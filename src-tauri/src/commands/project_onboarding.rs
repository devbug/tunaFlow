use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::projects::detect_project_info;

// ─── Cancellation flag ───────────────────────────────────────────────────────

static CANCEL_FLAG: OnceLock<Mutex<Option<Arc<AtomicBool>>>> = OnceLock::new();

fn cancel_flag() -> &'static Mutex<Option<Arc<AtomicBool>>> {
    CANCEL_FLAG.get_or_init(|| Mutex::new(None))
}
fn set_cancel_flag(flag: Arc<AtomicBool>) {
    if let Ok(mut g) = cancel_flag().lock() { *g = Some(flag); }
}
fn clear_cancel_flag() {
    if let Ok(mut g) = cancel_flag().lock() { *g = None; }
}
fn is_cancelled(flag: &AtomicBool) -> bool {
    flag.load(Ordering::Relaxed)
}

// ─── Event payloads ──────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct OnboardingStepPayload {
    pub step: u8,
    pub label: String,
    pub done: bool,
}

#[derive(Serialize, Clone)]
pub struct OnboardingPreviewPayload {
    pub claude_md: String,
    pub ref_index: String,
    pub has_existing_claude_md: bool,
}

#[derive(Serialize, Clone)]
pub struct OnboardingErrorPayload {
    pub message: String,
}

// ─── Helper: scan docs folder ────────────────────────────────────────────────

fn scan_docs_files(project_path: &str) -> Vec<String> {
    let docs = std::path::Path::new(project_path).join("docs");
    if !docs.is_dir() { return vec![]; }

    let mut files = Vec::new();
    collect_md_files(&docs, &docs, &mut files, 0);
    files
}

fn collect_md_files(
    base: &std::path::Path,
    dir: &std::path::Path,
    out: &mut Vec<String>,
    depth: usize,
) {
    if depth > 4 { return; }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_md_files(base, &path, out, depth + 1);
        } else if path.extension().map(|e| e == "md").unwrap_or(false) {
            if let Ok(rel) = path.strip_prefix(base) {
                out.push(rel.to_string_lossy().to_string());
            }
        }
    }
}

// ─── Prompt builder ──────────────────────────────────────────────────────────

fn build_prompt(
    project_name: &str,
    project_path: &str,
    docs_files: &[String],
    existing_claude_md: &Option<String>,
) -> String {
    let info = detect_project_info(project_path);

    let stack_summary = if info.detected_stack.is_empty() {
        "알 수 없음 (manifest 파일 없음)".to_string()
    } else {
        info.detected_stack.join(", ")
    };

    let lang = info.language.as_deref().unwrap_or("Unknown");
    let framework = info.framework.as_deref().unwrap_or("");
    let test_cmd = info.test_command.as_deref().unwrap_or("");
    let build_cmd = info.build_command.as_deref().unwrap_or("");
    let type_cmd = info.type_check_command.as_deref().unwrap_or("");

    // Truncate existing CLAUDE.md to 3000 chars to stay within prompt budget
    let existing_section = match existing_claude_md {
        Some(content) => {
            let truncated = if content.len() > 3000 {
                format!("{}...(truncated)", &content[..3000])
            } else {
                content.clone()
            };
            format!("\n\n## 기존 CLAUDE.md 내용 (참고용)\n```\n{}\n```", truncated)
        }
        None => String::new(),
    };

    let docs_section = if docs_files.is_empty() {
        "없음".to_string()
    } else {
        docs_files.iter().map(|f| format!("- docs/{}", f)).collect::<Vec<_>>().join("\n")
    };

    format!(
        r#"아래 프로젝트 정보를 분석하여 두 가지 파일의 내용을 생성해 주세요.

## 프로젝트 정보

- 이름: {project_name}
- 언어: {lang}
- 프레임워크: {framework}
- 스택: {stack_summary}
- 테스트 명령: {test_cmd}
- 빌드 명령: {build_cmd}
- 타입 체크: {type_cmd}

## 기존 문서 목록
{docs_section}{existing_section}

---

## 출력 형식

아래 두 섹션을 정확한 마커와 함께 출력하세요. 마커 외에 다른 텍스트는 추가하지 마세요.

[CLAUDE_MD_START]
# {project_name} — Claude Code Handoff Document

## 1. Project Overview

(프로젝트 목적과 핵심 기능을 2~4문장으로 설명. 기존 CLAUDE.md가 있으면 그 내용을 참고해서 더 정확하게 작성.)

## 2. 기술 스택

| 계층 | 기술 |
|------|------|
(감지된 스택 기반으로 채우기. 모르는 것은 "미확인"으로 표기.)

## 3. 빌드 / 테스트

```bash
(감지된 명령어로 채우기. 없으면 일반적인 패턴으로 추측.)
```

## 4. 코딩 컨벤션

(기존 CLAUDE.md에 컨벤션이 있으면 그대로 옮기기. 없으면 스택 기반 일반 컨벤션 제안.)

## 5. 다음 우선순위

- 미정 (에이전트와 상의하여 채우세요)

---

> Auto-detected by tunaFlow. 내용을 검토하고 필요하면 수정하세요.
[CLAUDE_MD_END]

[REF_INDEX_START]
# Reference

> 이 프로젝트의 문서 인덱스입니다.

(docs/ 아래 기존 문서 목록이 있으면 카테고리별로 정리. 없으면 빈 섹션만 만들기.)

## 계획 문서
- [plans/index.md](plans/index.md)

## 참고 문서
(기존 docs 파일이 있으면 여기 링크로 추가)

## 프롬프트
- [prompts/index.md](prompts/index.md)
[REF_INDEX_END]
"#,
        project_name = project_name,
        lang = lang,
        framework = framework,
        stack_summary = stack_summary,
        test_cmd = test_cmd,
        build_cmd = build_cmd,
        type_cmd = type_cmd,
        docs_section = docs_section,
        existing_section = existing_section,
    )
}

// ─── Parse output ────────────────────────────────────────────────────────────

fn parse_output(text: &str) -> Result<(String, String), String> {
    let claude_md = extract_between(text, "[CLAUDE_MD_START]", "[CLAUDE_MD_END]")
        .ok_or("AI 응답에서 CLAUDE.md 섹션을 찾을 수 없습니다")?;
    let ref_index = extract_between(text, "[REF_INDEX_START]", "[REF_INDEX_END]")
        .ok_or("AI 응답에서 Reference Index 섹션을 찾을 수 없습니다")?;
    Ok((claude_md.trim().to_string(), ref_index.trim().to_string()))
}

fn extract_between<'a>(text: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let s = text.find(start)? + start.len();
    let e = text[s..].find(end)? + s;
    Some(&text[s..e])
}

// ─── AI call ─────────────────────────────────────────────────────────────────

async fn call_claude(prompt: &str, cancel: &AtomicBool) -> Result<(String, String), String> {
    let mut child = tokio::process::Command::new("claude")
        .args(["-p", prompt, "--max-turns", "1", "--output-format", "text"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("claude CLI 실행 실패: {e}. claude가 설치되어 있고 로그인되어 있는지 확인하세요."))?;

    // Spawn subprocess in a background task; communicate result via channel.
    // If cancelled we return early — the background task finishes on its own and result is dropped.
    let (tx, mut rx) = tokio::sync::oneshot::channel::<std::io::Result<std::process::Output>>();
    tokio::spawn(async move {
        let _ = tx.send(child.wait_with_output().await);
    });

    let poll = tokio::time::Duration::from_millis(300);
    loop {
        tokio::time::sleep(poll).await;

        if is_cancelled(cancel) {
            return Err("cancelled".into());
        }

        match rx.try_recv() {
            Ok(Ok(output)) => {
                if !output.status.success() {
                    return Err(format!("claude 분석 실패 (exit: {:?})", output.status.code()));
                }
                return parse_output(&String::from_utf8_lossy(&output.stdout));
            }
            Ok(Err(e)) => return Err(format!("claude 실행 오류: {e}")),
            Err(tokio::sync::oneshot::error::TryRecvError::Empty) => continue,
            Err(_) => return Err("프로세스 채널 오류".into()),
        }
    }
}

// ─── Tauri commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn analyze_project_for_onboarding(
    project_path: String,
    project_name: String,
    app: AppHandle,
) -> Result<(), String> {
    let cancel = Arc::new(AtomicBool::new(false));
    set_cancel_flag(cancel.clone());

    let emit_step = |step: u8, label: &str, done: bool| {
        app.emit("project:onboarding:step", OnboardingStepPayload {
            step, label: label.to_string(), done,
        }).ok();
    };

    // Step 1: project scan
    emit_step(1, "프로젝트 스캔 중...", false);
    if is_cancelled(&cancel) { clear_cancel_flag(); return Ok(()); }

    let docs_files = scan_docs_files(&project_path);
    let claude_md_path = std::path::Path::new(&project_path).join("CLAUDE.md");
    let existing_claude_md = std::fs::read_to_string(&claude_md_path).ok();
    let has_existing = existing_claude_md.is_some();

    emit_step(1, "프로젝트 스캔 완료", true);

    // Step 2: document analysis
    emit_step(2, "기존 문서 분석 중...", false);
    if is_cancelled(&cancel) { clear_cancel_flag(); return Ok(()); }

    // Small pause so UI can show the step
    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
    emit_step(2, "기존 문서 분석 완료", true);

    // Step 3: AI analysis
    emit_step(3, "AI가 정리 중...", false);
    if is_cancelled(&cancel) { clear_cancel_flag(); return Ok(()); }

    let prompt = build_prompt(&project_name, &project_path, &docs_files, &existing_claude_md);

    match call_claude(&prompt, &cancel).await {
        Ok((claude_md, ref_index)) => {
            if is_cancelled(&cancel) { clear_cancel_flag(); return Ok(()); }
            emit_step(3, "분석 완료", true);
            app.emit("project:onboarding:preview", OnboardingPreviewPayload {
                claude_md,
                ref_index,
                has_existing_claude_md: has_existing,
            }).ok();
        }
        Err(e) if e == "cancelled" => { /* no-op */ }
        Err(e) => {
            app.emit("project:onboarding:error", OnboardingErrorPayload { message: e }).ok();
        }
    }

    clear_cancel_flag();
    Ok(())
}

#[tauri::command]
pub fn cancel_project_onboarding() {
    if let Ok(g) = cancel_flag().lock() {
        if let Some(ref flag) = *g {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

#[tauri::command]
pub fn apply_project_onboarding(
    project_path: String,
    claude_md_content: String,
    ref_index_content: String,
) -> Result<(), String> {
    use std::path::Path;
    let root = Path::new(&project_path);

    std::fs::write(root.join("CLAUDE.md"), &claude_md_content)
        .map_err(|e| format!("CLAUDE.md 쓰기 실패: {e}"))?;

    let ref_path = root.join("docs/reference/index.md");
    if let Some(p) = ref_path.parent() { std::fs::create_dir_all(p).ok(); }
    std::fs::write(&ref_path, &ref_index_content)
        .map_err(|e| format!("docs/reference/index.md 쓰기 실패: {e}"))?;

    Ok(())
}
