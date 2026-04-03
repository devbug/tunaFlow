mod context_loading;
mod prompt_assembly;
mod persistence;

// Re-export everything so external `use crate::commands::agents_helpers::send_common::*` still works
#[allow(unused_imports)]
pub use context_loading::{ContextData, load_context_data, load_project_path, build_lite_enriched_prompt};
#[allow(unused_imports)]
pub use prompt_assembly::{assemble_prompt, build_normalized_prompt, build_normalized_prompt_with_budget};
#[allow(unused_imports)]
pub use persistence::{persist_user_message, PreparedRun, prepare_engine_run, finalize_engine_run, AgentRunResult, persist_assistant_message, persist_assistant_message_with_id};

pub use super::identity::*;
#[allow(unused_imports)]
pub use super::trace_log::ContextPackMeta;

#[cfg(test)]
mod tests {
    use super::*;

    // ─── assemble_prompt (pure function) ────────────────────────────────

    fn empty_context_data() -> ContextData {
        ContextData {
            conversation_id: "test-conv".into(),
            project_path: Some("/tmp/test".into()),
            prompt: "hello".into(),
            is_branch: false,
            has_active_plan: false,
            current_messages: vec![],
            parent_messages: vec![],
            plan_section: None,
            plan_document: None,
            findings_section: None,
            artifacts_section: None,
            retrieval_chunks: vec![],
            compressed_memory: None,
            cross_session_data: vec![],
            thread_inheritance: None,
            agent_role_doc: None,
            active_skills: vec![],
            cross_session_ids: vec![],
            persona_fragment: None,
            context_mode_override: None,
            context_budget_cap: None,
        }
    }

    #[test]
    fn assemble_empty_data_returns_prompt_only() {
        let data = empty_context_data();
        let (assembled, _sys_ctx, meta) = assemble_prompt(&data, None);
        assert!(assembled.contains("hello"));
        // project section should be present
        assert!(meta.sections.contains(&"project".to_string()));
    }

    #[test]
    fn assemble_with_plan_includes_plan_section() {
        let mut data = empty_context_data();
        data.plan_section = Some("## Active Plan\n\n### Migration\n\n**Progress:** 2/5 done".into());
        data.context_mode_override = Some("standard".into());
        let (_, _, meta) = assemble_prompt(&data, None);
        assert!(meta.sections.contains(&"plan".to_string()));
    }

    #[test]
    fn auto_mode_short_prompt_selects_lite() {
        let mut data = empty_context_data();
        data.prompt = "ㅇㅇ".into();
        let (_, _, meta) = assemble_prompt(&data, None);
        assert!(meta.mode.contains("Lite"), "expected Lite mode, got: {}", meta.mode);
    }

    #[test]
    fn auto_mode_with_skills_pushes_toward_full() {
        let mut data = empty_context_data();
        data.active_skills = vec!["a".into(), "b".into(), "c".into()]; // +2
        data.cross_session_ids = vec!["other-conv".into()];            // +1  → total ≥ 3
        data.prompt = "코드를 리팩토링해주세요. 이 함수가 너무 길어요.".into();
        let (_, _, meta) = assemble_prompt(&data, None);
        assert!(meta.mode.contains("Full"), "expected Full mode, got: {}", meta.mode);
    }
}
