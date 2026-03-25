use rusqlite::params;
use serde::Deserialize;
use tauri::{Emitter, State};
use uuid::Uuid;

use std::sync::atomic::Ordering;

use crate::agents::{claude, codex, gemini, opencode};
use crate::db::{migrations::now_epoch_ms, models::Message, DbState};
use crate::errors::AppError;
use crate::CancelFlag;

/// Maximum characters per prior response included in prompt context.
const MAX_ANSWER_LENGTH: usize = 4000;

// ─── Input types ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundtableParticipant {
    pub name: String,
    pub model: Option<String>,
    /// "claude" | "codex" | "gemini" | "opencode". Defaults to "claude".
    pub engine: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundtableRunInput {
    pub conversation_id: String,
    pub prompt: String,
    pub participants: Vec<RoundtableParticipant>,
    /// Number of rounds (default 1, max 3).
    pub rounds: Option<u32>,
    /// Execution mode: "independent" | "sequential" | "deliberative".
    /// Defaults to "sequential".
    pub mode: Option<String>,
}

// ─── Internal types ──────────────────────────────────────────────────────────

struct ParticipantResult {
    name: String,
    engine: String,
    model: Option<String>,
    content: String,
    status: String,
    cost_usd: f64,
    in_tokens: i64,
    out_tokens: i64,
    /// JSON-encoded prompt source metadata for UI reference badges.
    prompt_sources: String,
}

/// Describes what context was included in a participant's prompt.
/// Serialized to JSON and stored in message.progress_content.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PromptSources {
    round: u32,
    total_rounds: u32,
    /// The RT mode string: "independent" | "sequential" | "deliberative"
    mode: String,
    /// Names of agents whose prior-round replies were included
    prior_round_refs: Vec<String>,
    /// Names of agents whose current-round replies were included (sequential within round)
    current_round_refs: Vec<String>,
}

/// Controls how participants see context within and across rounds.
#[derive(Clone, Copy)]
enum RoundStrategy {
    /// Every agent answers the raw topic — no cross-agent context at all.
    Independent,
    /// Each agent sees prior-round transcript + responses of agents earlier in the same round.
    Sequential,
    /// Round 1 is independent; Round 2+ agents see all prior-round answers, no within-round.
    Deliberative,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Truncate string to `max` characters (char-boundary safe).
fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let end = s
        .char_indices()
        .map(|(i, _)| i)
        .take_while(|&i| i <= max)
        .last()
        .unwrap_or(0);
    format!("{}...", &s[..end])
}

/// Build prompt for a single participant.
fn build_round_prompt(
    topic: &str,
    transcript: &[(String, String)],
    current_round: &[(String, String)],
) -> String {
    let mut sections: Vec<String> = Vec::new();

    if !transcript.is_empty() {
        let lines: Vec<String> = transcript
            .iter()
            .map(|(name, content)| {
                format!("**[{}]**:\n{}", name, truncate(content, MAX_ANSWER_LENGTH))
            })
            .collect();
        sections.push(format!("이전 라운드 응답:\n\n{}", lines.join("\n\n")));
    }

    if !current_round.is_empty() {
        let lines: Vec<String> = current_round
            .iter()
            .map(|(name, content)| {
                format!("**[{}]**:\n{}", name, truncate(content, MAX_ANSWER_LENGTH))
            })
            .collect();
        sections.push(format!(
            "이번 라운드 다른 에이전트 답변:\n\n{}",
            lines.join("\n\n")
        ));
    }

    if sections.is_empty() {
        return topic.to_string();
    }

    let context_block = sections.join("\n\n---\n\n");
    format!(
        "{}\n\n---\n\n위 의견들을 참고하여 답변해주세요: {}",
        context_block, topic
    )
}

/// Run a single participant against a prompt. No DB lock held.
fn run_participant(
    p: &RoundtableParticipant,
    prompt: String,
    sources_json: String,
) -> ParticipantResult {
    let engine_key = p.engine.as_deref().unwrap_or("claude");

    let run_input = claude::RunInput {
        prompt,
        model: p.model.clone(),
        system_prompt: None,
        resume_token: None,
    };

    let (run_result, engine_label) = match engine_key {
        "claude" => (claude::run(run_input), "claude-code"),
        "codex" => (codex::run(run_input), "codex"),
        "gemini" => (gemini::run(run_input), "gemini"),
        "opencode" => (opencode::run(run_input), "opencode"),
        other => (
            Err(AppError::Agent(format!("unsupported engine: {}", other))),
            "unknown",
        ),
    };

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

// ─── Per-message persistence ─────────────────────────────────────────────────

/// Persist a round header (system message) and return it.
fn persist_header(
    conn: &rusqlite::Connection,
    conversation_id: &str,
    text: &str,
) -> Result<Message, AppError> {
    let id = Uuid::new_v4().to_string();
    let now = now_epoch_ms();
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content, timestamp, status, engine)
         VALUES (?1, ?2, 'assistant', ?3, ?4, 'done', 'system')",
        params![id, conversation_id, text, now],
    )?;
    Ok(Message {
        id,
        conversation_id: conversation_id.to_string(),
        role: "assistant".into(),
        content: text.to_string(),
        timestamp: now,
        status: "done".into(),
        progress_content: None,
        engine: Some("system".into()),
        model: None,
        persona: None,
    })
}

/// Persist a single participant result, update conversation usage, and write trace log.
fn persist_single(
    conn: &rusqlite::Connection,
    conversation_id: &str,
    r: &ParticipantResult,
) -> Result<Message, AppError> {
    let msg_id = Uuid::new_v4().to_string();
    let now = now_epoch_ms();
    let progress = if r.prompt_sources.is_empty() {
        None
    } else {
        Some(r.prompt_sources.as_str())
    };

    conn.execute(
        "INSERT INTO messages
         (id, conversation_id, role, content, timestamp, status, progress_content, engine, model, persona)
         VALUES (?1, ?2, 'assistant', ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            msg_id,
            conversation_id,
            r.content,
            now,
            r.status,
            progress,
            r.engine,
            r.model,
            r.name,
        ],
    )?;

    conn.execute(
        "UPDATE conversations SET
             total_input_tokens  = total_input_tokens  + ?1,
             total_output_tokens = total_output_tokens + ?2,
             total_cost_usd      = total_cost_usd      + ?3,
             updated_at          = ?4
         WHERE id = ?5",
        params![r.in_tokens, r.out_tokens, r.cost_usd, now / 1000, conversation_id],
    )?;

    let _ = conn.execute(
        "INSERT INTO trace_log (conversation_id, input_tokens, output_tokens, cost_usd, recorded_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![conversation_id, r.in_tokens, r.out_tokens, r.cost_usd, now],
    );

    Ok(Message {
        id: msg_id,
        conversation_id: conversation_id.to_string(),
        role: "assistant".into(),
        content: r.content.clone(),
        timestamp: now,
        status: r.status.clone(),
        progress_content: if r.prompt_sources.is_empty() {
            None
        } else {
            Some(r.prompt_sources.clone())
        },
        engine: Some(r.engine.clone()),
        model: r.model.clone(),
        persona: Some(r.name.clone()),
    })
}

// ─── Archive ─────────────────────────────────────────────────────────────────

/// Archive the RT transcript into the memos table.
fn archive_transcript(
    conn: &rusqlite::Connection,
    conversation_id: &str,
    topic: &str,
    transcript: &[(String, String)],
    rounds: u32,
    rt_mode: &str,
) -> Result<(), AppError> {
    if transcript.is_empty() {
        return Ok(());
    }

    let project_key: String = conn
        .query_row(
            "SELECT project_key FROM conversations WHERE id = ?1",
            [conversation_id],
            |row| row.get(0),
        )
        .map_err(|_| AppError::NotFound("conversation not found for archive".into()))?;

    let transcript_text: String = transcript
        .iter()
        .map(|(name, content)| format!("**[{}]**:\n{}", name, content))
        .collect::<Vec<_>>()
        .join("\n\n");

    let mut seen = std::collections::HashSet::new();
    let unique_names: Vec<&str> = transcript
        .iter()
        .map(|(n, _)| n.as_str())
        .filter(|n| seen.insert(*n))
        .collect();

    let content = format!(
        "# Roundtable Archive\n\n\
         **Topic:** {}\n\
         **Mode:** {}\n\
         **Rounds:** {}\n\
         **Participants:** {}\n\n\
         ---\n\n\
         {}",
        topic,
        rt_mode,
        rounds,
        unique_names.join(", "),
        transcript_text,
    );

    let memo_id = Uuid::new_v4().to_string();
    let now = now_epoch_ms();
    let message_id: String = conn
        .query_row(
            "SELECT id FROM messages
             WHERE conversation_id = ?1 AND role = 'user'
             ORDER BY timestamp DESC LIMIT 1",
            [conversation_id],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "unknown".to_string());

    conn.execute(
        "INSERT INTO memos (id, message_id, conversation_id, project_key, content, type, tags, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'roundtable_archive', '[\"roundtable\"]', ?6)",
        params![memo_id, message_id, conversation_id, project_key, content, now],
    )?;

    Ok(())
}

// ─── Participant execution loop (shared by both commands) ────────────────────

/// Run all participants in a single round, persisting and emitting each result
/// as it completes. Returns round results and accumulated round_responses.
///
/// The `app` handle is used to emit `roundtable:progress` events so the
/// frontend can show each agent's response as soon as it arrives, instead
/// of waiting for the entire roundtable to finish.
fn execute_round(
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
    cancel: &CancelFlag,
) -> Result<(Vec<Message>, Vec<(String, String)>), AppError> {
    let mut messages: Vec<Message> = Vec::new();
    let mut round_responses: Vec<(String, String)> = Vec::new();

    for p in participants {
        // Check cancellation flag before each participant
        if cancel.0.load(Ordering::Relaxed) {
            cancel.0.store(false, Ordering::Relaxed);
            return Err(AppError::Agent("cancelled by user".into()));
        }
        // Build prompt + sources based on strategy
        let (prior_refs, current_refs, prompt) = match strategy {
            RoundStrategy::Independent => (
                Vec::<String>::new(),
                Vec::<String>::new(),
                topic.to_string(),
            ),
            RoundStrategy::Sequential => (
                transcript.iter().map(|(n, _)| n.clone()).collect(),
                round_responses.iter().map(|(n, _)| n.clone()).collect(),
                build_round_prompt(topic, transcript, &round_responses),
            ),
            RoundStrategy::Deliberative => (
                transcript.iter().map(|(n, _)| n.clone()).collect(),
                Vec::new(),
                build_round_prompt(topic, transcript, &[]),
            ),
        };

        let sources = PromptSources {
            round: round_num,
            total_rounds,
            mode: rt_mode.to_string(),
            prior_round_refs: prior_refs,
            current_round_refs: current_refs,
        };
        let sources_json = serde_json::to_string(&sources).unwrap_or_default();

        // Run participant (no DB lock held)
        let r = run_participant(p, prompt, sources_json);

        // Persist immediately + emit to frontend
        let msg = {
            let conn = state.0.lock().map_err(|_| AppError::Lock)?;
            persist_single(&conn, conversation_id, &r)?
        };
        let _ = app.emit("roundtable:progress", &msg);
        messages.push(msg);

        if r.status == "done" {
            round_responses.push((r.name.clone(), r.content.clone()));
        }
    }

    Ok((messages, round_responses))
}

// ─── Commands ────────────────────────────────────────────────────────────────

/// Execute a roundtable: user prompt → multi-round participant execution.
///
/// Each participant's response is persisted and emitted via `roundtable:progress`
/// as soon as it completes, so the frontend can show results incrementally.
#[tauri::command]
pub fn roundtable_run(
    input: RoundtableRunInput,
    state: State<DbState>,
    app: tauri::AppHandle,
    cancel: State<CancelFlag>,
) -> Result<Vec<Message>, AppError> {
    let rounds = input.rounds.unwrap_or(1).clamp(1, 3);
    let rt_mode = input.mode.as_deref().unwrap_or("sequential");
    let strategy = match rt_mode {
        "independent" => RoundStrategy::Independent,
        "deliberative" => RoundStrategy::Deliberative,
        _ => RoundStrategy::Sequential,
    };

    let mode_label = match rt_mode {
        "independent" => "Independent",
        "deliberative" => "Deliberative",
        _ => "Sequential",
    };

    // Step 1: insert user message
    {
        let conn = state.0.lock().map_err(|_| AppError::Lock)?;
        let id = Uuid::new_v4().to_string();
        let now = now_epoch_ms();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, timestamp, status)
             VALUES (?1, ?2, 'user', ?3, ?4, 'done')",
            params![id, input.conversation_id, input.prompt, now],
        )?;
    }

    // Step 2: run rounds — each participant is persisted + emitted individually
    let mut transcript: Vec<(String, String)> = Vec::new();
    let mut all_messages: Vec<Message> = Vec::new();

    for round_num in 1..=rounds {
        // Emit round header for multi-round
        if rounds > 1 {
            let header_text =
                format!("--- Round {}/{} · {} ---", round_num, rounds, mode_label);
            let conn = state.0.lock().map_err(|_| AppError::Lock)?;
            let header_msg = persist_header(&conn, &input.conversation_id, &header_text)?;
            let _ = app.emit("roundtable:progress", &header_msg);
            all_messages.push(header_msg);
        }

        let (msgs, round_responses) = execute_round(
            &input.participants,
            &transcript,
            round_num,
            rounds,
            &input.prompt,
            strategy,
            rt_mode,
            &input.conversation_id,
            &state,
            &app,
            &cancel,
        )?;
        all_messages.extend(msgs);

        // Accumulate transcript for next round (archive also uses this)
        transcript.extend(round_responses);
    }

    // Step 3: archive
    {
        let conn = state.0.lock().map_err(|_| AppError::Lock)?;
        let _ = archive_transcript(
            &conn,
            &input.conversation_id,
            &input.prompt,
            &transcript,
            rounds,
            rt_mode,
        );
    }

    Ok(all_messages)
}

/// Follow-up on an existing roundtable conversation.
///
/// Loads the previous transcript from existing assistant messages,
/// then runs one additional round with the new topic using the specified mode.
#[tauri::command]
pub fn roundtable_followup(
    input: RoundtableRunInput,
    state: State<DbState>,
    app: tauri::AppHandle,
    cancel: State<CancelFlag>,
) -> Result<Vec<Message>, AppError> {
    let rt_mode = input.mode.as_deref().unwrap_or("sequential");
    let strategy = match rt_mode {
        "independent" => RoundStrategy::Independent,
        "deliberative" => RoundStrategy::Deliberative,
        _ => RoundStrategy::Sequential,
    };

    // Step 1: load prior transcript + insert user message (lock)
    let prior_transcript: Vec<(String, String)>;
    {
        let conn = state.0.lock().map_err(|_| AppError::Lock)?;

        let mut stmt = conn.prepare(
            "SELECT persona, content FROM messages
             WHERE conversation_id = ?1
               AND role = 'assistant'
               AND persona IS NOT NULL
               AND status = 'done'
             ORDER BY timestamp",
        )?;
        prior_transcript = stmt
            .query_map([&input.conversation_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .filter_map(|r| r.ok())
            .collect();

        let id = Uuid::new_v4().to_string();
        let now = now_epoch_ms();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, timestamp, status)
             VALUES (?1, ?2, 'user', ?3, ?4, 'done')",
            params![id, input.conversation_id, input.prompt, now],
        )?;
    }

    // Step 2: run one round (each participant emitted individually)
    let (all_messages, followup_responses) = execute_round(
        &input.participants,
        &prior_transcript,
        1,
        1,
        &input.prompt,
        strategy,
        rt_mode,
        &input.conversation_id,
        &state,
        &app,
        &cancel,
    )?;

    // Step 3: archive
    {
        let conn = state.0.lock().map_err(|_| AppError::Lock)?;
        let followup_transcript: Vec<(String, String)> = followup_responses;
        let _ = archive_transcript(
            &conn,
            &input.conversation_id,
            &input.prompt,
            &followup_transcript,
            1,
            rt_mode,
        );
    }

    Ok(all_messages)
}

/// Set the cancellation flag so the next participant check in `execute_round`
/// will stop the roundtable early. The flag auto-resets after being consumed.
#[tauri::command]
pub fn cancel_running(cancel: State<CancelFlag>) -> Result<(), AppError> {
    cancel.0.store(true, Ordering::Relaxed);
    Ok(())
}
