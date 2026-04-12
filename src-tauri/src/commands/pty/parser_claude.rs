//! Claude JSONL parser — polls ~/.claude/projects/{encoded}/*.jsonl for assistant responses.

use std::io::BufRead;

use crate::errors::AppError;
use super::{PtyJsonlResult, PtyToolStep, summarize_tool_input, extract_tool_result_content};

/// Find the latest JSONL file for a project and return the last assistant message.
/// Claude Code writes conversation logs to ~/.claude/projects/{encoded-cwd}/{sessionId}.jsonl
///
/// If `jsonl_path` is provided, read that specific file (PTY session tracking).
/// Otherwise, fall back to the most recently modified .jsonl file.
#[tauri::command]
pub fn pty_poll_jsonl(
    project_path: String,
    after_line: Option<usize>,
    jsonl_path: Option<String>,
) -> Result<Option<PtyJsonlResult>, AppError> {
    let jsonl_path: std::path::PathBuf = if let Some(ref explicit) = jsonl_path {
        let p = std::path::PathBuf::from(explicit);
        if !p.exists() {
            return Ok(None);
        }
        p
    } else {
        let encoded = project_path.replace('/', "-");
        let claude_dir = dirs::home_dir()
            .ok_or_else(|| AppError::Agent("no home dir".into()))?
            .join(".claude/projects")
            .join(&encoded);

        if !claude_dir.exists() {
            return Ok(None);
        }

        let mut latest: Option<(std::time::SystemTime, std::path::PathBuf)> = None;
        for entry in std::fs::read_dir(&claude_dir).map_err(|e| AppError::Agent(e.to_string()))? {
            let entry = entry.map_err(|e| AppError::Agent(e.to_string()))?;
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "jsonl") && !path.to_string_lossy().contains("subagents") {
                if let Ok(meta) = path.metadata() {
                    if let Ok(modified) = meta.modified() {
                        if latest.as_ref().map_or(true, |(t, _)| modified > *t) {
                            latest = Some((modified, path));
                        }
                    }
                }
            }
        }

        match latest {
            Some((_, p)) => p,
            None => return Ok(None),
        }
    };

    // Read lines after `after_line` index, collect ALL assistant messages.
    // Claude Code JSONL interleaves: user → assistant(tool_use) → user(tool_result) → assistant(text)
    let file = std::fs::File::open(&jsonl_path).map_err(|e| AppError::Agent(e.to_string()))?;
    let reader = std::io::BufReader::new(file);
    let skip = after_line.unwrap_or(0);
    let mut total_lines = 0usize;
    let mut all_messages: Vec<serde_json::Value> = Vec::new();

    for (idx, line) in reader.lines().enumerate() {
        total_lines = idx + 1;
        if idx < skip { continue; }
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
            match value.get("type").and_then(|t| t.as_str()) {
                Some("assistant") | Some("user") | Some("human") => {
                    all_messages.push(value);
                }
                _ => {}
            }
        }
    }

    let assistant_messages: Vec<&serde_json::Value> = all_messages.iter()
        .filter(|v| v.get("type").and_then(|t| t.as_str()) == Some("assistant"))
        .collect();

    if assistant_messages.is_empty() {
        return Ok(None);
    }

    let mut tool_steps: Vec<PtyToolStep> = Vec::new();
    let mut final_text_parts: Vec<String> = Vec::new();
    let mut final_tool_uses: Vec<String> = Vec::new();
    let mut model: Option<String> = None;
    let mut pending_outputs: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    for msg_value in &all_messages {
        let msg_type = msg_value["type"].as_str().unwrap_or("");
        let message = &msg_value["message"];

        if msg_type == "assistant" {
            if model.is_none() {
                model = message["model"].as_str().map(|s| s.to_string());
            }

            if let Some(content) = message["content"].as_array() {
                for item in content {
                    match item["type"].as_str() {
                        Some("text") => {
                            if let Some(t) = item["text"].as_str() {
                                final_text_parts.push(t.to_string());
                            }
                        }
                        Some("tool_use") => {
                            let name = item["name"].as_str().unwrap_or("unknown").to_string();
                            let id = item["id"].as_str().unwrap_or("").to_string();
                            let input_summary = summarize_tool_input(&name, &item["input"]);
                            final_tool_uses.push(name.clone());
                            let idx = tool_steps.len();
                            if !id.is_empty() {
                                pending_outputs.insert(id.clone(), idx);
                            }
                            tool_steps.push(PtyToolStep {
                                step_type: "tool_use".to_string(),
                                name,
                                tool_use_id: if id.is_empty() { None } else { Some(id) },
                                input: input_summary,
                                output: None,
                                status: "done".to_string(),
                            });
                        }
                        Some("thinking") => {
                            let thinking_text = item["thinking"].as_str().unwrap_or("");
                            let summary = if thinking_text.len() > 120 {
                                format!("{}...", &thinking_text[..thinking_text.floor_char_boundary(120)])
                            } else {
                                thinking_text.to_string()
                            };
                            tool_steps.push(PtyToolStep {
                                step_type: "thinking".to_string(),
                                name: "thinking".to_string(),
                                tool_use_id: None,
                                input: summary,
                                output: None,
                                status: "done".to_string(),
                            });
                        }
                        _ => {}
                    }
                }
            }
        } else if msg_type == "user" || msg_type == "human" {
            if let Some(content) = message["content"].as_array() {
                for item in content {
                    if item["type"].as_str() == Some("tool_result") {
                        let tool_use_id = item["tool_use_id"].as_str().unwrap_or("");
                        if let Some(&step_idx) = pending_outputs.get(tool_use_id) {
                            let output = extract_tool_result_content(&item["content"]);
                            if !output.is_empty() {
                                let truncated = if output.len() > 500 {
                                    format!("{}…", &output[..output.floor_char_boundary(500)])
                                } else {
                                    output
                                };
                                if let Some(step) = tool_steps.get_mut(step_idx) {
                                    step.output = Some(truncated);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let last_has_text = assistant_messages.last()
        .and_then(|v| v["message"]["content"].as_array())
        .map(|arr| arr.iter().any(|item| item["type"].as_str() == Some("text") && item["text"].as_str().map_or(false, |t| !t.is_empty())))
        .unwrap_or(false);

    let is_complete = last_has_text && !final_text_parts.is_empty();

    Ok(Some(PtyJsonlResult {
        text: final_text_parts.join("\n\n"),
        tool_uses: final_tool_uses,
        tool_steps,
        model,
        total_lines,
        is_complete,
    }))
}
