use std::path::PathBuf;
use crate::errors::AppError;

/// Parsed agent definition (DATA_MODEL §1.6)
pub struct AgentDef {
    pub name: String,
    /// YAML body = system prompt injected via --append-system-prompt
    pub system_prompt: String,
    /// `model:` field from frontmatter (optional override)
    pub model: Option<String>,
}

/// Load `{project_path}/docs/agents/{name}.md` and parse it.
/// Returns Err if the file is missing or frontmatter is malformed.
pub fn load_agent(project_path: &str, name: &str) -> Result<AgentDef, AppError> {
    let path = PathBuf::from(project_path)
        .join("docs")
        .join("agents")
        .join(format!("{}.md", name));

    let content = std::fs::read_to_string(&path).map_err(|e| {
        AppError::Agent(format!(
            "Agent '{}' not found at {}: {}",
            name,
            path.display(),
            e
        ))
    })?;

    parse(&content, name)
}

fn parse(content: &str, name: &str) -> Result<AgentDef, AppError> {
    if !content.starts_with("---") {
        // No frontmatter: entire file is system prompt
        return Ok(AgentDef {
            name: name.to_string(),
            system_prompt: content.trim().to_string(),
            model: None,
        });
    }

    // Skip opening "---", find closing "\n---"
    let after_open = &content[3..];
    let close_pos = after_open.find("\n---").ok_or_else(|| {
        AppError::Agent(format!("Agent '{}': frontmatter is not closed", name))
    })?;

    let frontmatter = &after_open[..close_pos];
    // Body starts after "\n---" (4 bytes), skip one optional newline
    let body_raw = &content[3 + close_pos + 4..];
    let system_prompt = body_raw
        .strip_prefix('\n')
        .unwrap_or(body_raw)
        .to_string();

    Ok(AgentDef {
        name: name.to_string(),
        system_prompt,
        model: scalar_field(frontmatter, "model"),
    })
}

/// Extract a simple `key: value` line from YAML frontmatter.
/// Does not handle multi-line or quoted values — sufficient for our schema.
fn scalar_field(frontmatter: &str, key: &str) -> Option<String> {
    let prefix = format!("{}:", key);
    for line in frontmatter.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with(&prefix) {
            let val = trimmed[prefix.len()..].trim().to_string();
            if !val.is_empty() {
                return Some(val);
            }
        }
    }
    None
}
