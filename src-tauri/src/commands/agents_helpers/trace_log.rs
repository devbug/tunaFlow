use rusqlite::params;
use uuid::Uuid;

/// OTel-style span metadata for trace_log insertion.
pub struct SpanInfo<'a> {
    pub trace_id: &'a str,
    pub span_id: String,
    pub parent_span_id: Option<&'a str>,
    pub operation: &'a str,
    pub engine: &'a str,
    pub duration_ms: i64,
    pub status: &'a str,
}

/// Generate a new random span id (UUID v4 hex, no dashes, 32 chars).
pub fn new_span_id() -> String {
    Uuid::new_v4().simple().to_string()
}

/// Generate a new trace id (same format as span_id).
pub fn new_trace_id() -> String {
    Uuid::new_v4().simple().to_string()
}

/// Insert a trace_log record with full OTel-style metadata.
/// Errors are silently swallowed so a logging failure never breaks the caller.
pub fn insert_trace_log(
    conn: &rusqlite::Connection,
    conversation_id: &str,
    input_tokens: i64,
    output_tokens: i64,
    cost_usd: f64,
    recorded_at: i64,
    span: &SpanInfo,
) {
    let _ = conn.execute(
        "INSERT INTO trace_log
         (conversation_id, input_tokens, output_tokens, cost_usd, recorded_at,
          trace_id, span_id, parent_span_id, operation, engine, duration_ms, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            conversation_id,
            input_tokens,
            output_tokens,
            cost_usd,
            recorded_at,
            span.trace_id,
            span.span_id,
            span.parent_span_id,
            span.operation,
            span.engine,
            span.duration_ms,
            span.status,
        ],
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trace_id_format() {
        let id = new_trace_id();
        assert_eq!(id.len(), 32); // UUID simple format = 32 hex chars
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn span_id_format() {
        let id = new_span_id();
        assert_eq!(id.len(), 32);
    }

    #[test]
    fn trace_and_span_are_unique() {
        let a = new_trace_id();
        let b = new_trace_id();
        assert_ne!(a, b);
    }
}
