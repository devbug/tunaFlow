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
    routing::{get, post},
    extract::{Path, Query, State, WebSocketUpgrade, ws},
    http::{StatusCode, HeaderMap},
    response::{IntoResponse, Json},
    middleware,
};
use serde::Deserialize;
use tokio::sync::broadcast;

use crate::db::DbState;

const DEFAULT_PORT: u16 = 19840;

/// Shared state for axum handlers.
#[derive(Clone)]
pub struct ApiState {
    pub db: DbState,
    pub token: String,
    pub event_tx: broadcast::Sender<String>,
}

/// Start the HTTP API server on a background tokio task.
/// Returns the generated Bearer token for auth.
pub fn start_server(db: DbState, app_handle: tauri::AppHandle) -> String {
    let token = generate_token();
    let (event_tx, _) = broadcast::channel::<String>(256);

    let state = ApiState {
        db: db.clone(),
        token: token.clone(),
        event_tx: event_tx.clone(),
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
    use std::time::{SystemTime, UNIX_EPOCH};
    let seed = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    format!("{:032x}", seed ^ 0xdeadbeef_cafebabe_u128)
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
        .route("/api/conversations", post(create_conversation))
        .route("/api/conversations/{id}/send", post(send_message))
        .route("/api/plans/{id}/approve", post(approve_plan))
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
    let conn = match state.db.read.lock() {
        Ok(c) => c,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "db lock"}))).into_response(),
    };
    let mut stmt = conn.prepare("SELECT key, name, path, type FROM projects WHERE hidden = 0 ORDER BY name").unwrap();
    let rows: Vec<serde_json::Value> = stmt.query_map([], |r| {
        Ok(serde_json::json!({
            "key": r.get::<_, String>(0)?,
            "name": r.get::<_, String>(1)?,
            "path": r.get::<_, Option<String>>(2)?,
            "type": r.get::<_, String>(3)?,
        }))
    }).unwrap().filter_map(|r| r.ok()).collect();
    Json(serde_json::json!(rows)).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationQuery {
    project_key: Option<String>,
}

async fn list_conversations(State(state): State<ApiState>, Query(q): Query<ConversationQuery>) -> impl IntoResponse {
    let conn = match state.db.read.lock() {
        Ok(c) => c,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "db lock"}))).into_response(),
    };
    let map_conv = |r: &rusqlite::Row| -> rusqlite::Result<serde_json::Value> {
        Ok(serde_json::json!({
            "id": r.get::<_, String>(0)?, "projectKey": r.get::<_, String>(1)?,
            "label": r.get::<_, Option<String>>(2)?, "mode": r.get::<_, String>(3)?,
        }))
    };
    let rows: Vec<serde_json::Value> = if let Some(ref pk) = q.project_key {
        let mut stmt = conn.prepare(
            "SELECT id, project_key, label, mode FROM conversations WHERE project_key = ?1 AND usage_status != 'hidden' ORDER BY id"
        ).unwrap();
        stmt.query_map([pk], map_conv).unwrap().filter_map(|r| r.ok()).collect()
    } else {
        let mut stmt = conn.prepare(
            "SELECT id, project_key, label, mode FROM conversations WHERE usage_status != 'hidden' ORDER BY id"
        ).unwrap();
        stmt.query_map([], map_conv).unwrap().filter_map(|r| r.ok()).collect()
    };
    Json(serde_json::json!(rows)).into_response()
}

async fn list_messages(State(state): State<ApiState>, Path(conv_id): Path<String>) -> impl IntoResponse {
    let conn = match state.db.read.lock() {
        Ok(c) => c,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "db lock"}))).into_response(),
    };
    let mut stmt = conn.prepare(
        "SELECT id, role, content, engine, model, status, timestamp FROM messages WHERE conversation_id = ?1 ORDER BY timestamp ASC"
    ).unwrap();
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
    let conn = match state.db.read.lock() {
        Ok(c) => c,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "db lock"}))).into_response(),
    };
    let sql = if q.conversation_id.is_some() {
        "SELECT id, conversation_id, title, status, phase FROM plans WHERE conversation_id = ?1 ORDER BY created_at DESC"
    } else {
        "SELECT id, conversation_id, title, status, phase FROM plans ORDER BY created_at DESC LIMIT 20"
    };
    let mut stmt = conn.prepare(sql).unwrap();
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
    let conn = match state.db.read.lock() {
        Ok(c) => c,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "db lock"}))).into_response(),
    };
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
    let conn = match state.db.read.lock() {
        Ok(c) => c,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "db lock"}))).into_response(),
    };
    let mut stmt = conn.prepare(
        "SELECT id, event_type, actor, detail, created_at FROM plan_events WHERE plan_id = ?1 ORDER BY created_at ASC"
    ).unwrap();
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
    let conn = match state.db.read.lock() {
        Ok(c) => c,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "db lock"}))).into_response(),
    };
    let sql = if q.conversation_id.is_some() {
        "SELECT id, conversation_id, type, title, status FROM artifacts WHERE conversation_id = ?1 ORDER BY created_at DESC"
    } else {
        "SELECT id, conversation_id, type, title, status FROM artifacts ORDER BY created_at DESC LIMIT 20"
    };
    let mut stmt = conn.prepare(sql).unwrap();
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
    let conn = match state.db.read.lock() {
        Ok(c) => c,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "db lock"}))).into_response(),
    };
    let mut stmt = conn.prepare(
        "SELECT id, conversation_id, engine, kind, status FROM agent_jobs WHERE status = 'running'"
    ).unwrap();
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
struct CreateConversationInput {
    project_key: String,
    label: Option<String>,
}

async fn create_conversation(State(state): State<ApiState>, Json(input): Json<CreateConversationInput>) -> impl IntoResponse {
    let conn = match state.db.write.lock() {
        Ok(c) => c,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "db lock"}))).into_response(),
    };
    let id = uuid::Uuid::new_v4().to_string();
    let label = input.label.unwrap_or_else(|| "API conversation".into());
    let now = crate::db::migrations::now_epoch_ms();
    conn.execute(
        "INSERT INTO conversations (id, project_key, label, mode, usage_status) VALUES (?1, ?2, ?3, 'chat', 'active')",
        rusqlite::params![id, input.project_key, label],
    ).unwrap();
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
        let conn = match state.db.write.lock() {
            Ok(c) => c,
            Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "db lock"}))).into_response(),
        };
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, timestamp, status) VALUES (?1, ?2, 'user', ?3, ?4, 'done')",
            rusqlite::params![user_msg_id, conv_id, input.prompt, now],
        ).unwrap();
    }

    if input.dry_run.unwrap_or(false) {
        return (StatusCode::OK, Json(serde_json::json!({
            "messageId": user_msg_id, "dryRun": true,
            "info": "User message saved. Agent execution skipped (dry_run mode)."
        }))).into_response();
    }

    // Execute agent in background (same pattern as Tauri commands)
    let db = state.db.clone();
    let conv_id_clone = conv_id.clone();
    let prompt = input.prompt.clone();
    let model = input.model.clone();
    let event_tx = state.event_tx.clone();

    let engine_for_db = engine.clone();
    tokio::spawn(async move {
        let result = tokio::task::spawn_blocking(move || {
            use crate::agents::claude;
            let run_input = claude::RunInput {
                prompt,
                model,
                system_prompt: None,
                resume_token: None,
                project_path: None,
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
                if let Ok(conn) = db.write.lock() {
                    conn.execute(
                        "INSERT INTO messages (id, conversation_id, role, content, engine, model, timestamp, status) VALUES (?1, ?2, 'assistant', ?3, ?4, ?5, ?6, 'done')",
                        rusqlite::params![msg_id, conv_id_clone, out.content, engine_for_db, out.session_id, now],
                    ).ok();
                }
                let _ = event_tx.send(serde_json::json!({
                    "type": "agent:completed",
                    "conversationId": conv_id_clone,
                    "messageId": msg_id,
                }).to_string());
            }
            Ok(Err(e)) => {
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
    let conn = match state.db.write.lock() {
        Ok(c) => c,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "db lock"}))).into_response(),
    };
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
