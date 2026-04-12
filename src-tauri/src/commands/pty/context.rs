//! CLAUDE.md context injection + ContextPack build for PTY sessions.

use serde::Serialize;
use tauri::State;

use crate::errors::AppError;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyContextResult {
    pub assembled_prompt: String,
    pub system_prompt: Option<String>,
    pub context_mode: String,
    pub context_length: usize,
    pub sections: Vec<String>,
}

/// List JSONL files in the Claude projects directory for a given project path.
/// Used to snapshot before PTY spawn — new files after spawn = PTY session's JSONL.
#[tauri::command]
pub fn pty_list_jsonl_files(
    project_path: String,
) -> Result<Vec<String>, AppError> {
    let encoded = project_path.replace('/', "-");
    let claude_dir = dirs::home_dir()
        .ok_or_else(|| AppError::Agent("no home dir".into()))?
        .join(".claude/projects")
        .join(&encoded);

    if !claude_dir.exists() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    for entry in std::fs::read_dir(&claude_dir).map_err(|e| AppError::Agent(e.to_string()))? {
        let entry = entry.map_err(|e| AppError::Agent(e.to_string()))?;
        let path = entry.path();
        if path.extension().map_or(false, |e| e == "jsonl") && !path.to_string_lossy().contains("subagents") {
            files.push(path.to_string_lossy().to_string());
        }
    }
    Ok(files)
}

/// Update the ## tunaFlow Context section in a project's CLAUDE.md.
/// Called when plan changes, persona switches, or on PTY session start.
/// Creates the section if it doesn't exist; replaces it if it does.
#[tauri::command]
pub fn pty_update_claude_md(
    project_path: String,
    context_section: String,
) -> Result<(), AppError> {
    let claude_md = std::path::Path::new(&project_path).join("CLAUDE.md");

    let content = if claude_md.exists() {
        std::fs::read_to_string(&claude_md)
            .map_err(|e| AppError::Agent(format!("read CLAUDE.md: {}", e)))?
    } else {
        String::new()
    };

    let marker_start = "<!-- tunaflow:context-start -->";
    let marker_end = "<!-- tunaflow:context-end -->";

    let new_section = format!("{}\n{}\n{}", marker_start, context_section, marker_end);

    let updated = if let Some(start_idx) = content.find(marker_start) {
        let end_idx = content[start_idx..]
            .find(marker_end)
            .map(|i| start_idx + i + marker_end.len())
            .unwrap_or(content.len());
        format!("{}{}{}", &content[..start_idx], new_section, &content[end_idx..])
    } else {
        let legacy_start = "## tunaFlow Context";
        if let Some(legacy_idx) = content.find(legacy_start) {
            format!("{}\n{}", content[..legacy_idx].trim_end(), new_section)
        } else if content.is_empty() {
            new_section
        } else {
            format!("{}\n\n{}", content.trim_end(), new_section)
        }
    };

    std::fs::write(&claude_md, updated)
        .map_err(|e| AppError::Agent(format!("write CLAUDE.md: {}", e)))?;

    eprintln!("[pty] updated CLAUDE.md tunaFlow Context section ({} chars)", context_section.len());
    Ok(())
}

/// Build ContextPack for PTY mode — returns the assembled prompt sections
/// that should be injected into the PTY session (first message or delta).
#[tauri::command]
pub fn pty_build_context(
    conversation_id: String,
    prompt: String,
    project_path: Option<String>,
    active_skills: Vec<String>,
    cross_session_ids: Vec<String>,
    persona_fragment: Option<String>,
    context_mode: Option<String>,
    db: State<crate::db::DbState>,
) -> Result<PtyContextResult, AppError> {
    let conn = db.read.lock().map_err(|_| AppError::Lock)?;
    let (assembled, system_prompt, meta) = crate::commands::agents_helpers::send_common::build_normalized_prompt_with_budget(
        &conn,
        &conversation_id,
        &prompt,
        project_path.as_deref(),
        &active_skills,
        &cross_session_ids,
        persona_fragment.as_deref(),
        context_mode.as_deref(),
        None,
    );
    Ok(PtyContextResult {
        assembled_prompt: assembled,
        system_prompt,
        context_mode: meta.mode,
        context_length: meta.length,
        sections: meta.sections,
    })
}
