//! Runtime guardrails for ContextPack size, section truncation, and execution logging.
//! All values are character counts (not tokens). Token estimation: ~4 chars ≈ 1 token.

// ─── Section limits (characters) ─────────────────────────────────────────────

/// Maximum total system prompt size after all sections are assembled.
pub const MAX_TOTAL_PROMPT: usize = 60_000;

/// Per-section character limits for ContextPack sections.
pub const MAX_SKILLS_SECTION: usize = 8_000;
pub const MAX_RAWQ_SECTION: usize = 4_000;
pub const MAX_CROSS_SESSION_SECTION: usize = 6_000;
pub const MAX_CONTEXT_SECTION: usize = 8_000;
pub const MAX_PLAN_SECTION: usize = 2_000;

// ─── Execution defaults ──────────────────────────────────────────────────────

/// Default subprocess timeout in seconds (applied at the OS level via wait).
/// Currently advisory — actual enforcement depends on the CLI tool's own timeout.
pub const DEFAULT_TIMEOUT_SECS: u64 = 120;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Truncate a section string to `max` characters (char-boundary safe).
/// Returns the original if within limit.
pub fn truncate_section(section: Option<String>, max: usize) -> Option<String> {
    section.map(|s| {
        if s.len() <= max {
            s
        } else {
            let end = s
                .char_indices()
                .map(|(i, _)| i)
                .take_while(|&i| i <= max)
                .last()
                .unwrap_or(0);
            format!("{}…[truncated]", &s[..end])
        }
    })
}

/// Enforce total character limit on the assembled system prompt.
/// Truncates from the end with a `[system prompt truncated]` marker.
pub fn enforce_total_limit(prompt: Option<String>, max: usize) -> Option<String> {
    prompt.map(|s| {
        if s.len() <= max {
            s
        } else {
            let marker = "\n\n…[system prompt truncated]";
            let budget = max.saturating_sub(marker.len());
            let end = s
                .char_indices()
                .map(|(i, _)| i)
                .take_while(|&i| i <= budget)
                .last()
                .unwrap_or(0);
            format!("{}{}", &s[..end], marker)
        }
    })
}

/// Standard fallback error message for agent failures.
pub fn fallback_error(engine: &str, err: &crate::errors::AppError) -> String {
    format!(
        "[{} error] {}",
        engine,
        match err {
            crate::errors::AppError::Agent(msg) => msg.clone(),
            other => format!("{}", other),
        }
    )
}

/// Log an agent execution result to stderr (visible in `tauri dev` console).
pub fn log_run(engine: &str, model: Option<&str>, duration_ms: u128, prompt_len: usize, result_ok: bool) {
    let status = if result_ok { "ok" } else { "err" };
    let est_tokens = prompt_len / 4;
    eprintln!(
        "[guardrail] engine={} model={} status={} duration={}ms prompt_chars={} est_tokens={}",
        engine,
        model.unwrap_or("-"),
        status,
        duration_ms,
        prompt_len,
        est_tokens,
    );
}
