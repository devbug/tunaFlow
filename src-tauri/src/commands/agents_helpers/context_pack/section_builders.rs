/// Pure (DB-free) ContextPack section builders.
///
/// All functions here take pre-loaded data and return formatted section strings.
/// DB-dependent queries live in `db_queries.rs`.
use super::utils::{fold_similar_blocks, format_section, format_section_with_authors, truncate_str};

/// Words to skip when building chops search query.
#[allow(dead_code)]
const CHOPS_SKIP_WORDS: &[&str] = &[
    "the", "this", "that", "with", "from", "have", "been",
    "will", "would", "could", "should", "about", "into",
    "구현", "수정", "변경", "추가", "삭제", "확인", "진행",
    "해주세요", "합니다", "입니다", "있습니다", "없습니다",
];

/// Build skills section with selective injection.
///
/// Instead of injecting full SKILL.md content, splits each skill by `## ` headers
/// and only includes sections whose header or content matches keywords from the prompt.
/// Unmatched sections are replaced with a compact reference: "[SkillName: N sections omitted]".
pub fn build_skills_section(skill_names: &[String], prompt: &str) -> Option<String> {
    if skill_names.is_empty() {
        return None;
    }

    let keywords: Vec<String> = prompt
        .split_whitespace()
        .map(|w| w.to_lowercase())
        .filter(|w| w.len() >= 3)
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    let mut skill_blocks = Vec::new();
    for name in skill_names {
        if let Ok(skill) = crate::commands::skills::get_skill(name.clone()) {
            let block = extract_relevant_skill_sections(&skill.name, &skill.content, &keywords);
            skill_blocks.push(block);
        }
    }
    if skill_blocks.is_empty() {
        return None;
    }
    Some(format!("## Active skills\n\n{}", skill_blocks.join("\n\n")))
}

/// Extract only relevant sections from a skill's markdown content.
fn extract_relevant_skill_sections(skill_name: &str, content: &str, keywords: &[String]) -> String {
    let mut sections: Vec<(&str, &str)> = Vec::new();
    let mut current_header = "";
    let mut current_start = 0;

    for (i, line) in content.lines().enumerate() {
        if line.starts_with("## ") {
            if i > 0 {
                let body = &content[current_start..content.lines().take(i).map(|l| l.len() + 1).sum::<usize>().saturating_sub(1)];
                sections.push((current_header, body.trim()));
            }
            current_header = line;
            current_start = content.lines().take(i).map(|l| l.len() + 1).sum::<usize>();
        }
    }
    let remaining = &content[current_start..];
    sections.push((current_header, remaining.trim()));

    if sections.len() <= 1 || keywords.is_empty() {
        return format!("### {}\n\n{}", skill_name, truncate_str(content, 2000));
    }

    let mut included = Vec::new();
    let mut omitted = 0;

    for (header, body) in &sections {
        let combined = format!("{} {}", header.to_lowercase(), body.to_lowercase());
        let matches = keywords.iter().any(|kw| combined.contains(kw.as_str()));
        if matches || header.is_empty() {
            included.push(format!("{}\n{}", header, truncate_str(body, 800)));
        } else {
            omitted += 1;
        }
    }

    let mut result = format!("### {}\n\n", skill_name);
    if !included.is_empty() {
        result.push_str(&included.join("\n\n"));
    }
    if omitted > 0 {
        result.push_str(&format!("\n\n[{}: {} section{} omitted]", skill_name, omitted, if omitted > 1 { "s" } else { "" }));
    }
    result
}

/// Build a code-review-graph section — detect changes + impact radius.
/// Returns None if code-review-graph is unavailable or project has no graph.
pub fn build_crg_section(project_path: &str) -> Option<String> {
    if !crate::agents::crg::is_available() {
        return None;
    }

    let changes = crate::agents::crg::detect_changes(project_path, "HEAD~1").ok()?;
    let summary = changes.get("summary").and_then(|v| v.as_str()).unwrap_or("");
    if summary.is_empty() || summary.contains("No changes") {
        return None;
    }

    let mut out = String::from("## Code change impact (code-review-graph)\n\n");
    out.push_str(summary);

    if let Some(files) = changes.get("files").and_then(|v| v.as_array()) {
        if !files.is_empty() {
            out.push_str("\n\n**Risk-scored files**:\n");
            for (i, f) in files.iter().take(10).enumerate() {
                if let Some(name) = f.get("file").and_then(|v| v.as_str()) {
                    let score = f.get("risk_score").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    out.push_str(&format!("{}. {} (risk: {:.1})\n", i + 1, name, score));
                }
            }
        }
    }

    eprintln!("[context_pack] crg: change impact section built ({} chars)", out.len());
    Some(out)
}

/// Build a context-hub (chops) section from automatic keyword search.
///
/// Calls `context_hub::search()` with keywords extracted from the prompt.
/// Returns None if context-hub is unavailable or no results found.
#[allow(dead_code)]
pub fn build_chops_section(prompt: &str) -> Option<String> {
    let keywords: Vec<&str> = prompt
        .split_whitespace()
        .filter(|w| w.len() >= 3)
        .filter(|w| !CHOPS_SKIP_WORDS.contains(&w.to_lowercase().as_str()))
        .take(6)
        .collect();

    if keywords.is_empty() {
        return None;
    }

    let query = keywords.join(" ");
    match crate::agents::context_hub::search(&query, None, 3) {
        Ok(results) => {
            if results.is_empty() {
                return None;
            }
            let mut out = String::from("## Library documentation (context-hub)\n\n");
            for r in &results {
                out.push_str(&format!(
                    "### {} ({})\n{}\n\n",
                    r.title,
                    r.source,
                    truncate_str(&r.snippet, 500),
                ));
            }
            eprintln!("[context_pack] chops: {} results for \"{}\"", results.len(), query);
            Some(out.trim_end().to_string())
        }
        Err(_) => None,
    }
}

/// Build `## Cross-session context` from pre-loaded cross-session data.
pub fn build_cross_session_section(
    cross_session: &[(String, Vec<(String, String)>)],
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
    fold_similar_blocks(&mut blocks);
    if blocks.is_empty() {
        return None;
    }
    Some(format!("## Cross-session context\n\n{}", blocks.join("\n")))
}

/// Build context summary from pre-loaded message rows.
#[allow(dead_code)]
pub fn build_context_summary(
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
            "Branch conversation history (you are continuing this conversation)"
        } else {
            "Conversation history (you are continuing this conversation — refer to these messages as your own prior responses)"
        };
        parts.push(format_section(header, current_rows, 400));
    }

    Some(parts.join("\n"))
}

/// Build context summary with per-message author attribution.
///
/// Each assistant message shows `[assistant:ProfileName (engine)]` so the model
/// can distinguish which agent authored each past message.
pub fn build_context_summary_with_authors(
    current_rows: &[(String, String, Option<String>, Option<String>)],
    parent_rows: &[(String, String, Option<String>, Option<String>)],
    is_branch: bool,
) -> Option<String> {
    let has_current = !current_rows.is_empty();
    let has_parent = !parent_rows.is_empty();

    if !has_current && !has_parent {
        return None;
    }

    let mut parts: Vec<String> = Vec::new();

    if has_parent {
        parts.push(format_section_with_authors("Parent conversation context", parent_rows, 300));
    }

    if has_current {
        let header = if is_branch {
            "Branch conversation history (each assistant message shows its author — do not claim other agents' messages as your own)"
        } else {
            "Conversation history (each assistant message shows its author — you are continuing this conversation, but do not claim messages authored by other agents as your own)"
        };
        parts.push(format_section_with_authors(header, current_rows, 400));
    }

    Some(parts.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── build_context_summary ───────────────────────────────────────────
    #[test]
    fn context_summary_empty_inputs() {
        assert_eq!(build_context_summary(&[], &[], false), None);
    }

    #[test]
    fn context_summary_current_only() {
        let current = vec![("user".into(), "hello".into())];
        let result = build_context_summary(&current, &[], false).unwrap();
        assert!(result.contains("Conversation history"));
        assert!(result.contains("hello"));
    }

    #[test]
    fn context_summary_parent_only() {
        let parent = vec![("assistant".into(), "response".into())];
        let result = build_context_summary(&[], &parent, false).unwrap();
        assert!(result.contains("Parent conversation context"));
    }

    #[test]
    fn context_summary_branch_mode() {
        let current = vec![("user".into(), "msg".into())];
        let result = build_context_summary(&current, &[], true).unwrap();
        assert!(result.contains("Branch conversation history"));
    }

    #[test]
    fn context_summary_both() {
        let current = vec![("user".into(), "cur".into())];
        let parent = vec![("user".into(), "par".into())];
        let result = build_context_summary(&current, &parent, true).unwrap();
        assert!(result.contains("Parent conversation context"));
        assert!(result.contains("Branch conversation history"));
    }

    // ─── build_cross_session_section ─────────────────────────────────────
    #[test]
    fn cross_session_empty() {
        assert_eq!(build_cross_session_section(&[]), None);
    }

    #[test]
    fn cross_session_with_data() {
        let data = vec![
            ("Session A".into(), vec![("user".into(), "question".into())]),
        ];
        let result = build_cross_session_section(&data).unwrap();
        assert!(result.contains("Cross-session context"));
        assert!(result.contains("Session A"));
    }

    // ─── build_context_summary_with_authors ─────────────────────────────
    #[test]
    fn context_summary_authors_attribution_header() {
        let current = vec![
            ("user".into(), "hi".into(), None, None),
            ("assistant".into(), "hello".into(), Some("claude-code".into()), Some("Arch".into())),
        ];
        let result = build_context_summary_with_authors(&current, &[], false).unwrap();
        assert!(result.contains("do not claim messages authored by other agents"));
        assert!(result.contains("[assistant:Arch (claude-code)]"));
    }
}
