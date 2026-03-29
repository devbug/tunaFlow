use rusqlite::Connection;
use crate::errors::AppError;
use super::schema;

/// Check whether a column already exists on a table (PRAGMA table_info).
/// Returns true if the column is present, false otherwise.
fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
    let sql = format!("PRAGMA table_info({})", table);
    let Ok(mut stmt) = conn.prepare(&sql) else { return false };
    stmt.query_map([], |row| row.get::<_, String>(1))
        .map(|rows| rows.filter_map(|r| r.ok()).any(|name| name == column))
        .unwrap_or(false)
}

/// Idempotent ADD COLUMN: skips if column already exists, propagates real errors.
fn add_column_if_missing(conn: &Connection, table: &str, column: &str, col_def: &str) -> Result<(), AppError> {
    if column_exists(conn, table, column) {
        return Ok(());
    }
    let sql = format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, col_def);
    conn.execute(&sql, [])?;
    Ok(())
}

pub fn run(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(schema::CREATE_SCHEMA_VERSION)?;
    let current = current_version(conn)?;
    if current < 1 {
        apply_v1(conn)?;
    }
    if current < 2 {
        apply_v2(conn)?;
    }
    if current < 3 {
        apply_v3(conn)?;
    }
    if current < 4 {
        apply_v4(conn)?;
    }
    if current < 5 {
        apply_v5(conn)?;
    }
    if current < 6 {
        apply_v6(conn)?;
    }
    if current < 7 {
        apply_v7(conn)?;
    }
    if current < 8 {
        apply_v8(conn)?;
    }
    if current < 9 {
        apply_v9(conn)?;
    }
    if current < 10 {
        apply_v10(conn)?;
    }
    if current < 11 {
        apply_v11(conn)?;
    }
    if current < 12 {
        apply_v12(conn)?;
    }
    if current < 13 {
        apply_v13(conn)?;
    }
    if current < 14 {
        apply_v14(conn)?;
    }
    Ok(())
}

fn current_version(conn: &Connection) -> Result<i64, AppError> {
    let v: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    Ok(v)
}

fn apply_v1(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(schema::V1_SCHEMA)?;
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (1, ?1)",
        [now_epoch()],
    )?;
    Ok(())
}

fn apply_v2(conn: &Connection) -> Result<(), AppError> {
    // V2 adds resume_token columns — idempotent to survive partial prior runs
    add_column_if_missing(conn, "conversations", "resume_token", "TEXT")?;
    add_column_if_missing(conn, "conversations", "resume_token_engine", "TEXT")?;
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (2, ?1)",
        [now_epoch()],
    )?;
    Ok(())
}

fn apply_v3(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(schema::V3_SCHEMA)?;
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (3, ?1)",
        [now_epoch()],
    )?;
    Ok(())
}

fn apply_v4(conn: &Connection) -> Result<(), AppError> {
    // V4 adds subtask_id to artifacts — idempotent to survive partial prior runs
    add_column_if_missing(
        conn, "artifacts", "subtask_id",
        "TEXT REFERENCES plan_subtasks(id) ON DELETE SET NULL",
    )?;
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_artifacts_subtask_id ON artifacts(subtask_id);",
    )?;
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (4, ?1)",
        [now_epoch()],
    )?;
    Ok(())
}

fn apply_v5(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(schema::V5_SCHEMA)?;
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (5, ?1)",
        [now_epoch()],
    )?;
    Ok(())
}

fn apply_v6(conn: &Connection) -> Result<(), AppError> {
    // V6 extends trace_log with OTel span columns — idempotent per column
    add_column_if_missing(conn, "trace_log", "trace_id", "TEXT")?;
    add_column_if_missing(conn, "trace_log", "span_id", "TEXT")?;
    add_column_if_missing(conn, "trace_log", "parent_span_id", "TEXT")?;
    add_column_if_missing(conn, "trace_log", "operation", "TEXT")?;
    add_column_if_missing(conn, "trace_log", "engine", "TEXT")?;
    add_column_if_missing(conn, "trace_log", "duration_ms", "INTEGER")?;
    add_column_if_missing(conn, "trace_log", "status", "TEXT DEFAULT 'ok'")?;
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_trace_log_trace_id ON trace_log(trace_id);",
    )?;
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (6, ?1)",
        [now_epoch()],
    )?;
    Ok(())
}

fn apply_v7(conn: &Connection) -> Result<(), AppError> {
    add_column_if_missing(conn, "plan_subtasks", "owner_agent", "TEXT")?;
    add_column_if_missing(conn, "plan_subtasks", "last_updated_by", "TEXT")?;
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (7, ?1)",
        [now_epoch()],
    )?;
    Ok(())
}

fn apply_v8(conn: &Connection) -> Result<(), AppError> {
    add_column_if_missing(conn, "branches", "mode", "TEXT DEFAULT 'chat'")?;
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (8, ?1)",
        [now_epoch()],
    )?;
    Ok(())
}

fn apply_v9(conn: &Connection) -> Result<(), AppError> {
    add_column_if_missing(conn, "branches", "subtask_id", "TEXT REFERENCES plan_subtasks(id) ON DELETE SET NULL")?;
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (9, ?1)",
        [now_epoch()],
    )?;
    Ok(())
}

fn apply_v12(conn: &Connection) -> Result<(), AppError> {
    add_column_if_missing(conn, "conversations", "rt_config", "TEXT")?;
    conn.execute("INSERT INTO schema_version (version, applied_at) VALUES (12, ?1)", [now_epoch()])?;
    Ok(())
}

fn apply_v11(conn: &Connection) -> Result<(), AppError> {
    add_column_if_missing(conn, "trace_log", "context_mode", "TEXT")?;
    add_column_if_missing(conn, "trace_log", "context_sections", "TEXT")?;
    add_column_if_missing(conn, "trace_log", "context_length", "INTEGER")?;
    add_column_if_missing(conn, "trace_log", "context_hash", "TEXT")?;
    add_column_if_missing(conn, "trace_log", "context_truncated", "INTEGER DEFAULT 0")?;
    conn.execute("INSERT INTO schema_version (version, applied_at) VALUES (11, ?1)", [now_epoch()])?;
    Ok(())
}

fn apply_v10(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(schema::V10_SCHEMA)?;
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (10, ?1)",
        [now_epoch()],
    )?;
    Ok(())
}

fn apply_v13(conn: &Connection) -> Result<(), AppError> {
    add_column_if_missing(conn, "projects", "hidden", "INTEGER NOT NULL DEFAULT 0")?;
    conn.execute("INSERT INTO schema_version (version, applied_at) VALUES (13, ?1)", [now_epoch()])?;
    Ok(())
}

/// Fix branches with shadow conversation IDs (branch:xxx) as conversation_id.
/// These should point to the root conversation instead.
fn apply_v14(conn: &Connection) -> Result<(), AppError> {
    // Find all branches whose conversation_id starts with 'branch:'
    // and update them to use the root conversation (via conversations.parent_id chain)
    conn.execute_batch("
        UPDATE branches SET conversation_id = (
            WITH RECURSIVE chain AS (
                SELECT id, parent_id FROM conversations WHERE id = branches.conversation_id
                UNION ALL
                SELECT c.id, c.parent_id FROM conversations c JOIN chain ch ON c.id = ch.parent_id
                WHERE ch.parent_id IS NOT NULL
            )
            SELECT id FROM chain WHERE parent_id IS NULL OR parent_id NOT LIKE 'branch:%'
            ORDER BY rowid DESC LIMIT 1
        )
        WHERE conversation_id LIKE 'branch:%';
    ")?;

    // Also set parent_branch_id for branches that were created from shadow convs
    // but missing the parent reference: extract branch ID from the original conversation_id
    // This is best-effort — only fixes cases where we can match
    conn.execute_batch("
        UPDATE branches SET parent_branch_id = (
            SELECT b2.id FROM branches b2
            WHERE 'branch:' || b2.id = (
                SELECT c.id FROM conversations c WHERE c.id LIKE 'branch:%'
                AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.id = branches.checkpoint_id)
            )
        )
        WHERE parent_branch_id IS NULL
        AND checkpoint_id IS NOT NULL
        AND id IN (
            SELECT id FROM branches WHERE conversation_id NOT LIKE 'branch:%'
        );
    ")?;

    conn.execute("INSERT INTO schema_version (version, applied_at) VALUES (14, ?1)", [now_epoch()])?;
    Ok(())
}

/// Seconds since Unix epoch
pub fn now_epoch() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// Milliseconds since Unix epoch (for Message.timestamp)
pub fn now_epoch_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
