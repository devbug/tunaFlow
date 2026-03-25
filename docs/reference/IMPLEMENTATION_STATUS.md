# IMPLEMENTATION_STATUS.md — 구현 상태 문서

> **최종 갱신**: 2025-03-25 (실제 코드 기준 검증)

---

## 1. 도메인 개념 검증표

| 개념 | 문서상 정의 | 코드상 구현 형태 | 저장 위치 | 상태 | 근거 파일 |
|------|-----------|----------------|----------|------|---------|
| **Workspace** | 로컬 파일시스템 루트, 프로젝트 자동 발견 | 미구현 | - | **불일치** — 코드에 scan_workspace 없음 | `src-tauri/src/lib.rs` (등록된 커맨드에 없음) |
| **Project** | 작업 단위, 대화의 소유자 | `Project` struct, CRUD 커맨드 | SQLite `projects` | 일치 | `src-tauri/src/db/models.rs:6-16`, `commands/projects.rs` |
| **Conversation** | 대화 세션, Branch 루트 | `Conversation` struct, CRUD + delete cascade | SQLite `conversations` | 일치 | `db/models.rs:19-42`, `commands/conversations.rs` |
| **Branch** | Conversation 내 독립 메시지 스트림 | `Branch` struct + shadow conversation (`branch:{id}`) | SQLite `branches` + `conversations` | 일치 | `db/models.rs:92-105`, `commands/branches.rs` |
| **Message** | 대화 내 개별 메시지 | `Message` struct | SQLite `messages` | 일치 | `db/models.rs:45-58` |
| **Agent** | AI 에이전트 선언적 정의 (md 파일) | `loader.rs`가 `docs/agents/*.md` 파싱 | 파일시스템 | **부분일치** — 로더 존재하나 관리 UI 없음 | `agents/loader.rs` |
| **ContextPack** | runtime-only 프롬프트 주입 구조 | `assemble_system_prompt()` + 섹션 빌더 | 인메모리 (비영속) | 일치 | `commands/agents.rs:190-348` |
| **ResumeToken** | CLI 세션 연속성 토큰 | `conversations.resume_token` + `resume_token_engine` | SQLite (conversations 인라인) | 일치 | `db/schema.rs:9-15` (V2), `commands/agents.rs:298-307` |
| **Artifact** | 대화에서 생성된 문서 산출물 | `Artifact` struct, CRUD 커맨드 | SQLite `artifacts` | 일치 | `db/models.rs:76-89`, `commands/artifacts.rs` |
| **Memo** | 메시지의 영구 스냅샷 | `Memo` struct, CRUD 커맨드 | SQLite `memos` | 일치 | `db/models.rs:61-73`, `commands/memos.rs` |
| **Skill** | 스킬 정의 (md 파일) | `list_skills()`, `get_skill()` | 파일시스템 `~/.tunaflow/skills/` | **부분일치** — 문서는 `~/.tunachat/skills/` 표기 | `commands/skills.rs` |
| **Guardrail** | 프롬프트 크기 제한 | 섹션별 truncation + 전체 60K 제한 | 인메모리 | 일치 | `guardrail.rs` |
| **RoundtableState** | RT 실행 상태 | 독립 엔티티 아님. `roundtable_run` 내부 로컬 변수로만 존재 | 인메모리 (함수 로컬) | **부분일치** — 문서에서 엔티티처럼 기술했으나 실제로는 transient | `commands/roundtable.rs` |
| **Roundtable** | `Conversation.mode='roundtable'` 특수 케이스 | mode='roundtable'인 Conversation + roundtable_run 커맨드 | SQLite (Conversation) | 일치 | `commands/roundtable.rs`, `commands/conversations.rs:74-75` |
| **TraceEntry** | 토큰/비용 추적 | trace_log 테이블 스키마만 존재. 쓰기 로직 없음 | SQLite `trace_log` (미사용) | **불일치** — 스키마만 있고 실제 기록 없음 | `db/schema.rs:126-135` |

---

## 2. 기능 구현 상태표

### 2.1 Core

| 기능 | 상태 | UI | 백엔드 | 근거 파일 | 비고 |
|------|------|-----|-------|---------|------|
| 프로젝트 생성/목록/조회 | **완료** | ✅ | ✅ | `commands/projects.rs`, `Sidebar.tsx` | 자동 default 프로젝트 생성 |
| 대화 생성/목록/선택 | **완료** | ✅ | ✅ | `commands/conversations.rs`, `Sidebar.tsx` | |
| 대화 삭제 (cascade) | **완료** | ✅ | ✅ | `commands/conversations.rs:118-154`, `Sidebar.tsx` | memos/artifacts/trace_log 수동 DELETE, shadow conv도 삭제 |
| 메시지 전송/목록 | **완료** | ✅ | ✅ | `commands/messages.rs`, `ChatPanel.tsx` | |
| 메시지 스트리밍 (Claude) | **완료** | ✅ | ✅ | `commands/agents.rs:646-853`, `chatStore.ts:187-232` | Tauri `claude:chunk` 이벤트 |
| ResumeToken 저장/복원 | **완료** | ❌ (UI 표시 없음) | ✅ | `commands/agents.rs:298-307` | Claude 전용. 엔진 변경 시 폐기 |

### 2.2 Multi-Agent

| 기능 | 상태 | UI | 백엔드 | 근거 파일 | 비고 |
|------|------|-----|-------|---------|------|
| Claude adapter (one-shot) | **완료** | ✅ | ✅ | `agents/claude.rs`, `commands/agents.rs:222-424` | ContextPack 전체 지원 |
| Claude adapter (streaming) | **완료** | ✅ | ✅ | `agents/claude.rs:stream_run`, `commands/agents.rs:646-853` | |
| Codex adapter | **완료** | ✅ | ✅ | `agents/codex.rs` | stdin 모드, JSONL 파싱, lite context 주입 |
| Gemini adapter | **완료** | ✅ | ✅ | `agents/gemini.rs` | node 직접 호출, lite context 주입 |
| OpenCode adapter | **완료** | ✅ | ✅ | `agents/opencode.rs` | lite context 주입 |
| 엔진 선택 UI | **완료** | ✅ | - | `NewMessageInput.tsx` | Claude/Codex/Gemini/OpenCode 드롭다운 |
| Roundtable 실행 | **완료** | ✅ | ✅ | `commands/roundtable.rs:309-373`, `NewMessageInput.tsx` | 1-3 라운드 |
| Roundtable follow-up | **완료** | ✅ | ✅ | `commands/roundtable.rs:379-447`, `NewMessageInput.tsx` | |
| Roundtable transcript 아카이브 | **완료** | ❌ | ✅ | `commands/roundtable.rs:234-298` | memos에 roundtable_archive 타입으로 저장 |
| Roundtable 뷰 (카드) | **완료** | ✅ | - | `RoundtableView.tsx` | system header 인식 + persona heuristic fallback 2단계 전략 |

### 2.3 Branch

| 기능 | 상태 | UI | 백엔드 | 근거 파일 | 비고 |
|------|------|-----|-------|---------|------|
| Branch 생성 | **완료** | ✅ | ✅ | `commands/branches.rs:60-126`, `ContextPanel.tsx` | 자동 라벨 (b1, b1.1, ...) |
| Branch 목록 | **완료** | ✅ | ✅ | `commands/branches.rs:30-58`, `ContextPanel.tsx` | |
| Branch stream (열기) | **완료** | ✅ | ✅ | `commands/branches.rs:134-189`, `chatStore.ts:373-393` | shadow conversation 생성 |
| Branch adopt | **부분** | ✅ | ✅ | `commands/branches.rs:195-241` | placeholder summary만 삽입. 실제 요약 생성 미구현 |
| Branch → thread 패널 | **미구현** | ❌ | - | - | v0에 `BranchThreadPanel.tsx` 디자인 존재 |
| Branch-git 연동 | **미구현** | ❌ | ❌ | `db/schema.rs:86` | git_branch 컬럼 존재하나 사용 안 함 |
| Branch diff | **미구현** | ❌ | ❌ | - | |

### 2.4 Data/Context

| 기능 | 상태 | UI | 백엔드 | 근거 파일 | 비고 |
|------|------|-----|-------|---------|------|
| Memo CRUD | **완료** | ✅ | ✅ | `commands/memos.rs`, `ContextPanel.tsx` | 메시지 hover → Memo 버튼 |
| Artifact CRUD | **완료** | ✅ | ✅ | `commands/artifacts.rs`, `ContextPanel.tsx` | status 변경 (draft/approved/rejected) |
| Skill 목록/토글 | **완료** | ✅ | ✅ | `commands/skills.rs`, `ContextPanel.tsx` | `~/.tunaflow/skills/{name}/SKILL.md` |
| Cross-session 토글 | **완료** | ✅ | ✅ | `commands/agents.rs:109-130`, `ContextPanel.tsx` | 대화 3개 최근 메시지 주입 |
| ContextPack 조립 | **완료** | ❌ (내부 동작) | ✅ | `commands/agents.rs:190-348` | Agent prompt + Skills + rawq + Cross-session + Context |
| Guardrail | **완료** | ❌ (stderr 로그) | ✅ | `guardrail.rs` | 섹션별 8K/4K/6K/8K, 전체 60K |
| rawq 코드 검색 | **부분** | ❌ | ✅ | `agents/rawq.rs` | 기본 키워드 매칭만. 외부 rawq 미연동 |
| FTS 전문 검색 | **미구현** | ❌ | ❌ | `db/schema.rs:137-139` | messages_fts 테이블 스키마만 존재 |
| trace_log 토큰 추적 | **미구현** | ❌ | ❌ | `db/schema.rs:126-135` | 테이블만 존재, 쓰기 로직 없음 |
| Agent 정의 관리 | **부분** | ❌ | ✅ | `agents/loader.rs` | 로더만 존재, UI 없음 |

### 2.5 UI 구조

| 기능 | 상태 | 근거 파일 | 비고 |
|------|------|---------|------|
| 3패널 레이아웃 | **완료** | `AppShell.tsx` | Sidebar + ChatPanel + ContextPanel |
| Tailwind CSS v4 다크 테마 | **완료** | `index.css`, `index.html` | |
| 에이전트 색상 배지 | **완료** | `MessageItem.tsx`, `lib/utils.ts` | Claude/Codex/Gemini/OpenCode |
| StatusBar | **완료** | `StatusBar.tsx` | mode, branch, skills, cross-session 표시 |
| Stream/RT 뷰 토글 | **완료** | `ChatPanel.tsx` | RT 대화에서만 표시 |
| 대화 검색 | **완료** | `Sidebar.tsx` | 클라이언트 필터링 |
| 스트리밍 타이핑 인디케이터 | **완료** | `MessageItem.tsx` | typing-dot 애니메이션 |
| Soft delete (30일 보관) | **미구현** | - | 사용자 요청 있었으나 미착수 |

---

## 3. 기술 부채

| 항목 | 영향 | 위치 |
|------|------|------|
| ~~레거시 컴포넌트 6개~~ | ~~삭제 완료~~ (2025-03-25) | ~~`src/components/{5개}.tsx`, `src/pages/MainPage.tsx`~~ |
| DATA_MODEL_REVISED.md 근거 파일 경로 다수 오류 | 문서 신뢰도 저하 | 존재하지 않는 파일 참조: `chatStore.ts:29-40`, `contextStore.ts`, `runStore.ts`, `db.ts` 등 |
| Skill 경로 불일치 | 혼란 유발 | 문서 `~/.tunachat/skills/`, 코드 `~/.tunaflow/skills/` |
| 스키마 버전 불일치 | 문서 혼란 | 문서에서 memos=v3, artifacts=v5 표기. 실제 V1에 모두 포함 |
| Branch adopt placeholder | 기능 미완성 | `commands/branches.rs:219-222` — "Summary generation not implemented yet" |
| ~~Codex/Gemini/OpenCode context 미적용~~ | **해결** — lite context (최근 4메시지) prompt prefix 주입 | `commands/agents.rs:build_lite_context_prompt` |

---

## 4. UI 개선 우선순위표

| # | 개선 항목 | 현재 문제 | 관련 파일 | 난이도 | 우선순위 | 비고 |
|---|---------|---------|---------|-------|---------|------|
| 1 | ~~Branch → thread 슬라이딩 패널~~ | **구현 완료** — Peek 모드로 슬라이딩 패널 추가 | `BranchThreadPanel.tsx`, `chatStore.ts:peekBranch` | - | ✅ | Open(대화교체)과 Peek(오버레이) 병존 |
| 2 | 레거시 컴포넌트 정리 | 6개 미사용 파일이 혼란 유발 | `src/components/*.tsx`, `src/pages/MainPage.tsx` | 하 | **P0** | 단순 삭제 |
| 3 | 메시지별 메타데이터 표시 | 토큰 수, 비용, 실행 시간 등 불가시 | `MessageItem.tsx` | 중 | **P1** | trace_log 기록 로직 필요 |
| 4 | RT 라운드 구분 개선 | 라운드 번호를 heuristic으로 추론 | `RoundtableView.tsx` | 중 | **P1** | DB에 round 필드 추가 검토 |
| 5 | 에러 인라인 표시 | 상단 배너 한 줄만 | `ChatPanel.tsx`, `MessageItem.tsx` | 하 | **P1** | `message.status === "error"` 이미 있음 |
| 6 | 대화 라벨 편집 | customLabel 필드 있으나 편집 UI 없음 | `Sidebar.tsx` | 하 | **P2** | 더블클릭 인라인 편집 |
| 7 | Artifact 상세 뷰 | 인라인 접기/펼치기만 | `ContextPanel.tsx` | 중 | **P2** | 별도 패널/모달 |
| 8 | 프로젝트 관리 UI | 자동 생성만, 수정/삭제 없음 | `Sidebar.tsx` | 하 | **P2** | |
| 9 | 스트리밍 상태 개선 | 스트리밍 중 다른 조작 미차단 | `NewMessageInput.tsx` | 하 | **P2** | `isRunning` 체크는 있으나 UI 피드백 미흡 |
| 10 | 다크/라이트 테마 토글 | 현재 다크 고정 | `index.html`, `index.css` | 중 | **P3** | CSS 변수는 준비됨 |

---

## 5. Provider별 기능 비교표

코드 기준 검증 결과. 근거: `src-tauri/src/commands/agents.rs`, `src-tauri/src/agents/*.rs`

| 기능 | Claude | Codex | Gemini | OpenCode |
|------|--------|-------|--------|----------|
| **One-shot 전송** | ✅ `send_with_claude` | ✅ `send_with_codex` | ✅ `send_with_gemini` | ✅ `send_with_opencode` |
| **Streaming** | ✅ `stream_with_claude` | ❌ | ❌ | ❌ |
| **ContextPack (5단계)** | ✅ | ❌ | ❌ | ❌ |
| **System prompt 주입** | ✅ `--append-system-prompt` | ❌ (None 전달) | ❌ (None 전달) | ❌ (None 전달) |
| **Resume token** | ✅ `--resume` | ❌ | ❌ | ❌ |
| **Conversation context 로드** | ✅ (current + parent + cross-session) | ✅ (lite: 최근 4개) | ✅ (lite: 최근 4개) | ✅ (lite: 최근 4개) |
| **Skill content 주입** | ✅ | ❌ | ❌ | ❌ |
| **rawq 코드 검색** | ✅ | ❌ | ❌ | ❌ |
| **토큰/비용 추적** | ✅ (RunOutput에서 추출) | ❌ (0 반환) | ❌ (0 반환) | ❌ (0 반환) |
| **updated_at 갱신** | ✅ + usage | ✅ (updated_at만) | ✅ (updated_at만) | ✅ (updated_at만) |
| **engine 문자열** | `"claude-code"` | `"codex"` | `"gemini"` | `"opencode"` |
| **Roundtable 참여** | ✅ `run_participant` | ✅ `run_participant` | ✅ `run_participant` | ✅ `run_participant` |
| **RT 시 system_prompt** | ❌ (None) | ❌ (None) | ❌ (None) | ❌ (None) |

**핵심 격차**: Claude만 full ContextPack(5단계)을 지원. Codex/Gemini/OpenCode는 lite context(최근 4메시지 prefix)만 주입. Skill, rawq, cross-session 정보는 Claude 전용. Roundtable에서는 모든 엔진이 `system_prompt: None`으로 호출됨.

---

## 6. 레거시/정리 후보 표

검증 방법: 모든 `.tsx` 파일에서 import 참조 검색 (Grep). 결과: 아래 6개 파일은 어디서도 import되지 않음.

| 파일 경로 | 현재 사용 여부 | 근거 | 처리 권장 |
|---------|-------------|------|---------|
| `src/components/ConversationList.tsx` | ✅ **삭제 완료** | `Sidebar.tsx`가 대체 | 완료 |
| `src/components/MessageInput.tsx` | ✅ **삭제 완료** | `NewMessageInput.tsx`가 대체 | 완료 |
| `src/components/MessageList.tsx` | ✅ **삭제 완료** | `ChatPanel.tsx`+`MessageItem.tsx`가 대체 | 완료 |
| `src/components/SidePanel.tsx` | ✅ **삭제 완료** | `ContextPanel.tsx`가 대체 | 완료 |
| `src/components/ProjectList.tsx` | ✅ **삭제 완료** | `Sidebar.tsx`에 통합 | 완료 |
| `src/pages/MainPage.tsx` | ✅ **삭제 완료** | `AppShell.tsx`가 대체 | 완료 |

> 6개 파일 삭제 및 `src/pages/` 디렉토리 제거 완료 (2025-03-25). `tsc --noEmit` + `vite build` 모두 정상.
