use crate::agents::loader;

/// Assemble the system prompt component of ContextPack (step 1).
/// If both agent prompt and extra system_prompt are present, they are concatenated.
pub fn assemble_system_prompt(
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

#[cfg(test)]
mod tests {
    use super::*;

    // ─── assemble_system_prompt ──────────────────────────────────────────
    #[test]
    fn assemble_no_agent_no_extra() {
        assert_eq!(assemble_system_prompt(None, None, None), None);
    }

    #[test]
    fn assemble_extra_only() {
        let result = assemble_system_prompt(None, None, Some("custom prompt"));
        assert_eq!(result, Some("custom prompt".into()));
    }
}
