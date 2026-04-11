use serde::Serialize;
use std::fs;
use std::path::Path;

use crate::errors::AppError;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub path: String,
}

/// List immediate children of a directory (1 level deep).
/// Skips hidden files/folders (starting with `.`) and common noise dirs.
#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<DirEntry>, AppError> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(AppError::NotFound(format!("Not a directory: {}", path)));
    }

    let skip = [
        "node_modules", "target", "dist", ".git", ".next",
        "__pycache__", ".venv", "venv", ".idea", ".vscode",
    ];

    let mut entries: Vec<DirEntry> = Vec::new();
    let Ok(read) = fs::read_dir(dir) else {
        return Ok(entries);
    };

    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') { continue; }
        if skip.contains(&name.as_str()) { continue; }

        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let full_path = entry.path().to_string_lossy().to_string();
        entries.push(DirEntry { name, is_dir, path: full_path });
    }

    // Dirs first, then files, alphabetical within each group
    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

/// Read file content as UTF-8 string. Used by Docs viewer popup.
#[tauri::command]
pub fn read_file_content(path: String) -> Result<String, AppError> {
    fs::read_to_string(&path)
        .map_err(|e| AppError::NotFound(format!("Cannot read {}: {}", path, e)))
}

/// Read a text file's content, resolved relative to a project root.
///
/// Security: only allows reading files under `project_path`.
/// Returns file content as string, or error if outside scope or not readable.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub language: String,
    pub line_count: usize,
}

#[tauri::command]
pub fn read_text_file(file_path: String, project_path: String) -> Result<FileContent, AppError> {
    let project = Path::new(&project_path).canonicalize()
        .map_err(|e| AppError::NotFound(format!("Invalid project path: {}", e)))?;

    // Resolve: absolute or relative to project
    let resolved = if Path::new(&file_path).is_absolute() {
        Path::new(&file_path).to_path_buf()
    } else {
        project.join(&file_path)
    };
    let canonical = resolved.canonicalize()
        .map_err(|e| AppError::NotFound(format!("File not found: {}", e)))?;

    // Security: must be under project root
    if !canonical.starts_with(&project) {
        return Err(AppError::Agent(format!(
            "Access denied: {} is outside project scope", file_path
        )));
    }

    if !canonical.is_file() {
        return Err(AppError::NotFound(format!("Not a file: {}", file_path)));
    }

    // Size guard: max 512KB
    let metadata = fs::metadata(&canonical)
        .map_err(|e| AppError::NotFound(format!("Cannot read metadata: {}", e)))?;
    if metadata.len() > 512 * 1024 {
        return Err(AppError::Agent(format!(
            "File too large: {} bytes (max 512KB)", metadata.len()
        )));
    }

    let content = fs::read_to_string(&canonical)
        .map_err(|e| AppError::Agent(format!("Cannot read file: {}", e)))?;

    let line_count = content.lines().count();
    let ext = canonical.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let language = match ext.as_str() {
        "rs" => "rust", "ts" | "tsx" => "typescript", "js" | "jsx" => "javascript",
        "py" => "python", "go" => "go", "java" => "java", "rb" => "ruby",
        "md" => "markdown", "json" => "json", "toml" => "toml", "yaml" | "yml" => "yaml",
        "html" => "html", "css" => "css", "sql" => "sql", "sh" | "bash" => "bash",
        "xml" => "xml", "c" | "h" => "c", "cpp" | "cc" | "hpp" => "cpp",
        _ => "text",
    }.to_string();

    Ok(FileContent {
        path: canonical.to_string_lossy().to_string(),
        content,
        language,
        line_count,
    })
}
