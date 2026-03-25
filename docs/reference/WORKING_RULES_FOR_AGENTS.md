# WORKING_RULES_FOR_AGENTS.md — 작업자용 실행 가이드

> **대상**: Claude Code, Codex, 또는 사람이 이 프로젝트를 수정할 때 참조하는 규칙.

---

## 1. 문서 참조 순서

1. `docs/HANDOFF_TUNAFLOW_MASTER.md` — 프로젝트 전체 파악
2. `docs/reference/IMPLEMENTATION_STATUS.md` — 무엇이 구현되었는지
3. `docs/reference/FRONTEND_ARCHITECTURE.md` — UI 구조
4. `docs/reference/DATA_MODEL_REVISED.md` — 도메인 모델 SSOT
5. 이 문서 — 수정 규칙

---

## 2. 최소 수정 원칙

- 요청된 범위만 수정한다.
- "더 좋아 보이는" 리팩토링은 별도 요청 없이 하지 않는다.
- 기존 파일 삭제는 반드시 사용자 확인 후.
- 새 파일 생성보다 기존 파일 수정 우선.

---

## 3. 수정 영역별 규칙

### 3.1 src-tauri (Rust 백엔드) — 수정 최소화

| 허용 | 금지 |
|------|------|
| 버그 수정 | 구조 변경 |
| 새 커맨드 추가 (명확한 목적) | 기존 커맨드 시그니처 변경 |
| 마이그레이션 추가 (V3_SCHEMA) | 기존 테이블 ALTER 직접 수행 |
| 에이전트 래퍼 추가 | DB lock 패턴 변경 |

**DB lock 패턴 준수**:
```
lock → load data → unlock → subprocess 실행 → lock → persist
```
이 패턴을 위반하면 subprocess 실행 중 UI 전체가 블록됨.

근거: `commands/agents.rs` 모든 send_with_* 함수 구조

### 3.2 src/components/tunaflow/ — 자유롭게 수정 가능

현재 사용 중인 UI 컴포넌트. v0 디자인 기반이므로 스타일/레이아웃 수정 자유.

**주의사항**:
- `chatStore.ts`의 액션 시그니처를 변경하면 여러 컴포넌트에 영향.
- `types/index.ts`의 타입 변경은 프론트 전체에 영향.
- `lib/utils.ts`의 `AGENT_COLORS` 등은 여러 컴포넌트에서 사용.

### 3.3 src/stores/chatStore.ts — 신중하게 수정

- 새 상태 필드 추가: OK (기존에 영향 없음)
- 새 액션 추가: OK
- 기존 액션의 Tauri invoke 호출 수정: 백엔드 커맨드와 매칭 확인 필수
- 액션 시그니처 변경: 호출하는 모든 컴포넌트 함께 수정

### 3.4 src/types/index.ts — 신중하게 수정

- 타입 추가: OK
- 기존 타입 필드 추가: OK (Optional 필드)
- 기존 타입 필드 변경/삭제: Rust models.rs와 정확히 매칭해야 함

### 3.5 레거시 파일 — 무시

`src/components/` 직하 + `src/pages/MainPage.tsx`는 사용되지 않음. 수정 불필요.

---

## 4. DB 스키마 변경 체크리스트

1. `src-tauri/src/db/schema.rs`에 `V3_SCHEMA` (또는 다음 버전) 상수 추가
2. `src-tauri/src/db/migrations.rs`에서 새 버전 적용 로직 추가
3. 필요시 `src-tauri/src/db/models.rs`에 새 필드 추가
4. `src/types/index.ts`에 대응하는 TS 타입 추가/수정
5. 관련 Tauri 커맨드에서 새 필드 읽기/쓰기
6. `src-tauri/src/lib.rs`에 새 커맨드 등록 (필요 시)
7. `src/stores/chatStore.ts`에 새 invoke 호출 추가 (필요 시)

---

## 5. 새 에이전트 어댑터 추가 체크리스트

1. `src-tauri/src/agents/{name}.rs` 작성 — `run()` 함수 필수
2. `src-tauri/src/agents/mod.rs`에 `pub mod {name};` 추가
3. `src-tauri/src/commands/agents.rs`에 `send_with_{name}` 커맨드 작성
4. `src-tauri/src/lib.rs`에 커맨드 등록
5. `src-tauri/src/commands/roundtable.rs`의 `run_participant()`에 엔진 매칭 추가
6. `src/stores/chatStore.ts`에 `sendWith{Name}` 액션 추가
7. `src/components/tunaflow/NewMessageInput.tsx`에 엔진 버튼 추가
8. `src/lib/utils.ts`에 `AgentEngine` 타입과 색상 추가
9. `src/index.css`에 `--agent-{name}` CSS 변수 추가

---

## 6. 주요 구조적 제약

### 6.1 단일 Store
프론트엔드 상태는 `chatStore.ts` 하나. contextStore, runStore 등 별도 Store를 만들지 않는다.

### 6.2 에이전트 subprocess cwd
모든 CLI 에이전트는 `std::env::temp_dir()`을 cwd로 사용한다.
이유: 프로젝트 디렉토리를 cwd로 하면 에이전트가 "코딩 모드"에 진입하여 토론을 거부함.

근거: `agents/claude.rs:neutral_cwd()`, `docs/RT_FIX_CHANGELOG.md`

### 6.3 ContextPack은 Claude만 full 지원
Codex/Gemini/OpenCode는 시스템 프롬프트/ContextPack 없이 prompt만 전달.
이는 각 CLI 도구의 인터페이스 제약 때문.

근거: `commands/agents.rs:431-637`

### 6.4 Branch = shadow conversation
브랜치 메시지는 `conversation_id = "branch:{branchId}"` 형태의 shadow conversation에 저장됨.
FK 제약을 위해 conversations 테이블에 shadow row가 생성됨.

근거: `commands/branches.rs:128-189`

---

## 7. 테스트/실행 방법

```bash
# 개발 모드
npm run tauri dev

# 프론트엔드만 빌드 확인
npx tsc --noEmit && npx vite build

# Rust 빌드 확인
cd src-tauri && cargo check
```

DB 파일 위치: `%APPDATA%/com.tunaflow.dev/tunaflow.db` (Windows)

---

## 8. 문서 동시 업데이트 원칙

**새 기능 추가 시 반드시 아래 문서를 함께 업데이트하라:**

| 변경 종류 | 업데이트 대상 문서 |
|---------|---------------|
| 새 엔티티/테이블 추가 | `docs/reference/DATA_MODEL_REVISED.md` |
| 새 커맨드/기능 구현 | `docs/reference/IMPLEMENTATION_STATUS.md` |
| UI 컴포넌트 추가/변경 | `docs/reference/FRONTEND_ARCHITECTURE.md` |
| 주요 아키텍처 변경 | `docs/HANDOFF_TUNAFLOW_MASTER.md` |

문서를 업데이트하지 않으면 다음 작업자가 코드와 문서 간 불일치로 혼란을 겪게 된다.
이전에 발견된 14곳의 허위 파일 경로(`contextStore.ts`, `db.ts`, `runStore.ts` 등)가 대표적 사례.

---

## 9. Provider별 주의사항

### Claude
- 유일한 full ContextPack 지원 엔진
- streaming 지원 (`stream_with_claude`)
- ResumeToken 저장/복원
- `engine` 문자열: `"claude-code"`

### Codex
- stdin 모드로 prompt 전달 (`-` flag)
- Windows: `node codex.js` 직접 호출 (`.cmd` 래퍼 불가)
- ContextPack/system_prompt/resume_token 미지원
- `engine` 문자열: `"codex"`

### Gemini
- Windows: `node --no-warnings index.js` 직접 호출
- `-p <prompt>` 인자로 전달
- ContextPack/system_prompt/resume_token 미지원
- `engine` 문자열: `"gemini"`

### OpenCode
- `run <prompt>` 서브커맨드
- ContextPack/system_prompt/resume_token 미지원
- `engine` 문자열: `"opencode"`

근거: `src-tauri/src/agents/claude.rs`, `codex.rs`, `gemini.rs`, `opencode.rs`
