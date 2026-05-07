//! Detect which AI agents are available on this machine.
//!
//! Used by the Meta Agent Selector modal shown during project onboarding.
//! - CLI agents (claude / codex / gemini): probe PATH (cross-platform —
//!   `which` on Unix, PATH + PATHEXT enumeration on Windows) + `--version`.
//! - HTTP agents (ollama / lmstudio): probe endpoint + list models live.
//! - 모든 탐지는 병렬로 수행. 각 항목은 1.5s timeout.

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

use crate::no_console::NoConsole;

// LMStudio / Ollama 첫 응답이 모델 스캔 때문에 느릴 수 있으므로 3s 로 넉넉히.
// CLI(`which`) 쪽은 여전히 가볍기 때문에 동일 상수로 충분.
const PROBE_TIMEOUT_MS: u64 = 3000;

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentDetection {
    pub engine: String,
    pub kind: &'static str,        // "cli" or "http"
    pub installed: bool,
    pub version: Option<String>,   // CLI 에이전트의 `<cmd> --version`
    pub path: Option<String>,      // CLI: `which` 결과
    pub endpoint: Option<String>,  // HTTP: 확인/호출된 베이스 URL
    pub models: Vec<String>,       // HTTP: /api/tags / /v1/models
    pub note: Option<String>,      // 실패/에러 요약 (사용자에게 보여줄 수 있음)
}

// ─── CLI probing ─────────────────────────────────────────────────────────────

/// PATH 에서 binary 의 절대 경로를 찾는다. Cross-platform.
///
/// - Windows: `which` 명령이 존재하지 않으므로 PATH (`;` 구분) 와 PATHEXT
///   (`.EXE` / `.CMD` / `.BAT` / `.PS1` 등) 를 직접 enumerate. npm 으로
///   글로벌 설치된 claude / codex / gemini CLI 는 보통 `<bin>.cmd` 형태로
///   `%APPDATA%\npm\` 에 등록된다.
/// - Unix: 시스템 `which` 에 위임 (기존 동작 보존).
///
/// 같은 repo 의 `resolve.rs::which_or` / `crg.rs` Windows 분기와 같은
/// 철학이며, agent detection 은 PATHEXT 를 더 넓게 본다 (.cmd 까지).
async fn find_in_path(bin: &str) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let path = std::env::var("PATH").ok()?;
        let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
        let exts: Vec<String> = pathext
            .split(';')
            .map(|e| e.trim().to_string())
            .filter(|e| !e.is_empty())
            .collect();
        for dir in path.split(';') {
            let dir = dir.trim();
            if dir.is_empty() {
                continue;
            }
            for ext in &exts {
                let candidate = std::path::PathBuf::from(dir).join(format!("{}{}", bin, ext));
                if candidate.is_file() {
                    return Some(candidate.to_string_lossy().to_string());
                }
            }
            // Drop-in binaries without extension (rare on Windows but possible).
            let candidate = std::path::PathBuf::from(dir).join(bin);
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
        None
    }

    #[cfg(not(target_os = "windows"))]
    {
        let which_fut = Command::new("which").no_console().arg(bin).output();
        let out = match timeout(Duration::from_millis(PROBE_TIMEOUT_MS), which_fut).await {
            Ok(Ok(o)) => o,
            _ => return None,
        };
        if !out.status.success() {
            return None;
        }
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if s.is_empty() { None } else { Some(s) }
    }
}

async fn probe_cli(engine: &str, bin: &str, version_args: &[&str]) -> AgentDetection {
    let mut det = AgentDetection {
        engine: engine.to_string(),
        kind: "cli",
        installed: false,
        version: None,
        path: None,
        endpoint: None,
        models: vec![],
        note: None,
    };

    let path = match find_in_path(bin).await {
        Some(p) => p,
        None => {
            det.note = Some("not found in PATH".into());
            return det;
        }
    };
    det.path = Some(path.clone());
    det.installed = true;

    // `<bin> --version` (optional — 실패해도 installed 유지). Windows 에서
    // `.cmd` / `.bat` / `.ps1` 은 std::Command 직접 실행이 불가능하므로 cmd
    // /C 로 래핑. `.exe` 또는 Unix 는 직접 실행. 본 probe 가 실패해도
    // detection 자체는 path 발견 시점에 이미 성공이라 사용자 UX 에 영향 없음
    // (version 칸만 빈 채로 표시).
    let lower = path.to_lowercase();
    let is_windows_script = cfg!(target_os = "windows")
        && (lower.ends_with(".cmd") || lower.ends_with(".bat") || lower.ends_with(".ps1"));
    let ver_fut = if is_windows_script {
        let mut c = Command::new("cmd");
        c.no_console().arg("/C").arg(&path).args(version_args);
        c.output()
    } else {
        let mut c = Command::new(&path);
        c.no_console().args(version_args);
        c.output()
    };
    if let Ok(Ok(out)) = timeout(Duration::from_millis(PROBE_TIMEOUT_MS), ver_fut).await {
        if out.status.success() {
            let v = String::from_utf8_lossy(&out.stdout).lines().next().unwrap_or("").trim().to_string();
            if !v.is_empty() { det.version = Some(v); }
        }
    }
    det
}

// ─── HTTP probing ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct OllamaTagsResponse {
    #[serde(default)]
    models: Vec<OllamaTagModel>,
}
#[derive(Deserialize)]
struct OllamaTagModel { name: String }

#[derive(Deserialize)]
struct OpenAiModelsResponse {
    #[serde(default)]
    data: Vec<OpenAiModel>,
}
#[derive(Deserialize)]
struct OpenAiModel { id: String }

async fn probe_ollama(endpoint: &str) -> AgentDetection {
    let base = endpoint.trim_end_matches('/');
    let url = format!("{}/api/tags", base);
    let mut det = AgentDetection {
        engine: "ollama".into(),
        kind: "http",
        installed: false,
        version: None,
        path: None,
        endpoint: Some(base.to_string()),
        models: vec![],
        note: None,
    };

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_millis(PROBE_TIMEOUT_MS))
        .build()
    {
        Ok(c) => c,
        Err(e) => { det.note = Some(format!("reqwest build error: {e}")); return det; }
    };

    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<OllamaTagsResponse>().await {
                Ok(body) => {
                    det.installed = true;
                    det.models = body.models.into_iter().map(|m| m.name).collect();
                }
                Err(e) => det.note = Some(format!("parse error: {e}")),
            }
        }
        Ok(resp) => det.note = Some(format!("status {}", resp.status())),
        Err(_) => det.note = Some("not reachable".into()),
    }
    det
}

async fn probe_lmstudio(endpoint: &str) -> AgentDetection {
    // LMStudio는 보통 .../v1 로 base. 끝에 /v1 붙어있지 않으면 붙여서 접근.
    let base_raw = endpoint.trim_end_matches('/');
    let base = if base_raw.ends_with("/v1") { base_raw.to_string() } else { format!("{}/v1", base_raw) };
    let url = format!("{}/models", base);

    let mut det = AgentDetection {
        engine: "lmstudio".into(),
        kind: "http",
        installed: false,
        version: None,
        path: None,
        endpoint: Some(base.clone()),
        models: vec![],
        note: None,
    };

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_millis(PROBE_TIMEOUT_MS))
        .build()
    {
        Ok(c) => c,
        Err(e) => { det.note = Some(format!("reqwest build error: {e}")); return det; }
    };

    eprintln!("[agent-detect] probe lmstudio: GET {}", url);
    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<OpenAiModelsResponse>().await {
                Ok(body) => {
                    det.installed = true;
                    det.models = body.data.into_iter().map(|m| m.id).collect();
                    eprintln!("[agent-detect] lmstudio ok — {} models", det.models.len());
                }
                Err(e) => {
                    eprintln!("[agent-detect] lmstudio parse error: {e}");
                    det.note = Some(format!("응답 파싱 실패: {e}"));
                }
            }
        }
        Ok(resp) => {
            let status = resp.status();
            eprintln!("[agent-detect] lmstudio status {}", status);
            det.note = Some(format!("HTTP {status}"));
        }
        Err(e) => {
            eprintln!("[agent-detect] lmstudio unreachable: {e}");
            det.note = Some(if e.is_timeout() { "timeout".into() } else { "not reachable".into() });
        }
    }
    det
}

// ─── Tauri command ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn detect_available_agents(
    ollama_endpoint: Option<String>,
    lmstudio_endpoint: Option<String>,
) -> Vec<AgentDetection> {
    let ollama_ep = ollama_endpoint.unwrap_or_else(|| "http://localhost:11434".into());
    let lmstudio_ep = lmstudio_endpoint.unwrap_or_else(|| "http://localhost:1234/v1".into());

    // CLI probes — 병렬
    let (claude, codex, gemini, ollama, lmstudio) = tokio::join!(
        probe_cli("claude", "claude", &["--version"]),
        probe_cli("codex",  "codex",  &["--version"]),
        probe_cli("gemini", "gemini", &["--version"]),
        probe_ollama(&ollama_ep),
        probe_lmstudio(&lmstudio_ep),
    );

    vec![claude, codex, gemini, ollama, lmstudio]
}
