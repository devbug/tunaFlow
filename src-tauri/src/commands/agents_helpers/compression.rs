use crate::agents::claude;
use crate::guardrail;

/// Summarise a long context section via a direct claude subprocess call.
///
/// Returns `Ok(summary)` when claude produces non-empty output.
/// Returns `Err(())` on any failure.
///
/// Recursion safety: calls claude::run() directly with no system_prompt
/// and no resume_token — ContextPack assembly is never entered again.
pub fn compress_context_with_claude(text: &str) -> Result<String, ()> {
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
        model: None,
        system_prompt: None,
        resume_token: None,
        project_path: None,
    })
    .ok()
    .map(|out| out.content)
    .filter(|s| !s.trim().is_empty())
    .ok_or(())
}

/// Return the section as-is if within `limit`.
/// If over `limit`, attempt claude compression first; fall back to truncation.
pub fn maybe_compress_section(section: Option<String>, limit: usize) -> Option<String> {
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
