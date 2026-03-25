use rusqlite::params;
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use crate::db::{migrations::now_epoch_ms, models::Message, DbState};
use crate::errors::AppError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateUserMessageInput {
    pub conversation_id: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendAssistantMessageInput {
    pub conversation_id: String,
    pub content: String,
    pub status: Option<String>,
    pub engine: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMessageStatusInput {
    pub message_id: String,
    pub status: String,
    /// If provided, also update the message content (e.g. finalise streaming content)
    pub content: Option<String>,
}

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<Message> {
    Ok(Message {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        role: row.get(2)?,
        content: row.get(3)?,
        timestamp: row.get(4)?,
        status: row.get(5)?,
        progress_content: row.get(6)?,
        engine: row.get(7)?,
        model: row.get(8)?,
        persona: row.get(9)?,
    })
}

#[tauri::command]
pub fn list_messages(
    conversation_id: String,
    state: State<DbState>,
) -> Result<Vec<Message>, AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let mut stmt = conn.prepare(
        "SELECT id, conversation_id, role, content, timestamp, status,
                progress_content, engine, model, persona
         FROM messages WHERE conversation_id = ?1 ORDER BY timestamp ASC",
    )?;
    let rows = stmt
        .query_map([&conversation_id], map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn create_user_message(
    input: CreateUserMessageInput,
    state: State<DbState>,
) -> Result<Message, AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let id = Uuid::new_v4().to_string();
    let now = now_epoch_ms();
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content, timestamp, status)
         VALUES (?1, ?2, 'user', ?3, ?4, 'done')",
        params![id, input.conversation_id, input.content, now],
    )?;
    Ok(Message {
        id,
        conversation_id: input.conversation_id,
        role: "user".into(),
        content: input.content,
        timestamp: now,
        status: "done".into(),
        progress_content: None,
        engine: None,
        model: None,
        persona: None,
    })
}

#[tauri::command]
pub fn append_assistant_message(
    input: AppendAssistantMessageInput,
    state: State<DbState>,
) -> Result<Message, AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let id = Uuid::new_v4().to_string();
    let now = now_epoch_ms();
    let status = input.status.as_deref().unwrap_or("done").to_string();
    conn.execute(
        "INSERT INTO messages
         (id, conversation_id, role, content, timestamp, status, engine, model)
         VALUES (?1, ?2, 'assistant', ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            input.conversation_id,
            input.content,
            now,
            status,
            input.engine,
            input.model,
        ],
    )?;
    Ok(Message {
        id,
        conversation_id: input.conversation_id,
        role: "assistant".into(),
        content: input.content,
        timestamp: now,
        status,
        progress_content: None,
        engine: input.engine,
        model: input.model,
        persona: None,
    })
}

#[tauri::command]
pub fn update_message_status(
    input: UpdateMessageStatusInput,
    state: State<DbState>,
) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    if let Some(content) = input.content {
        conn.execute(
            "UPDATE messages SET status = ?1, content = ?2 WHERE id = ?3",
            params![input.status, content, input.message_id],
        )?;
    } else {
        conn.execute(
            "UPDATE messages SET status = ?1 WHERE id = ?2",
            params![input.status, input.message_id],
        )?;
    }
    Ok(())
}
