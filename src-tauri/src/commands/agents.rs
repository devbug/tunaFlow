use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::agents::{claude, codex, gemini, loader, opencode, rawq};
use crate::db::{migrations::now_epoch_ms, models::Message, DbState};
use crate::errors::AppError;
use crate::guardrail;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkPayload {
    pub message_id: String,
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendWithClaudeInput {
    pub project_key: String,
    pub conversation_id: String,
    /// If None, a new user message is persisted from `prompt`
    pub user_message_id: Option<String>,
    pub prompt: String,
    pub model: Option<String>,
    /// Passed directly when no agent is selected
    pub system_prompt: Option<String>,
    /// Agent name to load from `{project.path}/docs/agents/{name}.md`.
    /// When set, the agent's system prompt is injected via --append-system-prompt
    /// as the first step of ContextPack assembly (DATA_MODEL §4.2 step 1).
    #[serde(default)]
    pub agent_name: Option<String>,
    /// Active skill names — their content is injected into ContextPack (§4.2 step 2).
    #[serde(default)]
    pub active_skills: Vec<String>,
    /// Conversation IDs to include as cross-session context (§4.2 step 3.5).
    #[serde(default)]
    pub cross_session_ids: Vec<String>,
}

/// Maximum number of prior messages to include in the branch/current context summary.
const CONTEXT_MESSAGES_LIMIT: i64 = 6;
/// Maximum number of parent conversation messages to include when in a branch.
const PARENT_CONTEXT_MESSAGES_LIMIT: i64 = 4;
/// Maximum number of rawq code search results to include in ContextPack (DATA_MODEL §4.2 step 3).
const RAWQ_MAX_RESULTS: usize = 5;
/// Maximum number of recent messages to load per cross-session conversation.
const CROSS_SESSION_MESSAGES_LIMIT: i64 = 3;
/// Maximum number of prior messages to include as prompt prefix for non-Claude engines.
const LITE_CONTEXT_MESSAGES_LIMIT: i64 = 4;
/// Maximum total characters for the lite context prefix.
const LITE_CONTEXT_MAX_CHARS: usize = 4000;

/// Truncate a string to `max` bytes (character boundary safe for ASCII; logs `…` suffix).
fn truncate_str(s: &str, max: usize) -> String {
    if s.len() > max {
        // Walk back to a char boundary
        let end = s
            .char_indices()
            .map(|(i, _)| i)
            .take_while(|&i| i <= max)
            .last()
            .unwrap_or(0);
        format!("{}…", &s[..end])
    } else {
        s.to_string()
    }
}

/// Format a message block with a section header.
fn format_section(header: &str, rows: &[(String, String)], max_chars: usize) -> String {
    let mut out = format!("## {}\n", header);
    for (role, content) in rows {
        out.push_str(&format!("\n[{}] {}\n", role, truncate_str(content, max_chars)));
    }
    out
}

/// Combine multiple optional system-prompt sections, joining with double newline.
/// Returns None if all parts are None or empty.
fn combine_prompt_parts(parts: impl IntoIterator<Item = Option<String>>) -> Option<String> {
    let joined: String = parts
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join("\n\n");
    if joined.is_empty() { None } else { Some(joined) }
}

/// Build `## Active skills` section from active skill names (DATA_MODEL §4.2 step 2).
/// Loads each skill from `~/.tunaflow/skills/{name}/SKILL.md`.
/// Returns None if no skills are active or all fail to load.
fn build_skills_section(skill_names: &[String]) -> Option<String> {
    if skill_names.is_empty() {
        return None;
    }
    let mut sections = Vec::new();
    for name in skill_names {
        if let Ok(skill) = super::skills::get_skill(name.clone()) {
            sections.push(format!("### {}\n\n{}", skill.name, skill.content));
        }
    }
    if sections.is_empty() {
        return None;
    }
    Some(format!("## Active skills\n\n{}", sections.join("\n\n")))
}

/// Build `## Cross-session context` section from selected sibling conversations.
/// Each conversation contributes its label + last N messages as a summary.
/// Returns None if no cross-session conversations or all empty.
fn build_cross_session_section(
    cross_session: &[(String, Vec<(String, String)>)], // (label, [(role, content)])
) -> Option<String> {
    if cross_session.is_empty() {
        return None;
    }
    let mut blocks = Vec::new();
    for (label, rows) in cross_session {
        if rows.is_empty() {
            continue;
        }
        let mut block = format!("### {}\n", label);
        for (role, content) in rows {
            block.push_str(&format!("\n[{}] {}\n", role, truncate_str(content, 200)));
        }
        blocks.push(block);
    }
    if blocks.is_empty() {
        return None;
    }
    Some(format!("## Cross-session context\n\n{}", blocks.join("\n")))
}

/// Run rawq keyword search and format results as a `## Code context` section
/// for injection into the system prompt (DATA_MODEL §4.2 step 3).
/// Returns None if project_path is absent or no matches found.
fn build_rawq_section(project_path: Option<&str>, prompt: &str) -> Option<String> {
    let path = project_path?;
    let results = rawq::search(path, prompt, RAWQ_MAX_RESULTS);
    if results.is_empty() {
        return None;
    }
    let mut out = String::from("## Code context\n");
    for r in &results {
        let snippet = if r.snippet.len() > 120 {
            format!("{}…", &r.snippet[..120])
        } else {
            r.snippet.clone()
        };
        out.push_str(&format!("\n`{}` L{}: {}\n", r.file, r.line, snippet));
    }
    Some(out)
}

/// Build a structured context summary for ContextPack injection (DATA_MODEL §4.2 step 4).
///
/// - `current_rows`: messages from the active conversation (branch or main)
/// - `parent_rows`: messages from the parent conversation (non-empty only for branches)
/// - `is_branch`: whether the active conversation is a branch stream
///
/// Returns None if both inputs are empty.
fn build_context_summary(
    current_rows: &[(String, String)],
    parent_rows: &[(String, String)],
    is_branch: bool,
) -> Option<String> {
    let has_current = !current_rows.is_empty();
    let has_parent = !parent_rows.is_empty();

    if !has_current && !has_parent {
        return None;
    }

    let mut parts: Vec<String> = Vec::new();

    if has_parent {
        parts.push(format_section("Parent conversation context", parent_rows, 300));
    }

    if has_current {
        let header = if is_branch {
            "Branch conversation context"
        } else {
            "Recent conversation context"
        };
        parts.push(format_section(header, current_rows, 400));
    }

    Some(parts.join("\n"))
}

/// Build `## Active Plan` section from the conversation's active plan.
///
/// Queries for the first plan with status='active' for the given conversation,
/// then loads its subtasks. Produces a compact summary:
/// - Plan title + description
/// - Current in-progress subtask(s)
/// - Next todo subtask
///
/// Returns None if no active plan exists (preserving existing behaviour).
fn build_plan_section(
    conn: &rusqlite::Connection,
    conversation_id: &str,
) -> Option<String> {
    // Find active plan for this conversation
    let plan: (String, String, Option<String>) = conn
        .query_row(
            "SELECT id, title, description FROM plans
             WHERE conversation_id = ?1 AND status = 'active'
             ORDER BY updated_at DESC LIMIT 1",
            [conversation_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .ok()?;

    let (plan_id, title, description) = plan;

    // Load subtasks ordered by idx
    let mut stmt = conn
        .prepare(
            "SELECT title, status, details FROM plan_subtasks
             WHERE plan_id = ?1 ORDER BY idx",
        )
        .ok()?;
    let subtasks: Vec<(String, String, Option<String>)> = stmt
        .query_map([&plan_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .ok()?
        .filter_map(|r| r.ok())
        .collect();

    let mut out = format!("## Active Plan\n\n### {}\n", title);
    if let Some(desc) = &description {
        if !desc.is_empty() {
            out.push_str(&format!("{}\n", desc));
        }
    }

    // Current: in_progress subtasks
    let in_progress: Vec<&str> = subtasks
        .iter()
        .filter(|(_, s, _)| s == "in_progress")
        .map(|(t, _, _)| t.as_str())
        .collect();
    if !in_progress.is_empty() {
        out.push_str(&format!("\n**Current:** {}\n", in_progress.join(", ")));
    }

    // Next: first todo subtask
    if let Some((next_title, _, _)) = subtasks.iter().find(|(_, s, _)| s == "todo") {
        out.push_str(&format!("**Next:** {}\n", next_title));
    }

    // Progress summary
    let done_count = subtasks.iter().filter(|(_, s, _)| s == "done").count();
    let total = subtasks.len();
    if total > 0 {
        out.push_str(&format!("**Progress:** {}/{} done\n", done_count, total));
    }

    Some(out)
}

/// Build a lightweight context prefix for non-Claude engines.
///
/// Since Codex/Gemini/OpenCode don't support system_prompt, we prepend recent
/// conversation history directly into the user prompt so the engine has some context.
/// Returns the prompt with context prefix, or the original prompt if no context available.
fn build_lite_context_prompt(
    conn: &rusqlite::Connection,
    conversation_id: &str,
    user_prompt: &str,
) -> String {
    let Ok(mut stmt) = conn.prepare(
        "SELECT role, content FROM messages
         WHERE conversation_id = ?1
         ORDER BY timestamp DESC LIMIT ?2",
    ) else {
        return user_prompt.to_string();
    };

    let mut rows: Vec<(String, String)> = stmt
        .query_map(params![conversation_id, LITE_CONTEXT_MESSAGES_LIMIT], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map(|mapped| mapped.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();
    rows.reverse();

    if rows.is_empty() {
        return user_prompt.to_string();
    }

    let mut context = String::from("Recent conversation:\n");
    let mut char_count = context.len();
    for (role, content) in &rows {
        let truncated = truncate_str(content, 600);
        let line = format!("[{}] {}\n", role, truncated);
        if char_count + line.len() > LITE_CONTEXT_MAX_CHARS {
            break;
        }
        context.push_str(&line);
        char_count += line.len();
    }
    context.push_str("\n---\n\n");

    format!("{}{}", context, user_prompt)
}

/// Assemble the system prompt component of ContextPack (runtime-only, DATA_MODEL §0.2 / §4.2).
/// This stage: Agent.systemPrompt only (step 1).
/// If both agent prompt and extra system_prompt are present, they are concatenated.
fn assemble_system_prompt(
    agent_name: Option<&str>,
    project_path: Option<&str>,
    extra: Option<&str>,
) -> Option<String> {
    let agent_prompt = agent_name
        .zip(project_path)
        .and_then(|(name, path)| {
            loader::load_agent(path, name)
                .map(|a| a.system_prompt)
                .ok()
        });

    match (agent_prompt, extra) {
        (Some(a), Some(e)) => Some(format!("{}\n\n{}", a, e)),
        (Some(a), None) => Some(a),
        (None, Some(e)) => Some(e.to_string()),
        (None, None) => None,
    }
}

// ─── ContextPack memory compression ─────────────────────────────────────────
//
// These helpers implement selective compression for long ContextPack sections.
// Compression is applied only when a section exceeds its guardrail limit.
// On failure (claude unavailable, empty response, etc.) the caller falls back
// to the existing guardrail::truncate_section behaviour — no behaviour change
// for the user either way.
//
// Recursion safety: compress_context_with_claude() calls claude::run() directly
// with no system_prompt and no resume_token. It does NOT go through
// send_with_claude / stream_with_claude, so ContextPack assembly (and therefore
// this compression path) is never entered again.

/// Summarise a long context section via a direct claude subprocess call.
///
/// Returns `Ok(summary)` when claude produces non-empty output.
/// Returns `Err(())` on any failure (spawn error, empty output, parse error).
fn compress_context_with_claude(text: &str) -> Result<String, ()> {
    let prompt = format!(
        "Summarise the following conversation context in plain text, under 600 characters.\n\
        Preserve: what the user is working on, decisions already made, \
        key constraints, and anything needed for the next reply.\n\
        No markdown headers. No filler. Just the essential facts.\n\n\
        ---\n\n{}",
        text
    );
    claude::run(claude::RunInput {
        prompt,
        model: None,        // use whatever default the CLI has
        system_prompt: None, // ← no ContextPack assembly; no recursion possible
        resume_token: None,
    })
    .ok()
    .map(|out| out.content)
    .filter(|s| !s.trim().is_empty())
    .ok_or(())
}

/// Return the section as-is if within `limit`.
/// If over `limit`, attempt claude compression first; fall back to truncation.
///
/// The function never returns an error — callers always get a usable `Option<String>`.
fn maybe_compress_section(section: Option<String>, limit: usize) -> Option<String> {
    let s = section?;
    if s.len() <= limit {
        return Some(s);
    }
    match compress_context_with_claude(&s) {
        Ok(compressed) if compressed.len() <= limit => {
            eprintln!(
                "[compress] ok: {} → {} chars",
                s.len(),
                compressed.len()
            );
            Some(compressed)
        }
        Ok(compressed) => {
            // Compressed but still over limit — truncate the compressed text.
            eprintln!(
                "[compress] still over limit after compression ({} chars), truncating",
                compressed.len()
            );
            guardrail::truncate_section(Some(compressed), limit)
        }
        Err(()) => {
            eprintln!("[compress] failed, falling back to truncate ({} chars)", s.len());
            guardrail::truncate_section(Some(s), limit)
        }
    }
}

/// Insert a single execution record into trace_log.
/// Errors are silently swallowed so a logging failure never breaks the caller.
fn insert_trace_log(
    conn: &rusqlite::Connection,
    conversation_id: &str,
    input_tokens: i64,
    output_tokens: i64,
    cost_usd: f64,
    recorded_at: i64,
) {
    let _ = conn.execute(
        "INSERT INTO trace_log (conversation_id, input_tokens, output_tokens, cost_usd, recorded_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![conversation_id, input_tokens, output_tokens, cost_usd, recorded_at],
    );
}

/// Send a one-shot request to the local `claude` CLI and persist the result.
///
/// Flow:
///   1. Persist user message (if no user_message_id provided)
///   2. Load ResumeToken from conversations — discard if engine mismatch
///   3. Release DB lock
///   4. Spawn claude subprocess (may take seconds/minutes)
///   5. Re-acquire DB lock, persist assistant message + update usage + save new token
#[tauri::command]
pub fn send_with_claude(
    input: SendWithClaudeInput,
    state: State<DbState>,
) -> Result<Message, AppError> {
    // Step 1: load context + persist user message + load resume token + project path (single lock)
    let is_branch = input.conversation_id.starts_with("branch:");
    let (resume_token, project_path, current_context, parent_context, cross_session_data, plan_section) = {
        let conn = state.0.lock().map_err(|_| AppError::Lock)?;

        // Helper: load N messages from a given conversation_id in chronological order
        let load_messages = |conv_id: &str, limit: i64| -> Vec<(String, String)> {
            let Ok(mut stmt) = conn.prepare(
                "SELECT role, content FROM messages
                 WHERE conversation_id = ?1
                 ORDER BY timestamp DESC LIMIT ?2",
            ) else { return Vec::new(); };
            let mut rows: Vec<(String, String)> = stmt
                .query_map(params![conv_id, limit], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map(|mapped| mapped.filter_map(|r| r.ok()).collect())
                .unwrap_or_default();
            rows.reverse();
            rows
        };

        // 1a. Load current conversation context (DATA_MODEL §4.2 step 4)
        let current_context = load_messages(&input.conversation_id, CONTEXT_MESSAGES_LIMIT);

        // 1b. If branch, also load parent conversation context (DATA_MODEL §1.4 / §4.2)
        let parent_context: Vec<(String, String)> = if is_branch {
            let parent_id: Option<String> = conn
                .query_row(
                    "SELECT parent_id FROM conversations WHERE id = ?1",
                    [&input.conversation_id],
                    |row| row.get(0),
                )
                .ok()
                .flatten();
            parent_id
                .map(|pid| load_messages(&pid, PARENT_CONTEXT_MESSAGES_LIMIT))
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        // 1b2. Load cross-session conversation summaries (§4.2 step 3.5)
        let cross_session_data: Vec<(String, Vec<(String, String)>)> = input
            .cross_session_ids
            .iter()
            .filter(|id| **id != input.conversation_id)
            .filter_map(|conv_id| {
                let label: String = conn
                    .query_row(
                        "SELECT COALESCE(custom_label, label) FROM conversations WHERE id = ?1",
                        [conv_id],
                        |row| row.get(0),
                    )
                    .ok()?;
                let rows = load_messages(conv_id, CROSS_SESSION_MESSAGES_LIMIT);
                if rows.is_empty() { None } else { Some((label, rows)) }
            })
            .collect();

        // 1b3. Load active plan section (weak link — returns None if no active plan)
        let plan_section = guardrail::truncate_section(
            build_plan_section(&conn, &input.conversation_id),
            guardrail::MAX_PLAN_SECTION,
        );

        // 1c. Persist new user message
        if input.user_message_id.is_none() {
            let id = Uuid::new_v4().to_string();
            let now = now_epoch_ms();
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, timestamp, status)
                 VALUES (?1, ?2, 'user', ?3, ?4, 'done')",
                params![id, input.conversation_id, input.prompt, now],
            )?;
        }

        // Load stored token; discard if engine differs (DATA_MODEL §1.8 lifecycle)
        let token_result: rusqlite::Result<(Option<String>, Option<String>)> = conn.query_row(
            "SELECT resume_token, resume_token_engine FROM conversations WHERE id = ?1",
            [&input.conversation_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );
        let resume_token = match token_result {
            Ok((Some(token), Some(engine))) if engine == "claude-code" => Some(token),
            _ => None,
        };

        // Load project path for ContextPack assembly (DATA_MODEL §4.2)
        let project_path: Option<String> = conn
            .query_row(
                "SELECT path FROM projects WHERE key = ?1",
                [&input.project_key],
                |row| row.get(0),
            )
            .ok()
            .flatten();

        (resume_token, project_path, current_context, parent_context, cross_session_data, plan_section)
        // Lock released here
    };

    // Step 1b: assemble ContextPack — runtime only, no DB lock needed (DATA_MODEL §0.2)
    let base_system_prompt = assemble_system_prompt(
        input.agent_name.as_deref(),
        project_path.as_deref(),
        input.system_prompt.as_deref(),
    );
    let skills_section = guardrail::truncate_section(
        build_skills_section(&input.active_skills),
        guardrail::MAX_SKILLS_SECTION,
    );
    let rawq_section = guardrail::truncate_section(
        build_rawq_section(project_path.as_deref(), &input.prompt),
        guardrail::MAX_RAWQ_SECTION,
    );
    let cross_section = maybe_compress_section(
        build_cross_session_section(&cross_session_data),
        guardrail::MAX_CROSS_SESSION_SECTION,
    );
    let context_summary = maybe_compress_section(
        build_context_summary(&current_context, &parent_context, is_branch),
        guardrail::MAX_CONTEXT_SECTION,
    );
    let system_prompt = guardrail::enforce_total_limit(
        combine_prompt_parts([base_system_prompt, skills_section, plan_section, rawq_section, cross_section, context_summary]),
        guardrail::MAX_TOTAL_PROMPT,
    );

    // Step 2: run claude subprocess — DB lock must NOT be held here
    let prompt_len = input.prompt.len() + system_prompt.as_ref().map_or(0, |s| s.len());
    let t0 = std::time::Instant::now();
    let run_result = claude::run(claude::RunInput {
        prompt: input.prompt.clone(),
        model: input.model.clone(),
        system_prompt,
        resume_token,
    });
    let duration_ms = t0.elapsed().as_millis();
    guardrail::log_run("claude-code", input.model.as_deref(), duration_ms, prompt_len, run_result.is_ok());

    let (content, status, cost_usd, in_tokens, out_tokens, new_token) = match run_result {
        Ok(out) => (
            out.content,
            "done".to_string(),
            out.cost_usd,
            out.input_tokens,
            out.output_tokens,
            out.session_id,
        ),
        Err(ref e) => (guardrail::fallback_error("claude-code", e), "error".to_string(), 0.0, 0, 0, None),
    };

    // Step 3: persist assistant message, update usage, save new resume token
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let msg_id = Uuid::new_v4().to_string();
    let now = now_epoch_ms();

    conn.execute(
        "INSERT INTO messages
         (id, conversation_id, role, content, timestamp, status, engine, model)
         VALUES (?1, ?2, 'assistant', ?3, ?4, ?5, 'claude-code', ?6)",
        params![
            msg_id,
            input.conversation_id,
            content,
            now,
            status,
            input.model,
        ],
    )?;

    conn.execute(
        "UPDATE conversations SET
             total_input_tokens  = total_input_tokens  + ?1,
             total_output_tokens = total_output_tokens + ?2,
             total_cost_usd      = total_cost_usd      + ?3,
             updated_at          = ?4,
             resume_token        = ?5,
             resume_token_engine = CASE WHEN ?5 IS NOT NULL THEN 'claude-code' ELSE resume_token_engine END
         WHERE id = ?6",
        params![
            in_tokens,
            out_tokens,
            cost_usd,
            now / 1000,
            new_token,
            input.conversation_id,
        ],
    )?;

    insert_trace_log(&conn, &input.conversation_id, in_tokens, out_tokens, cost_usd, now);

    Ok(Message {
        id: msg_id,
        conversation_id: input.conversation_id,
        role: "assistant".into(),
        content,
        timestamp: now,
        status,
        progress_content: None,
        engine: Some("claude-code".into()),
        model: input.model,
        persona: None,
    })
}

/// Send a one-shot request to the local `codex` CLI and persist the result.
///
/// Same flow as `send_with_claude` but uses `codex::run`.
/// Full ContextPack not supported by codex — uses lite context prefix instead.
#[tauri::command]
pub fn send_with_codex(
    input: SendWithClaudeInput,
    state: State<DbState>,
) -> Result<Message, AppError> {
    // Step 1: persist user message + build lite context (single lock block)
    let enriched_prompt;
    {
        let conn = state.0.lock().map_err(|_| AppError::Lock)?;
        if input.user_message_id.is_none() {
            let id = Uuid::new_v4().to_string();
            let now = now_epoch_ms();
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, timestamp, status)
                 VALUES (?1, ?2, 'user', ?3, ?4, 'done')",
                params![id, input.conversation_id, input.prompt, now],
            )?;
        }
        enriched_prompt = build_lite_context_prompt(&conn, &input.conversation_id, &input.prompt);
    }

    // Step 2: run codex subprocess — DB lock must NOT be held
    let t0 = std::time::Instant::now();
    let run_result = codex::run(claude::RunInput {
        prompt: enriched_prompt,
        model: input.model.clone(),
        system_prompt: None,
        resume_token: None,
    });
    guardrail::log_run("codex", input.model.as_deref(), t0.elapsed().as_millis(), input.prompt.len(), run_result.is_ok());

    let (content, status, cost_usd, in_tokens, out_tokens) = match run_result {
        Ok(out) if out.content.is_empty() => {
            ("(codex returned no output)".to_string(), "done".to_string(), 0.0, 0i64, 0i64)
        }
        Ok(out) => (out.content, "done".to_string(), out.cost_usd, out.input_tokens, out.output_tokens),
        Err(ref e) => (guardrail::fallback_error("codex", e), "error".to_string(), 0.0, 0, 0),
    };

    // Step 3: persist assistant message + update usage
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let msg_id = Uuid::new_v4().to_string();
    let now = now_epoch_ms();

    conn.execute(
        "INSERT INTO messages
         (id, conversation_id, role, content, timestamp, status, engine, model)
         VALUES (?1, ?2, 'assistant', ?3, ?4, ?5, 'codex', ?6)",
        params![msg_id, input.conversation_id, content, now, status, input.model],
    )?;

    conn.execute(
        "UPDATE conversations SET
             total_input_tokens  = total_input_tokens  + ?1,
             total_output_tokens = total_output_tokens + ?2,
             total_cost_usd      = total_cost_usd      + ?3,
             updated_at          = ?4
         WHERE id = ?5",
        params![in_tokens, out_tokens, cost_usd, now / 1000, input.conversation_id],
    )?;

    insert_trace_log(&conn, &input.conversation_id, in_tokens, out_tokens, cost_usd, now);

    Ok(Message {
        id: msg_id,
        conversation_id: input.conversation_id,
        role: "assistant".into(),
        content,
        timestamp: now,
        status,
        progress_content: None,
        engine: Some("codex".into()),
        model: input.model,
        persona: None,
    })
}

/// Send a one-shot request to the local `gemini` CLI and persist the result.
///
/// Full ContextPack not supported by gemini — uses lite context prefix instead.
#[tauri::command]
pub fn send_with_gemini(
    input: SendWithClaudeInput,
    state: State<DbState>,
) -> Result<Message, AppError> {
    // Step 1: persist user message + build lite context (single lock block)
    let enriched_prompt;
    {
        let conn = state.0.lock().map_err(|_| AppError::Lock)?;
        if input.user_message_id.is_none() {
            let id = Uuid::new_v4().to_string();
            let now = now_epoch_ms();
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, timestamp, status)
                 VALUES (?1, ?2, 'user', ?3, ?4, 'done')",
                params![id, input.conversation_id, input.prompt, now],
            )?;
        }
        enriched_prompt = build_lite_context_prompt(&conn, &input.conversation_id, &input.prompt);
    }

    // Step 2: run gemini subprocess — DB lock must NOT be held
    let t0 = std::time::Instant::now();
    let run_result = gemini::run(claude::RunInput {
        prompt: enriched_prompt,
        model: input.model.clone(),
        system_prompt: None,
        resume_token: None,
    });
    guardrail::log_run("gemini", input.model.as_deref(), t0.elapsed().as_millis(), input.prompt.len(), run_result.is_ok());

    let (content, status) = match run_result {
        Ok(out) if out.content.is_empty() => {
            ("(gemini returned no output)".to_string(), "done".to_string())
        }
        Ok(out) => (out.content, "done".to_string()),
        Err(ref e) => (guardrail::fallback_error("gemini", e), "error".to_string()),
    };

    // Step 3: persist assistant message
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let msg_id = Uuid::new_v4().to_string();
    let now = now_epoch_ms();

    conn.execute(
        "INSERT INTO messages
         (id, conversation_id, role, content, timestamp, status, engine, model)
         VALUES (?1, ?2, 'assistant', ?3, ?4, ?5, 'gemini', ?6)",
        params![msg_id, input.conversation_id, content, now, status, input.model],
    )?;

    conn.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        params![now / 1000, input.conversation_id],
    )?;

    insert_trace_log(&conn, &input.conversation_id, 0, 0, 0.0, now);

    Ok(Message {
        id: msg_id,
        conversation_id: input.conversation_id,
        role: "assistant".into(),
        content,
        timestamp: now,
        status,
        progress_content: None,
        engine: Some("gemini".into()),
        model: input.model,
        persona: None,
    })
}

/// Send a one-shot request to the local `opencode` CLI and persist the result.
///
/// Full ContextPack not supported by opencode — uses lite context prefix instead.
#[tauri::command]
pub fn send_with_opencode(
    input: SendWithClaudeInput,
    state: State<DbState>,
) -> Result<Message, AppError> {
    let enriched_prompt;
    {
        let conn = state.0.lock().map_err(|_| AppError::Lock)?;
        if input.user_message_id.is_none() {
            let id = Uuid::new_v4().to_string();
            let now = now_epoch_ms();
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, timestamp, status)
                 VALUES (?1, ?2, 'user', ?3, ?4, 'done')",
                params![id, input.conversation_id, input.prompt, now],
            )?;
        }
        enriched_prompt = build_lite_context_prompt(&conn, &input.conversation_id, &input.prompt);
    }

    let t0 = std::time::Instant::now();
    let run_result = opencode::run(claude::RunInput {
        prompt: enriched_prompt,
        model: input.model.clone(),
        system_prompt: None,
        resume_token: None,
    });
    guardrail::log_run("opencode", input.model.as_deref(), t0.elapsed().as_millis(), input.prompt.len(), run_result.is_ok());

    let (content, status) = match run_result {
        Ok(out) if out.content.is_empty() => {
            ("(opencode returned no output)".to_string(), "done".to_string())
        }
        Ok(out) => (out.content, "done".to_string()),
        Err(ref e) => (guardrail::fallback_error("opencode", e), "error".to_string()),
    };

    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let msg_id = Uuid::new_v4().to_string();
    let now = now_epoch_ms();

    conn.execute(
        "INSERT INTO messages
         (id, conversation_id, role, content, timestamp, status, engine, model)
         VALUES (?1, ?2, 'assistant', ?3, ?4, ?5, 'opencode', ?6)",
        params![msg_id, input.conversation_id, content, now, status, input.model],
    )?;

    conn.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        params![now / 1000, input.conversation_id],
    )?;

    insert_trace_log(&conn, &input.conversation_id, 0, 0, 0.0, now);

    Ok(Message {
        id: msg_id,
        conversation_id: input.conversation_id,
        role: "assistant".into(),
        content,
        timestamp: now,
        status,
        progress_content: None,
        engine: Some("opencode".into()),
        model: input.model,
        persona: None,
    })
}

/// Streaming version of send_with_claude.
///
/// Flow:
///   1. Persist user message + load resume token + project path (single lock, then released)
///   2. Insert placeholder assistant message with status = 'streaming'
///   3. Spawn claude with --output-format stream-json; emit "claude:chunk" per assistant event
///   4. Re-acquire lock: update message content + status + usage + resume token
#[tauri::command]
pub fn stream_with_claude(
    input: SendWithClaudeInput,
    state: State<DbState>,
    app: AppHandle,
) -> Result<Message, AppError> {
    // Step 1: load context + persist user message + load resume token + project path
    let is_branch = input.conversation_id.starts_with("branch:");
    let (resume_token, project_path, msg_id, current_context, parent_context, cross_session_data, plan_section) = {
        let conn = state.0.lock().map_err(|_| AppError::Lock)?;

        let load_messages = |conv_id: &str, limit: i64| -> Vec<(String, String)> {
            let Ok(mut stmt) = conn.prepare(
                "SELECT role, content FROM messages
                 WHERE conversation_id = ?1
                 ORDER BY timestamp DESC LIMIT ?2",
            ) else { return Vec::new(); };
            let mut rows: Vec<(String, String)> = stmt
                .query_map(params![conv_id, limit], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map(|mapped| mapped.filter_map(|r| r.ok()).collect())
                .unwrap_or_default();
            rows.reverse();
            rows
        };

        let current_context = load_messages(&input.conversation_id, CONTEXT_MESSAGES_LIMIT);

        let parent_context: Vec<(String, String)> = if is_branch {
            let parent_id: Option<String> = conn
                .query_row(
                    "SELECT parent_id FROM conversations WHERE id = ?1",
                    [&input.conversation_id],
                    |row| row.get(0),
                )
                .ok()
                .flatten();
            parent_id
                .map(|pid| load_messages(&pid, PARENT_CONTEXT_MESSAGES_LIMIT))
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        // Cross-session context (§4.2 step 3.5)
        let cross_session_data: Vec<(String, Vec<(String, String)>)> = input
            .cross_session_ids
            .iter()
            .filter(|id| **id != input.conversation_id)
            .filter_map(|conv_id| {
                let label: String = conn
                    .query_row(
                        "SELECT COALESCE(custom_label, label) FROM conversations WHERE id = ?1",
                        [conv_id],
                        |row| row.get(0),
                    )
                    .ok()?;
                let rows = load_messages(conv_id, CROSS_SESSION_MESSAGES_LIMIT);
                if rows.is_empty() { None } else { Some((label, rows)) }
            })
            .collect();

        // Active plan section (weak link — returns None if no active plan)
        let plan_section = guardrail::truncate_section(
            build_plan_section(&conn, &input.conversation_id),
            guardrail::MAX_PLAN_SECTION,
        );

        if input.user_message_id.is_none() {
            let id = Uuid::new_v4().to_string();
            let now = now_epoch_ms();
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, timestamp, status)
                 VALUES (?1, ?2, 'user', ?3, ?4, 'done')",
                params![id, input.conversation_id, input.prompt, now],
            )?;
        }

        let token_result: rusqlite::Result<(Option<String>, Option<String>)> = conn.query_row(
            "SELECT resume_token, resume_token_engine FROM conversations WHERE id = ?1",
            [&input.conversation_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );
        let resume_token = match token_result {
            Ok((Some(token), Some(engine))) if engine == "claude-code" => Some(token),
            _ => None,
        };

        let project_path: Option<String> = conn
            .query_row(
                "SELECT path FROM projects WHERE key = ?1",
                [&input.project_key],
                |row| row.get(0),
            )
            .ok()
            .flatten();

        let msg_id = Uuid::new_v4().to_string();
        let now = now_epoch_ms();
        conn.execute(
            "INSERT INTO messages
             (id, conversation_id, role, content, timestamp, status, engine, model)
             VALUES (?1, ?2, 'assistant', '', ?3, 'streaming', 'claude-code', ?4)",
            params![msg_id, input.conversation_id, now, input.model],
        )?;

        (resume_token, project_path, msg_id, current_context, parent_context, cross_session_data, plan_section)
    };

    // Step 2: assemble ContextPack (runtime only) with guardrails
    let base_system_prompt = assemble_system_prompt(
        input.agent_name.as_deref(),
        project_path.as_deref(),
        input.system_prompt.as_deref(),
    );
    let skills_section = guardrail::truncate_section(
        build_skills_section(&input.active_skills),
        guardrail::MAX_SKILLS_SECTION,
    );
    let rawq_section = guardrail::truncate_section(
        build_rawq_section(project_path.as_deref(), &input.prompt),
        guardrail::MAX_RAWQ_SECTION,
    );
    let cross_section = maybe_compress_section(
        build_cross_session_section(&cross_session_data),
        guardrail::MAX_CROSS_SESSION_SECTION,
    );
    let context_summary = maybe_compress_section(
        build_context_summary(&current_context, &parent_context, is_branch),
        guardrail::MAX_CONTEXT_SECTION,
    );
    let system_prompt = guardrail::enforce_total_limit(
        combine_prompt_parts([base_system_prompt, skills_section, plan_section, rawq_section, cross_section, context_summary]),
        guardrail::MAX_TOTAL_PROMPT,
    );

    // Step 3: run streaming subprocess — DB lock must NOT be held
    let prompt_len = input.prompt.len() + system_prompt.as_ref().map_or(0, |s| s.len());
    let t0 = std::time::Instant::now();
    let chunk_msg_id = msg_id.clone();
    let run_result = claude::stream_run(
        claude::RunInput {
            prompt: input.prompt.clone(),
            model: input.model.clone(),
            system_prompt,
            resume_token,
        },
        |text| {
            let _ = app.emit(
                "claude:chunk",
                ChunkPayload {
                    message_id: chunk_msg_id.clone(),
                    text,
                },
            );
        },
    );
    let duration_ms = t0.elapsed().as_millis();
    guardrail::log_run("claude-code-stream", input.model.as_deref(), duration_ms, prompt_len, run_result.is_ok());

    let (content, status, cost_usd, in_tokens, out_tokens, new_token) = match run_result {
        Ok(out) => (
            out.content,
            "done".to_string(),
            out.cost_usd,
            out.input_tokens,
            out.output_tokens,
            out.session_id,
        ),
        Err(ref e) => (guardrail::fallback_error("claude-code", e), "error".to_string(), 0.0, 0, 0, None),
    };

    // Step 4: update placeholder message + conversation usage + resume token
    let conn = state.0.lock().map_err(|_| AppError::Lock)?;
    let now = now_epoch_ms();

    conn.execute(
        "UPDATE messages SET content = ?1, status = ?2, timestamp = ?3 WHERE id = ?4",
        params![content, status, now, msg_id],
    )?;

    conn.execute(
        "UPDATE conversations SET
             total_input_tokens  = total_input_tokens  + ?1,
             total_output_tokens = total_output_tokens + ?2,
             total_cost_usd      = total_cost_usd      + ?3,
             updated_at          = ?4,
             resume_token        = ?5,
             resume_token_engine = CASE WHEN ?5 IS NOT NULL THEN 'claude-code' ELSE resume_token_engine END
         WHERE id = ?6",
        params![
            in_tokens,
            out_tokens,
            cost_usd,
            now / 1000,
            new_token,
            input.conversation_id,
        ],
    )?;

    insert_trace_log(&conn, &input.conversation_id, in_tokens, out_tokens, cost_usd, now);

    Ok(Message {
        id: msg_id,
        conversation_id: input.conversation_id,
        role: "assistant".into(),
        content,
        timestamp: now,
        status,
        progress_content: None,
        engine: Some("claude-code".into()),
        model: input.model,
        persona: None,
    })
}
