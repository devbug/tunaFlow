use rusqlite::params;
use serde::Serialize;
use tauri::State;

use crate::db::{migrations::now_epoch_ms, DbState};
use crate::errors::AppError;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentJob {
    pub id: String,
    pub conversation_id: String,
    pub message_id: Option<String>,
    pub engine: String,
    pub kind: String,
    pub status: String,
    pub error: Option<String>,
    pub started_at: i64,
    pub updated_at: i64,
}

/// Create a new job record. Called from start_* commands.
pub fn create_job(
    conn: &rusqlite::Connection,
    id: &str,
    conversation_id: &str,
    message_id: Option<&str>,
    engine: &str,
    kind: &str,
) -> Result<(), AppError> {
    let now = now_epoch_ms();
    conn.execute(
        "INSERT INTO agent_jobs (id, conversation_id, message_id, engine, kind, status, started_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6, ?6)",
        params![id, conversation_id, message_id, engine, kind, now],
    )?;
    Ok(())
}

/// Update job status. Called from background threads on completion/error.
pub fn complete_job(
    conn: &rusqlite::Connection,
    id: &str,
    status: &str,
    error: Option<&str>,
) -> Result<(), AppError> {
    let now = now_epoch_ms();
    conn.execute(
        "UPDATE agent_jobs SET status = ?1, error = ?2, updated_at = ?3 WHERE id = ?4",
        params![status, error, now, id],
    )?;
    Ok(())
}

/// List active (running) jobs. Used by frontend to detect in-progress work.
#[tauri::command]
pub fn list_active_jobs(state: State<DbState>) -> Result<Vec<AgentJob>, AppError> {
    let conn = state.read.lock().map_err(|_| AppError::Lock)?;
    let mut stmt = conn.prepare(
        "SELECT id, conversation_id, message_id, engine, kind, status, error, started_at, updated_at
         FROM agent_jobs WHERE status = 'running' ORDER BY started_at DESC",
    )?;
    let jobs = stmt.query_map([], |row| {
        Ok(AgentJob {
            id: row.get(0)?,
            conversation_id: row.get(1)?,
            message_id: row.get(2)?,
            engine: row.get(3)?,
            kind: row.get(4)?,
            status: row.get(5)?,
            error: row.get(6)?,
            started_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    })?.filter_map(|r| r.ok()).collect();
    Ok(jobs)
}

/// Cleanup stale jobs: mark 'running' jobs as 'stale' and fix orphaned streaming messages.
/// Called on app startup to recover from interrupted runs.
#[tauri::command]
pub fn cleanup_stale_jobs(state: State<DbState>) -> Result<i64, AppError> {
    let conn = state.write.lock().map_err(|_| AppError::Lock)?;
    let now = now_epoch_ms();

    // Mark all running jobs as stale
    let job_count = conn.execute(
        "UPDATE agent_jobs SET status = 'stale', updated_at = ?1 WHERE status = 'running'",
        params![now],
    )?;

    // Fix orphaned streaming messages (from interrupted background threads)
    conn.execute(
        "UPDATE messages SET status = 'error', content = CASE WHEN content = '' THEN '(interrupted)' ELSE content END
         WHERE status = 'streaming'",
        [],
    )?;

    Ok(job_count as i64)
}
