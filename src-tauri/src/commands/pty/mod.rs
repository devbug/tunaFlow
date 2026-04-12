//! PTY module — portable PTY session management + JSONL parsers for agent output.

mod session;
mod context;
mod parser_claude;
mod parser_agents;

// Re-export all public API (including tauri::command-generated __cmd__* symbols)
// so callers use `commands::pty::*` unchanged.
pub use session::*;
pub use context::*;
pub use parser_claude::*;
pub use parser_agents::*;

use serde::Serialize;

// ─── Shared event payloads ─────────────────────────────────────────────

/// Payload emitted for each PTY output chunk.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyOutputPayload {
    pub session_id: u32,
    pub data: String,
}

/// Payload emitted when PTY process exits.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyExitPayload {
    pub session_id: u32,
    pub exit_code: Option<i32>,
}

// ─── Shared parser types ───────────────────────────────────────────────

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyToolStep {
    pub step_type: String,
    pub name: String,
    pub tool_use_id: Option<String>,
    pub input: String,
    pub output: Option<String>,
    pub status: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyJsonlResult {
    pub text: String,
    pub tool_uses: Vec<String>,
    pub tool_steps: Vec<PtyToolStep>,
    pub model: Option<String>,
    pub total_lines: usize,
    pub is_complete: bool,
}

// ─── Shared parser helpers ─────────────────────────────────────────────

pub(super) fn shorten_path(path: &str) -> String {
    let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if parts.len() <= 3 {
        parts.join("/")
    } else {
        parts[parts.len()-3..].join("/")
    }
}

pub(super) fn summarize_tool_input(tool_name: &str, input: &serde_json::Value) -> String {
    match tool_name {
        "Read" | "Write" | "Edit" => input["file_path"].as_str()
            .map(|p| shorten_path(p))
            .unwrap_or_default(),
        "Glob" => input["pattern"].as_str()
            .unwrap_or("")
            .to_string(),
        "Grep" => {
            let pattern = input["pattern"].as_str().unwrap_or("");
            let path = input["path"].as_str().map(|p| shorten_path(p)).unwrap_or_default();
            if path.is_empty() { pattern.to_string() }
            else { format!("{} in {}", pattern, path) }
        }
        "Bash" => input["command"].as_str()
            .map(|c| c.chars().take(60).collect::<String>())
            .unwrap_or_default(),
        _ => {
            for key in &["file_path", "path", "command", "query", "pattern", "url"] {
                if let Some(v) = input[*key].as_str() {
                    return v.chars().take(80).collect();
                }
            }
            String::new()
        }
    }
}

pub(super) fn extract_tool_result_content(content: &serde_json::Value) -> String {
    if let Some(s) = content.as_str() {
        return s.to_string();
    }
    if let Some(arr) = content.as_array() {
        let parts: Vec<String> = arr.iter().filter_map(|item| {
            if item["type"].as_str() == Some("text") {
                item["text"].as_str().map(|s| s.to_string())
            } else {
                None
            }
        }).collect();
        return parts.join("\n");
    }
    String::new()
}
