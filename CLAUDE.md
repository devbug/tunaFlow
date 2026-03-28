# tunaFlow — Claude Code Handoff Document

> 최종 갱신: 2026-03-28
> SSOT: `docs/reference/dataModelRevised.md` (도메인 모델), `docs/reference/implementationStatus.md` (구현 현황)

---

## 1. 프로젝트 개요

tunaFlow는 **다중 에이전트 오케스트레이션 IDE**이다. Tauri 2 + React + TypeScript + Rust + SQLite 기반.

핵심 기능:
- 프로젝트 단위로 Claude/Codex/Gemini/OpenCode 에이전트를 실행
- Roundtable(RT) 토론: 여러 에이전트가 순차(Sequential) 또는 병렬(Deliberative)로 토론
- Branch: 대화 중간에서 분기해 독립 실험 후 adopt(요약 삽입)
- Plan/Artifact/Memo: 작업 계획, 산출물, 메모 관리
- ContextPack: 매 요청마다 mode(Lite/Standard/Full)에 따라 system prompt 자동 조립

---

## 2. 기술 스택

| 계층 | 기술 |
|---|---|
| Desktop shell | Tauri 2 |
| Frontend | React 18 + TypeScript + Zustand 5 + Tailwind CSS 4 |
| Backend | Rust (tauri commands) |
| DB | SQLite (WAL mode, dual read/write connections) |
| Agent CLI | claude, codex(OpenAI), gemini(Google), opencode |
| Markdown | react-markdown + remark-gfm + react-syntax-highlighter |
| Icons | Lucide React |

---

## 3. 프로젝트 구조

```
tunaFlow/
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── lib.rs          # Tauri app builder + command registration
│   │   ├── agents/         # CLI agent adapters (claude, codex, gemini, opencode, rawq, loader)
│   │   ├── commands/       # Tauri commands (아래 상세)
│   │   ├── db/             # SQLite schema, migrations(v1-v12), models
│   │   ├── errors.rs       # AppError enum
│   │   └── guardrail.rs    # Context budget limits + truncation
│   └── Cargo.toml
├── src/                    # React frontend
│   ├── components/tunaflow/  # UI 컴포넌트 (아래 상세)
│   ├── stores/slices/      # Zustand store slices (7개)
│   ├── lib/                # utils, constants, appStore, api/
│   ├── types/index.ts      # 공유 타입
│   └── tests/              # vitest tests
├── docs/
│   ├── plans/              # 실행 계획 문서 27개
│   └── reference/          # SSOT 문서 (dataModelRevised.md, implementationStatus.md)
└── package.json
```

---

## 4. 아키텍처 핵심 원칙

### 4.1 Project-centric
모든 데이터는 Project 소속. Store는 선택된 프로젝트의 데이터만 보유. 전역 캐시 없음.

### 4.2 Background execution (Phase 1-2 완료)
- `start_*` 커맨드: DB 준비 후 즉시 반환, background thread에서 subprocess 실행
- 이벤트: `claude:progress`, `claude:chunk`, `gemini:progress`, `gemini:chunk`, `agent:completed`, `agent:error`
- Frontend: fire-and-forget invoke + event listener 패턴
- DB = SSOT: event를 놓쳐도 `list_messages()`로 복구

### 4.3 ContextPack = runtime-only
매 요청마다 조립, DB에 저장 안 함. 메타데이터(mode/sections/length/hash)만 trace_log에 기록.

### 4.4 RT = Conversation.mode
Roundtable은 별도 엔티티가 아님. `mode: "roundtable"`인 Conversation의 특수 실행 경로.

### 4.5 Branch = shadow conversation
Branch의 메시지는 `branch:{branchId}` shadow conversation에 저장. `openBranchStream`으로 full view 전환.

---

## 5. Backend 주요 커맨드

### Agent 실행 (background)
| 커맨드 | 설명 |
|---|---|
| `start_claude_stream` | Claude streaming 실행 (background, ContextPack full) |
| `start_gemini_stream` | Gemini streaming 실행 (background, stream-json) |
| `start_codex_run` | Codex one-shot 실행 (background) |
| `start_opencode_run` | OpenCode one-shot 실행 (background) |
| `start_roundtable_run` | RT 첫 라운드 실행 (background) |
| `start_roundtable_followup` | RT follow-up 라운드 (background) |

### Agent 실행 (legacy, RT 내부 사용)
`send_with_claude`, `stream_with_claude`, `send_with_codex`, `send_with_gemini`, `send_with_opencode`, `roundtable_run`, `roundtable_followup`

### CRUD
`list_projects`, `create_project`, `list_conversations`, `create_conversation`, `delete_conversation`, `list_messages`, `create_user_message`, `list_branches`, `create_branch`, `adopt_branch`, `delete_branch`, `list_memos`, `create_memo`, `list_artifacts`, `create_artifact`, `list_plans`, `create_plan` 등

### Job/Trace
`list_active_jobs`, `cleanup_stale_jobs`, `list_traces`, `export_traces_otel`

### RT Config
`save_rt_config`, `get_rt_config` — conversations.rt_config에 JSON 저장 (sessionStorage 대체)

---

## 6. Frontend Store 구조

`src/stores/chatStore.ts`가 6개 slice를 합성:

| Slice | 핵심 상태 |
|---|---|
| `projectSlice` | `projects`, `selectedProjectKey`, `selectProject()`, `loadProjects()` |
| `conversationSlice` | `conversations`, `selectedConversationId`, `messages`, `selectConversation()` |
| `branchSlice` | `branches`, `activeBranchId`, `threadBranchId`, `openBranchStream()`, `openThread()` |
| `runtimeSlice` | `runningThreadIds`, `messageQueue`, `sendMessage()`, `sendWithGemini()`, `sendRoundtable()` 등 |
| `assetSlice` | `memos`, `artifacts`, `activeSkills`, `crossSessionIds` |
| `engineModelSlice` | `engineModels`, `loadEngineModels()` |

**성능 최적화:**
- 모든 주요 컴포넌트에서 `useChatStore((s) => s.field)` 개별 selector 사용
- `MessageItem`은 `React.memo` + custom `areEqual` 적용
- Auto-scroll은 `scrollKey = length:id:status` 기반

---

## 7. DB 스키마 (v12)

| 테이블 | 핵심 필드 |
|---|---|
| `projects` | key(PK), name, path, type, source |
| `conversations` | id, project_key(FK), label, mode(chat/roundtable), rt_config(JSON) |
| `messages` | id, conversation_id(FK), role, content, status, engine, model, persona |
| `branches` | id, conversation_id(FK), label, status, checkpoint_id, mode |
| `memos` | id, message_id, content, type, tags |
| `artifacts` | id, conversation_id, type, title, status, subtask_id |
| `plans` | id, conversation_id, title, status |
| `plan_subtasks` | id, plan_id(FK), title, status, owner_agent |
| `trace_log` | id, conversation_id, trace_id, span_id, engine, context_mode, context_sections |
| `agent_jobs` | id, conversation_id, message_id, engine, kind, status, error |

---

## 8. RT (Roundtable) 실행 흐름

### 생성
1. `CreateRoundtableDialog`: participant(engine/model) 선택 → `save_rt_config`로 DB 저장
2. conversation `mode: "roundtable"` 생성 또는 branch `mode: "roundtable"` 생성

### 실행
1. Frontend `sendRoundtable()` → `invoke("start_roundtable_run")` (즉시 반환)
2. Backend background thread:
   - 각 participant에 대해 `run_participant()` 호출
   - Sequential: 직렬, 각 participant가 이전 응답 context를 받음
   - Deliberative: 병렬(`std::thread::spawn` × N), 이전 라운드 context만 받음
   - `roundtable:participant_status` 이벤트: running/done/error (실시간 telemetry)
   - `roundtable:progress` 이벤트: 완료된 participant Message
3. 완료 후 `agent:completed` 이벤트 → frontend `list_messages()`로 DB 동기화

### 프롬프트 구조
- 사용자 prompt + 이전 라운드 context (강제 지시문 없음)
- `build_round_prompt(topic, transcript, current_round)` — context만 prepend, 지시문 미삽입
- Round 1: topic만 전달
- Round 2+: 이전 라운드 응답을 `## Prior round responses` 헤더로 포함

### RT config 저장
`conversations.rt_config` (JSON) — 앱 재시작 후에도 유지. `sessionStorage`는 더 이상 사용하지 않음.

---

## 9. 주요 이벤트 모델

| 이벤트 | Payload | 발생 시점 |
|---|---|---|
| `claude:progress` | `{ messageId, text }` | thinking/tool_use 진행 |
| `claude:chunk` | `{ messageId, text }` | assistant 텍스트 누적 |
| `gemini:progress` | `{ messageId, text }` | init/tool 진행 |
| `gemini:chunk` | `{ messageId, text }` | assistant 텍스트 누적 |
| `codex:progress` | `{ messageId, text }` | 시작 알림 |
| `opencode:progress` | `{ messageId, text }` | 시작 알림 |
| `agent:completed` | `{ messageId, conversationId, engine }` | 실행 완료 |
| `agent:error` | `{ messageId, conversationId, engine, error }` | 실행 실패 |
| `roundtable:participant_status` | `{ conversationId, name, engine, model, round, status }` | participant 시작/완료 |
| `roundtable:progress` | `Message` (full) | participant 응답 완료 |

---

## 10. 현재 미커밋 변경사항 (51 files)

이번 세션에서 작업한 내용 (커밋 전):

### 성능 최적화
- React.memo MessageItem + custom areEqual
- Zustand selector 전환 (ChatPanel, Sidebar, StatusBar, ContextPanel, NewMessageInput, TracePanel)
- Auto-scroll scrollKey 최적화
- perflog.ts 삭제

### Streaming / Progress
- Claude tool_use progress 표시 (stream-json tool_use 블록 추출)
- Gemini CLI `--output-format stream-json` 실시간 스트리밍 구현
- ProgressBlock maxLines 8→5

### Background execution (Phase 1-2)
- `start_*` 커맨드 4개 (Claude/Gemini/Codex/OpenCode) + RT 2개
- `DbState.write`/`.read`를 `Arc<Mutex<Connection>>`으로 전환
- `agent:completed`/`agent:error` 통합 이벤트
- Frontend runtimeSlice: fire-and-forget + event listener 패턴
- `agent_jobs` 테이블 (v10) + `cleanup_stale_jobs` (앱 시작 시)
- AppShell startup cleanup

### RT 개선
- Deliberative 모드 병렬 실행 (`std::thread::spawn` × N)
- 프롬프트 강제 지시문 제거 (context만 prepend)
- 라운드별 intent/topic 표시 (Original Topic + per-round Intent)
- 실시간 participant telemetry (`roundtable:participant_status`)
- RT config: sessionStorage → DB (`conversations.rt_config`, v12)
- RT branch → full view로 열기 (drawer 대신)
- Branch RT의 shadow conversation을 conversations 배열에 추가
- 참가자 model 가시화 (RoundtableMessage header, telemetry strip, RoundtableControls)
- `ROUNDTABLE_PARTICIPANTS` 기본 이름 Haiku→Claude (모델명이 아닌 엔진명)

### ContextPack traceability
- trace_log에 context_mode/sections/length/hash/truncated 컬럼 (v11)
- `ContextPackMeta` 구조체 + `insert_trace_log_with_context`
- TracePanel에서 context metadata 표시

### 기타
- Rust 경고 8개 → 0개 정리
- Branch 삭제 후 사이드바 갱신 + full view 복귀
- `get_conversation` 인자명 불일치 수정
- RT participant model 전달 경로 검증 + console.log 디버그
- CreateRoundtableDialog selector UI 스타일 개선

---

## 11. 알려진 이슈 / 주의사항

### 반드시 확인
- **CLI 에이전트 3대 조건**: cwd(프로젝트 경로), stdin 미사용(파일 기반 전달), node 직접 호출(Windows)
- **Haiku RT 제한**: claude-haiku-4-5는 비코딩 RT 토론을 거부할 수 있음. Sonnet 이상 권장
- **sessionStorage 폐기**: RT config는 DB(`conversations.rt_config`)에 저장. 기존 sessionStorage 코드 잔존 가능성 있음

### 미해결
- `BranchThreadPanel`(drawer)은 RT 모드 미지원 — RT branch는 반드시 full view로 열어야 함
- 기존 smoke-sidebar/smoke-workspace 테스트 실패 (selector 전환 이후 store mock 불일치)
- Listener timeout: background thread crash 시 event listener가 영영 cleanup 안 될 수 있음
- trace_log context metadata는 `start_claude_stream`만 적용. 다른 엔진은 NULL

---

## 12. 빌드 / 실행 / 테스트

```bash
# 개발 실행
npm run tauri dev

# 빌드 검증
npx tsc --noEmit              # TypeScript
npx vite build                # Frontend
cd src-tauri && cargo check   # Rust

# 테스트
npx vitest run                # Frontend (69 tests)
cd src-tauri && cargo test --lib  # Rust unit tests

# 프로덕션 빌드
npm run tauri build
```

---

## 13. 다음 우선순위

1. **현재 미커밋 변경 커밋** — 51 파일, 2171 추가
2. **RT drawer 지원** — BranchThreadPanel에 RT mode 인식 추가 (또는 RT branch는 항상 full view)
3. **Evaluation UI 연결** — backend 완료, frontend 미연결
4. **Daemon Phase 3** — background worker → local daemon process 추출
5. **FTS 검색** — messages_fts 트리거 + UI
6. **Context budget scaling** — 60k chars guardrail 단계적 상향

---

## 14. 문서 참조

| 문서 | 용도 |
|---|---|
| `docs/reference/dataModelRevised.md` | 도메인 모델 SSOT |
| `docs/reference/implementationStatus.md` | 기능별 구현 현황 |
| `docs/plans/index.md` | 27개 plan 상태 인덱스 |
| `docs/plans/agentDaemonRoadmapPlan.md` | daemon 장기 로드맵 (Phase 1-2 완료) |
| `docs/plans/backgroundAgentExecutionPlan.md` | background execution 설계 |
| `docs/plans/contextPackTraceabilityPlan.md` | ContextPack 추적 설계 |

---

## 15. 코딩 컨벤션

- **한국어 응답**: 사용자 대면 텍스트는 한국어, 코드/경로/식별자는 원문
- **Zustand selector**: broad `useChatStore()` 금지, 개별 `useChatStore((s) => s.field)` 사용
- **Tauri command**: 인자는 `camelCase` (serde rename), 긴 실행은 `start_*` background 패턴
- **DB migration**: `add_column_if_missing`으로 idempotent, 버전 번호 순차 증가
- **에러 처리**: dev 단계에서 silent fallback 최소화, 명시적 경고/에러 표시
- **테스트**: vitest + jsdom (frontend), cargo test --lib (Rust unit)
