//! Low-level utilities — string truncation, embedding serialization, content classification.

/// Detect workflow auto-generated prompts that pollute vector search.
/// These are template messages from tunaFlow UI, not user conversations.
pub(super) fn is_workflow_prompt(content: &str) -> bool {
    content.starts_with("### 🔧") || content.starts_with("### 📋") || content.starts_with("### 🔍")
        || content.starts_with("### 🔄") || content.starts_with("### ✏") || content.starts_with("### 💬")
        || content.starts_with("### 📝") || content.starts_with("### 📌")
        || content.starts_with("┌─") // legacy ASCII box prompts
        || content.contains("<!-- tunaflow:review-verdict -->")
        || content.contains("<!-- tunaflow:impl-plan -->")
        || content.contains("<!-- tunaflow:impl-complete -->")
}

/// Format author label for embedding prefix: "persona · engine" or "assistant"
pub(super) fn format_author_label(engine: &str, persona: &str) -> String {
    if !persona.is_empty() && !engine.is_empty() {
        format!("{} · {}", persona, engine)
    } else if !engine.is_empty() {
        engine.to_string()
    } else {
        "assistant".to_string()
    }
}

pub fn truncate_str(s: &str, max_chars: usize) -> String {
    if s.len() <= max_chars {
        return s.to_string();
    }
    let end = s
        .char_indices()
        .take_while(|&(i, _)| i <= max_chars)
        .last()
        .map_or(0, |(i, _)| i);
    format!("{}…", &s[..end])
}

pub fn embedding_to_blob(embedding: &[f32]) -> Vec<u8> {
    let mut blob = Vec::with_capacity(embedding.len() * 4);
    for &val in embedding {
        blob.extend_from_slice(&val.to_le_bytes());
    }
    blob
}

pub(super) fn blob_to_embedding(blob: &[u8]) -> Option<Vec<f32>> {
    // Dynamic dimension: accept any valid f32 blob (must be multiple of 4 bytes)
    if blob.len() % 4 != 0 || blob.is_empty() {
        return None;
    }
    let dim = blob.len() / 4;
    let mut vec = Vec::with_capacity(dim);
    for chunk in blob.chunks_exact(4) {
        vec.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    Some(vec)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_DIM: usize = 1024;

    #[test]
    fn embedding_blob_roundtrip() {
        let original: Vec<f32> = (0..TEST_DIM).map(|i| i as f32 * 0.01).collect();
        let blob = embedding_to_blob(&original);
        assert_eq!(blob.len(), TEST_DIM * 4);
        let recovered = blob_to_embedding(&blob).unwrap();
        assert_eq!(recovered.len(), TEST_DIM);
        for i in 0..TEST_DIM {
            assert!((original[i] - recovered[i]).abs() < 1e-6);
        }
    }

    #[test]
    fn blob_wrong_size_returns_none() {
        let blob = vec![0u8; 3]; // not multiple of 4
        assert!(blob_to_embedding(&blob).is_none());
    }

    #[test]
    fn truncate_short_string() {
        assert_eq!(truncate_str("hello", 10), "hello");
    }

    #[test]
    fn truncate_long_string() {
        let long = "a".repeat(500);
        let result = truncate_str(&long, 100);
        assert!(result.len() <= 110);
        assert!(result.ends_with('…'));
    }

    #[test]
    fn workflow_prompt_emoji_headers() {
        assert!(is_workflow_prompt("### 🔧 구현 시작\n..."));
        assert!(is_workflow_prompt("### 📋 Plan 요약\n..."));
        assert!(is_workflow_prompt("### 🔍 검색 결과\n..."));
        assert!(is_workflow_prompt("### 🔄 Rework 지시\n..."));
    }

    #[test]
    fn workflow_prompt_legacy_ascii() {
        assert!(is_workflow_prompt("┌─ Implementation Report ─┐\n..."));
    }

    #[test]
    fn workflow_prompt_html_markers() {
        assert!(is_workflow_prompt("verdict <!-- tunaflow:review-verdict --> content"));
        assert!(is_workflow_prompt("plan <!-- tunaflow:impl-plan --> json"));
        assert!(is_workflow_prompt("done <!-- tunaflow:impl-complete -->"));
    }

    #[test]
    fn workflow_prompt_normal_text_false() {
        assert!(!is_workflow_prompt("How do I implement authentication?"));
        assert!(!is_workflow_prompt("The database schema needs updating"));
        assert!(!is_workflow_prompt(""));
    }

    #[test]
    fn embedding_blob_zeros() {
        let zeros: Vec<f32> = vec![0.0; TEST_DIM];
        let blob = embedding_to_blob(&zeros);
        let recovered = blob_to_embedding(&blob).unwrap();
        assert!(recovered.iter().all(|&v| v == 0.0));
    }

    #[test]
    fn embedding_blob_negative_values() {
        let negatives: Vec<f32> = (0..TEST_DIM).map(|i| -(i as f32) * 0.1).collect();
        let blob = embedding_to_blob(&negatives);
        let recovered = blob_to_embedding(&blob).unwrap();
        for i in 0..TEST_DIM {
            assert!((negatives[i] - recovered[i]).abs() < 1e-6);
        }
    }

    #[test]
    fn blob_empty_returns_none() {
        assert!(blob_to_embedding(&[]).is_none());
    }

    #[test]
    fn truncate_empty_string() {
        assert_eq!(truncate_str("", 100), "");
    }

    #[test]
    fn truncate_exact_limit() {
        let s = "hello";
        assert_eq!(truncate_str(s, 5), "hello");
    }

    #[test]
    fn truncate_multibyte_utf8() {
        let s = "한글테스트문자열이것은긴문자열입니다";
        let result = truncate_str(s, 10);
        assert!(result.is_char_boundary(result.len().saturating_sub(3)) || result.ends_with('…'));
    }

    #[test]
    fn format_author_label_full() {
        assert_eq!(format_author_label("claude", "Architect"), "Architect · claude");
    }

    #[test]
    fn format_author_label_engine_only() {
        assert_eq!(format_author_label("gemini", ""), "gemini");
    }

    #[test]
    fn format_author_label_fallback() {
        assert_eq!(format_author_label("", ""), "assistant");
    }
}
