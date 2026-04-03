use crate::agents::rawq;

use super::utils::fold_import_block;

/// Maximum number of rawq code search results.
const RAWQ_MAX_RESULTS: usize = 5;

/// Keywords that signal code-related intent — rawq is only useful for these.
pub const CODE_SIGNAL_KEYWORDS: &[&str] = &[
    // 한국어
    "파일", "코드", "함수", "구현", "클래스", "구조", "모듈", "타입", "인터페이스",
    "컴포넌트", "변수", "메서드", "에러", "버그", "수정", "리팩", "검색", "찾아",
    // 영어
    "file", "code", "function", "implement", "class", "struct", "module", "type",
    "interface", "component", "variable", "method", "error", "bug", "fix", "refactor",
    "search", "find", "where", "how does",
    // 경로/확장자 패턴
    "src/", "src\\", ".rs", ".ts", ".tsx", ".js", ".py", ".go", ".java",
];

/// Check if a prompt likely needs code context from rawq.
/// Relaxed: returns true for prompts longer than 10 chars (nearly all real prompts).
/// Short prompts (greetings, single words) still skip.
fn prompt_needs_rawq(prompt: &str) -> bool {
    let lower = prompt.to_lowercase();
    // Always include if explicit code signals
    if CODE_SIGNAL_KEYWORDS.iter().any(|kw| lower.contains(kw)) {
        return true;
    }
    // Include for any substantive prompt (> 10 chars, not just a greeting)
    prompt.trim().len() > 10
}

/// Maximum snippet length per rawq result (chars).
const RAWQ_SNIPPET_MAX_CHARS: usize = 300;
/// Minimum confidence threshold for rawq results (post-filter).
const RAWQ_MIN_CONFIDENCE: f64 = 0.4;
/// Lines within this range are considered overlapping and merged.
const RAWQ_DEDUP_LINE_RANGE: usize = 5;

pub fn build_rawq_section(project_path: Option<&str>, prompt: &str) -> Option<String> {
    let path = project_path?;

    if !prompt_needs_rawq(prompt) {
        eprintln!("[context_pack] rawq skipped — no code signal in prompt");
        return None;
    }

    // Skip search if no index exists (empty project, not yet indexed)
    match rawq::index_status(path) {
        Ok(Some(info)) => {
            // info has files/chunks — proceed with search
            eprintln!("[context_pack] rawq index: {} files", info.files);
            if info.files == 0 {
                eprintln!("[context_pack] rawq skipped — index empty (no code files)");
                return None;
            }
        }
        _ => {
            eprintln!("[context_pack] rawq skipped — no index for project");
            return None;
        }
    }

    // Detect prompt characteristics for search strategy
    let is_conceptual = !CODE_SIGNAL_KEYWORDS.iter().any(|kw| prompt.to_lowercase().contains(kw));
    let has_korean = prompt.chars().any(|c| ('\u{AC00}'..='\u{D7AF}').contains(&c));

    let opts = rawq::SearchOptions {
        limit: RAWQ_MAX_RESULTS + 3,
        threshold: 0.3,
        // Korean prompts: skip rerank (causes timeout with Korean tokenization)
        rerank: !has_korean,
        token_budget: None,
        text_weight: Some(if is_conceptual { 0.8 } else { 0.5 }),
        // Korean prompts: force semantic mode (BM25 is weak for Korean)
        rrf_weight: if has_korean { Some(0.9) } else if is_conceptual { Some(0.7) } else { None },
        context_lines: 2,
    };

    match rawq::search_with_options(path, prompt, opts) {
        Ok(mut results) => {
            // Post-processing: filter low confidence
            results.retain(|r| r.confidence >= RAWQ_MIN_CONFIDENCE);

            // Dedup: merge results from same file within ±DEDUP_LINE_RANGE
            results = dedup_rawq_results(results);

            // Sort by confidence descending
            results.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));

            // Take top-K after post-processing
            results.truncate(RAWQ_MAX_RESULTS);

            if results.is_empty() {
                eprintln!("[context_pack] rawq: all results filtered out (low confidence)");
                return None;
            }

            let mut out = String::from("## Code context (rawq)\n");
            for (idx, r) in results.iter().enumerate() {
                let meta = match &r.scope {
                    Some(s) => format!(" ({}, {:.0}%)", s, r.confidence * 100.0),
                    None => format!(" ({:.0}%)", r.confidence * 100.0),
                };

                // Multi-resolution: top 2 = full snippet, next 2 = skeleton, rest = one-line
                let snippet = if idx < 2 {
                    // Full snippet — fold imports, truncate to max
                    let folded = fold_import_block(&r.snippet);
                    if folded.len() > RAWQ_SNIPPET_MAX_CHARS {
                        let end = folded.char_indices()
                            .map(|(i, _)| i)
                            .take_while(|&i| i <= RAWQ_SNIPPET_MAX_CHARS)
                            .last()
                            .unwrap_or(0);
                        format!("{}…", &folded[..end])
                    } else {
                        folded
                    }
                } else if idx < 4 {
                    // Skeleton — first meaningful line only (signature/declaration)
                    r.snippet.lines()
                        .find(|l| {
                            let t = l.trim();
                            !t.is_empty() && !t.starts_with("import ") && !t.starts_with("use ")
                                && !t.starts_with("from ") && !t.starts_with("//") && !t.starts_with("#")
                        })
                        .unwrap_or("")
                        .trim()
                        .to_string()
                } else {
                    // One-line reference
                    String::new()
                };

                if snippet.is_empty() {
                    out.push_str(&format!("\n`{}` L{}{}\n", r.file, r.line, meta));
                } else {
                    out.push_str(&format!("\n`{}` L{}{}:\n{}\n", r.file, r.line, meta, snippet));
                }
            }
            Some(out)
        }
        Err(e) => {
            eprintln!("[context_pack] rawq: {}", e);
            None
        }
    }
}

/// Merge rawq results from the same file within ±N lines.
/// Keeps the entry with higher confidence and merges snippets.
pub(crate) fn dedup_rawq_results(results: Vec<rawq::SearchResult>) -> Vec<rawq::SearchResult> {
    let mut deduped: Vec<rawq::SearchResult> = Vec::new();
    for r in results {
        let merged = deduped.iter_mut().find(|existing| {
            existing.file == r.file
                && (existing.line as isize - r.line as isize).unsigned_abs() <= RAWQ_DEDUP_LINE_RANGE
        });
        if let Some(existing) = merged {
            // Keep higher confidence, merge snippets if distinct
            if r.confidence > existing.confidence {
                existing.confidence = r.confidence;
                existing.scope = r.scope.or(existing.scope.take());
            }
            // Extend snippet if the new one adds info
            if !existing.snippet.contains(&r.snippet) && !r.snippet.contains(&existing.snippet) {
                existing.snippet = format!("{}\n{}", existing.snippet, r.snippet);
            }
        } else {
            deduped.push(r);
        }
    }
    deduped
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── rawq dedup ────────────────────────────────────────────────────
    #[test]
    fn dedup_merges_same_file_nearby_lines() {
        let results = vec![
            rawq::SearchResult { file: "src/main.rs".into(), line: 10, snippet: "fn main()".into(), scope: None, confidence: 0.9 },
            rawq::SearchResult { file: "src/main.rs".into(), line: 12, snippet: "let x = 1;".into(), scope: None, confidence: 0.8 },
        ];
        let deduped = dedup_rawq_results(results);
        assert_eq!(deduped.len(), 1);
        assert!(deduped[0].confidence >= 0.9); // keeps higher
        assert!(deduped[0].snippet.contains("fn main()"));
    }

    #[test]
    fn dedup_keeps_distant_lines() {
        let results = vec![
            rawq::SearchResult { file: "src/main.rs".into(), line: 10, snippet: "a".into(), scope: None, confidence: 0.9 },
            rawq::SearchResult { file: "src/main.rs".into(), line: 100, snippet: "b".into(), scope: None, confidence: 0.8 },
        ];
        let deduped = dedup_rawq_results(results);
        assert_eq!(deduped.len(), 2);
    }

    #[test]
    fn dedup_keeps_different_files() {
        let results = vec![
            rawq::SearchResult { file: "a.rs".into(), line: 10, snippet: "a".into(), scope: None, confidence: 0.9 },
            rawq::SearchResult { file: "b.rs".into(), line: 10, snippet: "b".into(), scope: None, confidence: 0.8 },
        ];
        let deduped = dedup_rawq_results(results);
        assert_eq!(deduped.len(), 2);
    }
}
