/// Minimal rawq: keyword-based code file search for ContextPack injection.
/// DATA_MODEL §1.7 — rawq search result → prompt prefix (§4.2 step 3).
///
/// All operations are runtime-only (no DB, no persistent index).
use std::collections::HashSet;
use std::fs;
use std::path::Path;

/// Maximum file size to read (skip larger files to avoid performance issues).
const MAX_FILE_BYTES: u64 = 100_000;

/// Maximum number of files to scan per request.
const MAX_FILES: usize = 300;

/// Maximum directory depth to recurse into.
const MAX_DEPTH: usize = 6;

/// Code file extensions to include in the search.
const CODE_EXTENSIONS: &[&str] = &[
    "rs", "ts", "tsx", "js", "jsx", "mjs",
    "py", "go", "java", "c", "cpp", "h", "hpp",
    "toml", "yaml", "yml",
];

/// Directories to skip entirely during scan.
const SKIP_DIRS: &[&str] = &[
    "node_modules", "target", "dist", ".git", ".next",
    "__pycache__", "venv", ".venv", "vendor", "coverage",
];

pub struct SearchResult {
    /// File path relative to project root, forward-slash separated.
    pub file: String,
    /// 1-based line number of the match.
    pub line: usize,
    /// Trimmed content of the matched line.
    pub snippet: String,
}

/// Search `project_path` for code lines matching any keyword extracted from `query`.
/// Returns at most `limit` results in file-path + line-number order.
pub fn search(project_path: &str, query: &str, limit: usize) -> Vec<SearchResult> {
    let keywords = extract_keywords(query);
    if keywords.is_empty() || limit == 0 {
        return Vec::new();
    }

    let root = Path::new(project_path);
    if !root.is_dir() {
        return Vec::new();
    }

    let mut results = Vec::new();
    let mut files_scanned = 0usize;
    scan_dir(root, root, &keywords, &mut results, &mut files_scanned, 0, limit);
    results
}

/// Split query into unique lowercase tokens of length > 2 (char count).
/// Takes up to 5 tokens to avoid overly broad searches.
fn extract_keywords(query: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    query
        .split(|c: char| {
            c.is_whitespace() || ".,;:!?()[]{}\"'`#@/\\=<>".contains(c)
        })
        .filter(|w| w.chars().count() > 2)
        .map(|w| w.to_lowercase())
        .filter(|w| seen.insert(w.clone()))
        .take(5)
        .collect()
}

fn scan_dir(
    root: &Path,
    dir: &Path,
    keywords: &[String],
    results: &mut Vec<SearchResult>,
    files_scanned: &mut usize,
    depth: usize,
    limit: usize,
) {
    if depth > MAX_DEPTH || results.len() >= limit || *files_scanned >= MAX_FILES {
        return;
    }

    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name()); // deterministic order

    for entry in entries {
        if results.len() >= limit || *files_scanned >= MAX_FILES {
            break;
        }
        let path = entry.path();

        // Skip hidden entries and known large/irrelevant dirs
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.starts_with('.') || SKIP_DIRS.contains(&name) {
                continue;
            }
        }

        if path.is_dir() {
            scan_dir(root, &path, keywords, results, files_scanned, depth + 1, limit);
        } else if is_code_file(&path) {
            *files_scanned += 1;
            search_file(root, &path, keywords, results, limit);
        }
    }
}

fn is_code_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| CODE_EXTENSIONS.contains(&ext))
        .unwrap_or(false)
}

fn search_file(
    root: &Path,
    path: &Path,
    keywords: &[String],
    results: &mut Vec<SearchResult>,
    limit: usize,
) {
    if let Ok(meta) = path.metadata() {
        if meta.len() > MAX_FILE_BYTES {
            return;
        }
    }

    let Ok(content) = fs::read_to_string(path) else {
        return; // skip binary / non-UTF-8 files
    };

    let rel = path.strip_prefix(root).unwrap_or(path);
    let file = rel.to_string_lossy().replace('\\', "/");

    for (i, line) in content.lines().enumerate() {
        if results.len() >= limit {
            break;
        }
        let lower = line.to_lowercase();
        if keywords.iter().any(|kw| lower.contains(kw.as_str())) {
            let snippet = line.trim().to_string();
            if !snippet.is_empty() {
                results.push(SearchResult {
                    file: file.clone(),
                    line: i + 1,
                    snippet,
                });
            }
        }
    }
}
