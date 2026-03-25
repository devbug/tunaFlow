use rusqlite::params;
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use crate::db::{
    migrations::{now_epoch, now_epoch_ms},
    models::{Branch, Message},
    DbState,
};
use crate::errors::AppError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBranchInput {
    pub conversation_id: String,
    /// Auto-generated as b1, b1.1, etc. if not provided
    pub label: Option<String>,
    pub checkpoint_id: Option<String>,
    pub parent_branch_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptBranchInput {
    pub branch_id: String,
    pub conversation_id: String,
}

#[tauri::command]
pub fn list_branches(
    conversation_id: String,
    state: State<DbState>,
) -> Result<Vec<Branch>, AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let mut stmt = conn.prepare(
        "SELECT id, conversation_id, label, custom_label, status,
                checkpoint_id, parent_branch_id, session_id, git_branch, created_at
         FROM branches WHERE conversation_id = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt
        .query_map([&conversation_id], |row| {
            Ok(Branch {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                label: row.get(2)?,
                custom_label: row.get(3)?,
                status: row.get(4)?,
                checkpoint_id: row.get(5)?,
                parent_branch_id: row.get(6)?,
                session_id: row.get(7)?,
                git_branch: row.get(8)?,
                created_at: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn create_branch(
    input: CreateBranchInput,
    state: State<DbState>,
) -> Result<Branch, AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let id = Uuid::new_v4().to_string();
    let now = now_epoch();

    // Auto-generate label: b1, b1.1, b2, etc.
    let label = match input.label {
        Some(l) => l,
        None => {
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM branches WHERE conversation_id = ?1",
                [&input.conversation_id],
                |row| row.get(0),
            )?;
            match &input.parent_branch_id {
                None => format!("b{}", count + 1),
                Some(parent_id) => {
                    // Nested: derive from parent label
                    let parent_label: String = conn
                        .query_row(
                            "SELECT label FROM branches WHERE id = ?1",
                            [parent_id],
                            |row| row.get(0),
                        )
                        .unwrap_or_else(|_| format!("b{}", count));
                    let nested_count: i64 = conn.query_row(
                        "SELECT COUNT(*) FROM branches WHERE parent_branch_id = ?1",
                        [parent_id],
                        |row| row.get(0),
                    )?;
                    format!("{}.{}", parent_label, nested_count + 1)
                }
            }
        }
    };

    conn.execute(
        "INSERT INTO branches
         (id, conversation_id, label, status, checkpoint_id, parent_branch_id, created_at)
         VALUES (?1, ?2, ?3, 'active', ?4, ?5, ?6)",
        params![
            id,
            input.conversation_id,
            label,
            input.checkpoint_id,
            input.parent_branch_id,
            now,
        ],
    )?;

    Ok(Branch {
        id,
        conversation_id: input.conversation_id,
        label,
        custom_label: None,
        status: "active".into(),
        checkpoint_id: input.checkpoint_id,
        parent_branch_id: input.parent_branch_id,
        session_id: None,
        git_branch: None,
        created_at: now,
    })
}

/// Open (or ensure) a branch-dedicated conversation stream (DATA_MODEL §1.4, §1.5).
///
/// Branch messages are stored with `conversation_id = "branch:{branch_id}"`.
/// Because the `messages` table has FK → `conversations`, this command
/// creates a shadow `conversations` row with that id on first call (idempotent).
/// Returns the branch conversation id (`"branch:{branch_id}"`).
#[tauri::command]
pub fn open_branch_stream(
    branch_id: String,
    state: State<DbState>,
) -> Result<String, AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let branch_conv_id = format!("branch:{}", branch_id);

    // Idempotent: skip creation if shadow row already exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM conversations WHERE id = ?1",
            [&branch_conv_id],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;

    if !exists {
        // Resolve branch → parent conversation → project_key
        let (parent_conv_id, branch_label): (String, String) = conn
            .query_row(
                "SELECT conversation_id, label FROM branches WHERE id = ?1",
                [&branch_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| AppError::NotFound(format!("Branch '{}' not found", branch_id)))?;

        let project_key: String = conn
            .query_row(
                "SELECT project_key FROM conversations WHERE id = ?1",
                [&parent_conv_id],
                |row| row.get(0),
            )
            .map_err(|_| {
                AppError::NotFound(format!("Conversation '{}' not found", parent_conv_id))
            })?;

        let now = now_epoch();
        conn.execute(
            "INSERT INTO conversations
             (id, project_key, label, type, mode, parent_id, source,
              created_at, updated_at, total_input_tokens, total_output_tokens, total_cost_usd)
             VALUES (?1, ?2, ?3, 'branch', 'chat', ?4, 'tunadish', ?5, ?5, 0, 0, 0.0)",
            params![
                branch_conv_id,
                project_key,
                format!("Branch {}", branch_label),
                parent_conv_id,
                now,
            ],
        )?;
    }

    Ok(branch_conv_id)
}

/// Delete a branch and its shadow conversation + messages.
#[tauri::command]
pub fn delete_branch(
    id: String,
    state: State<DbState>,
) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;

    let branch_conv_id = format!("branch:{}", id);

    // Delete shadow conversation messages (FK cascade would handle this,
    // but the shadow conv itself needs explicit cleanup)
    conn.execute(
        "DELETE FROM messages WHERE conversation_id = ?1",
        [&branch_conv_id],
    )?;
    conn.execute(
        "DELETE FROM memos WHERE conversation_id = ?1",
        [&branch_conv_id],
    )?;
    conn.execute(
        "DELETE FROM artifacts WHERE conversation_id = ?1",
        [&branch_conv_id],
    )?;
    // Delete shadow conversation row
    conn.execute(
        "DELETE FROM conversations WHERE id = ?1",
        [&branch_conv_id],
    )?;
    // Delete the branch itself
    conn.execute("DELETE FROM branches WHERE id = ?1", [&id])?;

    Ok(())
}

/// DATA_MODEL §3.3 Adopt flow (simplified):
/// 1. Branch.status → 'adopted'
/// 2. Insert placeholder adopt-summary message in parent Conversation
#[tauri::command]
pub fn adopt_branch(
    input: AdoptBranchInput,
    state: State<DbState>,
) -> Result<Message, AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;

    // Validate branch exists and is active
    let branch_label: String = conn
        .query_row(
            "SELECT label FROM branches WHERE id = ?1 AND status = 'active'",
            [&input.branch_id],
            |row| row.get(0),
        )
        .map_err(|_| AppError::NotFound(format!("Active branch '{}' not found", input.branch_id)))?;

    // 1. Mark branch as adopted (irreversible per DATA_MODEL §7.1)
    conn.execute(
        "UPDATE branches SET status = 'adopted' WHERE id = ?1",
        [&input.branch_id],
    )?;

    // 2. Insert placeholder adopt-summary into parent conversation
    let msg_id = Uuid::new_v4().to_string();
    let now = now_epoch_ms();
    let content = format!(
        "<!-- branch-adopt-summary -->\nBranch {} adopted. Summary generation not implemented yet.",
        branch_label
    );
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content, timestamp, status)
         VALUES (?1, ?2, 'assistant', ?3, ?4, 'done')",
        params![msg_id, input.conversation_id, content, now],
    )?;

    Ok(Message {
        id: msg_id,
        conversation_id: input.conversation_id,
        role: "assistant".into(),
        content,
        timestamp: now,
        status: "done".into(),
        progress_content: None,
        engine: None,
        model: None,
        persona: None,
    })
}
