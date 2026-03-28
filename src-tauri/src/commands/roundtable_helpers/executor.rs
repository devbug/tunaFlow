use tauri::Emitter;
use serde::{Deserialize, Serialize};

use crate::agents::{claude, codex, gemini, opencode};
use crate::db::{models::Message, DbState};
use crate::errors::AppError;
use crate::CancelRegistry;

use super::prompt::{build_round_prompt, PromptSources};
use super::persist::persist_single;

/// Real-time participant execution status — emitted at actual subprocess lifecycle points.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RtParticipantStatus {
    pub conversation_id: String,
    pub name: String,
    pub engine: String,
    pub model: Option<String>,
    pub round: u32,
    pub status: String, // "running" | "done" | "error"
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundtableParticipant {
    pub name: String,
    pub model: Option<String>,
    pub engine: Option<String>,
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
}

/// Controls how participants see context within and across rounds.
#[derive(Clone, Copy)]
pub enum RoundStrategy {
    Sequential,
    Deliberative,
}

/// Run a single participant against a prompt. No DB lock held.
pub fn run_participant(
    p: &RoundtableParticipant,
    prompt: String,
    sources_json: String,
    project_path: Option<String>,
) -> ParticipantResult {
    let engine_key = p.engine.as_deref().unwrap_or("claude");
    eprintln!("[rt] running participant={} engine={} model={:?}", p.name, engine_key, p.model);

    let run_input = claude::RunInput {
        prompt,
        model: p.model.clone(),
        system_prompt: None,
        resume_token: None,
        project_path,
    };

    // Run subprocess in background thread to prevent UI freeze
    let engine_key_owned = engine_key.to_string();
    let (run_result, engine_label) = std::thread::spawn(move || -> (Result<crate::agents::claude::RunOutput, AppError>, &'static str) {
        match engine_key_owned.as_str() {
            "claude" => (claude::run(run_input), "claude-code"),
            "codex" => (codex::run(run_input), "codex"),
            "gemini" => (gemini::run(run_input), "gemini"),
            "opencode" => (opencode::run(run_input), "opencode"),
            _ => (
                Err(AppError::Agent(format!("unsupported engine: {}", engine_key_owned))),
                "unknown",
            ),
        }
    })
    .join()
    .unwrap_or_else(|_| (Err(AppError::Agent("participant thread panicked".into())), "unknown"));

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
        },
    }
}

/// Run all participants in a single round, persisting and emitting each result.
///
/// - **Sequential**: serial execution. Each participant runs after the previous finishes.
/// - **Deliberative**: parallel execution. All participants run simultaneously.
///
/// Prompt is passed through as-is — no forced context injection.
/// Users control what context to include in their prompt per round.
pub fn execute_round(
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
) -> Result<(Vec<Message>, Vec<(String, String)>), AppError> {
    let prior_refs: Vec<String> = transcript.iter().map(|(n, _)| n.clone()).collect();

    match strategy {
        RoundStrategy::Sequential => execute_sequential(
            participants, transcript, &prior_refs, round_num, total_rounds, topic, rt_mode,
            conversation_id, state, app, cancel, trace_id, root_span_id, project_path,
        ),
        RoundStrategy::Deliberative => execute_parallel(
            participants, transcript, &prior_refs, round_num, total_rounds, topic, rt_mode,
            conversation_id, state, app, cancel, trace_id, root_span_id, project_path,
        ),
    }
}

/// Sequential: run participants one by one. Each sees prior-round + current-round context.
fn execute_sequential(
    participants: &[RoundtableParticipant],
    transcript: &[(String, String)],
    prior_refs: &[String],
    round_num: u32, total_rounds: u32,
    topic: &str, rt_mode: &str,
    conversation_id: &str, state: &DbState, app: &tauri::AppHandle,
    cancel: &CancelRegistry, trace_id: &str, root_span_id: &str,
    project_path: Option<&str>,
) -> Result<(Vec<Message>, Vec<(String, String)>), AppError> {
    let mut messages = Vec::new();
    let mut round_responses: Vec<(String, String)> = Vec::new();

    for p in participants {
        if cancel.check_and_consume(conversation_id) {
            return Err(AppError::Agent("cancelled by user".into()));
        }

        let sources = PromptSources {
            round: round_num, total_rounds,
            mode: rt_mode.to_string(),
            prior_round_refs: prior_refs.to_vec(),
            current_round_refs: round_responses.iter().map(|(n, _)| n.clone()).collect(),
        };
        let sources_json = serde_json::to_string(&sources).unwrap_or_default();

        let engine_key = p.engine.as_deref().unwrap_or("claude");
        let _ = app.emit("roundtable:participant_status", RtParticipantStatus {
            conversation_id: conversation_id.to_string(),
            name: p.name.clone(), engine: engine_key.to_string(), model: p.model.clone(),
            round: round_num, status: "running".into(),
        });

        // Build prompt with discussion context (prior rounds + current round peers)
        let prompt = build_round_prompt(topic, transcript, &round_responses);
        let r = run_participant(p, prompt, sources_json, project_path.map(|s| s.to_string()));

        let _ = app.emit("roundtable:participant_status", RtParticipantStatus {
            conversation_id: conversation_id.to_string(),
            name: r.name.clone(), engine: r.engine.clone(), model: r.model.clone(),
            round: round_num, status: r.status.clone(),
        });

        let msg = {
            let conn = state.write.lock().map_err(|_| AppError::Lock)?;
            persist_single(&conn, conversation_id, &r, trace_id, root_span_id)?
        };
        let _ = app.emit("roundtable:progress", &msg);
        messages.push(msg);

        if r.status == "done" {
            round_responses.push((r.name.clone(), r.content.clone()));
        }
    }

    Ok((messages, round_responses))
}

/// Deliberative: run all participants in parallel, then persist results.
/// Each sees prior-round context but not current-round peers.
fn execute_parallel(
    participants: &[RoundtableParticipant],
    transcript: &[(String, String)],
    prior_refs: &[String],
    round_num: u32, total_rounds: u32,
    topic: &str, rt_mode: &str,
    conversation_id: &str, state: &DbState, app: &tauri::AppHandle,
    cancel: &CancelRegistry, trace_id: &str, root_span_id: &str,
    project_path: Option<&str>,
) -> Result<(Vec<Message>, Vec<(String, String)>), AppError> {
    if cancel.check_and_consume(conversation_id) {
        return Err(AppError::Agent("cancelled by user".into()));
    }

    // Emit "running" for all participants at once
    for p in participants {
        let engine_key = p.engine.as_deref().unwrap_or("claude");
        let _ = app.emit("roundtable:participant_status", RtParticipantStatus {
            conversation_id: conversation_id.to_string(),
            name: p.name.clone(), engine: engine_key.to_string(), model: p.model.clone(),
            round: round_num, status: "running".into(),
        });
    }

    // Build sources metadata (same for all — no current-round refs in deliberative)
    let sources = PromptSources {
        round: round_num, total_rounds,
        mode: rt_mode.to_string(),
        prior_round_refs: prior_refs.to_vec(),
        current_round_refs: Vec::new(),
    };
    let sources_json = serde_json::to_string(&sources).unwrap_or_default();

    // Build prompt with prior-round context (same for all — no current-round peers in deliberative)
    let prompt = build_round_prompt(topic, transcript, &[]);

    // Spawn all participants in parallel
    let handles: Vec<_> = participants.iter().map(|p| {
        let p_clone = p.clone();
        let pr = prompt.clone();
        let sj = sources_json.clone();
        let pp = project_path.map(|s| s.to_string());
        std::thread::spawn(move || run_participant(&p_clone, pr, sj, pp))
    }).collect();

    // Collect results as threads finish (join order = participant order)
    let mut messages = Vec::new();
    let mut round_responses: Vec<(String, String)> = Vec::new();

    for handle in handles {
        let r = handle.join().unwrap_or_else(|_| ParticipantResult {
            name: "unknown".into(), engine: "unknown".into(), model: None,
            content: "participant thread panicked".into(), status: "error".into(),
            cost_usd: 0.0, in_tokens: 0, out_tokens: 0, prompt_sources: String::new(),
        });

        let _ = app.emit("roundtable:participant_status", RtParticipantStatus {
            conversation_id: conversation_id.to_string(),
            name: r.name.clone(), engine: r.engine.clone(), model: r.model.clone(),
            round: round_num, status: r.status.clone(),
        });

        let msg = {
            let conn = state.write.lock().map_err(|_| AppError::Lock)?;
            persist_single(&conn, conversation_id, &r, trace_id, root_span_id)?
        };
        let _ = app.emit("roundtable:progress", &msg);
        messages.push(msg);

        if r.status == "done" {
            round_responses.push((r.name.clone(), r.content.clone()));
        }
    }

    Ok((messages, round_responses))
}
