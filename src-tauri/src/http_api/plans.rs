//! Plan and artifact endpoints.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use serde::Deserialize;

use super::{ApiState, db_error, lock_conn};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanQuery {
    pub conversation_id: Option<String>,
}

pub async fn list_plans(
    State(state): State<ApiState>,
    Query(q): Query<PlanQuery>,
) -> impl IntoResponse {
    let conn = lock_conn(&state.db.read);
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

pub async fn get_plan(
    State(state): State<ApiState>,
    Path(plan_id): Path<String>,
) -> impl IntoResponse {
    let conn = lock_conn(&state.db.read);
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

pub async fn list_plan_events(
    State(state): State<ApiState>,
    Path(plan_id): Path<String>,
) -> impl IntoResponse {
    let conn = lock_conn(&state.db.read);
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

pub async fn approve_plan(
    State(state): State<ApiState>,
    Path(plan_id): Path<String>,
) -> impl IntoResponse {
    let conn = lock_conn(&state.db.write);
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactQuery {
    pub conversation_id: Option<String>,
}

pub async fn list_artifacts(
    State(state): State<ApiState>,
    Query(q): Query<ArtifactQuery>,
) -> impl IntoResponse {
    let conn = lock_conn(&state.db.read);
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
