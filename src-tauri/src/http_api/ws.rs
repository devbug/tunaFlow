//! WebSocket event bridge + Tauri event bridging.

use axum::{
    extract::{State, WebSocketUpgrade, ws},
    http::{StatusCode, HeaderMap},
    response::IntoResponse,
};
use tokio::sync::broadcast;

use super::ApiState;

pub async fn ws_events(
    State(state): State<ApiState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
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
