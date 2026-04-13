//! RT context building and in-memory vector index for transcript sharing.

use crate::db::DbState;

// ─── RtContextCache ────────────────────────────────────────────────────────────

/// Lightweight RT context — Tier 0+1 only.
/// Instead of running the full ContextPack pipeline (identity, skills, rawq,
/// memory, cross-session, retrieval — ~15k chars), we load only what RT
/// participants actually need: project path + active plan.
/// This reduces per-participant context from ~5-7k tokens to ~1-2k tokens.
pub struct RtContextCache {
    pub(super) context: Option<String>,
}

impl RtContextCache {
    /// Build minimal Tier 0+1 context once per round.
    pub fn build(
        state: &DbState,
        conversation_id: &str,
        _topic: &str,
        project_path: Option<&str>,
        _has_local: bool,
    ) -> Self {
        let conn = match state.read.lock() {
            Ok(c) => c,
            Err(_) => return Self { context: None },
        };

        let mut sections: Vec<String> = Vec::new();

        if let Some(p) = project_path {
            sections.push(format!("Project: {}", p));
        }

        let plan_conv_id = Self::resolve_plan_conv_id(&conn, conversation_id);
        if let Some(plan) = Self::load_plan_summary(&conn, &plan_conv_id) {
            sections.push(plan);
        }

        if let Some(findings) = Self::load_review_findings(&conn, &plan_conv_id) {
            sections.push(findings);
        }

        if sections.is_empty() {
            Self { context: None }
        } else {
            Self { context: Some(format!("## Project Context\n\n{}", sections.join("\n\n"))) }
        }
    }

    fn resolve_plan_conv_id(conn: &rusqlite::Connection, conversation_id: &str) -> String {
        if conversation_id.starts_with("branch:") {
            conn.query_row(
                "SELECT parent_id FROM conversations WHERE id = ?1",
                [conversation_id], |row| row.get::<_, Option<String>>(0),
            ).ok().flatten().unwrap_or_else(|| conversation_id.to_string())
        } else {
            conversation_id.to_string()
        }
    }

    fn load_plan_summary(conn: &rusqlite::Connection, conversation_id: &str) -> Option<String> {
        let (title, phase): (String, String) = conn.query_row(
            "SELECT title, phase FROM plans
             WHERE conversation_id = ?1 AND status = 'active'
             ORDER BY updated_at DESC LIMIT 1",
            [conversation_id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).ok()?;

        let plan_id: String = conn.query_row(
            "SELECT id FROM plans WHERE conversation_id = ?1 AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
            [conversation_id], |row| row.get(0),
        ).ok()?;

        let mut out = format!("### Active Plan (phase: {})\n{}", phase, title);

        if let Ok(mut stmt) = conn.prepare(
            "SELECT title, status FROM plan_subtasks WHERE plan_id = ?1 ORDER BY idx"
        ) {
            let subtasks: Vec<(String, String)> = stmt.query_map([&plan_id], |row| {
                Ok((row.get(0)?, row.get(1)?))
            }).ok()?.filter_map(|r| r.ok()).collect();

            if !subtasks.is_empty() {
                out.push('\n');
                for (st_title, st_status) in &subtasks {
                    let icon = match st_status.as_str() { "done" => "✅", "in_progress" => "🔧", _ => "⬜" };
                    out.push_str(&format!("{} {}\n", icon, st_title));
                }
            }
        }

        Some(out)
    }

    fn load_review_findings(conn: &rusqlite::Connection, conversation_id: &str) -> Option<String> {
        let phase: String = conn.query_row(
            "SELECT phase FROM plans WHERE conversation_id = ?1 AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
            [conversation_id], |row| row.get(0),
        ).ok()?;

        if phase != "review" && phase != "review_conditional" {
            return None;
        }

        let mut stmt = conn.prepare(
            "SELECT finding FROM failure_lessons
             WHERE project_key = (SELECT project_key FROM conversations WHERE id = ?1)
             AND resolution IS NULL
             ORDER BY created_at DESC LIMIT 5"
        ).ok()?;

        let findings: Vec<String> = stmt.query_map([conversation_id], |row| row.get(0))
            .ok()?.filter_map(|r| r.ok()).collect();

        if findings.is_empty() { return None; }

        let mut out = String::from("### Open Review Findings\n");
        for f in &findings {
            out.push_str(&format!("- {}\n", f));
        }
        Some(out)
    }

    /// Get cached context (same for all engines — minimal is always small enough).
    pub fn get(&self, _engine_key: &str) -> Option<&str> {
        self.context.as_deref()
    }
}

// ─── RtVectorIndex ─────────────────────────────────────────────────────────────

/// In-memory vector index for RT transcript sharing.
pub struct RtVectorIndex {
    entries: Vec<RtVectorEntry>,
}

struct RtVectorEntry {
    name: String,
    text: String,
    embedding: Vec<f32>,
}

impl RtVectorIndex {
    pub fn new() -> Self { Self { entries: Vec::new() } }

    pub fn add(&mut self, name: &str, content: &str) {
        let text = super::prompt::truncate(content, 800);
        match crate::agents::embedder::embed_text(&text, false) {
            Ok(emb) => {
                self.entries.push(RtVectorEntry {
                    name: name.to_string(), text, embedding: emb,
                });
            }
            Err(e) => eprintln!("[rt-vec] embed failed for {}: {:?}", name, e),
        }
    }

    pub fn search(&self, topic: &str, limit: usize) -> Vec<(String, String)> {
        let query_emb = match crate::agents::embedder::embed_text(topic, true) {
            Ok(e) => e,
            Err(_) => return Vec::new(),
        };

        let mut scored: Vec<(f32, &RtVectorEntry)> = self.entries.iter()
            .map(|e| (crate::agents::rawq::cosine_similarity(&query_emb, &e.embedding), e))
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit);

        scored.into_iter()
            .filter(|(score, _)| *score > 0.2)
            .map(|(_, e)| (e.name.clone(), e.text.clone()))
            .collect()
    }

    pub fn is_empty(&self) -> bool { self.entries.is_empty() }

    /// Return number of indexed entries (for logging).
    pub fn entries_len(&self) -> usize { self.entries.len() }
}

// ─── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_cache_returns_same_for_all_engines() {
        let cache = RtContextCache {
            context: Some("plan ctx".into()),
        };
        assert_eq!(cache.get("claude"), Some("plan ctx"));
        assert_eq!(cache.get("gemini"), Some("plan ctx"));
        assert_eq!(cache.get("codex"), Some("plan ctx"));
        assert_eq!(cache.get("ollama"), Some("plan ctx"));
        assert_eq!(cache.get("opencode"), Some("plan ctx"));
    }

    #[test]
    fn context_cache_none_for_missing() {
        let cache = RtContextCache {
            context: None,
        };
        assert_eq!(cache.get("claude"), None);
        assert_eq!(cache.get("ollama"), None);
    }
}
