//! WebSocket event bridge + Tauri event bridging.

use axum::{
    extract::{State, WebSocketUpgrade, Query, ws},
    http::{StatusCode, HeaderMap},
    response::IntoResponse,
};
use serde::Deserialize;
use tokio::sync::broadcast;

use super::ApiState;

#[derive(Deserialize, Default)]
pub struct WsQuery {
    token: Option<String>,
}

pub async fn ws_events(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Query(query): Query<WsQuery>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    // Accept token either from Authorization header (REST clients) or
    // ?token= query param (browser WebSocket API can't send custom headers).
    let header_token = headers.get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.to_string());

    let provided = header_token.or(query.token).unwrap_or_default();

    if provided != state.token {
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

pub fn bridge_tauri_events(
    app: tauri::AppHandle,
    tx: broadcast::Sender<String>,
    db: crate::db::DbState,
) {
    use tauri::Listener;
    // Canonical event list for HTTP/WS clients. Refs: docs/api-inquiry-gamma-delta.md § E.
    // HTTP handlers also emit directly via broadcast_event (same log+fanout
    // path), so both Tauri-originated and HTTP-originated events land in
    // `ws_event_log` and reach live WS subscribers identically.
    let events = [
        // Messages & agents
        "message:new",
        "agent:completed",
        "agent:error",
        // Roundtable
        "roundtable:progress",
        "roundtable:participant_status",
        // Plan lifecycle
        "plan:created",
        "plan:phase_changed",
        "plan:status_changed",
        "plan:subtask_status_changed",
        // Branch lifecycle
        "branch:created",
        "branch:archived",
        "branch:adopted",
        // Meta inbox
        "meta:new",
        "meta:read",
        "meta:dismissed",
    ];
    for event_name in events {
        let tx = tx.clone();
        let db = db.clone();
        let name = event_name.to_string();
        app.listen(event_name, move |event| {
            let raw = event.payload();
            // Tauri payloads are already JSON strings; re-parse so the
            // outer envelope carries the actual object, not a string.
            let inner: serde_json::Value = serde_json::from_str(raw)
                .unwrap_or_else(|_| serde_json::Value::String(raw.to_string()));
            let envelope = serde_json::json!({
                "type": name,
                "payload": inner,
            });
            super::events::broadcast_event(&tx, &db, envelope);
        });
    }
}
