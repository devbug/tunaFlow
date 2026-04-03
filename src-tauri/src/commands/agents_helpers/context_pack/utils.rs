/// Truncate a string to `max` bytes (character boundary safe).
pub(crate) fn truncate_str(s: &str, max: usize) -> String {
    if s.len() > max {
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

pub(crate) fn format_section(header: &str, rows: &[(String, String)], max_chars: usize) -> String {
    let mut out = format!("## {}\n", header);
    for (role, content) in rows {
        out.push_str(&format!("\n[{}] {}\n", role, truncate_str(content, max_chars)));
    }
    out
}

pub(crate) fn format_section_with_authors(
    header: &str,
    rows: &[(String, String, Option<String>, Option<String>)],
    max_chars: usize,
) -> String {
    let mut out = format!("## {}\n", header);
    for (role, content, engine, persona) in rows {
        let author_tag = match (role.as_str(), persona, engine) {
            ("assistant", Some(p), Some(e)) if !p.is_empty() => format!("assistant:{} ({})", p, e),
            ("assistant", None, Some(e)) if !e.is_empty() => format!("assistant ({})", e),
            ("assistant", Some(p), _) if !p.is_empty() => format!("assistant:{}", p),
            _ => role.clone(),
        };
        // Apply markdown lightening to reduce token waste in long assistant messages
        let lightened = if role == "assistant" && content.len() > 200 {
            lighten_markdown(&truncate_str(content, max_chars))
        } else {
            truncate_str(content, max_chars)
        };
        out.push_str(&format!("\n[{}] {}\n", author_tag, lightened));
    }
    out
}

// ─── Algorithm helpers ──────────────────────────────────────────────────────

/// Jaccard similarity between two strings (word-level).
/// Returns 0.0–1.0. Used for detecting near-duplicate blocks.
pub(crate) fn jaccard_similarity(a: &str, b: &str) -> f64 {
    let words_a: std::collections::HashSet<&str> = a.split_whitespace().collect();
    let words_b: std::collections::HashSet<&str> = b.split_whitespace().collect();
    if words_a.is_empty() && words_b.is_empty() { return 1.0; }
    let intersection = words_a.intersection(&words_b).count();
    let union = words_a.union(&words_b).count();
    if union == 0 { return 0.0; }
    intersection as f64 / union as f64
}

/// Fold near-duplicate entries in a list of (label, content) pairs.
/// If Jaccard similarity > threshold, keep the first and replace subsequent with "[similar to above]".
const JACCARD_FOLD_THRESHOLD: f64 = 0.8;

pub(crate) fn fold_similar_blocks(blocks: &mut Vec<String>) {
    if blocks.len() < 2 { return; }
    let mut i = 1;
    while i < blocks.len() {
        if jaccard_similarity(&blocks[i - 1], &blocks[i]) > JACCARD_FOLD_THRESHOLD {
            blocks[i] = format!("[similar to previous entry — folded]");
        }
        i += 1;
    }
}

/// Strip heavy markdown formatting to save tokens.
/// Preserves code blocks and meaningful structure.
pub(crate) fn lighten_markdown(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut in_code_block = false;
    for line in text.lines() {
        if line.trim_start().starts_with("```") {
            in_code_block = !in_code_block;
            result.push_str(line);
            result.push('\n');
            continue;
        }
        if in_code_block {
            result.push_str(line);
            result.push('\n');
            continue;
        }
        // Strip bold/italic markers
        let cleaned = line
            .replace("**", "")
            .replace("__", "")
            .replace("*", "")
            .replace("_", " ");
        // Collapse multiple spaces
        let collapsed: String = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
        result.push_str(&collapsed);
        result.push('\n');
    }
    result
}

/// Fold import/use/from/require blocks in code snippets.
/// Replaces consecutive import lines with a summary.
pub(crate) fn fold_import_block(snippet: &str) -> String {
    let lines: Vec<&str> = snippet.lines().collect();
    let mut result: Vec<String> = Vec::new();
    let mut import_buf: Vec<String> = Vec::new();

    let flush_imports = |buf: &mut Vec<String>, out: &mut Vec<String>| {
        if buf.len() > 2 {
            out.push(format!("[{} imports folded]", buf.len()));
        } else {
            out.extend(buf.drain(..));
        }
        buf.clear();
    };

    for line in &lines {
        let trimmed = line.trim();
        let is_import = trimmed.starts_with("import ")
            || trimmed.starts_with("use ")
            || trimmed.starts_with("from ")
            || trimmed.starts_with("require(")
            || (trimmed.starts_with("const ") && trimmed.contains("require("));

        if is_import {
            import_buf.push(line.to_string());
        } else {
            flush_imports(&mut import_buf, &mut result);
            result.push(line.to_string());
        }
    }
    flush_imports(&mut import_buf, &mut result);
    result.join("\n")
}

/// Combine multiple optional system-prompt sections, joining with double newline.
#[allow(dead_code)]
pub fn combine_prompt_parts(parts: impl IntoIterator<Item = Option<String>>) -> Option<String> {
    let joined: String = parts
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join("\n\n");
    if joined.is_empty() { None } else { Some(joined) }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── truncate_str ────────────────────────────────────────────────────
    #[test]
    fn truncate_str_within_limit() {
        assert_eq!(truncate_str("hello", 10), "hello");
    }

    #[test]
    fn truncate_str_over_limit() {
        let result = truncate_str("hello world", 5);
        assert!(result.ends_with('…'));
        assert!(result.len() <= 10); // 5 bytes + ellipsis
    }

    #[test]
    fn truncate_str_empty() {
        assert_eq!(truncate_str("", 10), "");
    }

    // ─── combine_prompt_parts ────────────────────────────────────────────
    #[test]
    fn combine_all_none() {
        assert_eq!(combine_prompt_parts([None, None, None]), None);
    }

    #[test]
    fn combine_some_parts() {
        let result = combine_prompt_parts([
            Some("part1".into()),
            None,
            Some("part2".into()),
        ]);
        assert_eq!(result, Some("part1\n\npart2".into()));
    }

    #[test]
    fn combine_single_part() {
        let result = combine_prompt_parts([Some("only".into()), None]);
        assert_eq!(result, Some("only".into()));
    }

    // ─── format_section ─────────────────────────────────────────────────
    #[test]
    fn format_section_basic() {
        let rows = vec![("user".into(), "hello".into())];
        let result = format_section("Test", &rows, 100);
        assert!(result.starts_with("## Test\n"));
        assert!(result.contains("[user] hello"));
    }

    // ─── format_section_with_authors ────────────────────────────────────
    #[test]
    fn author_tag_with_persona_and_engine() {
        let rows = vec![
            ("assistant".into(), "response".into(), Some("claude-code".into()), Some("Architect Claude".into())),
        ];
        let result = format_section_with_authors("Test", &rows, 400);
        assert!(result.contains("[assistant:Architect Claude (claude-code)]"));
    }

    #[test]
    fn author_tag_engine_only() {
        let rows = vec![
            ("assistant".into(), "response".into(), Some("gemini".into()), None),
        ];
        let result = format_section_with_authors("Test", &rows, 400);
        assert!(result.contains("[assistant (gemini)]"));
    }

    #[test]
    fn author_tag_user_unchanged() {
        let rows = vec![
            ("user".into(), "question".into(), None, None),
        ];
        let result = format_section_with_authors("Test", &rows, 400);
        assert!(result.contains("[user]"));
        assert!(!result.contains("assistant"));
    }

    // ─── Jaccard similarity ─────────────────────────────────────────────
    #[test]
    fn jaccard_identical() {
        assert!((jaccard_similarity("hello world", "hello world") - 1.0).abs() < 0.01);
    }

    #[test]
    fn jaccard_disjoint() {
        assert!(jaccard_similarity("hello world", "foo bar") < 0.01);
    }

    #[test]
    fn jaccard_partial_overlap() {
        let sim = jaccard_similarity("the quick brown fox", "the quick red fox");
        assert!(sim > 0.5 && sim < 1.0);
    }

    #[test]
    fn fold_similar_blocks_removes_duplicates() {
        let mut blocks = vec![
            "user asked about Rust code review".into(),
            "user asked about Rust code review process".into(),
            "completely different topic about Python".into(),
        ];
        fold_similar_blocks(&mut blocks);
        assert!(blocks[1].contains("folded"));
        assert!(!blocks[2].contains("folded"));
    }

    // ─── lighten_markdown ───────────────────────────────────────────────
    #[test]
    fn lighten_strips_bold_italic() {
        let result = lighten_markdown("**bold** and *italic* text");
        assert!(!result.contains("**"));
        assert!(!result.contains("*italic*"));
        assert!(result.contains("bold"));
    }

    #[test]
    fn lighten_preserves_code_blocks() {
        let input = "text\n```rust\nlet **x** = 1;\n```\nmore text";
        let result = lighten_markdown(input);
        assert!(result.contains("let **x** = 1;"));
    }

    // ─── fold_import_block ──────────────────────────────────────────────
    #[test]
    fn fold_imports_large_block() {
        let snippet = "import a\nimport b\nimport c\nimport d\nfn main() {}";
        let folded = fold_import_block(snippet);
        assert!(folded.contains("[4 imports folded]"));
        assert!(folded.contains("fn main()"));
    }

    #[test]
    fn fold_imports_keeps_small_block() {
        let snippet = "import a\nimport b\nfn main() {}";
        let folded = fold_import_block(snippet);
        // 2 imports — not folded (threshold is >2)
        assert!(!folded.contains("folded"));
    }
}
