use serde::Serialize;
use std::fs;
use std::path::PathBuf;

use crate::errors::AppError;

/// Parsed skill definition loaded from `~/.tunaflow/skills/{name}/SKILL.md`
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillDef {
    pub name: String,
    pub description: String,
    pub content: String,
}

/// Skill base directory: `~/.tunaflow/skills/`
fn skills_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let home = std::env::var("USERPROFILE").ok();
    #[cfg(not(target_os = "windows"))]
    let home = std::env::var("HOME").ok();
    home.map(|h| PathBuf::from(h).join(".tunaflow").join("skills"))
}

/// Scan `~/.tunaflow/skills/*/SKILL.md` and return all valid skill definitions.
#[tauri::command]
pub fn list_skills() -> Result<Vec<SkillDef>, AppError> {
    let base = match skills_dir() {
        Some(d) if d.is_dir() => d,
        _ => return Ok(Vec::new()),
    };

    let mut skills = Vec::new();
    let Ok(entries) = fs::read_dir(&base) else {
        return Ok(Vec::new());
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let skill_file = path.join("SKILL.md");
        if !skill_file.is_file() {
            continue;
        }
        let Ok(content) = fs::read_to_string(&skill_file) else {
            continue;
        };
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        let (description, body) = parse_skill(&content);
        skills.push(SkillDef {
            name,
            description,
            content: body,
        });
    }

    skills.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(skills)
}

/// Load a single skill by name. Used by ContextPack assembly.
#[tauri::command]
pub fn get_skill(name: String) -> Result<SkillDef, AppError> {
    let base = skills_dir().ok_or_else(|| {
        AppError::NotFound("skills directory not found".into())
    })?;
    let skill_file = base.join(&name).join("SKILL.md");
    let content = fs::read_to_string(&skill_file).map_err(|e| {
        AppError::NotFound(format!("Skill '{}' not found: {}", name, e))
    })?;

    let (description, body) = parse_skill(&content);
    Ok(SkillDef {
        name,
        description,
        content: body,
    })
}

/// Parse SKILL.md: extract `description:` from frontmatter, rest is content.
fn parse_skill(raw: &str) -> (String, String) {
    if !raw.starts_with("---") {
        return (String::new(), raw.trim().to_string());
    }

    let after_open = &raw[3..];
    let Some(close_pos) = after_open.find("\n---") else {
        return (String::new(), raw.trim().to_string());
    };

    let frontmatter = &after_open[..close_pos];
    let body_raw = &raw[3 + close_pos + 4..];
    let body = body_raw
        .strip_prefix('\n')
        .unwrap_or(body_raw)
        .to_string();

    let description = frontmatter
        .lines()
        .find_map(|line| {
            let trimmed = line.trim_start();
            if trimmed.starts_with("description:") {
                Some(trimmed["description:".len()..].trim().to_string())
            } else {
                None
            }
        })
        .unwrap_or_default();

    (description, body)
}
