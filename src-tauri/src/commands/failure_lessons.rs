use rusqlite::params;
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use crate::db::{migrations::now_epoch, models::FailureLesson, DbState};
use crate::errors::AppError;

// ─── Input types ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFailureLessonInput {
    pub project_key: String,
    pub plan_id: Option<String>,
    pub file_path: Option<String>,
    pub pattern: Option<String>,
    pub finding: String,
}

// ─── Row mapper ──────────────────────────────────────────────────────────────

const LESSON_COLS: &str =
    "id, project_key, plan_id, file_path, pattern, finding, resolution, created_at";

fn map_lesson(row: &rusqlite::Row) -> rusqlite::Result<FailureLesson> {
    Ok(FailureLesson {
        id: row.get(0)?,
        project_key: row.get(1)?,
        plan_id: row.get(2)?,
        file_path: row.get(3)?,
        pattern: row.get(4)?,
        finding: row.get(5)?,
        resolution: row.get(6)?,
        created_at: row.get(7)?,
    })
}

// ─── Commands ────────────────────────────────────────────────────────────────

/// Create a failure lesson from a review verdict finding.
#[tauri::command]
pub fn create_failure_lesson(
    input: CreateFailureLessonInput,
    state: State<DbState>,
) -> Result<FailureLesson, AppError> {
    let conn = state.write.lock().map_err(|_| AppError::Lock)?;
    let id = Uuid::new_v4().to_string();
    let now = now_epoch();
    conn.execute(
        "INSERT INTO failure_lessons (id, project_key, plan_id, file_path, pattern, finding, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, input.project_key, input.plan_id, input.file_path, input.pattern, input.finding, now],
    )?;
    let sql = format!("SELECT {} FROM failure_lessons WHERE id = ?1", LESSON_COLS);
    let lesson = conn.query_row(&sql, [&id], map_lesson)
        .map_err(|_| AppError::NotFound("lesson not found after insert".into()))?;
    Ok(lesson)
}

/// Batch-create failure lessons from multiple findings.
#[tauri::command]
pub fn create_failure_lessons_batch(
    inputs: Vec<CreateFailureLessonInput>,
    state: State<DbState>,
) -> Result<Vec<FailureLesson>, AppError> {
    let conn = state.write.lock().map_err(|_| AppError::Lock)?;
    let now = now_epoch();
    let mut lessons = Vec::with_capacity(inputs.len());
    for input in inputs {
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO failure_lessons (id, project_key, plan_id, file_path, pattern, finding, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, input.project_key, input.plan_id, input.file_path, input.pattern, input.finding, now],
        )?;
        let sql = format!("SELECT {} FROM failure_lessons WHERE id = ?1", LESSON_COLS);
        let lesson = conn.query_row(&sql, [&id], map_lesson)
            .map_err(|_| AppError::NotFound("lesson not found after insert".into()))?;
        lessons.push(lesson);
    }
    Ok(lessons)
}

/// List all failure lessons for a project.
#[tauri::command]
pub fn list_failure_lessons(
    project_key: String,
    state: State<DbState>,
) -> Result<Vec<FailureLesson>, AppError> {
    let conn = state.read.lock().map_err(|_| AppError::Lock)?;
    let sql = format!(
        "SELECT {} FROM failure_lessons WHERE project_key = ?1 ORDER BY created_at DESC",
        LESSON_COLS,
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([&project_key], map_lesson)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// Search similar failure lessons using FTS5 + file path matching.
/// Returns up to `limit` results ranked by relevance.
#[tauri::command]
pub fn search_similar_failures(
    project_key: String,
    query: String,
    file_paths: Vec<String>,
    limit: Option<usize>,
    state: State<DbState>,
) -> Result<Vec<FailureLesson>, AppError> {
    let conn = state.read.lock().map_err(|_| AppError::Lock)?;
    let max = limit.unwrap_or(5);
    let mut results: Vec<(f64, FailureLesson)> = Vec::new();

    // 1) FTS5 keyword search on findings/pattern
    if !query.is_empty() {
        let fts_query = sanitize_fts_query(&query);
        if !fts_query.is_empty() {
            let sql = format!(
                "SELECT {cols}, bm25(failure_lessons_fts, 1.0, 0.5, 0.3) AS score
                 FROM failure_lessons_fts
                 JOIN failure_lessons ON failure_lessons.rowid = failure_lessons_fts.rowid
                 WHERE failure_lessons_fts MATCH ?1
                   AND failure_lessons.project_key = ?2
                 ORDER BY score
                 LIMIT ?3",
                cols = LESSON_COLS,
            );
            if let Ok(mut stmt) = conn.prepare(&sql) {
                let rows = stmt.query_map(params![fts_query, project_key, max * 2], |row| {
                    let lesson = map_lesson(row)?;
                    let score: f64 = row.get(8)?;
                    Ok((score, lesson))
                });
                if let Ok(rows) = rows {
                    for r in rows.flatten() {
                        results.push(r);
                    }
                }
            }
        }
    }

    // 2) File path exact match (finds failures in the same files)
    for fp in &file_paths {
        let sql = format!(
            "SELECT {} FROM failure_lessons WHERE project_key = ?1 AND file_path = ?2 ORDER BY created_at DESC LIMIT 3",
            LESSON_COLS,
        );
        if let Ok(mut stmt) = conn.prepare(&sql) {
            let rows = stmt.query_map(params![project_key, fp], map_lesson);
            if let Ok(rows) = rows {
                for lesson in rows.flatten() {
                    // Assign a high relevance score for file match
                    if !results.iter().any(|(_, l)| l.id == lesson.id) {
                        results.push((-10.0, lesson)); // lower = better (bm25 convention)
                    }
                }
            }
        }
    }

    // Sort by score (lower = more relevant for bm25), deduplicate
    results.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut seen = std::collections::HashSet::new();
    let deduped: Vec<FailureLesson> = results
        .into_iter()
        .filter(|(_, l)| seen.insert(l.id.clone()))
        .take(max)
        .map(|(_, l)| l)
        .collect();
    Ok(deduped)
}

/// Update the resolution of a failure lesson (called after rework succeeds).
#[tauri::command]
pub fn resolve_failure_lesson(
    id: String,
    resolution: String,
    state: State<DbState>,
) -> Result<(), AppError> {
    let conn = state.write.lock().map_err(|_| AppError::Lock)?;
    conn.execute(
        "UPDATE failure_lessons SET resolution = ?1 WHERE id = ?2",
        params![resolution, id],
    )?;
    Ok(())
}

/// Batch-resolve all unresolved lessons for a plan (called on review pass).
#[tauri::command]
pub fn resolve_failure_lessons_by_plan(
    plan_id: String,
    resolution: String,
    state: State<DbState>,
) -> Result<u64, AppError> {
    let conn = state.write.lock().map_err(|_| AppError::Lock)?;
    let count = conn.execute(
        "UPDATE failure_lessons SET resolution = ?1 WHERE plan_id = ?2 AND resolution IS NULL",
        params![resolution, plan_id],
    )?;
    Ok(count as u64)
}

/// Delete a failure lesson.
#[tauri::command]
pub fn delete_failure_lesson(
    id: String,
    state: State<DbState>,
) -> Result<(), AppError> {
    let conn = state.write.lock().map_err(|_| AppError::Lock)?;
    conn.execute("DELETE FROM failure_lessons WHERE id = ?1", [&id])?;
    Ok(())
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Sanitize FTS5 query: extract alphanumeric tokens, join with OR.
fn sanitize_fts_query(raw: &str) -> String {
    let tokens: Vec<&str> = raw
        .split(|c: char| !c.is_alphanumeric() && c != '_' && c != '-' && c != '.')
        .filter(|t| t.len() >= 2)
        .collect();
    if tokens.is_empty() {
        return String::new();
    }
    tokens.join(" OR ")
}

/// Extract file path from a finding string (best-effort regex-like match).
pub fn extract_file_path(finding: &str) -> Option<String> {
    // Match patterns like "src/foo/bar.rs", "lib/utils.ts", etc.
    for word in finding.split_whitespace() {
        let clean = word.trim_matches(|c: char| c == '`' || c == '\'' || c == '"' || c == '(' || c == ')' || c == ',');
        if clean.contains('/')
            && clean.contains('.')
            && clean.len() > 4
            && !clean.starts_with("http")
        {
            return Some(clean.to_string());
        }
    }
    None
}

/// Extract a short pattern summary from a finding (first ~80 chars, cleaned).
pub fn extract_pattern(finding: &str) -> String {
    let trimmed = finding.trim();
    if trimmed.len() <= 80 {
        trimmed.to_string()
    } else {
        format!("{}...", &trimmed[..80].trim_end())
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_fts_query() {
        assert_eq!(sanitize_fts_query("FTS5 rowid confusion"), "FTS5 OR rowid OR confusion");
        assert_eq!(sanitize_fts_query("a"), ""); // too short
        assert_eq!(sanitize_fts_query("error in src/db.rs"), "error OR in OR src OR db.rs");
    }

    #[test]
    fn test_extract_file_path() {
        assert_eq!(extract_file_path("Bug in `src/lib/utils.ts` line 42"), Some("src/lib/utils.ts".into()));
        assert_eq!(extract_file_path("No file path here"), None);
        assert_eq!(extract_file_path("see https://example.com/foo.js"), None);
    }

    #[test]
    fn test_extract_pattern() {
        assert_eq!(extract_pattern("short"), "short");
        let long = "a".repeat(100);
        let result = extract_pattern(&long);
        assert!(result.ends_with("..."));
        assert!(result.len() <= 84); // 80 + "..."
    }
}
