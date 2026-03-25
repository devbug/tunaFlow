use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;

use crate::agents::claude::{RunInput, RunOutput};
use crate::errors::AppError;

/// Resolve the gemini binary/script path.
///
/// On Windows, prefer the node script directly (tunadish pattern).
/// Returns `(command, script_arg)`:
///   - Windows with node_modules: ("node", Some("--no-warnings=DEP0040"), Some("path/to/index.js"))
///   - Otherwise: ("gemini" or resolved path, None, None)
fn resolve_gemini() -> (String, Option<String>) {
    #[cfg(target_os = "windows")]
    {
        // Prefer direct node invocation (tunadish pattern)
        if let Ok(appdata) = std::env::var("APPDATA") {
            let entry = PathBuf::from(&appdata)
                .join("npm")
                .join("node_modules")
                .join("@google")
                .join("gemini-cli")
                .join("dist")
                .join("index.js");
            if entry.exists() {
                let node = which_or("node", "node");
                return (node, Some(entry.to_string_lossy().to_string()));
            }
        }
        // Fallback
        if let Ok(appdata) = std::env::var("APPDATA") {
            let candidate = PathBuf::from(&appdata).join("npm").join("gemini.cmd");
            if candidate.exists() {
                return (candidate.to_string_lossy().to_string(), None);
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        for prefix in &["/usr/local/bin", "/usr/bin", "/opt/homebrew/bin"] {
            let candidate = PathBuf::from(prefix).join("gemini");
            if candidate.exists() {
                return (candidate.to_string_lossy().to_string(), None);
            }
        }
    }

    ("gemini".to_string(), None)
}

#[cfg(target_os = "windows")]
fn which_or(name: &str, fallback: &str) -> String {
    std::env::var("PATH")
        .ok()
        .and_then(|path| {
            path.split(';').find_map(|dir| {
                let candidate = PathBuf::from(dir).join(format!("{}.exe", name));
                if candidate.exists() {
                    Some(candidate.to_string_lossy().to_string())
                } else {
                    None
                }
            })
        })
        .unwrap_or_else(|| fallback.to_string())
}

/// Non-project working directory so CLI agents don't enter coding mode.
fn neutral_cwd() -> PathBuf {
    std::env::temp_dir()
}

/// Execute `gemini -p <prompt>` as a one-shot non-interactive subprocess.
///
/// Cost and token fields are unavailable; returned as 0.
pub fn run(input: RunInput) -> Result<RunOutput, AppError> {
    let (gemini_cmd, gemini_script) = resolve_gemini();

    let mut cmd = Command::new(&gemini_cmd);
    if let Some(ref script) = gemini_script {
        cmd.arg("--no-warnings=DEP0040").arg(script);
    }

    cmd.arg("-p").arg(&input.prompt);

    if let Some(model) = &input.model {
        cmd.arg("--model").arg(model);
    }

    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(neutral_cwd());

    let mut child = cmd.spawn().map_err(|e| {
        AppError::Agent(format!("Failed to spawn gemini ({}): {}", gemini_cmd, e))
    })?;

    // Drain stderr in background
    let mut stderr_pipe = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Agent("Failed to capture gemini stderr".into()))?;
    let stderr_handle = thread::spawn(move || {
        let mut buf = String::new();
        let _ = stderr_pipe.read_to_string(&mut buf);
        buf
    });

    // Read stdout
    let mut stdout_pipe = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Agent("Failed to capture gemini stdout".into()))?;
    let mut stdout_raw = String::new();
    stdout_pipe
        .read_to_string(&mut stdout_raw)
        .map_err(|e| AppError::Agent(format!("Failed to read gemini stdout: {}", e)))?;

    let exit_status = child.wait()?;
    let stderr_content = stderr_handle.join().unwrap_or_default();

    if !exit_status.success() {
        let detail = if !stderr_content.trim().is_empty() {
            stderr_content.trim().to_string()
        } else if !stdout_raw.trim().is_empty() {
            stdout_raw.trim().to_string()
        } else {
            format!("exit code {:?}", exit_status.code())
        };
        return Err(AppError::Agent(format!("gemini failed: {}", detail)));
    }

    let content = stdout_raw.trim().to_string();

    if content.is_empty() && !stderr_content.trim().is_empty() {
        return Err(AppError::Agent(format!(
            "gemini produced no output: {}",
            stderr_content.trim()
        )));
    }

    Ok(RunOutput {
        content,
        cost_usd: 0.0,
        input_tokens: 0,
        output_tokens: 0,
        session_id: None,
    })
}
