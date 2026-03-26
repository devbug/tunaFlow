//! Engine model catalog — curated lists of available models per engine.
//!
//! Source: curated (hardcoded). CLI engines do not expose model list commands.
//! When dynamic listing becomes available, `source` will change to "dynamic".

use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EngineModel {
    pub id: String,
    pub label: String,
    pub engine: String,
    pub recommended: bool,
    pub source: String,
}

/// Return the full model catalog for all engines.
#[tauri::command]
pub fn list_engine_models() -> Vec<EngineModel> {
    let mut catalog = Vec::new();

    // Claude Code (Anthropic) — aliases accepted by `claude --model`
    for (id, label, rec) in [
        ("claude-sonnet-4-6", "Sonnet 4.6", false),
        ("claude-opus-4-6", "Opus 4.6", false),
        ("claude-haiku-4-5-20251001", "Haiku 4.5", true),
        ("sonnet", "Sonnet (latest)", false),
        ("opus", "Opus (latest)", false),
        ("haiku", "Haiku (latest)", false),
    ] {
        catalog.push(EngineModel {
            id: id.into(), label: label.into(), engine: "claude".into(),
            recommended: rec, source: "curated".into(),
        });
    }

    // Codex (OpenAI) — model names accepted by `codex --model`
    // Note: some models require API key (not ChatGPT account)
    for (id, label, rec) in [
        ("o3-mini", "o3-mini", true),
        ("gpt-4o", "GPT-4o", false),
        ("gpt-4o-mini", "GPT-4o Mini", false),
        ("o3", "o3 (API key only)", false),
        ("o4-mini", "o4-mini (API key only)", false),
    ] {
        catalog.push(EngineModel {
            id: id.into(), label: label.into(), engine: "codex".into(),
            recommended: rec, source: "curated".into(),
        });
    }

    // Gemini CLI — model names accepted by `gemini --model`
    for (id, label, rec) in [
        ("gemini-2.5-pro", "Gemini 2.5 Pro", true),
        ("gemini-2.5-flash", "Gemini 2.5 Flash", false),
        ("gemini-2.0-flash", "Gemini 2.0 Flash", false),
    ] {
        catalog.push(EngineModel {
            id: id.into(), label: label.into(), engine: "gemini".into(),
            recommended: rec, source: "curated".into(),
        });
    }

    // OpenCode — model names accepted by `opencode --model`
    for (id, label, rec) in [
        ("anthropic:claude-sonnet-4-6", "Claude Sonnet 4.6", true),
        ("openai:gpt-4.1", "GPT-4.1", false),
    ] {
        catalog.push(EngineModel {
            id: id.into(), label: label.into(), engine: "opencode".into(),
            recommended: rec, source: "curated".into(),
        });
    }

    catalog
}
