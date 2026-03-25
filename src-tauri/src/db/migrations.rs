use rusqlite::Connection;
use crate::errors::AppError;
use super::schema;

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
    conn.execute_batch(schema::V2_SCHEMA)?;
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
    conn.execute_batch(schema::V4_SCHEMA)?;
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
    conn.execute_batch(schema::V6_SCHEMA)?;
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (6, ?1)",
        [now_epoch()],
    )?;
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
