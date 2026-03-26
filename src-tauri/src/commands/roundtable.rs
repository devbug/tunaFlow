use rusqlite::params;
use serde::Deserialize;
use tauri::{Emitter, State};
use uuid::Uuid;


use crate::db::{migrations::now_epoch_ms, models::Message, DbState};
use crate::errors::AppError;
use crate::CancelRegistry;

use super::roundtable_helpers::executor::{
    execute_round, RoundStrategy, RoundtableParticipant,
};
use super::roundtable_helpers::persist::{archive_transcript, persist_header, save_shared_brief};
use super::agents_helpers::trace_log::{insert_trace_log, new_trace_id, new_span_id, SpanInfo};
use super::agents_helpers::context_pack::build_rt_inheritance_section;
use super::context_queries::project_path_for_conversation;

// ─── Input type ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundtableRunInput {
    pub conversation_id: String,
    pub prompt: String,
    pub participants: Vec<RoundtableParticipant>,
    /// Ignored — kept for backward compat. Each invocation runs exactly 1 round.
    #[allow(dead_code)]
    pub rounds: Option<u32>,
    pub mode: Option<String>,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn parse_strategy(mode: &str) -> (RoundStrategy, &'static str) {
    match mode {
        "deliberative" => (RoundStrategy::Deliberative, "Deliberative"),
        _ => (RoundStrategy::Sequential, "Sequential"),
    }
}

fn participant_names(participants: &[RoundtableParticipant]) -> String {
    participants.iter().map(|p| p.name.as_str()).collect::<Vec<_>>().join(", ")
}

/// Count existing round headers to determine the next round number.
fn next_round_number(conn: &rusqlite::Connection, conversation_id: &str) -> u32 {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM messages
             WHERE conversation_id = ?1 AND engine = 'system' AND content LIKE '--- Round %'",
            [conversation_id],
            |row| row.get(0),
        )
        .unwrap_or(0);
    (count as u32) + 1
}

// ─── Commands ────────────────────────────────────────────────────────────────

/// Start a roundtable: always executes exactly 1 round (round 1).
#[tauri::command]
pub fn roundtable_run(
    input: RoundtableRunInput,
    state: State<DbState>,
    app: tauri::AppHandle,
    cancel: State<CancelRegistry>,
) -> Result<Vec<Message>, AppError> {
    let rt_mode = input.mode.as_deref().unwrap_or("sequential");
    let (strategy, mode_label) = parse_strategy(rt_mode);
    let names = participant_names(&input.participants);

    // Insert user message + emit round header + load project path + inheritance context
    let mut all_messages: Vec<Message> = Vec::new();
    let project_path: Option<String>;
    let enriched_prompt: String;
    {
        let conn = state.0.lock().map_err(|_| AppError::Lock)?;

        // Load project path for RT participants
        project_path = project_path_for_conversation(&conn, &input.conversation_id);

        // Build RT inheritance context (anchor + recent parent turns)
        let inheritance = build_rt_inheritance_section(&conn, &input.conversation_id, None);
        enriched_prompt = if let Some(ctx) = inheritance {
            format!("{}\n\n---\n\n{}", ctx, input.prompt)
        } else {
            input.prompt.clone()
        };

        let id = Uuid::new_v4().to_string();
        let now = now_epoch_ms();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, timestamp, status)
             VALUES (?1, ?2, 'user', ?3, ?4, 'done')",
            params![id, input.conversation_id, input.prompt, now],
        )?;

        let header = format!("--- Round 1 · {} · {} ---", mode_label, names);
        let header_msg = persist_header(&conn, &input.conversation_id, &header)?;
        let _ = app.emit("roundtable:progress", &header_msg);
        all_messages.push(header_msg);
    }

    // Execute 1 round with OTel tracing
    let trace_id = new_trace_id();
    let root_span_id = new_span_id();
    let t0 = std::time::Instant::now();

    let (msgs, round_responses) = execute_round(
        &input.participants,
        &[],
        1,
        1,
        &enriched_prompt,
        strategy,
        rt_mode,
        &input.conversation_id,
        &state,
        &app,
        &cancel,
        &trace_id,
        &root_span_id,
        project_path.as_deref(),
    )?;
    all_messages.extend(msgs);

    // Archive + root span
    {
        let conn = state.0.lock().map_err(|_| AppError::Lock)?;
        let _ = archive_transcript(
            &conn,
            &input.conversation_id,
            &input.prompt,
            &round_responses,
            1,
            rt_mode,
        );
        save_shared_brief(&conn, &input.conversation_id, &input.prompt, &round_responses, rt_mode);
        insert_trace_log(&conn, &input.conversation_id, 0, 0, 0.0, now_epoch_ms(), &SpanInfo {
            trace_id: &trace_id,
            span_id: root_span_id,
            parent_span_id: None,
            operation: "roundtable.run",
            engine: "system",
            duration_ms: t0.elapsed().as_millis() as i64,
            status: "ok",
        });
    }

    Ok(all_messages)
}

/// Follow-up on an existing roundtable: loads prior transcript, runs 1 round
/// with the given participants (which may differ from previous rounds).
#[tauri::command]
pub fn roundtable_followup(
    input: RoundtableRunInput,
    state: State<DbState>,
    app: tauri::AppHandle,
    cancel: State<CancelRegistry>,
) -> Result<Vec<Message>, AppError> {
    let rt_mode = input.mode.as_deref().unwrap_or("sequential");
    let (strategy, mode_label) = parse_strategy(rt_mode);
    let names = participant_names(&input.participants);

    // Load prior transcript + insert user message + emit round header
    let prior_transcript: Vec<(String, String)>;
    let round_num: u32;
    let mut all_messages: Vec<Message> = Vec::new();
    let project_path: Option<String>;
    {
        let conn = state.0.lock().map_err(|_| AppError::Lock)?;

        // Load project path for RT participants
        project_path = project_path_for_conversation(&conn, &input.conversation_id);

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

        round_num = next_round_number(&conn, &input.conversation_id) + 1;
        let header = format!("--- Round {} · {} · {} ---", round_num, mode_label, names);
        let header_msg = persist_header(&conn, &input.conversation_id, &header)?;
        let _ = app.emit("roundtable:progress", &header_msg);
        all_messages.push(header_msg);
    }

    // Execute 1 round with OTel tracing
    let trace_id = new_trace_id();
    let root_span_id = new_span_id();
    let t0 = std::time::Instant::now();

    let (msgs, followup_responses) = execute_round(
        &input.participants,
        &prior_transcript,
        round_num,
        round_num,
        &input.prompt,
        strategy,
        rt_mode,
        &input.conversation_id,
        &state,
        &app,
        &cancel,
        &trace_id,
        &root_span_id,
        project_path.as_deref(),
    )?;
    all_messages.extend(msgs);

    // Archive + root span
    {
        let conn = state.0.lock().map_err(|_| AppError::Lock)?;
        let _ = archive_transcript(
            &conn,
            &input.conversation_id,
            &input.prompt,
            &followup_responses,
            1,
            rt_mode,
        );
        save_shared_brief(&conn, &input.conversation_id, &input.prompt, &followup_responses, rt_mode);
        insert_trace_log(&conn, &input.conversation_id, 0, 0, 0.0, now_epoch_ms(), &SpanInfo {
            trace_id: &trace_id,
            span_id: root_span_id,
            parent_span_id: None,
            operation: "roundtable.followup",
            engine: "system",
            duration_ms: t0.elapsed().as_millis() as i64,
            status: "ok",
        });
    }

    Ok(all_messages)
}

/// Cancel a specific thread/conversation by its id.
#[tauri::command]
pub fn cancel_running(
    conversation_id: String,
    cancel: State<CancelRegistry>,
) -> Result<(), AppError> {
    cancel.cancel(&conversation_id);
    eprintln!("[cancel] registered for {}", conversation_id);
    Ok(())
}
