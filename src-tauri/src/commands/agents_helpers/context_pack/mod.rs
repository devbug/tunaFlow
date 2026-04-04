mod utils;
mod rawq_section;
mod section_builders;
mod system_prompt;

/// Controls how much context is assembled into the system prompt.
///
/// | Mode     | Includes                                    | Use case                     |
/// |----------|---------------------------------------------|------------------------------|
/// | Lite     | project path + base prompt + context summary | 일반 대화, 단순 질문          |
/// | Standard | Lite + plan + findings + artifacts           | follow-up, branch, plan 작업 |
/// | Full     | Standard + rawq + cross-session + skills     | 코드 분석, 전체 검토          |
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd)]
pub enum ContextMode {
    Lite,
    Standard,
    Full,
}

#[allow(unused_imports)]
pub use utils::combine_prompt_parts;
#[allow(unused_imports)]
pub use rawq_section::{build_rawq_section, CODE_SIGNAL_KEYWORDS};
#[allow(unused_imports)]
pub use section_builders::{
    build_skills_section,
    build_chops_section,
    build_crg_section,
    build_cross_session_section,
    build_context_summary,
    build_context_summary_with_authors,
    build_artifact_handoff_section,
    build_findings_section,
    build_plan_section,
    resolve_plan_conversation_id,
    build_lite_context_prompt,
    build_thread_inheritance_section,
    build_rt_inheritance_section,
    LITE_CONTEXT_MESSAGES_LIMIT,
};
#[allow(unused_imports)]
pub use system_prompt::assemble_system_prompt;
