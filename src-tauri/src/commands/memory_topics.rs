//! Memory topic types and DB loading — topic-segmented conversation summaries.

use rusqlite::Connection;

/// A single topic from compressed memory.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryTopic {
    pub topic: String,
    pub phase: Option<String>,
    pub summary: String,
}

/// Load compressed memory topics for a conversation.
pub fn load_compressed_memory_topics(conn: &Connection, conversation_id: &str) -> Vec<MemoryTopic> {
    let mut stmt = match conn.prepare(
        "SELECT topic, phase, summary FROM conversation_memory
         WHERE conversation_id = ?1
         ORDER BY created_at ASC",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    stmt.query_map([conversation_id], |row| {
        Ok(MemoryTopic {
            topic: row.get(0)?,
            phase: row.get(1)?,
            summary: row.get(2)?,
        })
    })
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

/// Load compressed memory as a single formatted string (backward-compatible).
pub fn load_compressed_memory(conn: &Connection, conversation_id: &str) -> Option<String> {
    let topics = load_compressed_memory_topics(conn, conversation_id);
    if topics.is_empty() {
        return None;
    }
    Some(format_topics_as_section(&topics))
}

/// Format topic list into a readable section for ContextPack injection.
pub fn format_topics_as_section(topics: &[MemoryTopic]) -> String {
    if topics.len() == 1 {
        // Single topic: just the summary (no subsection headers)
        return topics[0].summary.clone();
    }

    let mut out = String::new();
    for t in topics {
        if let Some(ref phase) = t.phase {
            out.push_str(&format!("### {} ({})\n", t.topic, phase));
        } else {
            out.push_str(&format!("### {}\n", t.topic));
        }
        out.push_str(&t.summary);
        out.push_str("\n\n");
    }
    out.trim_end().to_string()
}
