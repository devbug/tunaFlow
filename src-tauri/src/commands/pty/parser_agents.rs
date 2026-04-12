//! Codex and Gemini session file parsers.

use std::io::BufRead;

use crate::errors::AppError;
use super::{PtyJsonlResult, PtyToolStep, shorten_path};

// ─── Codex JSONL parser ──────────────────────────────────────────────────────

/// Poll a Codex JSONL session file for the last assistant response + tool steps.
/// Codex format: response_item with type=message|function_call|function_call_output
#[tauri::command]
pub fn pty_poll_codex(
    jsonl_path: String,
    after_line: Option<usize>,
) -> Result<Option<PtyJsonlResult>, AppError> {
    let path = std::path::PathBuf::from(&jsonl_path);
    if !path.exists() {
        return Ok(None);
    }

    let file = std::fs::File::open(&path).map_err(|e| AppError::Agent(e.to_string()))?;
    let reader = std::io::BufReader::new(file);
    let skip = after_line.unwrap_or(0);
    let mut total_lines = 0usize;

    let mut tool_steps: Vec<PtyToolStep> = Vec::new();
    let mut pending_calls: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut final_text = String::new();
    let model: Option<String> = None;
    let mut is_complete = false;

    for (idx, line) in reader.lines().enumerate() {
        total_lines = idx + 1;
        if idx < skip { continue; }
        let line = match line { Ok(l) => l, Err(_) => continue };
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }

        let value: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let line_type = value["type"].as_str().unwrap_or("");

        if line_type == "response_item" {
            let payload = &value["payload"];
            let item_type = payload["type"].as_str().unwrap_or("");

            match item_type {
                "message" => {
                    let role = payload["role"].as_str().unwrap_or("");
                    if role == "assistant" {
                        if let Some(content) = payload["content"].as_array() {
                            for item in content {
                                if item["type"].as_str() == Some("output_text") {
                                    if let Some(t) = item["text"].as_str() {
                                        final_text = t.to_string();
                                    }
                                }
                            }
                        }
                    }
                }
                "function_call" => {
                    let name = payload["name"].as_str().unwrap_or("unknown").to_string();
                    let call_id = payload["call_id"].as_str().unwrap_or("").to_string();
                    let args = payload["arguments"].as_str()
                        .map(|s| s.chars().take(80).collect::<String>())
                        .unwrap_or_default();
                    let idx = tool_steps.len();
                    if !call_id.is_empty() {
                        pending_calls.insert(call_id.clone(), idx);
                    }
                    tool_steps.push(PtyToolStep {
                        step_type: "tool_use".to_string(),
                        name,
                        tool_use_id: if call_id.is_empty() { None } else { Some(call_id) },
                        input: args,
                        output: None,
                        status: "done".to_string(),
                    });
                }
                "function_call_output" => {
                    let call_id = payload["call_id"].as_str().unwrap_or("");
                    if let Some(&step_idx) = pending_calls.get(call_id) {
                        let output = payload["output"].as_str().unwrap_or("").to_string();
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
                _ => {}
            }
        } else if line_type == "event_msg" {
            if value["payload"]["type"].as_str() == Some("task_complete") {
                is_complete = true;
            }
        }
    }

    if final_text.is_empty() && tool_steps.is_empty() {
        return Ok(None);
    }

    let has_text = !final_text.is_empty();
    Ok(Some(PtyJsonlResult {
        text: final_text,
        tool_uses: tool_steps.iter().filter(|s| s.step_type == "tool_use").map(|s| s.name.clone()).collect(),
        tool_steps,
        model,
        total_lines,
        is_complete: is_complete || has_text,
    }))
}

/// List Codex JSONL session files. Codex stores sessions globally by date.
#[tauri::command]
pub fn pty_list_codex_files(
    project_path: String,
) -> Result<Vec<String>, AppError> {
    let codex_dir = dirs::home_dir()
        .ok_or_else(|| AppError::Agent("no home dir".into()))?
        .join(".codex/sessions");

    if !codex_dir.exists() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    for year_entry in std::fs::read_dir(&codex_dir).map_err(|e| AppError::Agent(e.to_string()))? {
        let year_entry = year_entry.map_err(|e| AppError::Agent(e.to_string()))?;
        if !year_entry.path().is_dir() { continue; }
        for month_entry in std::fs::read_dir(year_entry.path()).into_iter().flatten().flatten() {
            if !month_entry.path().is_dir() { continue; }
            for day_entry in std::fs::read_dir(month_entry.path()).into_iter().flatten().flatten() {
                if !day_entry.path().is_dir() { continue; }
                for file_entry in std::fs::read_dir(day_entry.path()).into_iter().flatten().flatten() {
                    let path = file_entry.path();
                    if path.extension().map_or(false, |e| e == "jsonl") {
                        if let Ok(first_line) = std::fs::read_to_string(&path).map(|s| s.lines().next().unwrap_or("").to_string()) {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&first_line) {
                                let cwd = v["payload"]["cwd"].as_str().unwrap_or("");
                                if cwd.contains(&project_path) || project_path.contains(cwd) {
                                    files.push(path.to_string_lossy().to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(files)
}

// ─── Gemini JSON parser ──────────────────────────────────────────────────────

/// Poll a Gemini session JSON file for the last assistant response + tool steps.
/// Gemini format: single JSON with messages array, each having toolCalls.
#[tauri::command]
pub fn pty_poll_gemini(
    json_path: String,
    after_message_count: Option<usize>,
) -> Result<Option<PtyJsonlResult>, AppError> {
    let path = std::path::PathBuf::from(&json_path);
    if !path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| AppError::Agent(format!("read gemini session: {}", e)))?;
    let session: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| AppError::Agent(format!("parse gemini session: {}", e)))?;

    let messages = match session["messages"].as_array() {
        Some(m) => m,
        None => return Ok(None),
    };

    let skip = after_message_count.unwrap_or(0);
    let total_messages = messages.len();
    if total_messages <= skip {
        return Ok(None);
    }

    let mut tool_steps: Vec<PtyToolStep> = Vec::new();
    let mut final_text = String::new();
    let mut model: Option<String> = None;

    for msg in messages.iter().skip(skip) {
        let msg_type = msg["type"].as_str().unwrap_or("");
        if msg_type != "gemini" { continue; }

        if model.is_none() {
            model = msg["model"].as_str().map(|s| s.to_string());
        }

        if let Some(thoughts) = msg["thoughts"].as_str() {
            if !thoughts.is_empty() {
                let summary = if thoughts.len() > 120 {
                    format!("{}...", &thoughts[..thoughts.floor_char_boundary(120)])
                } else {
                    thoughts.to_string()
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
        }

        if let Some(tool_calls) = msg["toolCalls"].as_array() {
            for tc in tool_calls {
                let name = tc["name"].as_str().unwrap_or("unknown").to_string();
                let input_summary = {
                    let input = &tc["input"];
                    if let Some(v) = input["file_path"].as_str().or(input["path"].as_str()) {
                        shorten_path(v)
                    } else if let Some(v) = input["command"].as_str() {
                        v.chars().take(60).collect()
                    } else if let Some(v) = input["query"].as_str().or(input["pattern"].as_str()) {
                        v.to_string()
                    } else {
                        String::new()
                    }
                };
                let output = tc["output"].as_str().map(|s| {
                    if s.len() > 500 { format!("{}…", &s[..s.floor_char_boundary(500)]) }
                    else { s.to_string() }
                });
                tool_steps.push(PtyToolStep {
                    step_type: "tool_use".to_string(),
                    name,
                    tool_use_id: None,
                    input: input_summary,
                    output,
                    status: "done".to_string(),
                });
            }
        }

        if let Some(text) = msg["content"].as_str() {
            if !text.is_empty() {
                final_text = text.to_string();
            }
        }
    }

    if final_text.is_empty() && tool_steps.is_empty() {
        return Ok(None);
    }

    let has_text = !final_text.is_empty();
    Ok(Some(PtyJsonlResult {
        text: final_text,
        tool_uses: tool_steps.iter().filter(|s| s.step_type == "tool_use").map(|s| s.name.clone()).collect(),
        tool_steps,
        model,
        total_lines: total_messages,
        is_complete: has_text,
    }))
}

/// List Gemini session JSON files for a project.
#[tauri::command]
pub fn pty_list_gemini_files(
    project_path: String,
) -> Result<Vec<String>, AppError> {
    let project_name = std::path::Path::new(&project_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let gemini_dir = dirs::home_dir()
        .ok_or_else(|| AppError::Agent("no home dir".into()))?
        .join(".gemini/tmp")
        .join(&project_name)
        .join("chats");

    if !gemini_dir.exists() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    for entry in std::fs::read_dir(&gemini_dir).map_err(|e| AppError::Agent(e.to_string()))? {
        let entry = entry.map_err(|e| AppError::Agent(e.to_string()))?;
        let path = entry.path();
        if path.extension().map_or(false, |e| e == "json") {
            files.push(path.to_string_lossy().to_string());
        }
    }
    Ok(files)
}
