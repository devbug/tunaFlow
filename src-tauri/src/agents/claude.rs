use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use serde::Deserialize;
use crate::errors::AppError;

/// Non-project working directory so CLI agents don't enter coding mode.
fn neutral_cwd() -> PathBuf {
    std::env::temp_dir()
}

// ─── Streaming JSON types (--output-format stream-json) ───────────────────

/// One JSON line emitted by `claude --output-format stream-json`
#[derive(Deserialize)]
struct StreamLine {
    #[serde(rename = "type")]
    line_type: String,
    // assistant event
    message: Option<StreamAssistantMsg>,
    // result event
    result: Option<String>,
    is_error: Option<bool>,
    cost_usd: Option<f64>,
    total_input_tokens: Option<i64>,
    total_output_tokens: Option<i64>,
    session_id: Option<String>,
}

#[derive(Deserialize)]
struct StreamAssistantMsg {
    content: Option<Vec<StreamContentBlock>>,
}

#[derive(Deserialize)]
struct StreamContentBlock {
    #[serde(rename = "type")]
    block_type: String,
    text: Option<String>,
}

fn extract_text(msg: &StreamAssistantMsg) -> String {
    msg.content
        .as_ref()
        .and_then(|blocks| {
            blocks
                .iter()
                .filter(|b| b.block_type == "text")
                .filter_map(|b| b.text.as_deref())
                .next()
        })
        .unwrap_or("")
        .to_string()
}

/// Shape of `claude -p --output-format json` stdout
#[derive(Debug, Deserialize)]
pub struct ClaudeJsonOutput {
    pub result: Option<String>,
    pub is_error: Option<bool>,
    pub cost_usd: Option<f64>,
    pub total_input_tokens: Option<i64>,
    pub total_output_tokens: Option<i64>,
    pub session_id: Option<String>,
}

pub struct RunInput {
    pub prompt: String,
    pub model: Option<String>,
    pub system_prompt: Option<String>,
    /// Session resume token from the previous CompletedEvent (session_id).
    /// None = new session. Some(token) = continue existing session via --resume.
    pub resume_token: Option<String>,
}

pub struct RunOutput {
    pub content: String,
    pub cost_usd: f64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub session_id: Option<String>,
}

/// Execute `claude -p` with `--output-format stream-json` and call `on_chunk` for each
/// accumulated text received from an `assistant` event line.
/// Returns the final `RunOutput` when the `result` line arrives.
///
/// Caller must NOT hold the DbState lock while calling this function.
pub fn stream_run<F>(input: RunInput, mut on_chunk: F) -> Result<RunOutput, AppError>
where
    F: FnMut(String),
{
    let mut cmd = Command::new("claude");
    cmd.arg("-p")
        .arg(&input.prompt)
        .arg("--output-format")
        .arg("stream-json")
        .arg("--verbose")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(neutral_cwd());

    if let Some(model) = &input.model {
        cmd.arg("--model").arg(model);
    }

    if let Some(system_prompt) = &input.system_prompt {
        cmd.arg("--append-system-prompt").arg(system_prompt);
    }

    if let Some(token) = &input.resume_token {
        cmd.arg("--resume").arg(token);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Agent(format!("Failed to spawn claude: {}", e)))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Agent("Failed to capture stdout".into()))?;

    // Drain stderr in a background thread to prevent pipe-buffer deadlock
    let mut stderr_pipe = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Agent("Failed to capture stderr".into()))?;
    let stderr_handle = thread::spawn(move || {
        let mut buf = String::new();
        let _ = stderr_pipe.read_to_string(&mut buf);
        buf
    });

    let reader = BufReader::new(stdout);
    let mut final_output: Option<RunOutput> = None;
    let mut unparsed_lines: Vec<String> = Vec::new();

    for raw in reader.lines() {
        let line = raw?;
        if line.trim().is_empty() {
            continue;
        }
        let parsed: StreamLine = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                // Collect unparseable stdout lines (may contain plain-text errors)
                unparsed_lines.push(line);
                continue;
            }
        };

        match parsed.line_type.as_str() {
            "assistant" => {
                if let Some(msg) = &parsed.message {
                    let text = extract_text(msg);
                    if !text.is_empty() {
                        on_chunk(text);
                    }
                }
            }
            "result" => {
                if parsed.is_error.unwrap_or(false) {
                    let _ = child.wait();
                    return Err(AppError::Agent(format!(
                        "claude reported error: {}",
                        parsed.result.as_deref().unwrap_or("unknown")
                    )));
                }
                final_output = Some(RunOutput {
                    content: parsed.result.unwrap_or_default(),
                    cost_usd: parsed.cost_usd.unwrap_or(0.0),
                    input_tokens: parsed.total_input_tokens.unwrap_or(0),
                    output_tokens: parsed.total_output_tokens.unwrap_or(0),
                    session_id: parsed.session_id,
                });
            }
            _ => {}
        }
    }

    child.wait()?;
    let stderr_content = stderr_handle.join().unwrap_or_default();

    final_output.ok_or_else(|| {
        // Build a diagnostic message using stderr, then unparsed stdout lines as fallback
        let detail = if !stderr_content.trim().is_empty() {
            stderr_content.trim().to_string()
        } else if !unparsed_lines.is_empty() {
            unparsed_lines.join(" | ")
        } else {
            "no output received".to_string()
        };
        AppError::Agent(format!("claude stream failed: {}", detail))
    })
}

/// Execute `claude -p` as a one-shot subprocess and return the result.
///
/// Caller must NOT hold the DbState lock while calling this function,
/// since the subprocess can take an arbitrarily long time.
pub fn run(input: RunInput) -> Result<RunOutput, AppError> {
    let mut cmd = Command::new("claude");
    cmd.arg("-p")
        .arg(&input.prompt)
        .arg("--output-format")
        .arg("json")
        .current_dir(neutral_cwd());

    if let Some(model) = &input.model {
        cmd.arg("--model").arg(model);
    }

    if let Some(system_prompt) = &input.system_prompt {
        // TODO: ContextPack assembly (Skill content, rawq results) goes here
        cmd.arg("--append-system-prompt").arg(system_prompt);
    }

    if let Some(token) = &input.resume_token {
        cmd.arg("--resume").arg(token);
    }

    let output = cmd.output().map_err(|e| {
        AppError::Agent(format!("Failed to spawn claude: {}", e))
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Agent(format!(
            "claude exited {:?}: {}",
            output.status.code(),
            stderr.trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: ClaudeJsonOutput = serde_json::from_str(stdout.trim()).map_err(|e| {
        AppError::Agent(format!(
            "Failed to parse claude output: {} | raw: {}",
            e,
            stdout.trim()
        ))
    })?;

    if parsed.is_error.unwrap_or(false) {
        return Err(AppError::Agent(format!(
            "claude reported error: {}",
            parsed.result.as_deref().unwrap_or("unknown")
        )));
    }

    Ok(RunOutput {
        content: parsed.result.unwrap_or_default(),
        cost_usd: parsed.cost_usd.unwrap_or(0.0),
        input_tokens: parsed.total_input_tokens.unwrap_or(0),
        output_tokens: parsed.total_output_tokens.unwrap_or(0),
        session_id: parsed.session_id,
    })
}
