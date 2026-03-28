//! Evaluation harness — save and compare roundtable/agent execution results.
//!
//! An `EvalRun` captures the full context of a multi-agent execution (prompt,
//! participants, mode, rounds). Each participant's response is stored as an
//! `EvalResult` with token counts and timing data.
//!
//! This enables:
//! - Re-running the same prompt to compare results across time
//! - Comparing different modes / participant configs on the same topic
//! - Cost/latency tracking per agent per run

use rusqlite::params;
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use crate::db::{migrations::now_epoch_ms, models::{EvalRun, EvalResult}, DbState};
use crate::errors::AppError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEvalRunInput {
    pub conversation_id: String,
    pub title: String,
    pub prompt: String,
    pub mode: Option<String>,
    /// JSON-encoded participant list for reference
    pub participants: Option<String>,
    pub rounds: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddEvalResultInput {
    pub eval_run_id: String,
    pub agent_name: String,
    pub engine: String,
    pub round: i64,
    pub content: String,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cost_usd: Option<f64>,
    pub duration_ms: Option<i64>,
}

fn map_run(row: &rusqlite::Row) -> rusqlite::Result<EvalRun> {
    Ok(EvalRun {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        title: row.get(2)?,
        prompt: row.get(3)?,
        mode: row.get(4)?,
        participants: row.get(5)?,
        rounds: row.get(6)?,
        status: row.get(7)?,
        created_at: row.get(8)?,
    })
}

fn map_result(row: &rusqlite::Row) -> rusqlite::Result<EvalResult> {
    Ok(EvalResult {
        id: row.get(0)?,
        eval_run_id: row.get(1)?,
        agent_name: row.get(2)?,
        engine: row.get(3)?,
        round: row.get(4)?,
        content: row.get(5)?,
        input_tokens: row.get(6)?,
        output_tokens: row.get(7)?,
        cost_usd: row.get(8)?,
        duration_ms: row.get(9)?,
        created_at: row.get(10)?,
    })
}

const RUN_COLS: &str =
    "id, conversation_id, title, prompt, mode, participants, rounds, status, created_at";
const RESULT_COLS: &str =
    "id, eval_run_id, agent_name, engine, round, content, input_tokens, output_tokens, cost_usd, duration_ms, created_at";

/// Create a new evaluation run.
#[tauri::command]
pub fn create_eval_run(
    input: CreateEvalRunInput,
    state: State<DbState>,
) -> Result<EvalRun, AppError> {
    let conn = state.write.lock().map_err(|_| AppError::Lock)?;
    let id = Uuid::new_v4().to_string();
    let now = now_epoch_ms();
    let rounds = input.rounds.unwrap_or(1);

    conn.execute(
        "INSERT INTO eval_runs (id, conversation_id, title, prompt, mode, participants, rounds, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8)",
        params![id, input.conversation_id, input.title, input.prompt, input.mode, input.participants, rounds, now],
    )?;

    Ok(EvalRun {
        id,
        conversation_id: input.conversation_id,
        title: input.title,
        prompt: input.prompt,
        mode: input.mode,
        participants: input.participants,
        rounds,
        status: "pending".into(),
        created_at: now,
    })
}

/// List evaluation runs for a conversation, ordered by creation time descending.
#[tauri::command]
pub fn list_eval_runs(
    conversation_id: String,
    state: State<DbState>,
) -> Result<Vec<EvalRun>, AppError> {
    let conn = state.read.lock().map_err(|_| AppError::Lock)?;
    let sql = format!(
        "SELECT {} FROM eval_runs WHERE conversation_id = ?1 ORDER BY created_at DESC",
        RUN_COLS
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([&conversation_id], map_run)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Add a single agent result to an evaluation run.
#[tauri::command]
pub fn add_eval_result(
    input: AddEvalResultInput,
    state: State<DbState>,
) -> Result<EvalResult, AppError> {
    let conn = state.write.lock().map_err(|_| AppError::Lock)?;
    let id = Uuid::new_v4().to_string();
    let now = now_epoch_ms();

    conn.execute(
        "INSERT INTO eval_results (id, eval_run_id, agent_name, engine, round, content, input_tokens, output_tokens, cost_usd, duration_ms, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            id,
            input.eval_run_id,
            input.agent_name,
            input.engine,
            input.round,
            input.content,
            input.input_tokens.unwrap_or(0),
            input.output_tokens.unwrap_or(0),
            input.cost_usd.unwrap_or(0.0),
            input.duration_ms.unwrap_or(0),
            now,
        ],
    )?;

    Ok(EvalResult {
        id,
        eval_run_id: input.eval_run_id,
        agent_name: input.agent_name,
        engine: input.engine,
        round: input.round,
        content: input.content,
        input_tokens: input.input_tokens.unwrap_or(0),
        output_tokens: input.output_tokens.unwrap_or(0),
        cost_usd: input.cost_usd.unwrap_or(0.0),
        duration_ms: input.duration_ms.unwrap_or(0),
        created_at: now,
    })
}

/// List results for an evaluation run, ordered by round then agent name.
#[tauri::command]
pub fn list_eval_results(
    eval_run_id: String,
    state: State<DbState>,
) -> Result<Vec<EvalResult>, AppError> {
    let conn = state.read.lock().map_err(|_| AppError::Lock)?;
    let sql = format!(
        "SELECT {} FROM eval_results WHERE eval_run_id = ?1 ORDER BY round, agent_name",
        RESULT_COLS
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([&eval_run_id], map_result)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Mark an evaluation run as done or failed.
#[tauri::command]
pub fn update_eval_run_status(
    id: String,
    status: String,
    state: State<DbState>,
) -> Result<(), AppError> {
    let conn = state.write.lock().map_err(|_| AppError::Lock)?;
    conn.execute(
        "UPDATE eval_runs SET status = ?1 WHERE id = ?2",
        params![status, id],
    )?;
    Ok(())
}

/// Delete an evaluation run and its results (cascade).
#[tauri::command]
pub fn delete_eval_run(
    id: String,
    state: State<DbState>,
) -> Result<(), AppError> {
    let conn = state.write.lock().map_err(|_| AppError::Lock)?;
    conn.execute("DELETE FROM eval_runs WHERE id = ?1", [&id])?;
    Ok(())
}
