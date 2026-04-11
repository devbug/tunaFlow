//! Integration tests using in-memory SQLite DB.
//! Tests migration safety, plan CRUD, trace insert/export, and branch plan lookup.

use rusqlite::{params, Connection};

// Import the library crate
use tuna_flow_lib::db;
use tuna_flow_lib::db::migrations::now_epoch_ms;

/// Create a fresh in-memory DB with all migrations applied.
fn setup_db() -> Connection {
    // Register sqlite-vec extension (same as db::init)
    unsafe {
        rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite_vec::sqlite3_vec_init as *const (),
        )));
    }
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    db::migrations::run(&conn).unwrap();
    conn
}

// ─── Migration tests ─────────────────────────────────────────────────────────

#[test]
fn migrations_apply_cleanly() {
    let conn = setup_db();
    let version: i64 = conn
        .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
        .unwrap();
    assert!(version >= 6, "expected at least v6, got {}", version);
}

#[test]
fn migrations_are_idempotent() {
    let conn = setup_db();
    // Run again — should not fail
    db::migrations::run(&conn).unwrap();
    let version: i64 = conn
        .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
        .unwrap();
    assert!(version >= 6);
}

#[test]
fn v4_column_exists() {
    let conn = setup_db();
    // subtask_id should exist on artifacts
    conn.execute(
        "INSERT INTO artifacts (id, type, title, content, status, subtask_id, created_at, updated_at)
         VALUES ('a1', 'note', 'test', 'content', 'draft', NULL, 0, 0)",
        [],
    )
    .unwrap();
}

#[test]
fn v6_columns_exist() {
    let conn = setup_db();
    conn.execute(
        "INSERT INTO trace_log (conversation_id, input_tokens, output_tokens, cost_usd, recorded_at,
         trace_id, span_id, parent_span_id, operation, engine, duration_ms, status)
         VALUES ('c1', 10, 20, 0.01, 0, 'tid', 'sid', NULL, 'test', 'test', 100, 'ok')",
        [],
    )
    .unwrap();
}

// ─── Plan CRUD tests ─────────────────────────────────────────────────────────

fn seed_project_and_conversation(conn: &Connection) -> (String, String) {
    let now = now_epoch_ms();
    conn.execute(
        "INSERT INTO projects (key, name, type, source, updated_at) VALUES ('p1', 'Test', 'project', 'configured', ?1)",
        [now / 1000],
    ).unwrap();
    conn.execute(
        "INSERT INTO conversations (id, project_key, label, type, mode, source, created_at, updated_at,
         total_input_tokens, total_output_tokens, total_cost_usd)
         VALUES ('conv1', 'p1', 'Test Conv', 'main', 'chat', 'tunadish', ?1, ?1, 0, 0, 0.0)",
        [now / 1000],
    ).unwrap();
    ("p1".into(), "conv1".into())
}

#[test]
fn plan_create_and_list() {
    let conn = setup_db();
    let (_, conv_id) = seed_project_and_conversation(&conn);
    let now = now_epoch_ms();

    conn.execute(
        "INSERT INTO plans (id, conversation_id, title, status, created_at, updated_at)
         VALUES ('plan1', ?1, 'My Plan', 'draft', ?2, ?2)",
        params![conv_id, now],
    ).unwrap();

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM plans WHERE conversation_id = ?1",
            [&conv_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn plan_status_update() {
    let conn = setup_db();
    let (_, conv_id) = seed_project_and_conversation(&conn);
    let now = now_epoch_ms();

    conn.execute(
        "INSERT INTO plans (id, conversation_id, title, status, created_at, updated_at)
         VALUES ('plan2', ?1, 'Plan', 'draft', ?2, ?2)",
        params![conv_id, now],
    ).unwrap();

    conn.execute(
        "UPDATE plans SET status = 'active' WHERE id = 'plan2'",
        [],
    ).unwrap();

    let status: String = conn
        .query_row("SELECT status FROM plans WHERE id = 'plan2'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(status, "active");
}

#[test]
fn subtask_create_and_status_cycle() {
    let conn = setup_db();
    let (_, conv_id) = seed_project_and_conversation(&conn);
    let now = now_epoch_ms();

    conn.execute(
        "INSERT INTO plans (id, conversation_id, title, status, created_at, updated_at)
         VALUES ('plan3', ?1, 'Plan', 'active', ?2, ?2)",
        params![conv_id, now],
    ).unwrap();

    conn.execute(
        "INSERT INTO plan_subtasks (id, plan_id, idx, title, status, created_at, updated_at)
         VALUES ('st1', 'plan3', 0, 'Task 1', 'todo', ?1, ?1)",
        [now],
    ).unwrap();

    // todo → in_progress → done
    conn.execute("UPDATE plan_subtasks SET status = 'in_progress' WHERE id = 'st1'", []).unwrap();
    conn.execute("UPDATE plan_subtasks SET status = 'done' WHERE id = 'st1'", []).unwrap();

    let status: String = conn
        .query_row("SELECT status FROM plan_subtasks WHERE id = 'st1'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(status, "done");
}

// ─── Branch plan lookup ──────────────────────────────────────────────────────

#[test]
fn branch_canonical_conversation_id() {
    let conn = setup_db();
    let (_, conv_id) = seed_project_and_conversation(&conn);
    let now = now_epoch_ms();

    // Create branch
    conn.execute(
        "INSERT INTO branches (id, conversation_id, label, status, created_at)
         VALUES ('br1', ?1, 'b1', 'active', ?2)",
        params![conv_id, now],
    ).unwrap();

    // resolve_plan_conversation_id logic: branch:br1 → conv1
    let branch_conv_id = "branch:br1";
    let branch_id = &branch_conv_id["branch:".len()..];
    let resolved: String = conn
        .query_row(
            "SELECT conversation_id FROM branches WHERE id = ?1",
            [branch_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(resolved, conv_id);
}

#[test]
fn plan_visible_from_branch() {
    let conn = setup_db();
    let (_, conv_id) = seed_project_and_conversation(&conn);
    let now = now_epoch_ms();

    // Create active plan on the conversation
    conn.execute(
        "INSERT INTO plans (id, conversation_id, title, status, created_at, updated_at)
         VALUES ('plan4', ?1, 'Active Plan', 'active', ?2, ?2)",
        params![conv_id, now],
    ).unwrap();

    // Query with canonical conversation id (as resolve_plan_conversation_id would return)
    let plan_title: String = conn
        .query_row(
            "SELECT title FROM plans WHERE conversation_id = ?1 AND status = 'active' LIMIT 1",
            [&conv_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(plan_title, "Active Plan");
}

// ─── Trace log tests ─────────────────────────────────────────────────────────

#[test]
fn trace_insert_and_query() {
    let conn = setup_db();
    let (_, conv_id) = seed_project_and_conversation(&conn);

    conn.execute(
        "INSERT INTO trace_log (conversation_id, input_tokens, output_tokens, cost_usd, recorded_at,
         trace_id, span_id, operation, engine, duration_ms, status)
         VALUES (?1, 100, 200, 0.05, 1000, 'trace1', 'span1', 'agent.send', 'claude-code', 500, 'ok')",
        [&conv_id],
    ).unwrap();

    let (op, eng, dur, st): (String, String, i64, String) = conn
        .query_row(
            "SELECT operation, engine, duration_ms, status FROM trace_log WHERE trace_id = 'trace1'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();
    assert_eq!(op, "agent.send");
    assert_eq!(eng, "claude-code");
    assert_eq!(dur, 500);
    assert_eq!(st, "ok");
}

#[test]
fn trace_parent_span_linkage() {
    let conn = setup_db();
    let (_, conv_id) = seed_project_and_conversation(&conn);

    // Root span
    conn.execute(
        "INSERT INTO trace_log (conversation_id, input_tokens, output_tokens, cost_usd, recorded_at,
         trace_id, span_id, parent_span_id, operation, engine, duration_ms, status)
         VALUES (?1, 0, 0, 0.0, 1000, 'rt-trace', 'root-span', NULL, 'roundtable.run', 'system', 1000, 'ok')",
        [&conv_id],
    ).unwrap();

    // Participant span
    conn.execute(
        "INSERT INTO trace_log (conversation_id, input_tokens, output_tokens, cost_usd, recorded_at,
         trace_id, span_id, parent_span_id, operation, engine, duration_ms, status)
         VALUES (?1, 50, 100, 0.02, 1001, 'rt-trace', 'part-span', 'root-span', 'roundtable.participant', 'claude-code', 300, 'ok')",
        [&conv_id],
    ).unwrap();

    // Verify parent linkage
    let parent: String = conn
        .query_row(
            "SELECT parent_span_id FROM trace_log WHERE span_id = 'part-span'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(parent, "root-span");

    // Same trace_id
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM trace_log WHERE trace_id = 'rt-trace'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 2);
}

// ─── Eval tests ──────────────────────────────────────────────────────────────

#[test]
fn eval_run_crud() {
    let conn = setup_db();
    let (_, conv_id) = seed_project_and_conversation(&conn);
    let now = now_epoch_ms();

    conn.execute(
        "INSERT INTO eval_runs (id, conversation_id, title, prompt, rounds, status, created_at)
         VALUES ('er1', ?1, 'Test Eval', 'prompt', 1, 'pending', ?2)",
        params![conv_id, now],
    ).unwrap();

    conn.execute(
        "INSERT INTO eval_results (id, eval_run_id, agent_name, engine, round, content, created_at)
         VALUES ('res1', 'er1', 'Claude', 'claude-code', 1, 'response', ?1)",
        [now],
    ).unwrap();

    conn.execute("UPDATE eval_runs SET status = 'done' WHERE id = 'er1'", []).unwrap();

    let status: String = conn
        .query_row("SELECT status FROM eval_runs WHERE id = 'er1'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(status, "done");

    let result_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM eval_results WHERE eval_run_id = 'er1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(result_count, 1);
}

// ─── Artifact-subtask link ───────────────────────────────────────────────────

#[test]
fn artifact_subtask_link() {
    let conn = setup_db();
    let (_, conv_id) = seed_project_and_conversation(&conn);
    let now = now_epoch_ms();

    conn.execute(
        "INSERT INTO plans (id, conversation_id, title, status, created_at, updated_at)
         VALUES ('plan5', ?1, 'Plan', 'active', ?2, ?2)",
        params![conv_id, now],
    ).unwrap();

    conn.execute(
        "INSERT INTO plan_subtasks (id, plan_id, idx, title, status, created_at, updated_at)
         VALUES ('st2', 'plan5', 0, 'Task', 'todo', ?1, ?1)",
        [now],
    ).unwrap();

    conn.execute(
        "INSERT INTO artifacts (id, conversation_id, type, title, content, status, created_at, updated_at)
         VALUES ('art1', ?1, 'note', 'Artifact', 'content', 'draft', ?2, ?2)",
        params![conv_id, now],
    ).unwrap();

    // Link
    conn.execute(
        "UPDATE artifacts SET subtask_id = 'st2' WHERE id = 'art1'",
        [],
    ).unwrap();

    let linked: String = conn
        .query_row("SELECT subtask_id FROM artifacts WHERE id = 'art1'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(linked, "st2");
}

// ─── HTTP API DB patterns ───────────────────────────────────────────────────

/// Helper: create a project via the same SQL the HTTP API uses.
fn create_api_project(conn: &Connection, key: &str, name: &str, path: Option<&str>) {
    let now = now_epoch_ms();
    conn.execute(
        "INSERT OR IGNORE INTO projects (key, name, path, type, source, hidden, updated_at) VALUES (?1, ?2, ?3, 'project', 'api', 0, ?4)",
        params![key, name, path, now],
    ).unwrap();
}

/// Helper: create a conversation via the same SQL the HTTP API uses.
fn create_api_conversation(conn: &Connection, id: &str, project_key: &str, label: &str) {
    let now = now_epoch_ms();
    conn.execute(
        "INSERT INTO conversations (id, project_key, label, mode, usage_status, source, created_at, updated_at) VALUES (?1, ?2, ?3, 'chat', 'active', 'api', ?4, ?4)",
        params![id, project_key, label, now],
    ).unwrap();
}

#[test]
fn http_api_project_crud() {
    let conn = setup_db();
    create_api_project(&conn, "test-proj", "Test Project", Some("/tmp/test"));

    let name: String = conn.query_row("SELECT name FROM projects WHERE key = 'test-proj'", [], |r| r.get(0)).unwrap();
    assert_eq!(name, "Test Project");

    // Duplicate insert is ignored (OR IGNORE)
    create_api_project(&conn, "test-proj", "Different Name", None);
    let name2: String = conn.query_row("SELECT name FROM projects WHERE key = 'test-proj'", [], |r| r.get(0)).unwrap();
    assert_eq!(name2, "Test Project"); // unchanged
}

#[test]
fn http_api_conversation_crud() {
    let conn = setup_db();
    create_api_project(&conn, "proj1", "P1", None);
    create_api_conversation(&conn, "conv1", "proj1", "[E2E] Test Conv");

    let label: String = conn.query_row("SELECT label FROM conversations WHERE id = 'conv1'", [], |r| r.get(0)).unwrap();
    assert_eq!(label, "[E2E] Test Conv");

    // Delete conversation + messages
    conn.execute("INSERT INTO messages (id, conversation_id, role, content, timestamp, status) VALUES ('m1', 'conv1', 'user', 'hello', 0, 'done')", []).unwrap();
    conn.execute("DELETE FROM messages WHERE conversation_id = 'conv1'", []).unwrap();
    conn.execute("DELETE FROM conversations WHERE id = 'conv1'", []).unwrap();

    let count: i64 = conn.query_row("SELECT COUNT(*) FROM conversations WHERE id = 'conv1'", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 0);
    let msg_count: i64 = conn.query_row("SELECT COUNT(*) FROM messages WHERE conversation_id = 'conv1'", [], |r| r.get(0)).unwrap();
    assert_eq!(msg_count, 0);
}

#[test]
fn http_api_branch_lifecycle() {
    let conn = setup_db();
    create_api_project(&conn, "proj1", "P1", None);
    create_api_conversation(&conn, "conv1", "proj1", "Main");

    let now = now_epoch_ms();

    // Create branch
    conn.execute(
        "INSERT INTO branches (id, conversation_id, label, status, mode, created_at) VALUES ('br1', 'conv1', 'test-branch', 'active', 'chat', ?1)",
        params![now],
    ).unwrap();

    // Create shadow conversation
    conn.execute(
        "INSERT INTO conversations (id, project_key, label, mode, usage_status, source, created_at, updated_at) VALUES ('branch:br1', 'proj1', 'Branch test-branch', 'chat', 'active', 'api', ?1, ?1)",
        params![now],
    ).unwrap();

    // Add message to shadow
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content, timestamp, status) VALUES ('m1', 'branch:br1', 'user', 'branch msg', ?1, 'done')",
        params![now],
    ).unwrap();

    // Archive
    conn.execute("UPDATE branches SET status = 'archived' WHERE id = 'br1'", []).unwrap();
    let status: String = conn.query_row("SELECT status FROM branches WHERE id = 'br1'", [], |r| r.get(0)).unwrap();
    assert_eq!(status, "archived");

    // Adopt
    conn.execute("UPDATE branches SET status = 'adopted' WHERE id = 'br1'", []).unwrap();
    let status2: String = conn.query_row("SELECT status FROM branches WHERE id = 'br1'", [], |r| r.get(0)).unwrap();
    assert_eq!(status2, "adopted");

    // Delete branch (active branch = full delete)
    conn.execute("DELETE FROM messages WHERE conversation_id = 'branch:br1'", []).unwrap();
    conn.execute("DELETE FROM conversations WHERE id = 'branch:br1'", []).unwrap();
    conn.execute("DELETE FROM branches WHERE id = 'br1'", []).unwrap();

    let br_count: i64 = conn.query_row("SELECT COUNT(*) FROM branches WHERE id = 'br1'", [], |r| r.get(0)).unwrap();
    assert_eq!(br_count, 0);
}

#[test]
fn http_api_adopt_summary_collects_all_assistants() {
    let conn = setup_db();
    create_api_project(&conn, "proj1", "P1", None);
    create_api_conversation(&conn, "conv1", "proj1", "Main");

    let now = now_epoch_ms();
    conn.execute(
        "INSERT INTO branches (id, conversation_id, label, status, mode, created_at) VALUES ('br1', 'conv1', 'rt-review', 'active', 'roundtable', ?1)",
        params![now],
    ).unwrap();
    conn.execute(
        "INSERT INTO conversations (id, project_key, label, mode, usage_status, source, created_at, updated_at) VALUES ('branch:br1', 'proj1', 'Branch RT', 'roundtable', 'active', 'api', ?1, ?1)",
        params![now],
    ).unwrap();

    // 3 assistant messages (RT participants)
    for (id, persona, engine, content) in [
        ("a1", "Reviewer", "claude", "Code looks good."),
        ("a2", "Architect", "gemini", "Consider MVC pattern."),
        ("a3", "Critic", "codex", "Error handling missing."),
    ] {
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, engine, persona, timestamp, status) VALUES (?1, 'branch:br1', 'assistant', ?2, ?3, ?4, ?5, 'done')",
            params![id, content, engine, persona, now],
        ).unwrap();
    }

    // Simulate adopt: collect all assistant messages
    let mut stmt = conn.prepare(
        "SELECT content, persona, engine FROM messages WHERE conversation_id = 'branch:br1' AND role = 'assistant' ORDER BY timestamp ASC"
    ).unwrap();
    let parts: Vec<String> = stmt.query_map([], |r| {
        let content: String = r.get(0)?;
        let persona: Option<String> = r.get(1)?;
        let engine: Option<String> = r.get(2)?;
        let label = persona.or(engine).unwrap_or_default();
        Ok(if label.is_empty() { content } else { format!("**[{}]** {}", label, content) })
    }).unwrap().filter_map(|r| r.ok()).collect();

    assert_eq!(parts.len(), 3);
    assert!(parts[0].contains("Reviewer"));
    assert!(parts[1].contains("Architect"));
    assert!(parts[2].contains("Critic"));

    let summary = parts.join("\n\n");
    assert!(summary.contains("**[Reviewer]**"));
    assert!(summary.contains("**[Architect]**"));
    assert!(summary.contains("**[Critic]**"));
}

#[test]
fn http_api_fk_constraint_on_invalid_project() {
    let conn = setup_db();
    // Attempt to create conversation with non-existent project_key
    let result = conn.execute(
        "INSERT INTO conversations (id, project_key, label, mode, usage_status, source, created_at, updated_at) VALUES ('c1', 'nonexistent', 'test', 'chat', 'active', 'api', 0, 0)",
        [],
    );
    assert!(result.is_err(), "FK constraint should reject nonexistent project_key");
}

#[test]
fn http_api_message_send_pattern() {
    let conn = setup_db();
    create_api_project(&conn, "proj1", "P1", Some("/tmp/test"));
    create_api_conversation(&conn, "conv1", "proj1", "Test");

    // User message (dryRun pattern)
    let now = now_epoch_ms();
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content, timestamp, status) VALUES ('msg-user', 'conv1', 'user', 'What is 2+2?', ?1, 'done')",
        params![now],
    ).unwrap();

    // Verify project path lookup (same query HTTP API uses)
    let project_path: Option<String> = conn.query_row(
        "SELECT p.path FROM projects p JOIN conversations c ON c.project_key = p.key WHERE c.id = 'conv1'",
        [], |r| r.get(0),
    ).unwrap();
    assert_eq!(project_path, Some("/tmp/test".to_string()));

    // Assistant response (agent completion pattern)
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content, engine, model, timestamp, status) VALUES ('msg-asst', 'conv1', 'assistant', 'Four.', 'claude', 'haiku', ?1, 'done')",
        params![now + 1],
    ).unwrap();

    // Verify message ordering
    let mut stmt = conn.prepare("SELECT role, content FROM messages WHERE conversation_id = 'conv1' ORDER BY timestamp ASC").unwrap();
    let msgs: Vec<(String, String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().filter_map(|r| r.ok()).collect();
    assert_eq!(msgs.len(), 2);
    assert_eq!(msgs[0].0, "user");
    assert_eq!(msgs[1].0, "assistant");
    assert_eq!(msgs[1].1, "Four.");
}
