use tauri::State;

use crate::errors::AppError;
use super::projects::RawqIndexing;

/// Structured rawq status returned to frontend.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawqStatus {
    pub available: bool,
    pub indexed: bool,
    /// "ready" | "built" | "error" | "unavailable"
    pub status: String,
    pub message: String,
    pub files: Option<u64>,
    pub chunks: Option<u64>,
}

/// Get rawq status for a project path without triggering a build.
#[tauri::command]
pub fn get_rawq_status(project_path: String) -> Result<RawqStatus, AppError> {
    use crate::agents::rawq;

    // Check binary availability
    let bin_ok = rawq::is_available();
    if !bin_ok {
        return Ok(RawqStatus {
            available: false, indexed: false,
            status: "unavailable".into(), message: "rawq not found".into(),
            files: None, chunks: None,
        });
    }

    // Check index status via CLI
    match rawq::index_status(&project_path) {
        Ok(Some(info)) => Ok(RawqStatus {
            available: true, indexed: true,
            status: "ready".into(),
            message: format!("{} files, {} chunks", info.files, info.chunks),
            files: Some(info.files), chunks: Some(info.chunks),
        }),
        Ok(None) => Ok(RawqStatus {
            available: true, indexed: false,
            status: "ready".into(), message: "not indexed".into(),
            files: None, chunks: None,
        }),
        Err(e) => Ok(RawqStatus {
            available: true, indexed: false,
            status: "error".into(), message: format!("{}", e),
            files: None, chunks: None,
        }),
    }
}

/// Ensure rawq index exists, returning structured status.
/// NOTE: This is a blocking command. For non-blocking use `start_rawq_index`.
#[tauri::command]
pub fn ensure_rawq_index(project_path: String) -> Result<RawqStatus, AppError> {
    use crate::agents::rawq;

    match rawq::ensure_index(&project_path) {
        Ok(0) => {
            let (files, chunks) = rawq::index_status(&project_path)
                .ok()
                .flatten()
                .map(|i| (Some(i.files), Some(i.chunks)))
                .unwrap_or((None, None));
            Ok(RawqStatus {
                available: true, indexed: true,
                status: "ready".into(), message: "already indexed".into(),
                files, chunks,
            })
        }
        Ok(n) => Ok(RawqStatus {
            available: true, indexed: true,
            status: "built".into(), message: format!("indexed {} files", n),
            files: Some(n), chunks: None,
        }),
        Err(e) => {
            eprintln!("[ensure_rawq_index] {}", e);
            let available = !matches!(e, rawq::RawqError::NotFound(_));
            Ok(RawqStatus {
                available, indexed: false,
                status: if available { "error" } else { "unavailable" }.into(),
                message: format!("{}", e),
                files: None, chunks: None,
            })
        }
    }
}

/// Start rawq index build in background thread. Emits events:
/// - `rawq:indexing` — { projectPath, message }
/// - `rawq:indexed`  — RawqStatus (success)
/// - `rawq:error`    — RawqStatus (failure)
#[tauri::command]
pub fn start_rawq_index(
    project_path: String,
    app: tauri::AppHandle,
    indexing: State<RawqIndexing>,
) -> Result<(), AppError> {
    use crate::agents::rawq;
    use tauri::Emitter;

    // Duplicate guard — skip if already indexing this path
    {
        let mut set = indexing.0.lock().map_err(|_| AppError::Lock)?;
        if set.contains(&project_path) {
            eprintln!("[rawq] already indexing {}, skipping", project_path);
            return Ok(());
        }
        set.insert(project_path.clone());
    }
    let guard = indexing.0.clone();

    let _ = app.emit("rawq:indexing", serde_json::json!({
        "projectPath": &project_path,
        "message": "Building code index..."
    }));

    std::thread::spawn(move || {
        let result = match rawq::ensure_index(&project_path) {
            Ok(0) => {
                let (files, chunks) = rawq::index_status(&project_path)
                    .ok()
                    .flatten()
                    .map(|i| (Some(i.files), Some(i.chunks)))
                    .unwrap_or((None, None));
                RawqStatus {
                    available: true, indexed: true,
                    status: "ready".into(), message: "already indexed".into(),
                    files, chunks,
                }
            }
            Ok(n) => RawqStatus {
                available: true, indexed: true,
                status: "built".into(), message: format!("indexed {} files", n),
                files: Some(n), chunks: None,
            },
            Err(e) => {
                eprintln!("[start_rawq_index] {}", e);
                let available = !matches!(e, rawq::RawqError::NotFound(_));
                RawqStatus {
                    available, indexed: false,
                    status: if available { "error" } else { "unavailable" }.into(),
                    message: format!("{}", e),
                    files: None, chunks: None,
                }
            }
        };

        let event = if result.indexed { "rawq:indexed" } else { "rawq:error" };
        let _ = app.emit(event, &result);

        // Release guard
        if let Ok(mut set) = guard.lock() {
            set.remove(&project_path);
        }
    });

    Ok(())
}

/// Git status for a project path.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub dirty: bool,
    pub git_root: Option<String>,
}

#[tauri::command]
pub fn get_git_status(project_path: String) -> Result<GitStatus, AppError> {
    use std::process::Command;
    let path = std::path::Path::new(&project_path);
    if !path.exists() {
        return Ok(GitStatus { is_repo: false, branch: None, dirty: false, git_root: None });
    }

    // Check if git repo
    let is_repo = Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(&project_path)
        .output()
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "true")
        .unwrap_or(false);

    if !is_repo {
        return Ok(GitStatus { is_repo: false, branch: None, dirty: false, git_root: None });
    }

    let branch = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&project_path)
        .output()
        .ok()
        .and_then(|o| if o.status.success() {
            Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
        } else { None });

    let dirty = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&project_path)
        .output()
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(false);

    let git_root = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(&project_path)
        .output()
        .ok()
        .and_then(|o| if o.status.success() {
            Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
        } else { None });

    Ok(GitStatus { is_repo, branch, dirty, git_root })
}

/// Ensure workflow agent templates exist for an existing project.
/// Called from frontend on project selection to migrate older projects.
#[tauri::command]
pub fn ensure_project_workflow_templates(project_path: String) -> Result<(), AppError> {
    ensure_workflow_templates(&project_path);
    Ok(())
}

/// Ensure workflow agent templates exist in a project directory.
///
/// Creates `docs/agents/{architect,developer,reviewer}.md` if missing.
/// Safe to call on any project — only creates files that don't exist.
/// Called from scaffold_project_dir (new projects) and ensure_project_workflow_templates command (existing).
pub fn ensure_workflow_templates(project_path: &str) {
    use std::fs;
    use std::path::Path;

    let root = Path::new(project_path);
    if !root.is_dir() { return; }

    let agents_dir = root.join("docs/agents");
    let _ = fs::create_dir_all(&agents_dir);

    let templates: &[(&str, &str)] = &[
        ("architect.md", ARCHITECT_TEMPLATE),
        ("developer.md", DEVELOPER_TEMPLATE),
        ("reviewer.md", REVIEWER_TEMPLATE),
    ];

    for (name, content) in templates {
        let path = agents_dir.join(name);
        if !path.exists() {
            let _ = fs::write(&path, content);
            eprintln!("[scaffold] created {}", path.display());
        }
    }
}

const ARCHITECT_TEMPLATE: &str = r#"# Architect

You are the **Architect** in the tunaFlow workflow pipeline.

## Role

- Analyze user requirements through iterative Q&A
- Design implementation plans with clear scope, constraints, and trade-offs
- Propose plans using the structured format below when ready

## Plan Proposal Format

When the plan is ready, wrap it in markers so tunaFlow can detect it:

```
<!-- tunaflow:plan-proposal -->
## Plan Proposal: {title}

### Description
{what and why}

### Expected Outcome
{success criteria}

### Subtasks
1. {task} — {details}
2. {task} — {details}

### Constraints
- {constraint}

### Non-goals
- {explicitly excluded}
<!-- /tunaflow:plan-proposal -->
```

## Guidelines

- Ask clarifying questions before proposing. Don't rush to a plan.
- Keep subtasks at function/file level — concrete enough for a Developer to execute without ambiguity.
- Include non-goals to prevent scope creep.
- If the user says "approved" or promotes the plan, your job is done for this phase.
"#;

const DEVELOPER_TEMPLATE: &str = r#"# Developer

You are the **Developer** in the tunaFlow workflow pipeline.

## Role

- Receive an approved Plan and implement it
- Report your implementation plan BEFORE writing code
- Execute the plan after user approval

## Pre-Implementation Report Format

Before writing any code, report what you intend to do:

```
<!-- tunaflow:impl-plan -->
files:
- {path} — {create|modify|delete}: {what changes}
dependencies:
- {any new packages or version changes}
risks:
- {potential issues or things to watch}
<!-- /tunaflow:impl-plan -->
```

## Completion Signal

When implementation is complete, include this marker:

```
<!-- tunaflow:impl-complete -->
```

## Guidelines

- Follow the Plan exactly. If you think something should change, ask first.
- Report before coding — never start implementation without the pre-report step.
- Keep changes minimal and focused on what the Plan specifies.
- Signal completion clearly so the Review phase can begin.
"#;

const REVIEWER_TEMPLATE: &str = r#"# Reviewer

You are a **Reviewer** in the tunaFlow workflow pipeline.

## Role

- Review implemented code against the original Plan
- Verify test results
- Provide a structured verdict

## Review Verdict Format

After reviewing, provide your verdict:

```
<!-- tunaflow:review-verdict -->
verdict: {pass|fail|conditional}
findings:
- {finding with specific file/line references}
recommendations:
- {actionable suggestion}
<!-- /tunaflow:review-verdict -->
```

## Guidelines

- Compare implementation against every subtask in the Plan.
- Check test results — if tests fail, verdict must be `fail`.
- Be specific: reference file paths and line numbers.
- `conditional` means "acceptable with minor fixes" — list exactly what needs fixing.
- `pass` means all Plan subtasks are correctly implemented and tests pass.
- Do not be lenient — the Plan is the contract.
"#;
