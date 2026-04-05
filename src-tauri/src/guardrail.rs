//! Runtime guardrails for ContextPack size, section truncation, and execution logging.
//! All values are character counts (not tokens).
//! Token estimation: ~4 ASCII chars ≈ 1 token, ~1.5 CJK chars ≈ 1 token.

// ─── Section limits (characters) ─────────────────────────────────────────────

/// Maximum total system prompt size after all sections are assembled.
pub const MAX_TOTAL_PROMPT: usize = 60_000;

/// Per-section character limits for ContextPack sections.
/// Priority layers (structured) get full budget; auxiliary layers get smaller caps.
pub const MAX_SKILLS_SECTION: usize = 8_000;
pub const MAX_RAWQ_SECTION: usize = 4_000;
pub const MAX_CROSS_SESSION_SECTION: usize = 4_000; // tuned down from 6k — often repetitive
pub const MAX_CONTEXT_SECTION: usize = 6_000;       // tuned down from 8k — recent window is already compact
pub const MAX_PLAN_SECTION: usize = 2_000;
pub const MAX_FINDINGS_SECTION: usize = 3_000;
pub const MAX_ARTIFACTS_SECTION: usize = 2_000;
/// Dedicated caps for memory layers (don't reuse MAX_CONTEXT_SECTION)
pub const MAX_RETRIEVAL_SECTION: usize = 4_000;      // past conversation chunks — focused, not large
pub const MAX_COMPRESSED_MEMORY_SECTION: usize = 5_000; // topic-based summaries — detailed enough to preserve decisions

// ─── Execution defaults ──────────────────────────────────────────────────────

/// Default subprocess timeout in seconds (applied at the OS level via wait).
/// Currently advisory — actual enforcement depends on the CLI tool's own timeout.
#[allow(dead_code)]
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

// ─── Dynamic budget allocation ─────────────────────────────────────────────

/// Section budget request for dynamic allocation
pub struct SectionBudget {
    pub name: &'static str,
    /// Actual content length (0 if section is empty)
    pub content_len: usize,
    /// Relative importance weight (higher = more budget)
    pub weight: f32,
    /// Minimum guaranteed characters (even under pressure)
    pub min_chars: usize,
    /// Maximum cap (prevent one section from dominating)
    pub max_chars: usize,
}

/// Allocate budget dynamically based on actual content sizes.
///
/// Empty sections return 0 budget (released to others).
/// Non-empty sections get min_chars guaranteed + proportional share of remainder.
pub fn allocate_budgets(total: usize, sections: &[SectionBudget]) -> Vec<(&'static str, usize)> {
    // Phase 1: identify non-empty sections, allocate minimums
    let active: Vec<(usize, &SectionBudget)> = sections.iter()
        .enumerate()
        .filter(|(_, s)| s.content_len > 0)
        .collect();

    let total_min: usize = active.iter().map(|(_, s)| s.min_chars).sum();
    let remaining = total.saturating_sub(total_min);

    // Phase 2: distribute remaining by weight (proportional)
    let total_weight: f32 = active.iter().map(|(_, s)| s.weight).sum();

    let mut result: Vec<(&'static str, usize)> = sections.iter()
        .map(|s| (s.name, 0usize))
        .collect();

    if total_weight <= 0.0 {
        return result;
    }

    for (idx, section) in &active {
        let base = section.min_chars;
        let share = if total_weight > 0.0 {
            ((remaining as f32) * section.weight / total_weight) as usize
        } else { 0 };
        let allocated = (base + share).min(section.max_chars).min(section.content_len + 200); // +200 for headers
        result[*idx].1 = allocated;
    }

    result
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

// ─── Token estimation ───────────────────────────────────────────────────────

/// Returns true if the character falls in CJK/Hangul/Kana Unicode ranges.
/// These scripts use significantly more tokens per character than ASCII (~1.5 chars ≈ 1 token).
fn is_cjk(c: char) -> bool {
    matches!(c,
        '\u{AC00}'..='\u{D7AF}'   // Hangul Syllables
        | '\u{1100}'..='\u{11FF}' // Hangul Jamo
        | '\u{4E00}'..='\u{9FFF}' // CJK Unified Ideographs
        | '\u{3400}'..='\u{4DBF}' // CJK Extension A
        | '\u{3040}'..='\u{309F}' // Hiragana
        | '\u{30A0}'..='\u{30FF}' // Katakana
    )
}

/// Estimate token count for a text string, accounting for CJK/Hangul density.
///
/// - ASCII/Latin: ~4 chars = 1 token
/// - CJK/Hangul/Kana: ~1.5 chars = 1 token (these map to more tokens per character)
///
/// Formula: `(ascii_chars / 4) + (cjk_chars * 2 / 3)`
pub fn estimate_tokens(text: &str) -> usize {
    let mut ascii_chars: usize = 0;
    let mut cjk_chars: usize = 0;

    for c in text.chars() {
        if is_cjk(c) {
            cjk_chars += 1;
        } else {
            ascii_chars += 1;
        }
    }

    (ascii_chars / 4) + (cjk_chars * 2 / 3)
}

/// Log an agent execution result to stderr (visible in `tauri dev` console).
///
/// Note: `prompt_len` is byte length from `.len()`, so we use the simple `/4`
/// heuristic here. For accurate CJK-aware estimation, use `estimate_tokens()` directly.
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

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_estimate_tokens_pure_ascii() {
        // "Hello world" = 11 chars → 11/4 = 2
        assert_eq!(estimate_tokens("Hello world"), 2);
        // Longer ASCII: 20 chars → 5
        assert_eq!(estimate_tokens("abcdefghijklmnopqrst"), 5);
    }

    #[test]
    fn test_estimate_tokens_pure_korean() {
        // "안녕하세요" = 5 Hangul chars → 5*2/3 = 3
        assert_eq!(estimate_tokens("안녕하세요"), 3);
        // "한국어" = 3 Hangul chars → 3*2/3 = 2
        assert_eq!(estimate_tokens("한국어"), 2);
    }

    #[test]
    fn test_estimate_tokens_pure_cjk() {
        // "漢字テスト" = 2 CJK + 3 Katakana = 5 CJK chars → 5*2/3 = 3
        assert_eq!(estimate_tokens("漢字テスト"), 3);
    }

    #[test]
    fn test_estimate_tokens_mixed() {
        // "Hello 안녕" = 6 ASCII (incl space) + 2 Hangul → 6/4 + 2*2/3 = 1 + 1 = 2
        assert_eq!(estimate_tokens("Hello 안녕"), 2);
        // "test한국어test" = 8 ASCII + 3 Hangul → 8/4 + 3*2/3 = 2 + 2 = 4
        assert_eq!(estimate_tokens("test한국어test"), 4);
    }

    #[test]
    fn test_estimate_tokens_empty() {
        assert_eq!(estimate_tokens(""), 0);
    }

    #[test]
    fn test_is_cjk_ranges() {
        // Hangul Syllables
        assert!(is_cjk('가')); // U+AC00
        assert!(is_cjk('힣')); // U+D7A3
        // Hangul Jamo
        assert!(is_cjk('\u{1100}'));
        // CJK Unified Ideographs
        assert!(is_cjk('漢')); // U+6F22
        // Hiragana
        assert!(is_cjk('あ')); // U+3042
        // Katakana
        assert!(is_cjk('ア')); // U+30A2
        // ASCII - not CJK
        assert!(!is_cjk('A'));
        assert!(!is_cjk(' '));
        // Emoji - not CJK
        assert!(!is_cjk('🎉'));
    }
}
