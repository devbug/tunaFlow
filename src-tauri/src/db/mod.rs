pub mod migrations;
pub mod models;
pub mod schema;

use std::path::PathBuf;
use std::sync::Mutex;
use rusqlite::Connection;
use crate::errors::AppError;

/// Tauri managed state: wraps Connection in Mutex so it is Sync.
/// The Mutex is released between DB operations, allowing the subprocess
/// in send_with_claude to run without holding the DB lock.
pub struct DbState(pub Mutex<Connection>);

pub fn init(db_path: PathBuf) -> Result<Connection, AppError> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    migrations::run(&conn)?;
    Ok(conn)
}
