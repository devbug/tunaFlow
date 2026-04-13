//! Core types and participant helpers for RT execution.

use serde::{Deserialize, Serialize};

/// Real-time participant execution status — emitted at actual subprocess lifecycle points.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RtParticipantStatus {
    pub conversation_id: String,
    pub name: String,
    pub engine: String,
    pub model: Option<String>,
    pub round: u32,
    pub status: String,
    #[serde(default)]
    pub blind: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundtableParticipant {
    pub name: String,
    pub model: Option<String>,
    pub engine: Option<String>,
    /// Blind verifier — receives only the topic, no prior/current transcript.
    #[serde(default)]
    pub blind: bool,
    /// RT role — affects output cap and prompt directive.
    #[serde(default)]
    pub role: Option<String>,
    /// Explicit output token cap. If not set, derived from role.
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

/// Payload for real-time streaming chunks during RT participant execution.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RtChunkPayload {
    pub message_id: String,
    pub conversation_id: String,
    pub text: String,
}

pub struct ParticipantResult {
    pub name: String,
    pub engine: String,
    pub model: Option<String>,
    pub content: String,
    pub status: String,
    pub cost_usd: f64,
    pub in_tokens: i64,
    pub out_tokens: i64,
    pub prompt_sources: String,
    pub blind: bool,
    /// Session ID from the engine — used for resume_token in next round.
    pub session_id: Option<String>,
}

/// Controls how participants see context within and across rounds.
#[derive(Clone, Copy)]
pub enum RoundStrategy {
    Sequential,
    Deliberative,
}

pub type SessionMap = std::collections::HashMap<String, String>;

// ─── Participant helpers ───────────────────────────────────────────────────────

/// Build identity string for a RT participant.
pub fn participant_identity(p: &RoundtableParticipant) -> String {
    let engine = p.engine.as_deref().unwrap_or("claude");
    let mut lines = vec![format!("## Your Identity in this Roundtable\n\nYou are **{}** (engine: {}).", p.name, engine)];

    if let Some(role) = &p.role {
        let guidance = role_guidance(role);
        if guidance.is_empty() {
            lines.push(format!("Your role: {}.", role));
        } else {
            lines.push(format!("Your role: {}.\n{}", role, guidance));
        }
    }
    if p.blind {
        lines.push("You are a blind verifier — you have NOT seen other participants' responses. Judge independently.".into());
    }
    lines.push("Do NOT claim to be a different agent. Do NOT use other participants' names as your own.".into());
    lines.join("\n")
}

/// Role-specific behavioral guidance for RT participants.
fn role_guidance(role: &str) -> &'static str {
    match role {
        "proposer" => {
            "**Proposer guidelines:**\n\
             - Form your analysis independently — do not converge toward other participants' views.\n\
             - Lead with your conclusion, then provide supporting evidence.\n\
             - Flag assumptions explicitly; do not treat them as facts."
        }
        "reviewer" | "critic" => {
            "**Reviewer guidelines:**\n\
             - Evaluate across 4 dimensions: plan_coverage (completeness), code_quality (bugs/security), test_coverage, convention.\n\
             - Score each dimension 1–5. Include the scores in your response.\n\
             - For each finding, include: file path, line range (if applicable), defect type, severity.\n\
             - Put improvement suggestions in a separate `recommendations` section, not in `findings`.\n\
             - If verdict is `fail`, list failed subtask numbers as: `failed_subtask_ids: [N, M]`."
        }
        "verifier" | "judge" => {
            "**Verifier guidelines:**\n\
             - Focus on concrete evidence — do not rely on other participants' assessments.\n\
             - State your verdict first, then justify with specific references.\n\
             - Distinguish clearly between observed facts and inferences."
        }
        "synthesizer" | "lead" => {
            "**Synthesizer guidelines:**\n\
             - Organize findings into three sections: `consensus`, `contested`, `dissent`.\n\
             - Preserve each reviewer's original verdict — do not overwrite it.\n\
             - Final verdict must be consistent with the vote tally across participants.\n\
             - If no clear consensus exists, state that explicitly rather than forcing agreement."
        }
        _ => "",
    }
}

/// Get the effective output token cap for a participant based on role.
pub fn effective_max_tokens(p: &RoundtableParticipant) -> Option<u32> {
    if let Some(cap) = p.max_tokens {
        return Some(cap);
    }
    match p.role.as_deref() {
        Some("proposer") => Some(1200),
        Some("reviewer" | "critic") => Some(900),
        Some("verifier" | "judge") => Some(800),
        Some("synthesizer" | "lead") => Some(2000),
        _ => None,
    }
}

/// Build output cap directive to prepend to prompt.
pub fn output_cap_directive(max_tokens: Option<u32>) -> String {
    match max_tokens {
        Some(cap) => format!(
            "[Output limit: Keep your response under approximately {} tokens. Be concise and focused.]\n\n",
            cap
        ),
        None => String::new(),
    }
}

// ─── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_participant(name: &str, engine: Option<&str>, blind: bool, role: Option<&str>) -> RoundtableParticipant {
        RoundtableParticipant {
            name: name.into(),
            model: None,
            engine: engine.map(|s| s.into()),
            blind,
            role: role.map(|s| s.into()),
            max_tokens: None,
        }
    }

    #[test]
    fn identity_basic() {
        let p = make_participant("Alice", Some("claude"), false, None);
        let id = participant_identity(&p);
        assert!(id.contains("Alice"));
        assert!(id.contains("claude"));
        assert!(!id.contains("blind verifier"));
    }

    #[test]
    fn identity_blind_verifier() {
        let p = make_participant("Bob", Some("gemini"), true, Some("verifier"));
        let id = participant_identity(&p);
        assert!(id.contains("Bob"));
        assert!(id.contains("blind verifier"));
        assert!(id.contains("verifier"));
    }

    #[test]
    fn identity_with_role() {
        let p = make_participant("Charlie", Some("codex"), false, Some("proposer"));
        let id = participant_identity(&p);
        assert!(id.contains("proposer"));
    }

    #[test]
    fn identity_default_engine() {
        let p = make_participant("Default", None, false, None);
        let id = participant_identity(&p);
        assert!(id.contains("claude"));
    }

    #[test]
    fn identity_has_anti_impersonation_rule() {
        let p = make_participant("X", Some("gemini"), false, None);
        let id = participant_identity(&p);
        assert!(id.contains("Do NOT claim to be a different agent"));
    }

    #[test]
    fn max_tokens_explicit_override() {
        let mut p = make_participant("A", None, false, Some("proposer"));
        p.max_tokens = Some(2000);
        assert_eq!(effective_max_tokens(&p), Some(2000));
    }

    #[test]
    fn max_tokens_proposer_default() {
        let p = make_participant("A", None, false, Some("proposer"));
        assert_eq!(effective_max_tokens(&p), Some(1200));
    }

    #[test]
    fn max_tokens_reviewer_default() {
        let p = make_participant("A", None, false, Some("reviewer"));
        assert_eq!(effective_max_tokens(&p), Some(900));
    }

    #[test]
    fn max_tokens_critic_alias() {
        let p = make_participant("A", None, false, Some("critic"));
        assert_eq!(effective_max_tokens(&p), Some(900));
    }

    #[test]
    fn max_tokens_verifier_default() {
        let p = make_participant("A", None, false, Some("verifier"));
        assert_eq!(effective_max_tokens(&p), Some(800));
    }

    #[test]
    fn max_tokens_synthesizer_default() {
        let p = make_participant("A", None, false, Some("synthesizer"));
        assert_eq!(effective_max_tokens(&p), Some(2000));
    }

    #[test]
    fn max_tokens_lead_alias() {
        let p = make_participant("A", None, false, Some("lead"));
        assert_eq!(effective_max_tokens(&p), Some(2000));
    }

    #[test]
    fn max_tokens_no_role_none() {
        let p = make_participant("A", None, false, None);
        assert_eq!(effective_max_tokens(&p), None);
    }

    #[test]
    fn max_tokens_unknown_role_none() {
        let p = make_participant("A", None, false, Some("custom-role"));
        assert_eq!(effective_max_tokens(&p), None);
    }

    #[test]
    fn cap_directive_with_cap() {
        let d = output_cap_directive(Some(800));
        assert!(d.contains("800 tokens"));
        assert!(d.contains("Output limit"));
    }

    #[test]
    fn cap_directive_without_cap() {
        let d = output_cap_directive(None);
        assert!(d.is_empty());
    }
}
