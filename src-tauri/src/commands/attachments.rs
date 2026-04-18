//! Attachment storage — 사용자가 채팅 입력창에 첨부한 이미지/파일을
//! 프로젝트 내부 `.tunaflow/attachments/` 에 안전히 저장한다.
//!
//! ## 설계
//!
//! - **저장 위치**: `<project>/.tunaflow/attachments/<timestamp>-<name>`
//!   - 에이전트 Read 툴의 프로젝트 scope 안에 있어야 첨부를 읽을 수 있음
//!   - timestamp prefix 로 동일 이름 중복 회피
//! - **.gitignore 자동 생성**: 해당 디렉토리에 `*\n!.gitignore` 로 내부
//!   파일만 ignore. 상위 프로젝트 .gitignore 는 건드리지 않음
//! - **파일명 sanitize**: `/`, `\`, `..` 제거 + control char 제거 + 길이 200 제한
//! - **크기 상한 20MB**: 토큰 폭주 방지. 초과시 Err
//! - **경로 traversal 방지**: 삭제 시 `.tunaflow/attachments/` 아래만 허용

use std::fs;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose, Engine};
use serde::Serialize;

use crate::errors::AppError;

const ATTACHMENT_DIR: &str = ".tunaflow/attachments";
const GITIGNORE_CONTENT: &str = "# tunaFlow attachments — auto-generated\n*\n!.gitignore\n";
const MAX_SIZE: u64 = 20 * 1024 * 1024;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentSaved {
    pub abs_path: String,
    pub rel_path: String,
    pub size: u64,
}

fn ensure_dir(project_path: &Path) -> Result<PathBuf, AppError> {
    let dir = project_path.join(ATTACHMENT_DIR);
    fs::create_dir_all(&dir)?;
    let gi = dir.join(".gitignore");
    if !gi.exists() {
        if let Err(e) = fs::write(&gi, GITIGNORE_CONTENT) {
            eprintln!("[attachments] gitignore write failed: {e}");
        }
    }
    Ok(dir)
}

/// Clean an untrusted filename. Drops path separators, `..`, control chars,
/// and caps length. Guaranteed to produce a value that cannot escape the
/// target dir via path composition.
pub(crate) fn sanitize_name(name: &str) -> String {
    let mut out: String = name
        .chars()
        .filter(|c| !c.is_control())
        .map(|c| match c {
            '/' | '\\' => '_',
            _ => c,
        })
        .collect();
    // `..` 이 연속되지 않도록
    while out.contains("..") {
        out = out.replace("..", "_");
    }
    // 리딩 점 파일(.bashrc 등) 방어
    while out.starts_with('.') {
        out.remove(0);
    }
    if out.chars().count() > 200 {
        out = out.chars().take(200).collect();
    }
    out
}

#[tauri::command]
pub fn save_attachment(
    project_path: String,
    name: String,
    data_base64: String,
) -> Result<AttachmentSaved, AppError> {
    let project = PathBuf::from(&project_path);
    if !project.is_dir() {
        return Err(AppError::NotFound("project path not a directory".into()));
    }
    let dir = ensure_dir(&project)?;

    let clean_name = sanitize_name(&name);
    if clean_name.is_empty() {
        return Err(AppError::Agent("invalid filename".into()));
    }

    let bytes = general_purpose::STANDARD
        .decode(&data_base64)
        .map_err(|e| AppError::Agent(format!("base64 decode failed: {e}")))?;

    if bytes.len() as u64 > MAX_SIZE {
        return Err(AppError::Agent(format!(
            "file too large: {} bytes (max {})",
            bytes.len(),
            MAX_SIZE
        )));
    }

    // %Y%m%d-%H%M%S-%3f → 20260418-143052-123
    let timestamp = chrono::Local::now()
        .format("%Y%m%d-%H%M%S-%3f")
        .to_string();
    let filename = format!("{timestamp}-{clean_name}");
    let abs_path = dir.join(&filename);

    fs::write(&abs_path, &bytes)?;

    let rel_path = format!("{ATTACHMENT_DIR}/{filename}");
    Ok(AttachmentSaved {
        abs_path: abs_path.to_string_lossy().to_string(),
        rel_path,
        size: bytes.len() as u64,
    })
}

#[tauri::command]
pub fn delete_attachment(abs_path: String) -> Result<(), AppError> {
    // 보안: 경로가 `.tunaflow/attachments` 를 포함해야 삭제 허용. 그 외엔 거부.
    let p = PathBuf::from(&abs_path);
    let canonical = p.components();
    let under_attachments = canonical
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .windows(2)
        .any(|w| w[0] == ".tunaflow" && w[1] == "attachments");
    if !under_attachments {
        return Err(AppError::Agent(
            "refusing to delete: path is not under .tunaflow/attachments".into(),
        ));
    }
    match fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_separators_and_traversal() {
        assert_eq!(sanitize_name("foo.png"), "foo.png");
        assert_eq!(sanitize_name("a/b.png"), "a_b.png");
        assert_eq!(sanitize_name("a\\b.png"), "a_b.png");
        // `..` → `__` (먼저 `/`→`_` 로 치환 후 남은 `..` 를 또 치환), leading `.` 없음
        assert_eq!(sanitize_name("../etc/passwd"), "__etc_passwd");
        assert_eq!(sanitize_name(".bashrc"), "bashrc");
    }

    #[test]
    fn sanitize_caps_length() {
        let long = "a".repeat(500);
        let out = sanitize_name(&long);
        assert_eq!(out.chars().count(), 200);
    }

    #[test]
    fn sanitize_rejects_control_chars() {
        assert_eq!(sanitize_name("hi\0there"), "hithere");
        assert_eq!(sanitize_name("a\nb.png"), "ab.png");
    }

    #[test]
    fn save_roundtrip_in_tempdir() {
        let tmp = tempfile::TempDir::new().unwrap();
        let project = tmp.path().to_string_lossy().to_string();

        // "hello" 를 base64 인코딩
        let data = general_purpose::STANDARD.encode("hello");
        let saved = save_attachment(project.clone(), "greeting.txt".into(), data).unwrap();

        assert!(saved.rel_path.starts_with(".tunaflow/attachments/"));
        assert_eq!(saved.size, 5);
        // 실제 디스크에 내용 확인
        let content = fs::read_to_string(&saved.abs_path).unwrap();
        assert_eq!(content, "hello");
        // .gitignore 자동 생성
        let gi = tmp.path().join(".tunaflow/attachments/.gitignore");
        assert!(gi.exists());
    }

    #[test]
    fn save_rejects_oversize() {
        let tmp = tempfile::TempDir::new().unwrap();
        let project = tmp.path().to_string_lossy().to_string();
        // 21MB
        let big = vec![0u8; 21 * 1024 * 1024];
        let data = general_purpose::STANDARD.encode(&big);
        let err = save_attachment(project, "big.bin".into(), data).unwrap_err();
        assert!(format!("{err}").contains("too large"));
    }

    #[test]
    fn delete_refuses_outside_attachments_dir() {
        let err = delete_attachment("/etc/passwd".into()).unwrap_err();
        assert!(format!("{err}").contains("refusing to delete"));
    }

    #[test]
    fn delete_nonexistent_is_ok() {
        let tmp = tempfile::TempDir::new().unwrap();
        let fake = tmp
            .path()
            .join(".tunaflow/attachments/nonexistent.png")
            .to_string_lossy()
            .into_owned();
        assert!(delete_attachment(fake).is_ok());
    }
}
