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

pub fn bridge_tauri_events(app: tauri::AppHandle, tx: broadcast::Sender<String>) {
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
