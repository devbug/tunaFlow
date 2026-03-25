use rusqlite::params;
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use crate::db::{migrations::now_epoch_ms, models::Artifact, DbState};
use crate::errors::AppError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateArtifactInput {
    pub conversation_id: Option<String>,
    pub branch_id: Option<String>,
    pub subtask_id: Option<String>,
    #[serde(rename = "type")]
    pub artifact_type: String,
    pub title: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateArtifactStatusInput {
    pub id: String,
    pub status: String,
}

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<Artifact> {
    Ok(Artifact {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        branch_id: row.get(2)?,
        subtask_id: row.get(3)?,
        artifact_type: row.get(4)?,
        title: row.get(5)?,
        content: row.get(6)?,
        status: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

const SELECT_COLS: &str =
    "id, conversation_id, branch_id, subtask_id, type, title, content, status, created_at, updated_at";

#[tauri::command]
pub fn list_artifacts(
    conversation_id: String,
    state: State<DbState>,
) -> Result<Vec<Artifact>, AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let sql = format!(
        "SELECT {} FROM artifacts WHERE conversation_id = ?1 ORDER BY updated_at DESC",
        SELECT_COLS
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([&conversation_id], map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn list_artifacts_by_branch(
    branch_id: String,
    state: State<DbState>,
) -> Result<Vec<Artifact>, AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let sql = format!(
        "SELECT {} FROM artifacts WHERE branch_id = ?1 ORDER BY updated_at DESC",
        SELECT_COLS
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([&branch_id], map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn create_artifact(
    input: CreateArtifactInput,
    state: State<DbState>,
) -> Result<Artifact, AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let id = Uuid::new_v4().to_string();
    let now = now_epoch_ms();

    conn.execute(
        "INSERT INTO artifacts (id, conversation_id, branch_id, subtask_id, type, title, content, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'draft', ?8, ?9)",
        params![
            id,
            input.conversation_id,
            input.branch_id,
            input.subtask_id,
            input.artifact_type,
            input.title,
            input.content,
            now,
            now,
        ],
    )?;

    Ok(Artifact {
        id,
        conversation_id: input.conversation_id,
        branch_id: input.branch_id,
        subtask_id: input.subtask_id,
        artifact_type: input.artifact_type,
        title: input.title,
        content: input.content,
        status: "draft".into(),
        created_at: now,
        updated_at: now,
    })
}

#[tauri::command]
pub fn update_artifact_status(
    input: UpdateArtifactStatusInput,
    state: State<DbState>,
) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let now = now_epoch_ms();
    conn.execute(
        "UPDATE artifacts SET status = ?1, updated_at = ?2 WHERE id = ?3",
        params![input.status, now, input.id],
    )?;
    Ok(())
}

/// Link an existing artifact to a plan subtask.
/// This is the minimal "weak link" between plan outcomes and artifacts.
#[tauri::command]
pub fn link_artifact_to_subtask(
    artifact_id: String,
    subtask_id: String,
    state: State<DbState>,
) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let now = now_epoch_ms();
    conn.execute(
        "UPDATE artifacts SET subtask_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![subtask_id, now, artifact_id],
    )?;
    Ok(())
}

#[tauri::command]
pub fn delete_artifact(id: String, state: State<DbState>) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    conn.execute("DELETE FROM artifacts WHERE id = ?1", [&id])?;
    Ok(())
}
