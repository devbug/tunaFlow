# tunaFlow Patch Log

각 작업 세션 종료 시 갱신. 파일, 함수, 이유를 기준으로 기록.

---

## 2026-03-26 — trace_log write 활성화

### 목적
`trace_log` 테이블이 스키마만 존재하고 실제 write 경로가 없었음. 모든 엔진 실행 후 INSERT 경로 추가.

### 수정 파일

#### `src-tauri/src/commands/agents.rs`

**추가: `insert_trace_log()` helper**
- 위치: `send_with_claude` 함수 직전
- 역할: `trace_log` 테이블에 단일 행 INSERT. 에러 발생 시 `let _ =` 로 swallow — 기존 반환값 영향 없음
- 시그니처: `fn insert_trace_log(conn, conversation_id, input_tokens, output_tokens, cost_usd, recorded_at)`

**호출 삽입 위치 (UPDATE conversations 직후, Ok(Message{..}) 직전):**
| 함수 | 토큰/비용 |
|---|---|
| `send_with_claude` | 실제 `in_tokens`, `out_tokens`, `cost_usd` |
| `send_with_codex` | 실제 값 |
| `send_with_gemini` | `0, 0, 0.0` (엔진 미추적) |
| `send_with_opencode` | `0, 0, 0.0` (엔진 미추적) |
| `stream_with_claude` | 실제 값 |

#### `src-tauri/src/commands/roundtable.rs`

**`persist_round()` 내 inline INSERT 추가**
- 위치: UPDATE conversations 직후
- `total_in`, `total_out`, `total_cost` (라운드 전체 participants 합계) 를 단일 행으로 기록
- helper 미사용 — `insert_trace_log`가 `agents.rs` private이라 inline으로 처리

### DB 스키마 변경
없음. `trace_log` 테이블은 v1 migration에 이미 존재.

### 검증
```
cargo check: 0 errors, 2 warnings (기존과 동일)
```

### 런타임 확인 방법
```bash
sqlite3 "$APPDATA/tuna-flow/tunaflow.db" \
  "SELECT * FROM trace_log ORDER BY recorded_at DESC LIMIT 5;"
```

---

## 2026-03-26 — ContextPack memory compression (선별적 압축 실험)

### 목적
ContextPack 조립 시 일부 섹션이 guardrail limit을 초과하면 단순 절단 대신 Claude 요약 압축을 먼저 시도. 실패 시 기존 truncate fallback 유지.

### 적용 대상 섹션
- `cross_section` (`build_cross_session_section` 결과)
- `context_summary` (`build_context_summary` 결과)

미적용 섹션 (의도적 제외): `skills_section`, `rawq_section`

### 수정 파일

#### `src-tauri/src/commands/agents.rs`

**추가: `compress_context_with_claude(text: &str) -> Result<String, ()>`**
- `claude::run()` 직접 호출 (`send_with_claude` 경유 없음 → 재귀 불가)
- `system_prompt: None`, `resume_token: None` — ContextPack 조립 경로 완전 우회
- 요약 프롬프트: 600자 이내, 사용자 작업/결정/제약/다음 단계 보존
- 실패 조건: spawn 에러, 빈 응답, parse 에러 → `Err(())`

**추가: `maybe_compress_section(section: Option<String>, limit: usize) -> Option<String>`**
- `section.len() <= limit` → 그대로 반환 (압축 없음)
- 초과 → `compress_context_with_claude` 호출
  - 성공 + limit 이내 → 압축 결과 사용
  - 성공 + 여전히 초과 → 압축 결과를 `guardrail::truncate_section`
  - 실패 → 원문을 `guardrail::truncate_section` (기존 동작 보장)

**교체: `send_with_claude` / `stream_with_claude` ContextPack 조립 내**
```
before: guardrail::truncate_section(build_cross_session_section(...), ...)
after:  maybe_compress_section(build_cross_session_section(...), ...)

before: guardrail::truncate_section(build_context_summary(...), ...)
after:  maybe_compress_section(build_context_summary(...), ...)
```

### 재귀 방지 구조
```
compress_context_with_claude()
  └─ claude::run()  ← subprocess 직접 호출
       ├─ system_prompt = None
       ├─ resume_token  = None
       └─ ContextPack 조립 없음 → maybe_compress_section 미호출 → 재귀 불가
```

### DB 스키마 변경
없음. 압축 결과는 per-request transient (persistent cache 없음).

### 검증
```
cargo check: 0 errors, 2 warnings (기존과 동일)
```

### 런타임 로그 확인
`tauri dev` 콘솔에서:
```
[compress] ok: 7200 → 543 chars        ← 압축 성공
[compress] still over limit after compression (1200 chars), truncating  ← 압축 후 truncate
[compress] failed, falling back to truncate (7200 chars)   ← fallback
```

### 남은 리스크
| 항목 | 내용 |
|---|---|
| 추가 지연 | 섹션 초과 시 claude subprocess 추가 호출 (최대 2회) |
| 압축 품질 | 중요 결정 누락 가능. 현재 단순 텍스트 프롬프트 |
| 비용 추적 | 압축 호출의 토큰은 `trace_log` 미기록 |
| Codex/Gemini/OpenCode | 적용 범위 외 (`build_lite_context_prompt` 경로) |

---

---

## 2026-03-26 — Roundtable 실행 모델 최소 리팩터링

### 목적
`roundtable_run` / `roundtable_followup` 두 command에 participant inner loop가 직접 인라인으로 중복돼 있었음.
이를 strategy 단위로 분리해 이후 `Fanout`/`concurrent` 실험 지점을 만드는 것이 목표.
동작 변경 없음.

### 수정 파일

#### `src-tauri/src/commands/roundtable.rs`

**추가: `RoundStrategy` enum**
```rust
enum RoundStrategy {
    Sequential,
    // Fanout, // future
}
```
- 현재 variant 1개 (`Sequential`). 이후 `Fanout` 추가 시 command 코드는 무변경.

**추가: `run_round_sequential(participants, transcript, round_num, total_rounds, topic) -> Vec<ParticipantResult>`**
- 기존 inner loop를 그대로 추출
- 보존 규칙:
  - `round_responses` 누적 (within-round sequential context)
  - `build_prompt_sources` / `build_round_prompt` 인자 순서 동일
  - `run_participant` 호출 방식 동일

**추가: `run_round(participants, transcript, round_num, total_rounds, topic, strategy) -> Vec<ParticipantResult>`**
- Strategy dispatcher. match 분기 한 곳에서만 전략 관리.
- 새 전략 추가 = 새 `run_round_*` 함수 + 새 match arm. 호출부 무변경.

**변경: `roundtable_run` inner loop**
```
before: for p in &input.participants { ... }  // 10줄 인라인
after:  run_round(..., RoundStrategy::Sequential)  // 1 call
```

**변경: `roundtable_followup` inner loop**
```
before: for p in &input.participants { ... }  // 11줄 인라인
after:  run_round(..., RoundStrategy::Sequential)  // 1 call
```

### 동작 보존 확인
- `build_prompt_sources` 호출 인자: 동일 (`transcript`, `round_responses`, `round_num`, `total_rounds`)
- `prompt_sources` JSON 직렬화 방식: 동일
- `persist_round` 호출 타이밍: 동일 (round 실행 후, lock 재획득 시)
- `archive_transcript` 호출 타이밍: 동일 (모든 round 완료 후)
- 라운드 헤더 포함 방식: 동일 (`rounds > 1`일 때만)
- `transcript` 누적 방식: 동일 (성공한 결과만)

### 다음 fanout 실험 진입점
`roundtable.rs`에서:
1. `RoundStrategy::Fanout` variant 추가
2. `run_round_fanout(participants, transcript, round_num, total_rounds, topic) -> Vec<ParticipantResult>` 구현 (parallel, intra-round context 없음)
3. `run_round()` match에 새 arm 추가
4. command 호출부에서 `RoundStrategy::Fanout`로 교체 또는 input에서 선택

### DB 스키마 변경
없음.

### 검증
```
cargo check: 0 errors, 2 warnings (기존과 동일)
```

---

## 2026-03-26 — Plan State 최소 백엔드 추가

### 목적
conversation / branch 스코프의 plan 상태를 저장/조회/갱신할 수 있는 persistent backend 기반 추가.
planner UI 또는 future harness가 붙을 수 있는 최소 layer.

### 추가된 테이블

**`plans`** (migration v3)
| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | TEXT PK | UUID |
| `conversation_id` | TEXT NOT NULL | FK → conversations |
| `branch_id` | TEXT nullable | FK → branches (optional) |
| `title` | TEXT | 계획 제목 |
| `description` | TEXT nullable | 계획 설명 |
| `expected_outcome` | TEXT nullable | 기대 결과 |
| `status` | TEXT | `draft` / `active` / `done` / `abandoned` |
| `created_at` / `updated_at` | INTEGER | epoch ms |

**`plan_subtasks`** (migration v3)
| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | TEXT PK | UUID |
| `plan_id` | TEXT NOT NULL | FK → plans (CASCADE) |
| `idx` | INTEGER | 표시/실행 순서 (0-based) |
| `title` | TEXT | 서브태스크 제목 |
| `details` | TEXT nullable | 상세 설명 |
| `status` | TEXT | `todo` / `in_progress` / `done` / `abandoned` |
| `outcome` | TEXT nullable | 완료 결과 기록 |
| `created_at` / `updated_at` | INTEGER | epoch ms |

### 수정 파일

| 파일 | 변경 |
|---|---|
| `db/schema.rs` | `V3_SCHEMA` 추가 |
| `db/migrations.rs` | `apply_v3()` + `if current < 3` 분기 추가 |
| `db/models.rs` | `Plan`, `PlanSubtask` struct 추가 |
| `commands/plans.rs` | 신규 파일 — 8개 command |
| `commands/mod.rs` | `pub mod plans;` 추가 |
| `lib.rs` | invoke_handler에 8개 command 등록 |

### 추가된 Commands

| command | 역할 |
|---|---|
| `create_plan` | plan 생성 (초기 subtasks 포함 가능) |
| `get_plan` | plan 단건 조회 |
| `list_plans_by_conversation` | conversation 기준 plan 목록 |
| `update_plan_status` | plan status 변경 |
| `list_subtasks` | plan의 subtask 목록 (idx 순) |
| `update_subtask_status` | subtask status + outcome 변경 |
| `replace_plan_subtasks` | subtask 전체 교체 (DELETE + bulk INSERT) |
| `delete_plan` | plan 삭제 (subtask CASCADE) |

### conversation / branch 연결 방식
- `plans.conversation_id` → 항상 필수. conversation 삭제 시 CASCADE
- `plans.branch_id` → nullable. branch 기준 plan은 branch_id도 함께 저장
- branch용 plan도 `list_plans_by_conversation`으로 조회 가능 (conversation 공유)

### DB 스키마 변경
v3 신규 migration. 기존 v1/v2 무변경.
앱 기동 시 `migrations::run()` 에서 자동 적용.

### 검증
```
cargo check: 0 errors, 2 warnings (기존과 동일)
```

---

## 2026-03-26 — Planner UI 최소 통합

### 목적
백엔드에 추가된 plan/subtask CRUD를 기존 3패널 UI 안에서 조회/상태 변경 가능하도록 최소 연결.
새 페이지/라우팅 없음. 기존 Assets 탭 안에 Plans 세그먼트 추가.

### UI 위치
`ContextPanel` → Assets 탭 → **Plans 서브 세그먼트** (Artifacts / Memos / Skills 옆)

### 수정 파일

#### `src/types/index.ts`
- `PlanStatus`, `SubtaskStatus` 타입 추가
- `Plan`, `PlanSubtask` interface 추가

#### `src/components/tunaflow/ContextPanel.tsx`
- `invoke` import 추가
- `ClipboardList` lucide icon import 추가
- `Plan`, `PlanSubtask`, `PlanStatus`, `SubtaskStatus` 타입 import 추가
- `AssetSegment` 타입에 `"plans"` 추가
- **`PLAN_STATUS_CFG`**: plan status → 표시 label/색 매핑
- **`SUBTASK_STATUS_CFG`**: subtask status → 다음 상태 포함 매핑 (클릭 순환)
- **`SubtaskRow`**: subtask 1행 컴포넌트. 상태 배지 클릭 → 다음 status로 전환
- **`PlanCard`**: plan 카드 컴포넌트. 클릭 expand → subtasks lazy load → 개별 상태 변경
- **`PlansPanel`**: conversation 기준 plan 목록 조회. local state 전용 (store 미확장)
- Assets 서브 세그먼트 바에 Plans 버튼 추가
- 렌더 블록에 `assetSegment === "plans"` 케이스 추가

### Command 연결

| command | 호출 위치 | 시점 |
|---|---|---|
| `list_plans_by_conversation` | `PlansPanel` useEffect | conversationId 변경 시 |
| `list_subtasks` | `PlanCard.handleToggle` | 처음 expand 시 (lazy) |
| `update_subtask_status` | `PlanCard.handleSubtaskStatus` | SubtaskRow 배지 클릭 시 |
| `update_plan_status` | `PlansPanel.handlePlanStatus` | PlanCard 상태 배지 클릭 시 |

### 상태 관리
- `PlansPanel`: `plans` local state (invoke → setPlans)
- `PlanCard`: `subtasks` / `expanded` / `loading` local state
- Global store 무변경

### 상태 전환 동작
```
plan:    draft → active → done → abandoned → draft (배지 클릭 순환)
subtask: todo → in_progress → done → todo (배지 클릭 순환)
         abandoned → todo (배지 클릭 리셋)
```

### 검증
```
tsc --noEmit: 0 errors
```

---

---

## 2026-03-26 — RT 3-mode 실행 전략 추가

### 목적
Roundtable에 기존 Sequential 외 Independent / Deliberative 2개 모드를 추가.
모드 이름만 추가하는 것이 아니라 실제 프롬프트 조립 로직이 모드별로 다르게 동작.

### 모드 정의

| 모드 | 라운드 내 | 라운드 간 | 특징 |
|---|---|---|---|
| **independent** | 없음 | 없음 | 모든 에이전트가 원래 토픽만 응답 |
| **sequential** | 있음 (기존 동작) | transcript 누적 | 에이전트가 같은 라운드 앞 에이전트 답변 참조 |
| **deliberative** | 없음 | transcript 누적 | R1은 독립, R2+는 이전 라운드 전체 참조 (같은 라운드 내 참조 없음) |

### 수정 파일

#### `src-tauri/src/commands/roundtable.rs` (전체 재작성)
- `RoundtableRunInput`에 `mode: Option<String>` 추가
- `RoundStrategy` enum: `Independent`, `Sequential`, `Deliberative` (Clone+Copy derive)
- `PromptSources.mode`: 추론 방식 제거, 실제 RT 모드 문자열을 직접 기록
- `build_prompt_sources()` 제거 (inline으로 전환)
- `archive_transcript()`: `rt_mode` 파라미터 추가, memo content에 **Mode** 행 포함
- 라운드 헤더: `--- Round {n}/{N} · {ModeName} ---` 형식
- **`roundtable:progress` 이벤트 emit** — 에이전트별 결과를 DB 저장 즉시 프론트엔드로 전송
- `persist_header()`, `persist_single()` 헬퍼로 분리 (기존 `persist_round` 배치 → 개별 persist 패턴)
- `execute_round()`: 에이전트별 run → persist → emit 루프. 전략별 컨텍스트 조립을 inline match로 처리
- `roundtable_run()` / `roundtable_followup()`: `app: tauri::AppHandle` 파라미터 추가, mode 파싱 → strategy 선택
- `use tauri::Emitter;` import 추가

#### `src/types/index.ts`
- `RtMode = "independent" | "sequential" | "deliberative"` 타입 추가
- `RoundtableRunInput`에 `mode?: RtMode` 추가

#### `src/stores/chatStore.ts`
- `RtMode` import 추가
- `sendRoundtable(prompt, rounds?, mode?)` 시그니처 업데이트
- `sendRoundtableFollowup(prompt, mode?)` 시그니처 업데이트
- **optimistic user message** 추가 (토론 시작 시 즉시 사용자 메시지 표시)
- **`roundtable:progress` 이벤트 리스너** 추가 (에이전트 응답 도착 시 즉시 messages에 append)
- invoke 완료 후 `list_messages`로 정규 상태 로드 (임시/스트림 상태 교체)
- `finally { unlisten() }` 패턴으로 이벤트 리스너 정리

#### `src/components/tunaflow/NewMessageInput.tsx`
- `RtMode` import 추가
- `RT_MODES` 배열 정의 (id, label, title)
- `rtMode` state 추가 (default: `"sequential"`)
- Roundtable 모드바에 Mode 셀렉터 UI 추가 (Rounds 셀렉터 옆)
- `handleSend` → `sendRoundtable(prompt, rounds, rtMode)` / `sendRoundtableFollowup(prompt, rtMode)` 전달

#### `src/components/tunaflow/RoundtableView.tsx`
- `RT_MODE_LABELS` 맵 추가: `independent` / `sequential` / `deliberative` → 표시 문자열
- `PromptSources.mode` JSDoc 업데이트 (`"cumulative"` → `"deliberative"`)
- `rtMode` 파생: `firstSources?.mode ?? "sequential"`
- 세션 메타 "Sequential within round" → `RT_MODE_LABELS[rtMode]` 동적 표시
- 라운드 헤더 어노테이션:
  - `deliberative` + Round 1 (라운드 복수) → "independent"
  - `sequential` + roundIdx > 0 → "builds on Round N + prior agents"
  - `deliberative` + roundIdx > 0 → "reflects on Round N"

### PromptSources.mode 의미 변화
- 이전: `transcript`/`current_round` 내용 보고 "independent"/"sequential"/"cumulative" 추론
- 이후: 백엔드에서 실제 RT 모드 문자열을 직접 저장 → UI가 신뢰 가능한 단일 출처

### 검증
```
cargo check: 0 errors, 2 warnings (기존과 동일)
npx tsc --noEmit: 0 errors
npx vite build: ✓ built in 2.74s
```

---

## 2026-03-26 — OPUS Master Plan Steps 2-8

### Step 2. Plan → ContextPack Link
- `build_plan_section(conn, conversation_id)` — active plan의 title/current/next/progress를 `## Active Plan` 섹션으로 조립
- `guardrail::MAX_PLAN_SECTION = 2000` 상수
- `send_with_claude`, `stream_with_claude` ContextPack에 plan_section 주입 (skills와 rawq 사이)
- plan 없으면 None → fallback 보존

### Step 3. Plan → Artifact Link
- V4 migration: `artifacts.subtask_id TEXT` nullable 컬럼 + index
- `Artifact` model, `CreateArtifactInput`에 subtask_id 추가
- `link_artifact_to_subtask` command 추가

### Step 4. Tool Capability Registry
- `capabilities.rs` 모듈: `ToolCapability` (name, kind, description, source, stateful)
- `list_capabilities` command: skills wrapping, future MCP/local_tool 확장점

### Step 5. MCP Abstraction
- `~/.tunaflow/mcp/{name}.json` 로딩 경로
- `McpToolDef` (description, endpoint, stateful)
- `load_mcp_tools()` → `list_capabilities`에 통합

### Step 6. Evaluation Harness
- V5 migration: `eval_runs` + `eval_results` 테이블
- `EvalRun`, `EvalResult` 모델
- 6개 command: create/list/add_result/list_results/update_status/delete

### Step 7. OTel Exporter Layer
- V6 migration: `trace_log`에 trace_id, span_id, parent_span_id, operation, engine, duration_ms, status
- `tracing.rs` 모듈: `TraceSpan`, `list_traces`, `export_traces_otel`

### Step 8. HITL Enhancement
- `CancelFlag(AtomicBool)` managed state
- `cancel_running` command — flag 설정
- `execute_round`에서 참가자 간 cancel 체크 (cooperative cancellation)
- Frontend: `cancelOperation` store action + Cancel 버튼 (isRunning일 때 표시)

### 검증
```
cargo check: 0 errors, 2 warnings (기존과 동일)
npx tsc --noEmit: 0 errors
npx vite build: ✓ built in 2.72s
```

---

## 변경 이력 요약

| 날짜 | 패치 | 파일 |
|---|---|---|
| 2026-03-26 | trace_log write 활성화 | `commands/agents.rs`, `commands/roundtable.rs` |
| 2026-03-26 | ContextPack memory compression | `commands/agents.rs` |
| 2026-03-26 | Roundtable 실행 모델 최소 리팩터링 | `commands/roundtable.rs` |
| 2026-03-26 | Plan State 최소 백엔드 추가 | `db/schema.rs`, `db/migrations.rs`, `db/models.rs`, `commands/plans.rs`, `lib.rs` |
| 2026-03-26 | Planner UI 최소 통합 | `types/index.ts`, `ContextPanel.tsx` |
| 2026-03-26 | Plan 생성 UI 추가 | `types/index.ts`, `ContextPanel.tsx` |
| 2026-03-26 | RT 3-mode 실행 전략 추가 | `roundtable.rs`, `types/index.ts`, `chatStore.ts`, `NewMessageInput.tsx`, `RoundtableView.tsx` |
| 2026-03-26 | RT progress event + UI 응답성 개선 | `roundtable.rs`, `chatStore.ts` |
| 2026-03-26 | Plan → ContextPack link | `agents.rs`, `guardrail.rs` |
| 2026-03-26 | Plan → Artifact link (V4) | `artifacts.rs`, `schema.rs`, `migrations.rs`, `models.rs`, `types/index.ts` |
| 2026-03-26 | Tool Capability Registry | `capabilities.rs`, `mod.rs`, `lib.rs`, `types/index.ts` |
| 2026-03-26 | MCP Abstraction | `capabilities.rs` |
| 2026-03-26 | Evaluation Harness (V5) | `evaluation.rs`, `schema.rs`, `migrations.rs`, `models.rs`, `lib.rs` |
| 2026-03-26 | OTel Exporter Layer (V6) | `tracing.rs`, `schema.rs`, `migrations.rs`, `lib.rs` |
| 2026-03-26 | HITL Cancel 기반 | `roundtable.rs`, `lib.rs`, `chatStore.ts`, `NewMessageInput.tsx` |
| 2026-03-26 | Branch plan context 수정 | `agents.rs` (resolve_plan_conversation_id) |
| 2026-03-26 | Migration idempotent 안전성 | `migrations.rs` (add_column_if_missing) |
| 2026-03-26 | Independent 모드 제거 + RT 10라운드 | `roundtable.rs`, `executor.rs`, `NewMessageInput.tsx`, `types/index.ts` |
| 2026-03-26 | RT 인터랙티브 UX (참가자 선택, /follow) | `roundtable.rs`, `chatStore.ts`, `NewMessageInput.tsx` |
| 2026-03-26 | UI 응답성 (thinking placeholder) | `chatStore.ts`, `NewMessageInput.tsx` |
| 2026-03-26 | OTel span write path 보강 | `trace_log.rs`, `agents.rs`, `roundtable.rs`, `persist.rs` |
| 2026-03-26 | Branch-scoped plan UI | `PlansPanel.tsx` |
| 2026-03-26 | 리팩토링 Step 1-5 | `ContextPanel.tsx`, `agents.rs`, `roundtable.rs` + helpers |
| 2026-03-26 | 테스트 체계 도입 | 53 tests (27 unit + 13 integration + 13 frontend) |
| 2026-03-26 | docs 구조 정리 | 목적별 폴더 재편 (explanation/plans/prompts/reference/how-to) |

---

## 초기 RT 수정 이력 (rtFixChangelog 흡수)

아래는 RT 기능을 처음 포팅하면서 발생한 12개 수정 사항의 요약이다.
상세 내용은 git history 참조.

| # | 수정 | 핵심 변경 |
|---|---|---|
| 1 | Gemini CLI adapter | `agents/gemini.rs` 신규, resolve_gemini_path |
| 2 | RT engine routing | agents.rs 엔진별 분기 |
| 3 | OpenCode adapter | `agents/opencode.rs` 신규 |
| 4 | RT context 공유 | prior_answers 마크다운 조립 |
| 5 | Windows .cmd 실행 | build_command helper 도입 |
| 6 | Codex sandbox/PATH | resolve_codex_path |
| 7 | Codex --skip-git-repo-check | 플래그 추가 |
| 8 | RT 프롬프트 정규화 | build_round_prompt (tunadish 패턴) |
| 9 | 다중 라운드 | rounds 파라미터 + transcript 누적 |
| 10 | 후속 토론 | roundtable_followup command |
| 11 | 아카이브 | archive_transcript → memos 테이블 |
| 12 | CLI 구조적 문제 해결 | cwd=temp_dir, stdin mode, node 직접호출 |
