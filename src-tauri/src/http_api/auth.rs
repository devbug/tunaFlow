//! Bearer token auth middleware.

use axum::{
    extract::State,
    http::{StatusCode, HeaderMap},
    middleware,
    response::{IntoResponse, Json},
};

use super::ApiState;

pub async fn auth_middleware(
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
