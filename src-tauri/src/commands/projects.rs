use rusqlite::params;
use serde::Deserialize;
use tauri::State;

use crate::db::{migrations::now_epoch, models::Project, DbState};
use crate::errors::AppError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectInput {
    pub key: String,
    pub name: String,
    pub path: Option<String>,
    #[serde(rename = "type")]
    pub project_type: String,
    pub default_engine: Option<String>,
    pub workspace_root: Option<String>,
    pub source: String,
}

#[tauri::command]
pub fn list_projects(state: State<DbState>) -> Result<Vec<Project>, AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let mut stmt = conn.prepare(
        "SELECT key, name, path, type, default_engine, workspace_root, source, updated_at
         FROM projects ORDER BY updated_at DESC",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Project {
                key: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                project_type: row.get(3)?,
                default_engine: row.get(4)?,
                workspace_root: row.get(5)?,
                source: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn create_project(
    input: CreateProjectInput,
    state: State<DbState>,
) -> Result<Project, AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let now = now_epoch();
    conn.execute(
        "INSERT INTO projects (key, name, path, type, default_engine, workspace_root, source, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            input.key,
            input.name,
            input.path,
            input.project_type,
            input.default_engine,
            input.workspace_root,
            input.source,
            now,
        ],
    )?;
    Ok(Project {
        key: input.key,
        name: input.name,
        path: input.path,
        project_type: input.project_type,
        default_engine: input.default_engine,
        workspace_root: input.workspace_root,
        source: input.source,
        updated_at: now,
    })
}

#[tauri::command]
pub fn get_project(key: String, state: State<DbState>) -> Result<Project, AppError> {
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    conn.query_row(
        "SELECT key, name, path, type, default_engine, workspace_root, source, updated_at
         FROM projects WHERE key = ?1",
        [&key],
        |row| {
            Ok(Project {
                key: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                project_type: row.get(3)?,
                default_engine: row.get(4)?,
                workspace_root: row.get(5)?,
                source: row.get(6)?,
                updated_at: row.get(7)?,
            })
        },
    )
    .map_err(|_| AppError::NotFound(format!("Project '{}' not found", key)))
}
