//! Mobile connection helpers — QR pairing info.

/// Detect the machine's primary LAN IP using a UDP routing trick.
/// Connects to an external address (no data sent), letting the OS pick
/// the correct interface and revealing the local IP.
fn get_local_ip() -> Option<String> {
    use std::net::UdpSocket;
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    Some(addr.ip().to_string())
}

/// Read the persisted API token from ~/.tunaflow/api-token.
fn read_api_token() -> Option<String> {
    let path = dirs::home_dir()?.join(".tunaflow").join("api-token");
    let token = std::fs::read_to_string(&path).ok()?;
    let trimmed = token.trim().to_string();
    if trimmed.len() >= 32 { Some(trimmed) } else { None }
}

/// Return everything a mobile app needs to connect:
/// - url:   http://<LAN_IP>:19840  (or localhost fallback)
/// - token: the Bearer token
///
/// Used by the desktop Settings panel to generate a QR code.
#[tauri::command]
pub fn get_api_connection_info() -> serde_json::Value {
    let ip = get_local_ip().unwrap_or_else(|| "localhost".to_string());
    let token = read_api_token().unwrap_or_default();
    serde_json::json!({
        "url":   format!("http://{}:19840", ip),
        "token": token,
    })
}
