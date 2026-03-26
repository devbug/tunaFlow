//! Integration tests using in-memory SQLite DB.
//! Tests migration safety, plan CRUD, trace insert/export, and branch plan lookup.

use rusqlite::{params, Connection};

// Import the library crate
use tuna_flow_lib::db;
use tuna_flow_lib::db::migrations::now_epoch_ms;

/// Create a fresh in-memory DB with all migrations applied.
fn setup_db() -> Connection {
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
