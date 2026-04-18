//! Engine model discovery — dynamic detection + fallback registry.
//!
//! Discovers available models from each engine's local sources:
//! - **Codex**: reads `~/.codex/models_cache.json`
//! - **Gemini**: reads constants from installed `@google/gemini-cli-core` npm package
//! - **Claude**: scans the native `claude` binary for embedded model ID strings
//!   (the CLI itself hardcodes `claude-opus-*`/`claude-sonnet-*`/`claude-haiku-*`
//!   IDs as plain ASCII text — same list its own `/model` picker uses).
//!   Auto-updater symlink keeps this fresh without user action.
//! - **OpenCode**: fallback static list
//!
//! Results are cached in-process with TTL. Invalidated by `refresh_engine_models`.

use serde::Serialize;
use std::collections::{BTreeSet, HashMap};
use parking_lot::Mutex;
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime};

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EngineModel {
    pub id: String,
    pub label: String,
    pub engine: String,
    pub recommended: bool,
    pub source: String,
}

struct CacheEntry {
    models: Vec<String>,
    source: String,
    at: Instant,
    /// Path + mtime of the binary that produced this cache. When the binary
    /// is updated (symlink switch or in-place), mtime changes and the cache
    /// is invalidated even before the TTL expires. Only set by discoverers
    /// that scan a binary (claude); None for config-file-based discovery.
    binary_stamp: Option<(PathBuf, SystemTime)>,
}

// ─── Global cache ────────────────────────────────────────────────────────────

static CACHE_TTL: Duration = Duration::from_secs(3600);

lazy_static::lazy_static! {
    static ref MODEL_CACHE: Mutex<HashMap<String, CacheEntry>> = Mutex::new(HashMap::new());
}

// ─── Fallback registry ──────────────────────────────────────────────────────

fn fallback_models(engine: &str) -> Vec<(&'static str, &'static str, bool)> {
    match engine {
        // Fallback only — only used when `discover_claude` fails (e.g. claude
        // CLI not installed). Keep minimal + alias-based so "latest" always
        // works even without a known version list. When discovery succeeds the
        // binary-extracted list is authoritative (with aliases prepended).
        "claude" => vec![
            ("opus", "Opus (latest)", true),
            ("sonnet", "Sonnet (latest)", false),
            ("haiku", "Haiku (latest)", false),
        ],
        "codex" => vec![
            ("gpt-5.4-mini", "GPT-5.4 Mini", true),
            ("gpt-5.4", "GPT-5.4", false),
            ("gpt-5.3-codex", "GPT-5.3 Codex", false),
            ("gpt-5.2-codex", "GPT-5.2 Codex", false),
            ("gpt-5.1-codex-mini", "GPT-5.1 Codex Mini", false),
            ("o3-mini", "o3-mini", false),
        ],
        "gemini" => vec![
            ("auto", "Auto (Gemini CLI default)", true),
            ("gemini-2.5-pro", "Gemini 2.5 Pro", false),
            ("gemini-2.5-flash", "Gemini 2.5 Flash", false),
            ("gemini-2.5-flash-lite", "Gemini 2.5 Flash Lite", false),
            ("gemini-3-pro-preview", "Gemini 3 Pro (preview, 용량 미보장)", false),
            ("gemini-3-flash-preview", "Gemini 3 Flash (preview, 용량 미보장)", false),
            ("gemini-3.1-pro-preview", "Gemini 3.1 Pro (preview, 용량 미보장)", false),
            ("gemini-3.1-flash-lite-preview", "Gemini 3.1 Flash Lite (preview, 용량 미보장)", false),
        ],
        "ollama" => vec![
            ("qwen3:8b", "Qwen 3 8B", true),
            ("llama3.3:latest", "Llama 3.3", false),
            ("gemma3:12b", "Gemma 3 12B", false),
            ("phi-4:latest", "Phi-4", false),
        ],
        "lmstudio" => vec![],  // LM Studio models are always discovered live
        _ => vec![],
    }
}

// ─── Discovery functions ────────────────────────────────────────────────────

/// Codex: read `~/.codex/models_cache.json`
fn discover_codex() -> Option<Vec<String>> {
    let cache_path = dirs::home_dir()?.join(".codex").join("models_cache.json");
    if !cache_path.exists() {
        return None;
    }
    let text = std::fs::read_to_string(&cache_path).ok()?;
    let data: serde_json::Value = serde_json::from_str(&text).ok()?;
    let models_arr = data.get("models")?.as_array()?;
    let mut models = Vec::new();
    for m in models_arr {
        let slug = m.get("slug").and_then(|v| v.as_str()).unwrap_or("");
        let vis = m.get("visibility").and_then(|v| v.as_str()).unwrap_or("");
        if !slug.is_empty() && vis != "hide" {
            models.push(slug.to_string());
        }
    }
    if models.is_empty() { None } else { Some(models) }
}

/// Gemini: read constants from installed npm package via node
fn discover_gemini() -> Option<Vec<String>> {
    // Step 1: find the global node_modules root via `npm root -g`
    let npm_root = std::process::Command::new("npm")
        .args(["root", "-g"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        });

    // Build candidate paths: npm root -g result, then legacy fallback
    let mut candidates = Vec::new();
    if let Some(root) = &npm_root {
        candidates.push(format!(
            "{root}/@google/gemini-cli/node_modules/@google/gemini-cli-core"
        ));
    }
    // Legacy fallback paths
    if let Some(home) = dirs::home_dir() {
        let home = home.display();
        candidates.push(format!(
            "{home}/.npm-global/npm/node_modules/@google/gemini-cli/node_modules/@google/gemini-cli-core"
        ));
        #[cfg(target_os = "windows")]
        if let Ok(appdata) = std::env::var("APPDATA") {
            candidates.push(format!(
                "{appdata}/npm/node_modules/@google/gemini-cli/node_modules/@google/gemini-cli-core"
            ));
        }
    }

    let paths_json = serde_json::to_string(&candidates).unwrap_or_else(|_| "[]".to_string());

    let script = format!(r#"
const paths = {paths_json};
for (const p of paths) {{
    try {{
        const core = require(p);
        const models = [];
        const keys = Object.keys(core).filter(k =>
            k.includes('GEMINI') && k.includes('MODEL') &&
            !k.includes('ALIAS') && !k.includes('EMBEDDING') && !k.includes('AUTO')
        );
        keys.forEach(k => {{
            const v = core[k];
            if (typeof v === 'string' && v.startsWith('gemini-') && !v.includes('customtools'))
                models.push(v);
        }});
        if (models.length > 0) {{
            console.log(JSON.stringify([...new Set(models)]));
            process.exit(0);
        }}
    }} catch(_) {{}}
}}
console.log('[]');
"#);

    let output = std::process::Command::new("node")
        .args(["-e", &script])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let models: Vec<String> = serde_json::from_str(stdout.trim()).ok()?;
    if models.is_empty() { None } else { Some(models) }
}

/// Resolve the path to the currently-installed `claude` binary (following
/// symlinks to catch auto-updater-managed installs where `~/.local/bin/claude`
/// points to `~/.local/share/claude/versions/<n>`).
fn resolve_claude_binary() -> Option<PathBuf> {
    let (lookup_cmd, arg) = if cfg!(windows) {
        ("where", "claude")
    } else {
        ("which", "claude")
    };
    let output = std::process::Command::new(lookup_cmd).arg(arg).output().ok()?;
    if !output.status.success() { return None; }
    let first_line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()?
        .trim()
        .to_string();
    if first_line.is_empty() { return None; }
    // Follow symlink — auto-updater flips the symlink on update.
    std::fs::canonicalize(PathBuf::from(first_line)).ok()
}

/// Extract strings that look like Claude model IDs from an arbitrary byte
/// buffer. Scans ASCII-printable runs and pattern-matches against model IDs
/// the CLI knows about. Pure function — exposed for unit testing.
pub(crate) fn extract_claude_model_ids(bytes: &[u8]) -> BTreeSet<String> {
    use regex::Regex;
    lazy_static::lazy_static! {
        // Matches: claude-(opus|sonnet|haiku)-<major>[-<minor>][-<yyyymmdd>]
        // The @YYYYMMDD variant is Anthropic's provider-specific form — keep canonical dash form only.
        static ref MODEL_RE: Regex = Regex::new(
            r"\bclaude-(?:opus|sonnet|haiku)-\d+(?:-\d+)?(?:-\d{8})?\b"
        ).unwrap();
    }
    let mut out = BTreeSet::new();
    // Scan runs of printable ASCII (>=32, <127). Everything else breaks the run.
    let is_printable = |b: u8| (32..127).contains(&b);
    let mut start = 0usize;
    for i in 0..bytes.len() {
        if !is_printable(bytes[i]) {
            if i > start {
                if let Ok(s) = std::str::from_utf8(&bytes[start..i]) {
                    for m in MODEL_RE.find_iter(s) { out.insert(m.as_str().to_string()); }
                }
            }
            start = i + 1;
        }
    }
    // Tail
    if start < bytes.len() {
        if let Ok(s) = std::str::from_utf8(&bytes[start..]) {
            for m in MODEL_RE.find_iter(s) { out.insert(m.as_str().to_string()); }
        }
    }
    out
}

/// Parse a `claude-(opus|sonnet|haiku)-X[-Y][-YYYYMMDD]` ID into
/// (family, version_tuple, has_date). Returns None if the ID doesn't match.
///
/// `version_tuple` is (major, minor) with minor defaulting to 0 when absent
/// (e.g. `claude-opus-4` → (4, 0)). Allows numeric sort across forms.
fn parse_claude_id(id: &str) -> Option<(&'static str, (u32, u32), bool)> {
    let rest = id.strip_prefix("claude-")?;
    let family = if rest.starts_with("opus-") { "opus" }
        else if rest.starts_with("sonnet-") { "sonnet" }
        else if rest.starts_with("haiku-") { "haiku" }
        else { return None; };
    let tail = &rest[family.len() + 1..]; // skip "family-"
    let parts: Vec<&str> = tail.split('-').collect();
    let has_date = parts.last()
        .map(|last| last.len() == 8 && last.chars().all(|c| c.is_ascii_digit()))
        .unwrap_or(false);
    let version_parts: Vec<&str> = if has_date { parts[..parts.len() - 1].to_vec() } else { parts };
    if version_parts.is_empty() { return None; }
    let major: u32 = version_parts[0].parse().ok()?;
    let minor: u32 = version_parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    Some((family, (major, minor), has_date))
}

/// Trim the raw extracted set down to a presentable list:
///   1. drop date-suffixed variants (`claude-opus-4-5-20251101`) — the
///      canonical `claude-opus-4-5` already represents them
///   2. per family (opus/sonnet/haiku), keep only the top N versions by
///      (major, minor) descending. Default N=2 (latest + one prior)
///
/// Exposed `pub(crate)` for unit tests. Pure function.
pub(crate) fn trim_claude_model_list(ids: &BTreeSet<String>, per_family_limit: usize) -> Vec<String> {
    use std::collections::HashMap;
    // Group non-dated IDs by family, each with its parsed version.
    let mut by_family: HashMap<&'static str, Vec<(String, (u32, u32))>> = HashMap::new();
    for id in ids {
        let Some((family, version, has_date)) = parse_claude_id(id) else { continue };
        if has_date { continue; }
        by_family.entry(family).or_default().push((id.clone(), version));
    }
    // Sort each family by version desc and truncate.
    // Result order: families in canonical order (opus, sonnet, haiku) for stable UI.
    let mut out: Vec<String> = Vec::new();
    for family in ["opus", "sonnet", "haiku"] {
        if let Some(mut items) = by_family.remove(family) {
            items.sort_by(|a, b| b.1.cmp(&a.1));
            items.truncate(per_family_limit);
            for (id, _) in items { out.push(id); }
        }
    }
    out
}

/// Discover Claude models by scanning the native CLI binary for embedded
/// model-ID strings. Returns (models, binary_path, binary_mtime) so the caller
/// can cache with mtime-based invalidation.
fn discover_claude_with_stamp() -> Option<(Vec<String>, PathBuf, SystemTime)> {
    let path = resolve_claude_binary()?;
    let meta = std::fs::metadata(&path).ok()?;
    let mtime = meta.modified().ok()?;
    // Binary size guard — refuse to buffer absurd files (e.g. pathological symlink target).
    const MAX_BIN_SIZE: u64 = 300 * 1024 * 1024; // 300 MB
    if meta.len() > MAX_BIN_SIZE {
        eprintln!("[model_discovery] claude binary too large ({} bytes), skipping scan", meta.len());
        return None;
    }
    let bytes = std::fs::read(&path).ok()?;
    let ids = extract_claude_model_ids(&bytes);
    if ids.is_empty() {
        eprintln!("[model_discovery] claude binary scan found 0 model IDs at {:?}", path);
        return None;
    }
    // Trim to "latest + 1 prior per family" and drop date-suffixed variants.
    let trimmed = trim_claude_model_list(&ids, 2);
    if trimmed.is_empty() {
        eprintln!("[model_discovery] claude binary scan: no canonical models after trim (raw={})", ids.len());
        return None;
    }
    Some((trimmed, path, mtime))
}

/// Claude: scan installed CLI binary for embedded model IDs.
#[allow(dead_code)]
fn discover_claude() -> Option<Vec<String>> {
    discover_claude_with_stamp().map(|(m, _, _)| m)
}

/// LMStudio: query OpenAI-compatible `/v1/models` endpoint.
fn discover_lmstudio() -> Option<Vec<String>> {
    let endpoint = std::env::var("LMSTUDIO_ENDPOINT")
        .unwrap_or_else(|_| "http://localhost:1234".into());
    let url = format!("{}/v1/models", endpoint.trim_end_matches('/'));

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .ok()?;

    let mut req = client.get(&url);
    if let Ok(token) = std::env::var("LMSTUDIO_API_KEY") {
        req = req.header("Authorization", format!("Bearer {}", token));
    }
    let resp = req.send().ok()?;
    if !resp.status().is_success() {
        eprintln!("[model_discovery] lmstudio {} → {}", url, resp.status());
        return None;
    }

    let body: serde_json::Value = resp.json().ok()?;
    let data = body.get("data")?.as_array()?;
    let models: Vec<String> = data.iter()
        .filter_map(|m| m.get("id").and_then(|v| v.as_str()).map(String::from))
        .collect();

    if models.is_empty() { None } else { Some(models) }
}

// OpenCode discovery removed — engine dropped from active ENGINES list.

// ─── Core API ───────────────────────────────────────────────────────────────

const ENGINES: &[&str] = &["claude", "codex", "gemini", "ollama", "lmstudio"];

fn get_models_for_engine(engine: &str, force: bool) -> (Vec<String>, String) {
    // Check cache — invalidate early if the tracked binary's mtime has changed
    // (auto-updater symlink switch or in-place reinstall).
    if !force {
        let cache = MODEL_CACHE.lock();
        if let Some(entry) = cache.get(engine) {
            let ttl_ok = entry.at.elapsed() < CACHE_TTL;
            let binary_fresh = match &entry.binary_stamp {
                None => true,
                Some((path, stamp)) => std::fs::metadata(path)
                    .and_then(|m| m.modified())
                    .map(|now| now == *stamp)
                    .unwrap_or(false),
            };
            if ttl_ok && binary_fresh {
                return (entry.models.clone(), entry.source.clone());
            }
        }
    }

    // Try discovery. Claude has a special path to capture the binary stamp.
    let (discovered, binary_stamp): (Option<Vec<String>>, Option<(PathBuf, SystemTime)>) = match engine {
        "codex" => (discover_codex(), None),
        "gemini" => (discover_gemini(), None),
        "claude" => match discover_claude_with_stamp() {
            Some((m, p, t)) => (Some(m), Some((p, t))),
            None => (None, None),
        },
        "ollama" => (crate::agents::openai_compat::discover_models(), None),
        "lmstudio" => (discover_lmstudio(), None),
        _ => (None, None),
    };

    if let Some(mut models) = discovered {
        // Gemini: prepend "auto" option for CLI default routing
        if engine == "gemini" && !models.contains(&"auto".to_string()) {
            models.insert(0, "auto".to_string());
        }
        // Claude: prepend `opus`/`sonnet`/`haiku` aliases (CLI resolves these
        // to the latest known version). Useful default that stays correct
        // across CLI auto-updates without a new discovery run.
        if engine == "claude" {
            for alias in ["haiku", "sonnet", "opus"] {
                if !models.iter().any(|m| m == alias) {
                    models.insert(0, alias.to_string());
                }
            }
        }
        let source = "discovered".to_string();
        let mut cache = MODEL_CACHE.lock();
        cache.insert(engine.to_string(), CacheEntry {
            models: models.clone(), source: source.clone(), at: Instant::now(),
            binary_stamp,
        });
        return (models, source);
    }

    // Fallback
    let fb = fallback_models(engine);
    let models: Vec<String> = fb.iter().map(|(id, _, _)| id.to_string()).collect();
    let source = "fallback".to_string();
    let mut cache = MODEL_CACHE.lock();
    cache.insert(engine.to_string(), CacheEntry {
        models: models.clone(), source: source.clone(), at: Instant::now(),
        binary_stamp: None,
    });
    (models, source)
}

fn model_label(engine: &str, id: &str) -> String {
    // Check fallback registry first for human-authored labels
    for (fid, label, _) in fallback_models(engine) {
        if fid == id { return label.to_string(); }
    }
    // Claude: synthesize a nice label from the ID
    // e.g. `claude-opus-4-7` → "Opus 4.7" / `claude-haiku-4-5-20251001` → "Haiku 4.5 (20251001)"
    if engine == "claude" {
        if let Some(rest) = id.strip_prefix("claude-") {
            let parts: Vec<&str> = rest.split('-').collect();
            if parts.len() >= 2 {
                let family = parts[0];
                let family_label = match family {
                    "opus" => "Opus",
                    "sonnet" => "Sonnet",
                    "haiku" => "Haiku",
                    other => return format!("{} {}", other, parts[1..].join(".")),
                };
                // Detect an 8-digit date suffix (e.g. 20251001) at the tail
                let (version_parts, date): (Vec<&str>, Option<&str>) = if let Some(last) = parts.last() {
                    if last.len() == 8 && last.chars().all(|c| c.is_ascii_digit()) {
                        (parts[1..parts.len() - 1].to_vec(), Some(last))
                    } else {
                        (parts[1..].to_vec(), None)
                    }
                } else {
                    (vec![], None)
                };
                let version = version_parts.join(".");
                return match date {
                    Some(d) => format!("{} {} ({})", family_label, version, d),
                    None => format!("{} {}", family_label, version),
                };
            }
        }
    }
    id.to_string()
}

fn model_recommended(engine: &str, id: &str) -> bool {
    for (fid, _, rec) in fallback_models(engine) {
        if fid == id { return rec; }
    }
    // Claude discovery: recommend `opus` alias (auto-resolves to latest Opus).
    // Keeps one clear default across CLI updates without chasing version numbers.
    if engine == "claude" && id == "opus" {
        return true;
    }
    false
}

/// Invalidate cache for all engines or a specific one.
pub fn invalidate_cache(engine: Option<&str>) {
    let mut cache = MODEL_CACHE.lock();
    match engine {
        Some(e) => { cache.remove(e); }
        None => { cache.clear(); }
    }
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

/// Return all engine models — discovery + fallback.
#[tauri::command]
pub fn list_engine_models() -> Vec<EngineModel> {
    let mut catalog = Vec::new();
    for engine in ENGINES {
        let (models, source) = get_models_for_engine(engine, false);
        for id in &models {
            catalog.push(EngineModel {
                id: id.clone(),
                label: model_label(engine, id),
                engine: engine.to_string(),
                recommended: model_recommended(engine, id),
                source: source.clone(),
            });
        }
    }
    catalog
}

/// Invalidate model cache and re-discover.
#[tauri::command]
pub fn refresh_engine_models() -> Vec<EngineModel> {
    invalidate_cache(None);
    let mut catalog = Vec::new();
    for engine in ENGINES {
        let (models, source) = get_models_for_engine(engine, true);
        for id in &models {
            catalog.push(EngineModel {
                id: id.clone(),
                label: model_label(engine, id),
                engine: engine.to_string(),
                recommended: model_recommended(engine, id),
                source: source.clone(),
            });
        }
    }
    catalog
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_model_ids_basic() {
        let haystack = b"random blob\nclaude-opus-4-7 and also claude-sonnet-4-6 here\nNone: claude-foo-4-1";
        let ids = extract_claude_model_ids(haystack);
        assert!(ids.contains("claude-opus-4-7"));
        assert!(ids.contains("claude-sonnet-4-6"));
        assert!(!ids.iter().any(|s| s.contains("foo")));
    }

    #[test]
    fn extract_model_ids_with_dated_variant() {
        // extract still captures dated form — trim_claude_model_list drops it later.
        let haystack = b"\"claude-haiku-4-5-20251001\"";
        let ids = extract_claude_model_ids(haystack);
        assert!(ids.contains("claude-haiku-4-5-20251001"));
    }

    fn mk_set(items: &[&str]) -> BTreeSet<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parse_claude_id_shapes() {
        assert_eq!(parse_claude_id("claude-opus-4-7"),  Some(("opus",   (4, 7), false)));
        assert_eq!(parse_claude_id("claude-sonnet-4"),   Some(("sonnet", (4, 0), false)));
        assert_eq!(parse_claude_id("claude-opus-4-0"),   Some(("opus",   (4, 0), false)));
        assert_eq!(parse_claude_id("claude-haiku-4-5-20251001"), Some(("haiku", (4, 5), true)));
        assert_eq!(parse_claude_id("claude-foo-1"), None);
        assert_eq!(parse_claude_id("random-string"), None);
    }

    #[test]
    fn trim_drops_dated_variants() {
        let ids = mk_set(&["claude-opus-4-7", "claude-opus-4-7-20260417", "claude-opus-4-6", "claude-opus-4-6-20260301"]);
        let out = trim_claude_model_list(&ids, 10);
        assert!(out.iter().all(|id| !id.chars().rev().take(8).all(|c| c.is_ascii_digit())),
            "dated variants should be dropped: {:?}", out);
        assert_eq!(out, vec!["claude-opus-4-7", "claude-opus-4-6"]);
    }

    #[test]
    fn trim_keeps_only_top_n_per_family() {
        let ids = mk_set(&[
            "claude-opus-4",   "claude-opus-4-0", "claude-opus-4-1",
            "claude-opus-4-5", "claude-opus-4-6", "claude-opus-4-7",
            "claude-sonnet-4-5", "claude-sonnet-4-6",
            "claude-haiku-3-5", "claude-haiku-4", "claude-haiku-4-5",
        ]);
        let out = trim_claude_model_list(&ids, 2);
        // Opus: 4.7, 4.6 (top 2 by version desc)
        // Sonnet: 4.6, 4.5
        // Haiku: 4.5, 4 (== 4.0)
        assert_eq!(out, vec![
            "claude-opus-4-7",
            "claude-opus-4-6",
            "claude-sonnet-4-6",
            "claude-sonnet-4-5",
            "claude-haiku-4-5",
            "claude-haiku-4",
        ]);
    }

    #[test]
    fn trim_family_order_stable() {
        // Even if parsed in arbitrary order, result groups opus → sonnet → haiku.
        let ids = mk_set(&["claude-haiku-4-5", "claude-opus-4-7", "claude-sonnet-4-6"]);
        let out = trim_claude_model_list(&ids, 1);
        assert_eq!(out, vec!["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"]);
    }

    #[test]
    fn trim_empty_when_no_canonical() {
        // Only dated variants → all dropped.
        let ids = mk_set(&["claude-opus-4-7-20260417", "claude-sonnet-4-6-20260401"]);
        let out = trim_claude_model_list(&ids, 2);
        assert!(out.is_empty(), "expected empty, got {:?}", out);
    }

    #[test]
    fn extract_model_ids_dedupes_across_runs() {
        let mut haystack = Vec::new();
        haystack.extend_from_slice(b"claude-opus-4-7");
        haystack.push(0);
        haystack.extend_from_slice(b"other stuff claude-opus-4-7 again");
        let ids = extract_claude_model_ids(&haystack);
        assert_eq!(ids.len(), 1);
    }

    #[test]
    fn extract_model_ids_ignores_near_misses() {
        let haystack = b"claude-plus-4-7 clauude-opus-4-7 claude-opus";
        let ids = extract_claude_model_ids(haystack);
        // `claude-opus` alone lacks the version suffix the regex requires.
        // `claude-plus` is wrong family, `clauude-` misspelled prefix.
        assert!(ids.is_empty(), "expected no matches, got: {:?}", ids);
    }

    #[test]
    fn model_label_synthesizes_claude_version() {
        assert_eq!(model_label("claude", "claude-opus-4-7"), "Opus 4.7");
        assert_eq!(model_label("claude", "claude-sonnet-4-6"), "Sonnet 4.6");
        assert_eq!(model_label("claude", "claude-haiku-4-5-20251001"), "Haiku 4.5 (20251001)");
    }

    #[test]
    fn model_label_fallback_aliases_human() {
        assert_eq!(model_label("claude", "opus"), "Opus (latest)");
        assert_eq!(model_label("claude", "sonnet"), "Sonnet (latest)");
    }

    #[test]
    fn claude_alias_recommended() {
        assert!(model_recommended("claude", "opus"));
        assert!(!model_recommended("claude", "sonnet"));
        assert!(!model_recommended("claude", "claude-opus-4-7"));
    }

    /// Integration test — only runs when a real claude binary is present on PATH.
    /// Skipped silently otherwise so CI without claude still passes.
    #[test]
    fn claude_binary_scan_finds_real_models() {
        let Some(path) = resolve_claude_binary() else {
            eprintln!("[test] claude binary not installed — skipping integration check");
            return;
        };
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(_) => return,
        };
        let ids = extract_claude_model_ids(&bytes);
        assert!(
            !ids.is_empty(),
            "expected ≥1 model ID from installed claude binary at {:?}",
            path
        );
        assert!(
            ids.iter().any(|s| s.starts_with("claude-opus-")
                || s.starts_with("claude-sonnet-")
                || s.starts_with("claude-haiku-")),
            "extracted IDs do not look like claude models: {:?}",
            ids
        );
        let trimmed = trim_claude_model_list(&ids, 2);
        // Per family (opus/sonnet/haiku) up to 2 models → at most 6 items.
        assert!(trimmed.len() <= 6, "trimmed list longer than expected: {:?}", trimmed);
        // No date-suffixed IDs should remain.
        assert!(
            trimmed.iter().all(|id| parse_claude_id(id).map(|(_,_,dated)| !dated).unwrap_or(false)),
            "dated variants leaked into trimmed list: {:?}",
            trimmed
        );
        eprintln!(
            "[test] claude binary: raw={} IDs, trimmed to {} (latest+1 prior per family)",
            ids.len(), trimmed.len()
        );
    }
}
