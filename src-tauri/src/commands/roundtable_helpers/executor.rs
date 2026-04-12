use tauri::Emitter;
use serde::{Deserialize, Serialize};

use crate::agents::{claude, codex, gemini, openai_compat, opencode};
use crate::db::{models::Message, DbState};
use crate::errors::AppError;
use crate::CancelRegistry;

/// Budget settings for local models (ollama, opencode) — smaller context window.
#[allow(dead_code)]
const LOCAL_MODE: &str = "lite";
#[allow(dead_code)]
const LOCAL_BUDGET_CAP: usize = 15_000;

/// Lightweight RT context — Tier 0+1 only.
/// Instead of running the full ContextPack pipeline (identity, skills, rawq,
/// memory, cross-session, retrieval — ~15k chars), we load only what RT
/// participants actually need: project path + active plan.
/// This reduces per-participant context from ~5-7k tokens to ~1-2k tokens.
pub(super) struct RtContextCache {
    pub(super) context: Option<String>,
}

impl RtContextCache {
    /// Build minimal Tier 0+1 context once per round.
    pub(super) fn build(
        state: &DbState,
        conversation_id: &str,
        _topic: &str,
        project_path: Option<&str>,
        _has_local: bool,
    ) -> Self {
        let conn = match state.read.lock() {
            Ok(c) => c,
            Err(_) => return Self { context: None },
        };

        let mut sections: Vec<String> = Vec::new();

        if let Some(p) = project_path {
            sections.push(format!("Project: {}", p));
        }

        let plan_conv_id = Self::resolve_plan_conv_id(&conn, conversation_id);
        if let Some(plan) = Self::load_plan_summary(&conn, &plan_conv_id) {
            sections.push(plan);
        }

        if let Some(findings) = Self::load_review_findings(&conn, &plan_conv_id) {
            sections.push(findings);
        }

        if sections.is_empty() {
            Self { context: None }
        } else {
            Self { context: Some(format!("## Project Context\n\n{}", sections.join("\n\n"))) }
        }
    }

    fn resolve_plan_conv_id(conn: &rusqlite::Connection, conversation_id: &str) -> String {
        if conversation_id.starts_with("branch:") {
            conn.query_row(
                "SELECT parent_id FROM conversations WHERE id = ?1",
                [conversation_id], |row| row.get::<_, Option<String>>(0),
            ).ok().flatten().unwrap_or_else(|| conversation_id.to_string())
        } else {
            conversation_id.to_string()
        }
    }

    fn load_plan_summary(conn: &rusqlite::Connection, conversation_id: &str) -> Option<String> {
        let (title, phase): (String, String) = conn.query_row(
            "SELECT title, phase FROM plans
             WHERE conversation_id = ?1 AND status = 'active'
             ORDER BY updated_at DESC LIMIT 1",
            [conversation_id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).ok()?;

        let plan_id: String = conn.query_row(
            "SELECT id FROM plans WHERE conversation_id = ?1 AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
            [conversation_id], |row| row.get(0),
        ).ok()?;

        let mut out = format!("### Active Plan (phase: {})\n{}", phase, title);

        if let Ok(mut stmt) = conn.prepare(
            "SELECT title, status FROM plan_subtasks WHERE plan_id = ?1 ORDER BY idx"
        ) {
            let subtasks: Vec<(String, String)> = stmt.query_map([&plan_id], |row| {
                Ok((row.get(0)?, row.get(1)?))
            }).ok()?.filter_map(|r| r.ok()).collect();

            if !subtasks.is_empty() {
                out.push('\n');
                for (st_title, st_status) in &subtasks {
                    let icon = match st_status.as_str() { "done" => "✅", "in_progress" => "🔧", _ => "⬜" };
                    out.push_str(&format!("{} {}\n", icon, st_title));
                }
            }
        }

        Some(out)
    }

    fn load_review_findings(conn: &rusqlite::Connection, conversation_id: &str) -> Option<String> {
        let phase: String = conn.query_row(
            "SELECT phase FROM plans WHERE conversation_id = ?1 AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
            [conversation_id], |row| row.get(0),
        ).ok()?;

        if phase != "review" && phase != "review_conditional" {
            return None;
        }

        let mut stmt = conn.prepare(
            "SELECT finding FROM failure_lessons
             WHERE project_key = (SELECT project_key FROM conversations WHERE id = ?1)
             AND resolution IS NULL
             ORDER BY created_at DESC LIMIT 5"
        ).ok()?;

        let findings: Vec<String> = stmt.query_map([conversation_id], |row| row.get(0))
            .ok()?.filter_map(|r| r.ok()).collect();

        if findings.is_empty() { return None; }

        let mut out = String::from("### Open Review Findings\n");
        for f in &findings {
            out.push_str(&format!("- {}\n", f));
        }
        Some(out)
    }

    /// Get cached context (same for all engines — minimal is always small enough).
    pub(super) fn get(&self, _engine_key: &str) -> Option<&str> {
        self.context.as_deref()
    }
}

/// In-memory vector index for RT transcript sharing.
pub(super) struct RtVectorIndex {
    entries: Vec<RtVectorEntry>,
}

pub(super) struct RtVectorEntry {
    pub(super) name: String,
    pub(super) text: String,
    pub(super) embedding: Vec<f32>,
}

impl RtVectorIndex {
    pub(super) fn new() -> Self { Self { entries: Vec::new() } }

    pub(super) fn add(&mut self, name: &str, content: &str) {
        let text = super::prompt::truncate(content, 800);
        match crate::agents::embedder::embed_text(&text, false) {
            Ok(emb) => {
                self.entries.push(RtVectorEntry {
                    name: name.to_string(), text, embedding: emb,
                });
            }
            Err(e) => eprintln!("[rt-vec] embed failed for {}: {:?}", name, e),
        }
    }

    pub(super) fn search(&self, topic: &str, limit: usize) -> Vec<(String, String)> {
        let query_emb = match crate::agents::embedder::embed_text(topic, true) {
            Ok(e) => e,
            Err(_) => return Vec::new(),
        };

        let mut scored: Vec<(f32, &RtVectorEntry)> = self.entries.iter()
            .map(|e| (crate::agents::rawq::cosine_similarity(&query_emb, &e.embedding), e))
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit);

        scored.into_iter()
            .filter(|(score, _)| *score > 0.2)
            .map(|(_, e)| (e.name.clone(), e.text.clone()))
            .collect()
    }

    pub(super) fn is_empty(&self) -> bool { self.entries.is_empty() }

    /// Return number of indexed entries (for logging).
    pub(super) fn entries_len(&self) -> usize { self.entries.len() }
}

/// Real-time participant execution status — emitted at actual subprocess lifecycle points.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RtParticipantStatus {
    pub conversation_id: String,
    pub name: String,
    pub engine: String,
    pub model: Option<String>,
    pub round: u32,
    pub status: String,
    #[serde(default)]
    pub blind: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundtableParticipant {
    pub name: String,
    pub model: Option<String>,
    pub engine: Option<String>,
    /// Blind verifier — receives only the topic, no prior/current transcript.
    #[serde(default)]
    pub blind: bool,
    /// RT role — affects output cap and prompt directive.
    #[serde(default)]
    pub role: Option<String>,
    /// Explicit output token cap. If not set, derived from role.
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

/// Build identity string for a RT participant.
pub(super) fn participant_identity(p: &RoundtableParticipant) -> String {
    let engine = p.engine.as_deref().unwrap_or("claude");
    let mut lines = vec![format!("## Your Identity in this Roundtable\n\nYou are **{}** (engine: {}).", p.name, engine)];
    if let Some(role) = &p.role {
        lines.push(format!("Your role: {}.", role));
    }
    if p.blind {
        lines.push("You are a blind verifier — you have NOT seen other participants' responses. Judge independently.".into());
    }
    lines.push("Do NOT claim to be a different agent. Do NOT use other participants' names as your own.".into());
    lines.join("\n")
}

/// Get the effective output token cap for a participant based on role.
fn effective_max_tokens(p: &RoundtableParticipant) -> Option<u32> {
    if let Some(cap) = p.max_tokens {
        return Some(cap);
    }
    match p.role.as_deref() {
        Some("proposer") => Some(1200),
        Some("reviewer" | "critic") => Some(900),
        Some("verifier" | "judge") => Some(800),
        Some("synthesizer" | "lead") => Some(1500),
        _ => None,
    }
}

/// Build output cap directive to prepend to prompt.
fn output_cap_directive(max_tokens: Option<u32>) -> String {
    match max_tokens {
        Some(cap) => format!(
            "[Output limit: Keep your response under approximately {} tokens. Be concise and focused.]\n\n",
            cap
        ),
        None => String::new(),
    }
}

/// Payload for real-time streaming chunks during RT participant execution.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RtChunkPayload {
    pub message_id: String,
    pub conversation_id: String,
    pub text: String,
}

pub struct ParticipantResult {
    pub name: String,
    pub engine: String,
    pub model: Option<String>,
    pub content: String,
    pub status: String,
    pub cost_usd: f64,
    pub in_tokens: i64,
    pub out_tokens: i64,
    pub prompt_sources: String,
    pub blind: bool,
    /// Session ID from the engine — used for resume_token in next round.
    pub session_id: Option<String>,
}

/// Controls how participants see context within and across rounds.
#[derive(Clone, Copy)]
pub enum RoundStrategy {
    Sequential,
    Deliberative,
}

/// Run a single participant against a prompt. No DB lock held.
/// Retained for non-streaming fallback (opencode).
#[allow(dead_code)]
pub async fn run_participant(
    p: &RoundtableParticipant,
    prompt: String,
    sources_json: String,
    project_path: Option<String>,
) -> ParticipantResult {
    let engine_key = p.engine.as_deref().unwrap_or("claude");
    let max_tok = effective_max_tokens(p);
    eprintln!("[rt] running participant={} engine={} role={:?} max_tokens={:?}", p.name, engine_key, p.role, max_tok);

    let prompt = format!("{}{}", output_cap_directive(max_tok), prompt);

    let run_input = claude::RunInput {
        prompt,
        model: p.model.clone(),
        system_prompt: None,
        resume_token: None,
        project_path,
    };

    let engine_key_owned = engine_key.to_string();
    let result = tokio::task::spawn_blocking(move || -> (Result<crate::agents::claude::RunOutput, AppError>, &'static str) {
        match engine_key_owned.as_str() {
            "claude" => (claude::run(run_input), "claude-code"),
            "codex" => (codex::run(run_input), "codex"),
            "gemini" => (gemini::run(run_input), "gemini"),
            "opencode" => (opencode::run(run_input), "opencode"),
            "ollama" => (openai_compat::run(run_input), "ollama"),
            _ => (
                Err(AppError::Agent(format!("unsupported engine: {}", engine_key_owned))),
                "unknown",
            ),
        }
    })
    .await
    .unwrap_or_else(|_| (Err(AppError::Agent("participant task panicked".into())), "unknown"));

    let (run_result, engine_label) = result;
    match run_result {
        Ok(out) => ParticipantResult {
            name: p.name.clone(),
            engine: engine_label.to_string(),
            model: p.model.clone(),
            content: out.content,
            status: "done".into(),
            cost_usd: out.cost_usd,
            in_tokens: out.input_tokens,
            out_tokens: out.output_tokens,
            prompt_sources: sources_json,
            blind: p.blind,
            session_id: out.session_id,
        },
        Err(e) => ParticipantResult {
            name: p.name.clone(),
            engine: engine_label.to_string(),
            model: p.model.clone(),
            content: format!("Error: {}", e),
            status: "error".into(),
            cost_usd: 0.0,
            in_tokens: 0,
            out_tokens: 0,
            prompt_sources: sources_json,
            blind: p.blind,
            session_id: None,
        },
    }
}

/// Run a single participant with real-time streaming. Emits `roundtable:chunk` events
/// as text arrives. Falls back to `run()` for engines without `stream_run()` (opencode).
pub(super) async fn stream_participant(
    p: &RoundtableParticipant,
    prompt: String,
    sources_json: String,
    project_path: Option<String>,
    msg_id: String,
    conversation_id: String,
    app: tauri::AppHandle,
    cancel_arc: std::sync::Arc<parking_lot::Mutex<std::collections::HashSet<String>>>,
    resume_token: Option<String>,
) -> ParticipantResult {
    let engine_key = p.engine.as_deref().unwrap_or("claude");
    let max_tok = effective_max_tokens(p);
    if resume_token.is_some() {
        eprintln!("[rt-stream] participant={} engine={} resume_token=yes", p.name, engine_key);
    }

    let prompt = format!("{}{}", output_cap_directive(max_tok), prompt);
    let run_input = claude::RunInput {
        prompt,
        model: p.model.clone(),
        system_prompt: None,
        resume_token,
        project_path,
    };

    let name = p.name.clone();
    let model = p.model.clone();
    let blind = p.blind;
    let engine_key_owned = engine_key.to_string();

    let result: (Result<claude::RunOutput, AppError>, &'static str) = match engine_key {
        "claude" | "gemini" => {
            let a = app.clone(); let mi = msg_id.clone(); let ci = conversation_id.clone();
            let ca = std::sync::Arc::clone(&cancel_arc);
            let ci2 = conversation_id.clone();
            let is_claude = engine_key == "claude";
            tokio::task::spawn_blocking(move || {
                let on_chunk = {
                    let a = a.clone(); let mi = mi.clone(); let ci = ci.clone();
                    move |text: String| {
                        let _ = a.emit("roundtable:chunk", RtChunkPayload {
                            message_id: mi.clone(), conversation_id: ci.clone(), text,
                        });
                    }
                };
                let on_progress = |_: String| {};
                let is_cancelled = move || ca.lock().contains(&ci2);
                if is_claude {
                    (claude::stream_run(run_input, on_progress, on_chunk, is_cancelled), "claude-code")
                } else {
                    (gemini::stream_run(run_input, on_progress, on_chunk, is_cancelled), "gemini")
                }
            })
            .await
            .unwrap_or_else(|_| (Err(AppError::Agent("participant task panicked".into())), "unknown"))
        }
        "codex" => {
            let a = app.clone(); let mi = msg_id.clone(); let ci = conversation_id.clone();
            tokio::task::spawn_blocking(move || {
                let on_chunk = {
                    let a = a.clone(); let mi = mi.clone(); let ci = ci.clone();
                    move |text: &str| {
                        let _ = a.emit("roundtable:chunk", RtChunkPayload {
                            message_id: mi.clone(), conversation_id: ci.clone(), text: text.to_string(),
                        });
                    }
                };
                let on_progress = |_: &str| {};
                (codex::stream_run(run_input, on_progress, on_chunk), "codex")
            })
            .await
            .unwrap_or_else(|_| (Err(AppError::Agent("participant task panicked".into())), "unknown"))
        }
        "ollama" => {
            let a = app.clone(); let mi = msg_id.clone(); let ci = conversation_id.clone();
            let on_chunk = {
                let a = a.clone(); let mi = mi.clone(); let ci = ci.clone();
                move |text: String| {
                    let _ = a.emit("roundtable:chunk", RtChunkPayload {
                        message_id: mi.clone(), conversation_id: ci.clone(), text,
                    });
                }
            };
            let on_progress = |_: String| {};
            (openai_compat::stream_run(run_input, on_progress, on_chunk).await, "ollama")
        }
        "opencode" => {
            tokio::task::spawn_blocking(move || {
                (opencode::run(run_input), "opencode")
            })
            .await
            .unwrap_or_else(|_| (Err(AppError::Agent("participant task panicked".into())), "unknown"))
        }
        _ => {
            (Err(AppError::Agent(format!("unsupported engine: {}", engine_key_owned))), "unknown")
        }
    };

    let (run_result, engine_label) = result;
    match run_result {
        Ok(out) => ParticipantResult {
            name, engine: engine_label.to_string(), model, content: out.content,
            status: "done".into(), cost_usd: out.cost_usd,
            in_tokens: out.input_tokens, out_tokens: out.output_tokens,
            prompt_sources: sources_json, blind, session_id: out.session_id,
        },
        Err(e) => ParticipantResult {
            name, engine: engine_label.to_string(), model, content: format!("Error: {}", e),
            status: "error".into(), cost_usd: 0.0, in_tokens: 0, out_tokens: 0,
            prompt_sources: sources_json, blind, session_id: None,
        },
    }
}

pub type SessionMap = std::collections::HashMap<String, String>;

/// Dispatch to Sequential or Deliberative execution.
pub async fn execute_round(
    participants: &[RoundtableParticipant],
    transcript: &[(String, String)],
    round_num: u32,
    total_rounds: u32,
    topic: &str,
    strategy: RoundStrategy,
    rt_mode: &str,
    conversation_id: &str,
    state: &DbState,
    app: &tauri::AppHandle,
    cancel: &CancelRegistry,
    trace_id: &str,
    root_span_id: &str,
    project_path: Option<&str>,
    session_map: &mut SessionMap,
) -> Result<(Vec<Message>, Vec<(String, String)>), AppError> {
    let prior_refs: Vec<String> = transcript.iter().map(|(n, _)| n.clone()).collect();

    match strategy {
        RoundStrategy::Sequential => super::sequential::execute_sequential(
            participants, transcript, &prior_refs, round_num, total_rounds, topic, rt_mode,
            conversation_id, state, app, cancel, trace_id, root_span_id, project_path, session_map,
        ).await,
        RoundStrategy::Deliberative => super::deliberative::execute_parallel(
            participants, transcript, &prior_refs, round_num, total_rounds, topic, rt_mode,
            conversation_id, state, app, cancel, trace_id, root_span_id, project_path, session_map,
        ).await,
    }
}

// ─── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_participant(name: &str, engine: Option<&str>, blind: bool, role: Option<&str>) -> RoundtableParticipant {
        RoundtableParticipant {
            name: name.into(),
            model: None,
            engine: engine.map(|s| s.into()),
            blind,
            role: role.map(|s| s.into()),
            max_tokens: None,
        }
    }

    #[test]
    fn identity_basic() {
        let p = make_participant("Alice", Some("claude"), false, None);
        let id = participant_identity(&p);
        assert!(id.contains("Alice"));
        assert!(id.contains("claude"));
        assert!(!id.contains("blind verifier"));
    }

    #[test]
    fn identity_blind_verifier() {
        let p = make_participant("Bob", Some("gemini"), true, Some("verifier"));
        let id = participant_identity(&p);
        assert!(id.contains("Bob"));
        assert!(id.contains("blind verifier"));
        assert!(id.contains("verifier"));
    }

    #[test]
    fn identity_with_role() {
        let p = make_participant("Charlie", Some("codex"), false, Some("proposer"));
        let id = participant_identity(&p);
        assert!(id.contains("proposer"));
    }

    #[test]
    fn identity_default_engine() {
        let p = make_participant("Default", None, false, None);
        let id = participant_identity(&p);
        assert!(id.contains("claude"));
    }

    #[test]
    fn identity_has_anti_impersonation_rule() {
        let p = make_participant("X", Some("gemini"), false, None);
        let id = participant_identity(&p);
        assert!(id.contains("Do NOT claim to be a different agent"));
    }

    #[test]
    fn max_tokens_explicit_override() {
        let mut p = make_participant("A", None, false, Some("proposer"));
        p.max_tokens = Some(2000);
        assert_eq!(effective_max_tokens(&p), Some(2000));
    }

    #[test]
    fn max_tokens_proposer_default() {
        let p = make_participant("A", None, false, Some("proposer"));
        assert_eq!(effective_max_tokens(&p), Some(1200));
    }

    #[test]
    fn max_tokens_reviewer_default() {
        let p = make_participant("A", None, false, Some("reviewer"));
        assert_eq!(effective_max_tokens(&p), Some(900));
    }

    #[test]
    fn max_tokens_critic_alias() {
        let p = make_participant("A", None, false, Some("critic"));
        assert_eq!(effective_max_tokens(&p), Some(900));
    }

    #[test]
    fn max_tokens_verifier_default() {
        let p = make_participant("A", None, false, Some("verifier"));
        assert_eq!(effective_max_tokens(&p), Some(800));
    }

    #[test]
    fn max_tokens_synthesizer_default() {
        let p = make_participant("A", None, false, Some("synthesizer"));
        assert_eq!(effective_max_tokens(&p), Some(1500));
    }

    #[test]
    fn max_tokens_lead_alias() {
        let p = make_participant("A", None, false, Some("lead"));
        assert_eq!(effective_max_tokens(&p), Some(1500));
    }

    #[test]
    fn max_tokens_no_role_none() {
        let p = make_participant("A", None, false, None);
        assert_eq!(effective_max_tokens(&p), None);
    }

    #[test]
    fn max_tokens_unknown_role_none() {
        let p = make_participant("A", None, false, Some("custom-role"));
        assert_eq!(effective_max_tokens(&p), None);
    }

    #[test]
    fn cap_directive_with_cap() {
        let d = output_cap_directive(Some(800));
        assert!(d.contains("800 tokens"));
        assert!(d.contains("Output limit"));
    }

    #[test]
    fn cap_directive_without_cap() {
        let d = output_cap_directive(None);
        assert!(d.is_empty());
    }

    #[test]
    fn context_cache_returns_same_for_all_engines() {
        let cache = RtContextCache {
            context: Some("plan ctx".into()),
        };
        assert_eq!(cache.get("claude"), Some("plan ctx"));
        assert_eq!(cache.get("gemini"), Some("plan ctx"));
        assert_eq!(cache.get("codex"), Some("plan ctx"));
        assert_eq!(cache.get("ollama"), Some("plan ctx"));
        assert_eq!(cache.get("opencode"), Some("plan ctx"));
    }

    #[test]
    fn context_cache_none_for_missing() {
        let cache = RtContextCache {
            context: None,
        };
        assert_eq!(cache.get("claude"), None);
        assert_eq!(cache.get("ollama"), None);
    }
}
