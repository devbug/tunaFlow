use rusqlite::params;
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use crate::db::{migrations::now_epoch_ms, models::Memo, DbState};
use crate::errors::AppError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMemoInput {
    pub message_id: String,
    pub conversation_id: String,
    pub project_key: String,
    pub content: String,
    #[serde(rename = "type")]
    pub memo_type: Option<String>,
    pub tags: Option<String>,
}

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<Memo> {
    Ok(Memo {
        id: row.get(0)?,
        message_id: row.get(1)?,
        conversation_id: row.get(2)?,
        project_key: row.get(3)?,
        content: row.get(4)?,
        memo_type: row.get(5)?,
        tags: row.get(6)?,
        created_at: row.get(7)?,
    })
}

const SELECT_COLS: &str =
    "id, message_id, conversation_id, project_key, content, type, tags, created_at";

#[tauri::command]
pub fn list_memos(
    project_key: String,
    state: State<DbState>,
) -> Result<Vec<Memo>, AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let sql = format!(
        "SELECT {} FROM memos WHERE project_key = ?1 ORDER BY created_at DESC",
        SELECT_COLS
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([&project_key], map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn list_memos_by_conversation(
    conversation_id: String,
    state: State<DbState>,
) -> Result<Vec<Memo>, AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let sql = format!(
        "SELECT {} FROM memos WHERE conversation_id = ?1 ORDER BY created_at DESC",
        SELECT_COLS
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([&conversation_id], map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn create_memo(
    input: CreateMemoInput,
    state: State<DbState>,
) -> Result<Memo, AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let id = Uuid::new_v4().to_string();
    let now = now_epoch_ms();
    let memo_type = input.memo_type.as_deref().unwrap_or("context");
    let tags = input.tags.as_deref().unwrap_or("[]");

    conn.execute(
        "INSERT INTO memos (id, message_id, conversation_id, project_key, content, type, tags, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, input.message_id, input.conversation_id, input.project_key, input.content, memo_type, tags, now],
    )?;

    Ok(Memo {
        id,
        message_id: input.message_id,
        conversation_id: input.conversation_id,
        project_key: input.project_key,
        content: input.content,
        memo_type: memo_type.to_string(),
        tags: tags.to_string(),
        created_at: now,
    })
}

#[tauri::command]
pub fn delete_memo(id: String, state: State<DbState>) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    conn.execute("DELETE FROM memos WHERE id = ?1", [&id])?;
    Ok(())
}
