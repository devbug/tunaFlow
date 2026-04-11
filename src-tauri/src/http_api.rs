//! HTTP API server — axum-based, runs inside Tauri app via tokio::spawn.
//! Provides REST endpoints for E2E testing, mobile access, and MCP wrapping.
//!
//! Architecture:
//! - Shares DbState with Tauri commands (same Arc<Mutex<Connection>>)
//! - Bearer token auth (generated at startup, shown in Settings)
//! - WS event bridge: Tauri events → broadcast → WebSocket clients
//! - Binds to localhost only (127.0.0.1:19840)

use axum::{
    Router,
    routing::{get, post, delete},
    extract::{Path, Query, State, WebSocketUpgrade, ws},
    http::{StatusCode, HeaderMap},
    response::{IntoResponse, Json},
    middleware,
};
use serde::Deserialize;
use tokio::sync::broadcast;

use crate::db::DbState;
use crate::commands::roundtable_helpers::executor::RoundtableParticipant;

const DEFAULT_PORT: u16 = 19840;
type CancelArc = std::sync::Arc<parking_lot::Mutex<std::collections::HashSet<String>>>;

/// Helper: acquire lock, recovering from poison if needed.
macro_rules! lock_or_recover {
    ($mutex:expr) => {
        match $mutex.lock() {
            Ok(g) => g,
            Err(poisoned) => {
                eprintln!("[http-api] recovering poisoned mutex");
                poisoned.into_inner()
            }
        }
    };
}

/// Helper: run a fallible DB closure, returning 500 JSON on error.
fn db_error(e: impl std::fmt::Display) -> axum::response::Response {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("db: {}", e)}))).into_response()
}

/// Run a blocking DB operation off the async executor.
/// Prevents head-of-line blocking when holding std::sync::Mutex.
async fn with_read_db<F, T>(state: &ApiState, f: F) -> Result<T, axum::response::Response>
where
    F: FnOnce(&rusqlite::Connection) -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        let conn = lock_or_recover!(db.read);
        f(&conn)
    })
    .await
    .map_err(|e| db_error(format!("task join: {}", e)))?
    .map_err(|e| db_error(e))
}

async fn with_write_db<F, T>(state: &ApiState, f: F) -> Result<T, axum::response::Response>
where
    F: FnOnce(&rusqlite::Connection) -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        let conn = lock_or_recover!(db.write);
        f(&conn)
    })
    .await
    .map_err(|e| db_error(format!("task join: {}", e)))?
    .map_err(|e| db_error(e))
}

/// Shared state for axum handlers.
#[derive(Clone)]
#[allow(dead_code)]
pub struct ApiState {
    pub db: DbState,
    pub token: String,
    pub event_tx: broadcast::Sender<String>,
    pub app_handle: tauri::AppHandle,
    pub cancel: CancelArc,
}

/// Start the HTTP API server on a background tokio task.
/// Returns the generated Bearer token for auth.
pub fn start_server(db: DbState, app_handle: tauri::AppHandle, cancel: CancelArc) -> String {
    let token = generate_token();
    let (event_tx, _) = broadcast::channel::<String>(256);

    let state = ApiState {
        db: db.clone(),
        token: token.clone(),
        event_tx: event_tx.clone(),
        app_handle: app_handle.clone(),
        cancel,
    };

    // Bridge Tauri events → broadcast channel
    let tx = event_tx.clone();
    bridge_tauri_events(app_handle, tx);

    tauri::async_runtime::spawn(async move {
        let app = build_router(state);
        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], DEFAULT_PORT));
        eprintln!("[http-api] starting on http://{}", addr);
        let listener = match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[http-api] bind failed: {} (port {} may be in use)", e, DEFAULT_PORT);
                return;
            }
        };
        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("[http-api] server error: {}", e);
        }
    });

    token
}

fn generate_token() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn build_router(state: ApiState) -> Router {
    Router::new()
        // Read endpoints
        .route("/api/projects", get(list_projects))
        .route("/api/conversations", get(list_conversations))
        .route("/api/conversations/{id}/messages", get(list_messages))
        .route("/api/plans", get(list_plans))
        .route("/api/plans/{id}", get(get_plan))
        .route("/api/plans/{id}/events", get(list_plan_events))
        .route("/api/artifacts", get(list_artifacts))
        .route("/api/agents/status", get(agents_status))
        // Write endpoints
        .route("/api/projects", post(create_project))
        .route("/api/conversations", post(create_conversation))
        .route("/api/conversations/{id}/send", post(send_message))
        .route("/api/conversations/{id}/delete", post(delete_conversation))
        .route("/api/plans/{id}/approve", post(approve_plan))
        // Branch endpoints
        .route("/api/conversations/{id}/branches", get(list_branches))
        .route("/api/branches", post(create_branch))
        .route("/api/branches/{id}", delete(delete_branch))
        .route("/api/branches/{id}/archive", post(archive_branch))
        .route("/api/branches/{id}/adopt", post(adopt_branch))
        .route("/api/branches/{id}/rename", post(rename_branch))
        // Roundtable endpoints
        .route("/api/roundtables/run", post(start_rt_run))
        .route("/api/roundtables/{id}/cancel", post(cancel_rt))
        // Memory & search endpoints
        .route("/api/conversations/{id}/memory/status", get(memory_status))
        .route("/api/conversations/{id}/memory/compress", post(compress_memory))
        .route("/api/conversations/{id}/session-links", get(list_session_links))
        .route("/api/conversations/{id}/session-links/refresh", post(refresh_session_links))
        .route("/api/conversations/{id}/chunks/index", post(index_chunks))
        .route("/api/conversations/{id}/chunks/search", post(search_chunks))
        .route("/api/conversations/{id}/traces", get(list_conv_traces))
        // Document RAG endpoints
        .route("/api/projects/{key}/documents/index", post(index_project_documents))
        .route("/api/projects/{key}/documents/search", post(search_project_documents))
        .route("/api/projects/{key}/documents/graph", get(get_document_graph))
        .route("/api/projects/{key}/documents/orphans", get(get_orphan_documents))
        .route("/api/projects/{key}/documents/status", get(get_document_index_status))
        // WebSocket
        .route("/ws/events", get(ws_events))
        // Health
        .route("/api/health", get(health))
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware))
        .with_state(state)
}

// ─── Auth middleware ────────────────────────────────────────────────────

async fn auth_middleware(
    State(state): State<ApiState>,
    headers: HeaderMap,
    request: axum::extract::Request,
    next: middleware::Next,
) -> impl IntoResponse {
    // Skip auth for health check
    if request.uri().path() == "/api/health" {
        return next.run(request).await;
    }

    let auth = headers.get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if auth == format!("Bearer {}", state.token) {
        next.run(request).await
    } else {
        (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "invalid token"}))).into_response()
    }
}

// ─── Read handlers ──────────────────────────────────────────────────────

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({"status": "ok", "version": env!("CARGO_PKG_VERSION")}))
}

async fn list_projects(State(state): State<ApiState>) -> impl IntoResponse {
    match with_read_db(&state, |conn| {
        let mut stmt = conn.prepare("SELECT key, name, path, type FROM projects WHERE hidden = 0 ORDER BY name")
            .map_err(|e| e.to_string())?;
        let rows: Vec<serde_json::Value> = stmt.query_map([], |r| {
            Ok(serde_json::json!({
                "key": r.get::<_, String>(0)?,
                "name": r.get::<_, String>(1)?,
                "path": r.get::<_, Option<String>>(2)?,
                "type": r.get::<_, String>(3)?,
            }))
        }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        Ok(rows)
    }).await {
        Ok(rows) => Json(serde_json::json!(rows)).into_response(),
        Err(resp) => resp,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationQuery {
    project_key: Option<String>,
}

async fn list_conversations(State(state): State<ApiState>, Query(q): Query<ConversationQuery>) -> impl IntoResponse {
    let conn = lock_or_recover!(state.db.read);
    let map_conv = |r: &rusqlite::Row| -> rusqlite::Result<serde_json::Value> {
        Ok(serde_json::json!({
            "id": r.get::<_, String>(0)?, "projectKey": r.get::<_, String>(1)?,
            "label": r.get::<_, Option<String>>(2)?, "mode": r.get::<_, String>(3)?,
        }))
    };
    let rows: Vec<serde_json::Value> = if let Some(ref pk) = q.project_key {
        let mut stmt = match conn.prepare(
            "SELECT id, project_key, label, mode FROM conversations WHERE project_key = ?1 AND usage_status != 'hidden' ORDER BY id"
        ) { Ok(s) => s, Err(e) => return db_error(e) };
        stmt.query_map([pk], map_conv).unwrap().filter_map(|r| r.ok()).collect()
    } else {
        let mut stmt = match conn.prepare(
            "SELECT id, project_key, label, mode FROM conversations WHERE usage_status != 'hidden' ORDER BY id"
        ) { Ok(s) => s, Err(e) => return db_error(e) };
        stmt.query_map([], map_conv).unwrap().filter_map(|r| r.ok()).collect()
    };
    Json(serde_json::json!(rows)).into_response()
}

async fn list_messages(State(state): State<ApiState>, Path(conv_id): Path<String>) -> impl IntoResponse {
    let conn = lock_or_recover!(state.db.read);
    let mut stmt = match conn.prepare(
        "SELECT id, role, content, engine, model, status, timestamp FROM messages WHERE conversation_id = ?1 ORDER BY timestamp ASC"
    ) { Ok(s) => s, Err(e) => return db_error(e) };
    let rows: Vec<serde_json::Value> = stmt.query_map([&conv_id], |r| Ok(serde_json::json!({
        "id": r.get::<_, String>(0)?, "role": r.get::<_, String>(1)?,
        "content": r.get::<_, String>(2)?, "engine": r.get::<_, Option<String>>(3)?,
        "model": r.get::<_, Option<String>>(4)?, "status": r.get::<_, String>(5)?,
        "timestamp": r.get::<_, i64>(6)?,
    }))).unwrap().filter_map(|r| r.ok()).collect();
    Json(serde_json::json!(rows)).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanQuery {
    conversation_id: Option<String>,
}

async fn list_plans(State(state): State<ApiState>, Query(q): Query<PlanQuery>) -> impl IntoResponse {
    let conn = lock_or_recover!(state.db.read);
    let sql = if q.conversation_id.is_some() {
        "SELECT id, conversation_id, title, status, phase FROM plans WHERE conversation_id = ?1 ORDER BY created_at DESC"
    } else {
        "SELECT id, conversation_id, title, status, phase FROM plans ORDER BY created_at DESC LIMIT 20"
    };
    let mut stmt = match conn.prepare(sql) { Ok(s) => s, Err(e) => return db_error(e) };
    let rows: Vec<serde_json::Value> = if let Some(ref cid) = q.conversation_id {
        stmt.query_map([cid], |r| Ok(serde_json::json!({
            "id": r.get::<_, String>(0)?, "conversationId": r.get::<_, String>(1)?,
            "title": r.get::<_, String>(2)?, "status": r.get::<_, String>(3)?,
            "phase": r.get::<_, String>(4)?,
        }))).unwrap().filter_map(|r| r.ok()).collect()
    } else {
        stmt.query_map([], |r| Ok(serde_json::json!({
            "id": r.get::<_, String>(0)?, "conversationId": r.get::<_, String>(1)?,
            "title": r.get::<_, String>(2)?, "status": r.get::<_, String>(3)?,
            "phase": r.get::<_, String>(4)?,
        }))).unwrap().filter_map(|r| r.ok()).collect()
    };
    Json(serde_json::json!(rows)).into_response()
}

async fn get_plan(State(state): State<ApiState>, Path(plan_id): Path<String>) -> impl IntoResponse {
    let conn = lock_or_recover!(state.db.read);
    let plan = conn.query_row(
        "SELECT id, conversation_id, title, status, phase FROM plans WHERE id = ?1",
        [&plan_id], |r| Ok(serde_json::json!({
            "id": r.get::<_, String>(0)?, "conversationId": r.get::<_, String>(1)?,
            "title": r.get::<_, String>(2)?, "status": r.get::<_, String>(3)?,
            "phase": r.get::<_, String>(4)?,
        }))
    );
    match plan {
        Ok(p) => Json(p).into_response(),
        Err(_) => (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "plan not found"}))).into_response(),
    }
}

async fn list_plan_events(State(state): State<ApiState>, Path(plan_id): Path<String>) -> impl IntoResponse {
    let conn = lock_or_recover!(state.db.read);
    let mut stmt = match conn.prepare(
        "SELECT id, event_type, actor, detail, created_at FROM plan_events WHERE plan_id = ?1 ORDER BY created_at ASC"
    ) { Ok(s) => s, Err(e) => return db_error(e) };
    let rows: Vec<serde_json::Value> = stmt.query_map([&plan_id], |r| Ok(serde_json::json!({
        "id": r.get::<_, String>(0)?, "eventType": r.get::<_, String>(1)?,
        "actor": r.get::<_, Option<String>>(2)?, "detail": r.get::<_, Option<String>>(3)?,
        "createdAt": r.get::<_, i64>(4)?,
    }))).unwrap().filter_map(|r| r.ok()).collect();
    Json(serde_json::json!(rows)).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactQuery {
    conversation_id: Option<String>,
}

async fn list_artifacts(State(state): State<ApiState>, Query(q): Query<ArtifactQuery>) -> impl IntoResponse {
    let conn = lock_or_recover!(state.db.read);
    let sql = if q.conversation_id.is_some() {
        "SELECT id, conversation_id, type, title, status FROM artifacts WHERE conversation_id = ?1 ORDER BY created_at DESC"
    } else {
        "SELECT id, conversation_id, type, title, status FROM artifacts ORDER BY created_at DESC LIMIT 20"
    };
    let mut stmt = match conn.prepare(sql) { Ok(s) => s, Err(e) => return db_error(e) };
    let rows: Vec<serde_json::Value> = if let Some(ref cid) = q.conversation_id {
        stmt.query_map([cid], |r| Ok(serde_json::json!({
            "id": r.get::<_, String>(0)?, "conversationId": r.get::<_, String>(1)?,
            "type": r.get::<_, String>(2)?, "title": r.get::<_, String>(3)?,
            "status": r.get::<_, String>(4)?,
        }))).unwrap().filter_map(|r| r.ok()).collect()
    } else {
        stmt.query_map([], |r| Ok(serde_json::json!({
            "id": r.get::<_, String>(0)?, "conversationId": r.get::<_, String>(1)?,
            "type": r.get::<_, String>(2)?, "title": r.get::<_, String>(3)?,
            "status": r.get::<_, String>(4)?,
        }))).unwrap().filter_map(|r| r.ok()).collect()
    };
    Json(serde_json::json!(rows)).into_response()
}

async fn agents_status(State(state): State<ApiState>) -> impl IntoResponse {
    let conn = lock_or_recover!(state.db.read);
    let mut stmt = match conn.prepare(
        "SELECT id, conversation_id, engine, kind, status FROM agent_jobs WHERE status = 'running'"
    ) { Ok(s) => s, Err(e) => return db_error(e) };
    let jobs: Vec<serde_json::Value> = stmt.query_map([], |r| Ok(serde_json::json!({
        "id": r.get::<_, String>(0)?, "conversationId": r.get::<_, String>(1)?,
        "engine": r.get::<_, Option<String>>(2)?, "kind": r.get::<_, String>(3)?,
        "status": r.get::<_, String>(4)?,
    }))).unwrap().filter_map(|r| r.ok()).collect();
    let running = !jobs.is_empty();
    Json(serde_json::json!({"running": running, "jobs": jobs})).into_response()
}

// ─── Write handlers ─────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateProjectInput {
    key: String,
    name: String,
    path: Option<String>,
}

async fn create_project(State(state): State<ApiState>, Json(input): Json<CreateProjectInput>) -> impl IntoResponse {
    let conn = lock_or_recover!(state.db.write);
    let now = crate::db::migrations::now_epoch_ms();
    if let Err(e) = conn.execute(
        "INSERT OR IGNORE INTO projects (key, name, path, type, source, hidden, updated_at) VALUES (?1, ?2, ?3, 'project', 'api', 0, ?4)",
        rusqlite::params![input.key, input.name, input.path, now],
    ) {
        return db_error(e);
    }
    (StatusCode::CREATED, Json(serde_json::json!({"key": input.key, "name": input.name, "path": input.path}))).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateConversationInput {
    project_key: String,
    label: Option<String>,
}

async fn create_conversation(State(state): State<ApiState>, Json(input): Json<CreateConversationInput>) -> impl IntoResponse {
    let conn = lock_or_recover!(state.db.write);
    let id = uuid::Uuid::new_v4().to_string();
    let label = input.label.unwrap_or_else(|| "API conversation".into());
    let now = crate::db::migrations::now_epoch_ms();
    if let Err(e) = conn.execute(
        "INSERT INTO conversations (id, project_key, label, mode, usage_status, source, created_at, updated_at) VALUES (?1, ?2, ?3, 'chat', 'active', 'api', ?4, ?4)",
        rusqlite::params![id, input.project_key, label, now],
    ) {
        return db_error(e);
    }
    (StatusCode::CREATED, Json(serde_json::json!({"id": id, "label": label, "createdAt": now}))).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendMessageInput {
    engine: Option<String>,
    prompt: String,
    model: Option<String>,
    dry_run: Option<bool>,
}

async fn send_message(
    State(state): State<ApiState>,
    Path(conv_id): Path<String>,
    Json(input): Json<SendMessageInput>,
) -> impl IntoResponse {
    let engine = input.engine.unwrap_or_else(|| "claude".into());

    // Save user message
    let user_msg_id = uuid::Uuid::new_v4().to_string();
    let now = crate::db::migrations::now_epoch_ms();
    {
        let conn = lock_or_recover!(state.db.write);
        if let Err(e) = conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, timestamp, status) VALUES (?1, ?2, 'user', ?3, ?4, 'done')",
            rusqlite::params![user_msg_id, conv_id, input.prompt, now],
        ) {
            return db_error(e);
        }
    }

    if input.dry_run.unwrap_or(false) {
        return (StatusCode::OK, Json(serde_json::json!({
            "messageId": user_msg_id, "dryRun": true,
            "info": "User message saved. Agent execution skipped (dry_run mode)."
        }))).into_response();
    }

    // Resolve project path from DB
    let project_path = {
        let conn = lock_or_recover!(state.db.read);
        conn.query_row(
            "SELECT p.path FROM projects p JOIN conversations c ON c.project_key = p.key WHERE c.id = ?1",
            [&conv_id], |r| r.get::<_, Option<String>>(0),
        ).unwrap_or(None)
    };

    // Execute agent in background (same pattern as Tauri commands)
    let db = state.db.clone();
    let db_post = state.db.clone();
    let conv_id_clone = conv_id.clone();
    let prompt = input.prompt.clone();
    let model = input.model.clone();
    let event_tx = state.event_tx.clone();

    let engine_for_db = engine.clone();
    let conv_id_for_ctx = conv_id.clone();
    tokio::spawn(async move {
        let result = tokio::task::spawn_blocking(move || {
            use crate::agents::claude;
            use crate::commands::agents_helpers::send_common::build_normalized_prompt_with_budget;

            // Build ContextPack — same as Tauri commands
            let (enriched_prompt, system_prompt, _meta) = {
                let conn = match db.read.lock() { Ok(c) => c, Err(p) => p.into_inner() };
                build_normalized_prompt_with_budget(
                    &conn,
                    &conv_id_for_ctx,
                    &prompt,
                    project_path.as_deref(),
                    &[],  // active_skills
                    &[],  // cross_session_ids (auto-discovered inside)
                    None, // persona_fragment
                    None, // context_mode_override
                    None, // context_budget_cap
                )
            };

            eprintln!("[http-api] ContextPack built: prompt={}chars system={}chars",
                enriched_prompt.len(), system_prompt.as_ref().map(|s| s.len()).unwrap_or(0));

            let run_input = claude::RunInput {
                prompt: enriched_prompt,
                model,
                system_prompt,
                resume_token: None,
                project_path: project_path.clone(),
            };
            match engine.as_str() {
                "claude" => claude::run(run_input),
                "codex" => crate::agents::codex::run(run_input),
                "gemini" => crate::agents::gemini::run(run_input),
                "ollama" => crate::agents::openai_compat::run(run_input),
                _ => claude::run(run_input),
            }
        }).await;

        match result {
            Ok(Ok(out)) => {
                let msg_id = uuid::Uuid::new_v4().to_string();
                let now = crate::db::migrations::now_epoch_ms();
                let conn = match db.write.lock() { Ok(c) => c, Err(p) => p.into_inner() };
                {
                    conn.execute(
                        "INSERT INTO messages (id, conversation_id, role, content, engine, model, timestamp, status) VALUES (?1, ?2, 'assistant', ?3, ?4, ?5, ?6, 'done')",
                        rusqlite::params![msg_id, conv_id_clone, out.content, engine_for_db, out.session_id, now],
                    ).ok();
                }
                drop(conn);
                let _ = event_tx.send(serde_json::json!({
                    "type": "agent:completed",
                    "conversationId": conv_id_clone,
                    "messageId": msg_id,
                }).to_string());
                // Fire-and-forget: memory compression, session discovery, vector indexing
                crate::commands::agents_helpers::send_common::spawn_post_completion_tasks(
                    db_post, conv_id_clone,
                );
            }
            Ok(Err(e)) => {
                eprintln!("[http-api] agent error: {}", e);
                let _ = event_tx.send(serde_json::json!({
                    "type": "agent:error",
                    "conversationId": conv_id_clone,
                    "error": format!("{}", e),
                }).to_string());
            }
            Err(e) => {
                eprintln!("[http-api] agent task panicked: {:?}", e);
            }
        }
    });

    (StatusCode::ACCEPTED, Json(serde_json::json!({
        "messageId": user_msg_id, "status": "running",
        "info": "Agent execution started. Listen on /ws/events for completion."
    }))).into_response()
}

async fn approve_plan(State(state): State<ApiState>, Path(plan_id): Path<String>) -> impl IntoResponse {
    let conn = lock_or_recover!(state.db.write);
    let updated = conn.execute(
        "UPDATE plans SET status = 'active', phase = 'implementation' WHERE id = ?1 AND status != 'done'",
        [&plan_id],
    ).unwrap_or(0);
    if updated > 0 {
        let now = crate::db::migrations::now_epoch_ms();
        let event_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO plan_events (id, plan_id, event_type, actor, created_at) VALUES (?1, ?2, 'approved', 'api', ?3)",
            rusqlite::params![event_id, plan_id, now],
        ).ok();
        Json(serde_json::json!({"approved": true, "planId": plan_id})).into_response()
    } else {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "plan not found or already done"}))).into_response()
    }
}

// ─── Conversation delete ────────────────────────────────────────────────

async fn delete_conversation(State(state): State<ApiState>, Path(conv_id): Path<String>) -> impl IntoResponse {
    let conn = lock_or_recover!(state.db.write);
    // Delete messages first (FK), then conversation
    conn.execute("DELETE FROM messages WHERE conversation_id = ?1", [&conv_id]).ok();
    conn.execute("DELETE FROM memos WHERE conversation_id = ?1", [&conv_id]).ok();
    let deleted = conn.execute("DELETE FROM conversations WHERE id = ?1", [&conv_id]).unwrap_or(0);
    if deleted > 0 {
        Json(serde_json::json!({"deleted": true, "conversationId": conv_id})).into_response()
    } else {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "conversation not found"}))).into_response()
    }
}

// ─── Branch handlers ───────────────────────────────────────────────────

async fn list_branches(State(state): State<ApiState>, Path(conv_id): Path<String>) -> impl IntoResponse {
    let conn = lock_or_recover!(state.db.read);
    let mut stmt = match conn.prepare(
        "SELECT id, label, custom_label, status, checkpoint_id, mode, parent_branch_id, created_at FROM branches WHERE conversation_id = ?1 ORDER BY created_at ASC"
    ) { Ok(s) => s, Err(e) => return db_error(e) };
    let rows: Vec<serde_json::Value> = stmt.query_map([&conv_id], |r| Ok(serde_json::json!({
        "id": r.get::<_, String>(0)?, "label": r.get::<_, String>(1)?,
        "customLabel": r.get::<_, Option<String>>(2)?, "status": r.get::<_, String>(3)?,
        "checkpointId": r.get::<_, Option<String>>(4)?, "mode": r.get::<_, String>(5)?,
        "parentBranchId": r.get::<_, Option<String>>(6)?, "createdAt": r.get::<_, i64>(7)?,
    }))).unwrap().filter_map(|r| r.ok()).collect();
    Json(serde_json::json!(rows)).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateBranchInput {
    conversation_id: String,
    label: Option<String>,
    mode: Option<String>,
    checkpoint_id: Option<String>,
}

async fn create_branch(State(state): State<ApiState>, Json(input): Json<CreateBranchInput>) -> impl IntoResponse {
    let conn = lock_or_recover!(state.db.write);
    let id = uuid::Uuid::new_v4().to_string();
    let label = input.label.unwrap_or_else(|| format!("b{}", id.chars().take(4).collect::<String>()));
    let mode = input.mode.unwrap_or_else(|| "chat".into());
    let now = crate::db::migrations::now_epoch_ms();

    if let Err(e) = conn.execute(
        "INSERT INTO branches (id, conversation_id, label, status, mode, checkpoint_id, created_at) VALUES (?1, ?2, ?3, 'active', ?4, ?5, ?6)",
        rusqlite::params![id, input.conversation_id, label, mode, input.checkpoint_id, now],
    ) {
        return db_error(e);
    }

    // Create shadow conversation for the branch
    let shadow_id = format!("branch:{}", id);
    if let Err(e) = conn.execute(
        "INSERT INTO conversations (id, project_key, label, mode, usage_status, source, created_at, updated_at) \
         SELECT ?1, project_key, ?2, ?3, 'active', 'api', ?4, ?4 FROM conversations WHERE id = ?5",
        rusqlite::params![shadow_id, format!("Branch {}", label), mode, now, input.conversation_id],
    ) {
        return db_error(e);
    }

    (StatusCode::CREATED, Json(serde_json::json!({
        "id": id, "label": label, "mode": mode, "shadowConversationId": shadow_id
    }))).into_response()
}

async fn delete_branch(State(state): State<ApiState>, Path(branch_id): Path<String>) -> impl IntoResponse {
    let conn = lock_or_recover!(state.db.write);
    let shadow_id = format!("branch:{}", branch_id);
    // Delete messages in shadow conversation
    conn.execute("DELETE FROM messages WHERE conversation_id = ?1", [&shadow_id]).ok();
    // Delete shadow conversation
    conn.execute("DELETE FROM conversations WHERE id = ?1", [&shadow_id]).ok();
    // Delete branch
    let deleted = conn.execute("DELETE FROM branches WHERE id = ?1", [&branch_id]).unwrap_or(0);
    if deleted > 0 {
        Json(serde_json::json!({"deleted": true, "branchId": branch_id})).into_response()
    } else {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "branch not found"}))).into_response()
    }
}

async fn archive_branch(State(state): State<ApiState>, Path(branch_id): Path<String>) -> impl IntoResponse {
    let conn = lock_or_recover!(state.db.write);
    let updated = conn.execute("UPDATE branches SET status = 'archived' WHERE id = ?1", [&branch_id]).unwrap_or(0);
    if updated > 0 {
        Json(serde_json::json!({"archived": true, "branchId": branch_id})).into_response()
    } else {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "branch not found"}))).into_response()
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdoptInput {
    conversation_id: String,
}

async fn adopt_branch(State(state): State<ApiState>, Path(branch_id): Path<String>, Json(input): Json<AdoptInput>) -> impl IntoResponse {
    let conn = lock_or_recover!(state.db.write);
    let shadow_id = format!("branch:{}", branch_id);

    // Collect ALL assistant messages as summary (with persona/engine attribution)
    let summary = {
        let mut stmt = match conn.prepare(
            "SELECT content, persona, engine FROM messages WHERE conversation_id = ?1 AND role = 'assistant' ORDER BY timestamp ASC"
        ) { Ok(s) => s, Err(e) => return db_error(e) };
        let parts: Vec<String> = stmt.query_map([&shadow_id], |r| {
            let content: String = r.get(0)?;
            let persona: Option<String> = r.get(1)?;
            let engine: Option<String> = r.get(2)?;
            let label = persona.or(engine).unwrap_or_default();
            let truncated = if content.len() > 300 { format!("{}...", &content[..300]) } else { content };
            Ok(if label.is_empty() { truncated } else { format!("**[{}]** {}", label, truncated) })
        }).unwrap().filter_map(|r| r.ok()).collect();
        if parts.is_empty() { "(no summary available)".to_string() } else { parts.join("\n\n") }
    };

    // Mark branch as adopted
    let updated = conn.execute("UPDATE branches SET status = 'adopted' WHERE id = ?1", [&branch_id]).unwrap_or(0);
    if updated == 0 {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "branch not found"}))).into_response();
    }

    // Insert adopt-summary into parent conversation (cap at 2000 chars)
    let msg_id = uuid::Uuid::new_v4().to_string();
    let now = crate::db::migrations::now_epoch_ms();
    let capped = if summary.len() > 2000 { format!("{}...", &summary[..2000]) } else { summary };
    let adopt_content = format!("[Branch adopted]\n\n{}", capped);
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content, timestamp, status) VALUES (?1, ?2, 'system', ?3, ?4, 'done')",
        rusqlite::params![msg_id, input.conversation_id, adopt_content, now],
    ).ok();

    Json(serde_json::json!({"adopted": true, "branchId": branch_id, "summaryMessageId": msg_id})).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameInput {
    label: String,
}

async fn rename_branch(State(state): State<ApiState>, Path(branch_id): Path<String>, Json(input): Json<RenameInput>) -> impl IntoResponse {
    let conn = lock_or_recover!(state.db.write);
    let updated = conn.execute("UPDATE branches SET custom_label = ?1 WHERE id = ?2", rusqlite::params![input.label, branch_id]).unwrap_or(0);
    if updated > 0 {
        Json(serde_json::json!({"renamed": true, "branchId": branch_id, "label": input.label})).into_response()
    } else {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "branch not found"}))).into_response()
    }
}

// ─── Roundtable handlers ───────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RtRunInput {
    conversation_id: String,
    prompt: String,
    participants: Vec<RoundtableParticipant>,
    mode: Option<String>,
}

async fn start_rt_run(State(state): State<ApiState>, Json(input): Json<RtRunInput>) -> impl IntoResponse {
    use crate::commands::roundtable::RoundtableRunInput;

    let rt_input = RoundtableRunInput {
        conversation_id: input.conversation_id.clone(),
        prompt: input.prompt,
        participants: input.participants,
        rounds: None,
        mode: input.mode,
    };

    let db = state.db.clone();
    let event_tx = state.event_tx.clone();

    let write_arc = std::sync::Arc::clone(&db.write);

    tokio::task::spawn_blocking(move || {
        use crate::commands::agents_helpers::context_pack::build_rt_inheritance_section;
        use crate::commands::context_queries::project_path_for_conversation;
        use crate::db::migrations::now_epoch_ms;

        let result: Result<(), String> = (|| {
            let conn = match write_arc.lock() { Ok(c) => c, Err(p) => p.into_inner() };
            let _pp = project_path_for_conversation(&conn, &rt_input.conversation_id);
            let inheritance = build_rt_inheritance_section(&conn, &rt_input.conversation_id, None);
            let enriched = if let Some(ctx) = inheritance {
                format!("{}\n\n---\n\n{}", ctx, rt_input.prompt)
            } else {
                rt_input.prompt.clone()
            };

            let names: Vec<&str> = rt_input.participants.iter().map(|p| p.name.as_str()).collect();
            let mode_label = rt_input.mode.as_deref().unwrap_or("sequential");
            let header = format!("--- Round 1 · {} · {} ---", mode_label, names.join(", "));

            // Save user message
            let user_id = uuid::Uuid::new_v4().to_string();
            let now = now_epoch_ms();
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, timestamp, status) VALUES (?1, ?2, 'user', ?3, ?4, 'done')",
                rusqlite::params![user_id, rt_input.conversation_id, rt_input.prompt, now],
            ).map_err(|e| e.to_string())?;

            // Save header
            let header_id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, timestamp, status) VALUES (?1, ?2, 'system', ?3, ?4, 'done')",
                rusqlite::params![header_id, rt_input.conversation_id, header, now_epoch_ms()],
            ).map_err(|e| e.to_string())?;

            drop(conn); // Release write lock before running agents

            // Execute each participant sequentially
            for participant in &rt_input.participants {
                let engine = participant.engine.as_deref().unwrap_or("claude");
                let model = participant.model.clone();
                let name = &participant.name;

                // Emit participant status
                let _ = event_tx.send(serde_json::json!({
                    "type": "roundtable:participant_status",
                    "payload": {"conversationId": rt_input.conversation_id, "name": name, "status": "running"}
                }).to_string());

                // Run agent (use temp dir to avoid project-level CLI conflicts)
                let run_result = {
                    use crate::agents::claude;
                    let run_input = claude::RunInput {
                        prompt: enriched.clone(),
                        model,
                        system_prompt: Some(format!("You are {} participating in a roundtable discussion. Be concise.", name)),
                        resume_token: None,
                        project_path: None, // temp dir — avoids conflict with PTY sessions
                    };
                    match engine {
                        "claude" => claude::run(run_input),
                        "codex" => crate::agents::codex::run(run_input),
                        "gemini" => crate::agents::gemini::run(run_input),
                        "ollama" => crate::agents::openai_compat::run(run_input),
                        _ => claude::run(run_input),
                    }
                };

                match run_result {
                    Ok(out) => {
                        let msg_id = uuid::Uuid::new_v4().to_string();
                        let conn = match write_arc.lock() { Ok(c) => c, Err(p) => p.into_inner() };
                        conn.execute(
                            "INSERT INTO messages (id, conversation_id, role, content, engine, model, persona, timestamp, status) VALUES (?1, ?2, 'assistant', ?3, ?4, ?5, ?6, ?7, 'done')",
                            rusqlite::params![msg_id, rt_input.conversation_id, out.content, engine, out.session_id, name, now_epoch_ms()],
                        ).ok();
                        let _ = event_tx.send(serde_json::json!({
                            "type": "roundtable:participant_status",
                            "payload": {"conversationId": rt_input.conversation_id, "name": name, "status": "done"}
                        }).to_string());
                    }
                    Err(e) => {
                        eprintln!("[http-api] RT participant {} error: {}", name, e);
                        // Save error as system message so it's visible in conversation
                        let err_msg_id = uuid::Uuid::new_v4().to_string();
                        let conn = match write_arc.lock() { Ok(c) => c, Err(p) => p.into_inner() };
                        conn.execute(
                            "INSERT INTO messages (id, conversation_id, role, content, timestamp, status) VALUES (?1, ?2, 'system', ?3, ?4, 'done')",
                            rusqlite::params![err_msg_id, rt_input.conversation_id, format!("[{}] 에이전트 실패: {}", name, e), now_epoch_ms()],
                        ).ok();
                        let _ = event_tx.send(serde_json::json!({
                            "type": "agent:error",
                            "payload": {"conversationId": rt_input.conversation_id, "name": name, "error": format!("{}", e)}
                        }).to_string());
                    }
                }
            }

            let _ = event_tx.send(serde_json::json!({
                "type": "agent:completed",
                "payload": {"conversationId": rt_input.conversation_id}
            }).to_string());

            Ok(())
        })();

        if let Err(e) = result {
            eprintln!("[http-api] RT run failed: {}", e);
        }
    });

    (StatusCode::ACCEPTED, Json(serde_json::json!({
        "status": "running",
        "conversationId": input.conversation_id,
        "info": "Roundtable started. Listen on /ws/events for progress."
    }))).into_response()
}

async fn cancel_rt(State(state): State<ApiState>, Path(conv_id): Path<String>) -> impl IntoResponse {
    let mut set = state.cancel.lock();
    set.insert(conv_id.clone());
    Json(serde_json::json!({"cancelled": true, "conversationId": conv_id})).into_response()
}

// ─── Memory & Search handlers ──────────────────────────────────────────

async fn memory_status(State(state): State<ApiState>, Path(conv_id): Path<String>) -> impl IntoResponse {
    let conn = lock_or_recover!(state.db.read);
    let status = crate::commands::conversation_memory::get_memory_status(&conn, &conv_id);
    Json(serde_json::json!(status)).into_response()
}

async fn compress_memory(State(state): State<ApiState>, Path(conv_id): Path<String>) -> impl IntoResponse {
    let db = state.db.clone();
    let cid = conv_id.clone();
    match tokio::task::spawn_blocking(move || {
        crate::commands::conversation_memory::compress_memory_blocking(&db, &cid)
    }).await {
        Ok(Ok(compressed)) => Json(serde_json::json!({"compressed": compressed, "conversationId": conv_id})).into_response(),
        Ok(Err(e)) => db_error(e),
        Err(e) => db_error(format!("task: {}", e)),
    }
}

async fn list_session_links(State(state): State<ApiState>, Path(conv_id): Path<String>) -> impl IntoResponse {
    let conn = lock_or_recover!(state.db.read);
    let mut stmt = match conn.prepare(
        "SELECT id, linked_conv_id, score, method, created_at FROM session_links WHERE conversation_id = ?1 ORDER BY score DESC"
    ) { Ok(s) => s, Err(e) => return db_error(e) };
    let rows: Vec<serde_json::Value> = stmt.query_map([&conv_id], |r| Ok(serde_json::json!({
        "id": r.get::<_, String>(0)?, "linkedConvId": r.get::<_, String>(1)?,
        "score": r.get::<_, f64>(2)?, "method": r.get::<_, String>(3)?,
        "createdAt": r.get::<_, i64>(4)?,
    }))).unwrap().filter_map(|r| r.ok()).collect();
    Json(serde_json::json!(rows)).into_response()
}

async fn refresh_session_links(State(state): State<ApiState>, Path(conv_id): Path<String>) -> impl IntoResponse {
    let conn = lock_or_recover!(state.db.read);
    // Get project_key for this conversation
    let project_key: String = match conn.query_row(
        "SELECT project_key FROM conversations WHERE id = ?1", [&conv_id], |r| r.get(0),
    ) {
        Ok(pk) => pk,
        Err(_) => return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "conversation not found"}))).into_response(),
    };
    let links = crate::commands::session_discovery::discover_related_sessions(&conn, &conv_id, &project_key, 5);
    // Upsert links
    drop(conn);
    let write_conn = lock_or_recover!(state.db.write);
    let now = crate::db::migrations::now_epoch_ms();
    for (linked_id, score) in &links {
        let link_id = uuid::Uuid::new_v4().to_string();
        write_conn.execute(
            "INSERT OR REPLACE INTO session_links (id, conversation_id, linked_conv_id, score, method, created_at) VALUES (?1, ?2, ?3, ?4, 'fts5', ?5)",
            rusqlite::params![link_id, conv_id, linked_id, score, now],
        ).ok();
    }
    Json(serde_json::json!({"refreshed": links.len(), "links": links.iter().map(|(id, score)| serde_json::json!({"conversationId": id, "score": score})).collect::<Vec<_>>()})).into_response()
}

async fn index_chunks(State(state): State<ApiState>, Path(conv_id): Path<String>) -> impl IntoResponse {
    let db = state.db.clone();
    let cid = conv_id.clone();
    match tokio::task::spawn_blocking(move || {
        crate::commands::vector_search::index_chunks_blocking(&db, &cid)
    }).await {
        Ok(Ok(count)) => Json(serde_json::json!({"indexed": count, "conversationId": conv_id})).into_response(),
        Ok(Err(e)) => db_error(e),
        Err(e) => db_error(format!("task: {}", e)),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchChunksInput {
    query: String,
    limit: Option<usize>,
}

async fn search_chunks(State(state): State<ApiState>, Path(conv_id): Path<String>, Json(input): Json<SearchChunksInput>) -> impl IntoResponse {
    let db = state.db.clone();
    let query = input.query;
    let limit = input.limit.unwrap_or(5);
    match tokio::task::spawn_blocking(move || {
        crate::commands::vector_search::search_chunks_blocking(&db, &conv_id, &query, limit)
    }).await {
        Ok(Ok(results)) => Json(serde_json::json!(results)).into_response(),
        Ok(Err(e)) => db_error(e),
        Err(e) => db_error(format!("task: {}", e)),
    }
}

async fn list_conv_traces(State(state): State<ApiState>, Path(conv_id): Path<String>) -> impl IntoResponse {
    let conn = lock_or_recover!(state.db.read);
    let mut stmt = match conn.prepare(
        "SELECT id, trace_id, span_id, engine, context_mode, context_length, input_tokens, output_tokens, cost_usd, created_at FROM trace_log WHERE conversation_id = ?1 ORDER BY created_at DESC LIMIT 20"
    ) { Ok(s) => s, Err(e) => return db_error(e) };
    let rows: Vec<serde_json::Value> = stmt.query_map([&conv_id], |r| Ok(serde_json::json!({
        "id": r.get::<_, String>(0)?, "traceId": r.get::<_, Option<String>>(1)?,
        "engine": r.get::<_, Option<String>>(3)?, "contextMode": r.get::<_, Option<String>>(4)?,
        "contextLength": r.get::<_, i64>(5)?, "inputTokens": r.get::<_, i64>(6)?,
        "outputTokens": r.get::<_, i64>(7)?, "costUsd": r.get::<_, f64>(8)?,
        "createdAt": r.get::<_, i64>(9)?,
    }))).unwrap().filter_map(|r| r.ok()).collect();
    Json(serde_json::json!(rows)).into_response()
}

// ─── WebSocket events ───────────────────────────────────────────────────

async fn ws_events(
    State(state): State<ApiState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    // Auth check for WS (token in query or header)
    let auth = headers.get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if auth != format!("Bearer {}", state.token) {
        return (StatusCode::UNAUTHORIZED, "invalid token").into_response();
    }
    ws.on_upgrade(move |socket| handle_ws(socket, state.event_tx)).into_response()
}

async fn handle_ws(mut socket: ws::WebSocket, event_tx: broadcast::Sender<String>) {
    let mut rx = event_tx.subscribe();
    while let Ok(msg) = rx.recv().await {
        if socket.send(ws::Message::Text(msg.into())).await.is_err() {
            break;
        }
    }
}

// ─── Tauri event bridge ─────────────────────────────────────────────────

fn bridge_tauri_events(app: tauri::AppHandle, tx: broadcast::Sender<String>) {
    use tauri::Listener;
    let events = ["agent:completed", "agent:error", "roundtable:progress", "roundtable:participant_status"];
    for event_name in events {
        let tx = tx.clone();
        let name = event_name.to_string();
        app.listen(event_name, move |event| {
            let payload = event.payload();
            let msg = serde_json::json!({
                "type": name,
                "payload": payload,
            }).to_string();
            let _ = tx.send(msg);
        });
    }
}

// ─── Document RAG endpoints ───────────────────────────────────────────

async fn index_project_documents(
    State(state): State<ApiState>,
    Path(project_key): Path<String>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let pk = project_key.clone();

    let project_path = match with_read_db(&state, move |conn| {
        conn.query_row("SELECT path FROM projects WHERE key = ?1", [&pk], |r| r.get::<_, Option<String>>(0))
            .map_err(|e| format!("project lookup: {}", e))?
            .ok_or_else(|| "project has no path".to_string())
    }).await {
        Ok(p) => p,
        Err(resp) => return resp,
    };

    // Run indexing in background — return immediately with status
    let event_tx = state.event_tx.clone();
    let pk2 = project_key.clone();
    std::thread::spawn(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            crate::commands::document_index::index_project_documents(&db, &project_key, &project_path)
        }));
        match result {
            Ok(Ok(r)) => {
                eprintln!("[doc-index] completed: files={}, chunks={}, edges={}, errors={}",
                    r.files_indexed, r.chunks_created, r.edges_created, r.errors.len());
                if !r.errors.is_empty() {
                    for e in &r.errors[..r.errors.len().min(5)] { eprintln!("[doc-index]   error: {}", e); }
                }
                let _ = event_tx.send(serde_json::json!({
                    "type": "document:indexed", "projectKey": pk2, "result": r,
                }).to_string());
            }
            Ok(Err(e)) => {
                eprintln!("[doc-index] failed: {}", e);
                let _ = event_tx.send(serde_json::json!({
                    "type": "document:error", "projectKey": pk2, "error": e.to_string(),
                }).to_string());
            }
            Err(panic_err) => {
                let msg = panic_err.downcast_ref::<String>()
                    .map(|s| s.as_str())
                    .or_else(|| panic_err.downcast_ref::<&str>().copied())
                    .unwrap_or("unknown panic");
                eprintln!("[doc-index] PANIC: {}", msg);
            }
        }
    });

    (StatusCode::ACCEPTED, Json(serde_json::json!({
        "status": "indexing",
        "info": "Document indexing started in background. Listen on /ws/events for document:indexed event.",
    }))).into_response()
}

#[derive(Deserialize)]
struct DocumentSearchInput {
    query: String,
    limit: Option<usize>,
}

async fn search_project_documents(
    State(state): State<ApiState>,
    Path(project_key): Path<String>,
    Json(input): Json<DocumentSearchInput>,
) -> impl IntoResponse {
    let db = state.db.clone();
    match tokio::task::spawn_blocking(move || {
        crate::commands::document_index::search_documents(&db, &project_key, &input.query, input.limit.unwrap_or(10))
    }).await {
        Ok(Ok(results)) => (StatusCode::OK, Json(serde_json::json!(results))).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()}))).into_response(),
        Err(e) => db_error(format!("task join: {}", e)),
    }
}

async fn get_document_graph(
    State(state): State<ApiState>,
    Path(project_key): Path<String>,
) -> impl IntoResponse {
    match with_read_db(&state, move |conn| {
        Ok(crate::commands::document_index::get_document_graph(conn, &project_key))
    }).await {
        Ok(edges) => (StatusCode::OK, Json(serde_json::json!(edges))).into_response(),
        Err(resp) => resp,
    }
}

async fn get_orphan_documents(
    State(state): State<ApiState>,
    Path(project_key): Path<String>,
) -> impl IntoResponse {
    match with_read_db(&state, move |conn| {
        Ok(crate::commands::document_index::find_orphan_documents(conn, &project_key))
    }).await {
        Ok(orphans) => (StatusCode::OK, Json(serde_json::json!(orphans))).into_response(),
        Err(resp) => resp,
    }
}

async fn get_document_index_status(
    State(state): State<ApiState>,
    Path(project_key): Path<String>,
) -> impl IntoResponse {
    match with_read_db(&state, move |conn| {
        Ok(crate::commands::document_index::get_index_status(conn, &project_key))
    }).await {
        Ok(status) => (StatusCode::OK, Json(serde_json::json!(status))).into_response(),
        Err(resp) => resp,
    }
}
