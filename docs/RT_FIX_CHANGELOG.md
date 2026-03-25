# tunaFlow Roundtable 수정 이력

## 배경

tunaFlow v2에서 Roundtable(RT) 기능을 구현하는 과정에서 발견된 문제들과 해결 과정을 기록한다. 기존 tunadish 프로젝트의 RT 구현을 참조하여 tunaFlow에 포팅하였다.

---

## 1. Gemini CLI adapter 추가

**파일**: `src-tauri/src/agents/gemini.rs` (신규)

- `gemini -p <prompt>` 비대화형 실행
- `resolve_gemini_path()` 로 Windows npm 경로 자동 탐색
- stdout/stderr 분리 캡처 (deadlock 방지)
- `src-tauri/src/agents/mod.rs`에 `pub mod gemini` 등록
- `src-tauri/src/commands/agents.rs`에 `send_with_gemini` 커맨드 추가
- UI engine 토글에 Gemini 버튼 추가

---

## 2. Roundtable engine routing

**파일**: `src-tauri/src/commands/roundtable.rs`

- `RoundtableParticipant`에 `engine: Option<String>` 필드 추가
- `roundtable_run` 내부에서 `engine` 값에 따라 `claude::run` / `codex::run` / `gemini::run` / `opencode::run` 분기
- 미지원 엔진은 `AppError::Agent("unsupported engine: ...")` 반환
- 에러 발생 시 해당 참가자 메시지를 `status: "error"`로 저장하고 다음 참가자 계속 진행
- INSERT 시 `engine` 컬럼에 실제 엔진명 저장 (기존 하드코딩 `'claude-code'` 제거)

---

## 3. OpenCode adapter 추가

**파일**: `src-tauri/src/agents/opencode.rs` (신규)

- Codex/Gemini와 동일한 패턴
- `opencode run <prompt>` 비대화형 실행
- `send_with_opencode` 커맨드, UI 토글 추가

---

## 4. Roundtable context 공유

**파일**: `src-tauri/src/commands/roundtable.rs`

- 이전 참가자 응답을 다음 참가자 프롬프트에 누적 포함
- 형식: `## Other participants responses\n\n[agent] ...`
- 에러 응답은 제외 (`r.status == "done"` 필터)

---

## 5. Windows `.cmd` 파일 실행 문제 해결

**파일**: `agents/codex.rs`, `agents/gemini.rs`, `agents/opencode.rs`

**증상**: `batch file arguments are invalid`

**원인**: Windows에서 `.cmd` 파일을 `Command::new("file.cmd")`로 직접 실행하면 인자 파싱 실패

**해결**: `build_command()` 헬퍼 추가 — `.cmd` 확장자면 `cmd.exe /C <file>` 경유

```rust
#[cfg(target_os = "windows")]
fn build_command(bin: &PathBuf) -> Command {
    if bin.extension().and_then(|e| e.to_str()) == Some("cmd") {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(bin);
        c
    } else {
        Command::new(bin)
    }
}
```

---

## 6. Codex sandbox/PATH 문제 해결

**파일**: `agents/codex.rs`

**증상**: `Failed to spawn codex: program not found`

**원인**: Tauri subprocess가 shell PATH를 완전히 상속하지 않음 (npm global 경로 누락)

**해결**: `resolve_codex_path()` 추가 — `%APPDATA%\npm\codex.cmd` 등 일반적 설치 경로를 순차 탐색

---

## 7. Codex `--skip-git-repo-check` 추가

**증상**: `Not inside a trusted directory and --skip-git-repo-check was not specified`

**해결**: `cmd.arg("--skip-git-repo-check")` 추가

---

## 8. RT 프롬프트 정규화 (Phase 1 — tunadish 패턴 포팅)

**파일**: `src-tauri/src/commands/roundtable.rs`

**Before** (tunaFlow 자체 구현):
- `ROUNDTABLE_INSTRUCTION` (인프롬프트 지시문)
- `ROUNDTABLE_SYSTEM_PROMPT` (`--append-system-prompt`)
- `## Other participants responses\n[name] content` 형식

**After** (tunadish `_build_round_prompt` 패턴):
- 첫 참가자: `{topic}` 만 전달
- 후속 참가자: `**[name]**:\n{응답}` + `위 의견들을 참고하여 답변해주세요: {topic}`
- system_prompt 없음 (`system_prompt: None`)
- 이전 라운드 / 현재 라운드 컨텍스트 분리

```rust
fn build_round_prompt(
    topic: &str,
    transcript: &[(String, String)],     // 이전 라운드 전체
    current_round: &[(String, String)],  // 같은 라운드 선행 응답
) -> String
```

---

## 9. 다중 라운드 지원 (Phase 2)

**파일**: `roundtable.rs`, `types/index.ts`, `chatStore.ts`, `MessageInput.tsx`

- `RoundtableRunInput.rounds: Option<u32>` (1-3, 기본 1)
- 바깥 `for round_num in 1..=rounds` 루프
- `transcript` (이전 라운드) / `round_responses` (현재 라운드) 분리
- 2라운드 이상이면 `--- Round N/M ---` 헤더 메시지 삽입
- UI: Rounds 셀렉터 (1/2/3)

---

## 10. 후속 토론 (Phase 3)

**파일**: `roundtable.rs`, `lib.rs`, `chatStore.ts`, `MessageInput.tsx`

- `roundtable_followup` 커맨드 추가
- DB에서 기존 assistant 메시지 (`persona IS NOT NULL AND status = 'done'`) 로드 → 이전 transcript로 사용
- 새 토픽으로 1라운드 추가 실행
- UI: "Follow-up" 버튼 (기존 RT 메시지 있을 때만 표시)

---

## 11. 아카이브 (Phase 5)

**파일**: `roundtable.rs`

- RT 완료 시 `memos` 테이블에 `type='roundtable_archive'` 로 저장
- 내용: topic / rounds / participants / 전체 transcript
- Follow-up도 별도 아카이브 생성
- DB 스키마 변경 없음 (기존 `memos` 테이블 활용)

---

## 12. CLI 에이전트 구조적 문제 해결 (가장 중요)

### 12-1. 작업 디렉토리 (cwd)

**파일**: `agents/claude.rs`, `agents/codex.rs`, `agents/gemini.rs`, `agents/opencode.rs`

**증상**: Gemini가 토론 대신 tunaFlow 프로젝트 구조를 분석. Claude가 "역할 범위 밖" 거부.

**원인**: CLI 에이전트가 tunaFlow 프로젝트 디렉토리에서 실행되어 자동으로 코딩 모드에 진입

**해결**: 모든 adapter에 `.current_dir(std::env::temp_dir())` 적용

```rust
fn neutral_cwd() -> PathBuf {
    std::env::temp_dir()
}
```

### 12-2. Codex stdin 모드

**파일**: `agents/codex.rs`

**증상**: Codex가 이전 참가자 응답을 무시하고 "다른 에이전트 답변을 붙여 주세요" 응답

**원인**: tunadish는 Codex에 stdin으로 프롬프트를 전달 (`-` 플래그), tunaFlow는 CLI 인자로 전달

**해결**:
```rust
// Before
cmd.arg(&input.prompt);

// After
cmd.arg("-");  // stdin 모드
cmd.stdin(Stdio::piped());
// child.stdin에 prompt write
```

추가 플래그: `--json`, `--color=never` (tunadish 동일)

### 12-3. Windows node 직접 호출

**파일**: `agents/codex.rs`, `agents/gemini.rs`

**증상**: `.cmd` 래퍼 경유 시 인자 파싱 문제 반복 발생

**해결**: `%APPDATA%\npm\node_modules\` 에서 JS 엔트리포인트를 직접 찾아 `node <script>` 로 호출

```
Codex:  node %APPDATA%\npm\node_modules\@openai\codex\bin\codex.js exec --json ...
Gemini: node --no-warnings=DEP0040 %APPDATA%\npm\node_modules\@google\gemini-cli\dist\index.js -p ...
```

---

## 최종 검증 결과

| 참가자 | 엔진 | 토론 참여 | 이전 응답 참조 |
|--------|------|----------|--------------|
| Haiku | claude | ✗ (모델 한계 — Sonnet 이상 필요) | N/A |
| Codex | codex | ✓ 정상 | ✓ 정상 |
| Gemini | gemini | ✓ 정상 | ✓ 정상 |

**참고**: Claude Haiku는 Claude Code CLI의 코딩 시스템 프롬프트를 강하게 따라 비코딩 토론을 거부함. Sonnet 이상 모델은 정상 동작. 이는 모델 특성이지 코드 문제가 아님.
