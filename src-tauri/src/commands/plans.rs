use rusqlite::params;
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use crate::db::{migrations::now_epoch_ms, models::{Plan, PlanSubtask}, DbState};
use crate::errors::AppError;

// ─── Input types ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtaskInput {
    pub title: String,
    pub details: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePlanInput {
    pub conversation_id: String,
    pub branch_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub expected_outcome: Option<String>,
    /// Initial subtasks to create alongside the plan (optional).
    #[serde(default)]
    pub subtasks: Vec<SubtaskInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePlanStatusInput {
    pub id: String,
    /// "draft" | "active" | "done" | "abandoned"
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSubtaskStatusInput {
    pub id: String,
    /// "todo" | "in_progress" | "done" | "abandoned"
    pub status: String,
    pub outcome: Option<String>,
}

// ─── Row mappers ─────────────────────────────────────────────────────────────

fn map_plan(row: &rusqlite::Row) -> rusqlite::Result<Plan> {
    Ok(Plan {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        branch_id: row.get(2)?,
        title: row.get(3)?,
        description: row.get(4)?,
        expected_outcome: row.get(5)?,
        status: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn map_subtask(row: &rusqlite::Row) -> rusqlite::Result<PlanSubtask> {
    Ok(PlanSubtask {
        id: row.get(0)?,
        plan_id: row.get(1)?,
        idx: row.get(2)?,
        title: row.get(3)?,
        details: row.get(4)?,
        status: row.get(5)?,
        outcome: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

const PLAN_COLS: &str =
    "id, conversation_id, branch_id, title, description, expected_outcome, status, created_at, updated_at";

const SUBTASK_COLS: &str =
    "id, plan_id, idx, title, details, status, outcome, created_at, updated_at";

// ─── Commands ─────────────────────────────────────────────────────────────────

/// Create a plan, optionally with an initial set of subtasks.
/// Returns the created Plan (subtasks can be retrieved via list_subtasks).
#[tauri::command]
pub fn create_plan(
    input: CreatePlanInput,
    state: State<DbState>,
) -> Result<Plan, AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let id = Uuid::new_v4().to_string();
    let now = now_epoch_ms();

    conn.execute(
        "INSERT INTO plans
         (id, conversation_id, branch_id, title, description, expected_outcome, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'draft', ?7, ?8)",
        params![
            id,
            input.conversation_id,
            input.branch_id,
            input.title,
            input.description,
            input.expected_outcome,
            now,
            now,
        ],
    )?;

    for (i, st) in input.subtasks.iter().enumerate() {
        let st_id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO plan_subtasks
             (id, plan_id, idx, title, details, status, outcome, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'todo', NULL, ?6, ?7)",
            params![st_id, id, i as i64, st.title, st.details, now, now],
        )?;
    }

    Ok(Plan {
        id,
        conversation_id: input.conversation_id,
        branch_id: input.branch_id,
        title: input.title,
        description: input.description,
        expected_outcome: input.expected_outcome,
        status: "draft".into(),
        created_at: now,
        updated_at: now,
    })
}

/// Fetch a single plan by id.
#[tauri::command]
pub fn get_plan(id: String, state: State<DbState>) -> Result<Plan, AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let sql = format!("SELECT {} FROM plans WHERE id = ?1", PLAN_COLS);
    conn.query_row(&sql, [&id], map_plan)
        .map_err(|_| AppError::NotFound(format!("plan {} not found", id)))
}

/// List all plans for a conversation (newest first).
#[tauri::command]
pub fn list_plans_by_conversation(
    conversation_id: String,
    state: State<DbState>,
) -> Result<Vec<Plan>, AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let sql = format!(
        "SELECT {} FROM plans WHERE conversation_id = ?1 ORDER BY created_at DESC",
        PLAN_COLS
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([&conversation_id], map_plan)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Update the status of a plan (draft → active → done | abandoned).
#[tauri::command]
pub fn update_plan_status(
    input: UpdatePlanStatusInput,
    state: State<DbState>,
) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let now = now_epoch_ms();
    conn.execute(
        "UPDATE plans SET status = ?1, updated_at = ?2 WHERE id = ?3",
        params![input.status, now, input.id],
    )?;
    Ok(())
}

/// List all subtasks for a plan, ordered by idx.
#[tauri::command]
pub fn list_subtasks(plan_id: String, state: State<DbState>) -> Result<Vec<PlanSubtask>, AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let sql = format!(
        "SELECT {} FROM plan_subtasks WHERE plan_id = ?1 ORDER BY idx ASC",
        SUBTASK_COLS
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([&plan_id], map_subtask)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Update the status (and optional outcome) of a single subtask.
#[tauri::command]
pub fn update_subtask_status(
    input: UpdateSubtaskStatusInput,
    state: State<DbState>,
) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let now = now_epoch_ms();
    conn.execute(
        "UPDATE plan_subtasks SET status = ?1, outcome = ?2, updated_at = ?3 WHERE id = ?4",
        params![input.status, input.outcome, now, input.id],
    )?;
    Ok(())
}

/// Replace all subtasks for a plan with a new ordered list.
/// Deletes existing subtasks, then inserts the new ones.
/// Also bumps plan.updated_at.
#[tauri::command]
pub fn replace_plan_subtasks(
    plan_id: String,
    subtasks: Vec<SubtaskInput>,
    state: State<DbState>,
) -> Result<Vec<PlanSubtask>, AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let now = now_epoch_ms();

    conn.execute("DELETE FROM plan_subtasks WHERE plan_id = ?1", [&plan_id])?;
    conn.execute(
        "UPDATE plans SET updated_at = ?1 WHERE id = ?2",
        params![now, plan_id],
    )?;

    let mut result: Vec<PlanSubtask> = Vec::new();
    for (i, st) in subtasks.iter().enumerate() {
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO plan_subtasks
             (id, plan_id, idx, title, details, status, outcome, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'todo', NULL, ?6, ?7)",
            params![id, plan_id, i as i64, st.title, st.details, now, now],
        )?;
        result.push(PlanSubtask {
            id,
            plan_id: plan_id.clone(),
            idx: i as i64,
            title: st.title.clone(),
            details: st.details.clone(),
            status: "todo".into(),
            outcome: None,
            created_at: now,
            updated_at: now,
        });
    }

    Ok(result)
}

/// Delete a plan and all its subtasks (CASCADE handles subtasks).
#[tauri::command]
pub fn delete_plan(id: String, state: State<DbState>) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    conn.execute("DELETE FROM plans WHERE id = ?1", [&id])?;
    Ok(())
}
