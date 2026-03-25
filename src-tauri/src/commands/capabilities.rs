//! Unified capability registry — aggregates skills, local tools, and MCP tools
//! into a single queryable list.
//!
//! Sources:
//!   1. File-based skills (`~/.tunaflow/skills/{name}/SKILL.md`)
//!   2. MCP tool definitions (`~/.tunaflow/mcp/{name}.json`)
//!   3. Local tools (future — project-local executables)
//!
//! No DB tables needed — capabilities are derived at runtime.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::errors::AppError;

/// A unified capability entry visible to the frontend.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToolCapability {
    /// Unique name within its kind (e.g. skill folder name, MCP tool id)
    pub name: String,
    /// "skill" | "local_tool" | "mcp_tool"
    pub kind: String,
    /// Human-readable description
    pub description: String,
    /// Where this capability was loaded from (e.g. file path, MCP server URL)
    pub source: String,
    /// Whether the tool is stateful (maintains server-side state across calls)
    pub stateful: bool,
}

// ─── MCP tool definition format ──────────────────────────────────────────────

/// JSON schema for `~/.tunaflow/mcp/{name}.json`.
///
/// Minimal format — just enough to register the tool in the capability list.
/// Actual invocation protocol is deferred until a real MCP client is needed.
///
/// Example file `~/.tunaflow/mcp/web-search.json`:
/// ```json
/// {
///   "description": "Search the web via Brave Search API",
///   "endpoint": "http://localhost:3100",
///   "stateful": false
/// }
/// ```
#[derive(Debug, Deserialize)]
struct McpToolDef {
    description: String,
    #[serde(default)]
    endpoint: Option<String>,
    #[serde(default)]
    stateful: bool,
}

/// MCP definitions directory: `~/.tunaflow/mcp/`
fn mcp_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let home = std::env::var("USERPROFILE").ok();
    #[cfg(not(target_os = "windows"))]
    let home = std::env::var("HOME").ok();
    home.map(|h| PathBuf::from(h).join(".tunaflow").join("mcp"))
}

/// Load MCP tool definitions from `~/.tunaflow/mcp/*.json`.
fn load_mcp_tools() -> Vec<ToolCapability> {
    let base = match mcp_dir() {
        Some(d) if d.is_dir() => d,
        _ => return Vec::new(),
    };

    let Ok(entries) = fs::read_dir(&base) else {
        return Vec::new();
    };

    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                return None;
            }
            let raw = fs::read_to_string(&path).ok()?;
            let def: McpToolDef = serde_json::from_str(&raw).ok()?;
            let name = path
                .file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();
            let source = def
                .endpoint
                .unwrap_or_else(|| format!("~/.tunaflow/mcp/{}.json", name));
            Some(ToolCapability {
                name,
                kind: "mcp_tool".into(),
                description: def.description,
                source,
                stateful: def.stateful,
            })
        })
        .collect()
}

// ─── Registry command ────────────────────────────────────────────────────────

/// Return all known capabilities across all sources.
#[tauri::command]
pub fn list_capabilities() -> Result<Vec<ToolCapability>, AppError> {
    let mut caps: Vec<ToolCapability> = Vec::new();

    // Source 1: file-based skills
    let skills = super::skills::list_skills().unwrap_or_default();
    for skill in skills {
        caps.push(ToolCapability {
            name: skill.name,
            kind: "skill".into(),
            description: skill.description,
            source: "~/.tunaflow/skills".into(),
            stateful: false,
        });
    }

    // Source 2: MCP tool definitions
    caps.extend(load_mcp_tools());

    // Source 3: local tools (future — project-local executables)

    caps.sort_by(|a, b| a.kind.cmp(&b.kind).then(a.name.cmp(&b.name)));
    Ok(caps)
}
