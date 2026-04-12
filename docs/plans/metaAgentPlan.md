# 메타에이전트(Meta-agent) 구현 플랜

> Status: planned
> Created: 2026-04-12
> 원칙: "제안하되 결정하지 않는다" — 승인 게이트는 항상 사용자

---

## 개요

메타에이전트는 **프로세스 관리자**다. Architect(설계 실행자)와 역할이 다르다.

| 역할 | 판단 범위 |
|---|---|
| **메타에이전트** | 프로젝트 상태 분석, 이슈 감지, 우선순위 제안, 설정 최적화 |
| **아키텍트** | 기술 설계, Plan 분해, subtask 구성 |
| **사용자** | 모든 결정 — 메타에이전트는 제안만 |

### 적용 범위
tunaFlow 자체뿐 아니라 **사용자의 모든 프로젝트**에서 훌륭한 어시스턴트 역할.

---

## 핵심 기능

### 1. 온보딩 (새 프로젝트 추가 시 자동 트리거)
- 프로젝트 기술 스택 감지 (rawq/파일시스템 스캔)
- context-hub 소스 추천 (감지된 스택 기반)
- 추천 스킬셋 제안
- CLAUDE.md 초안 생성 제안

### 2. 에러/이슈 모니터링 (온디맨드)
- `agent_jobs` 에러 스캔
- `trace_log` 이상 패턴 (context 과부하, 반복 실패)
- `failure_lessons` 반복 패턴 감지
- → `insight_findings`에 기록 → `meta-suggestion` 카드 → 사용자 승인 → Architect 전달

### 3. 프로젝트 상태 분석 (온디맨드)
- 밀린 Plan 목록, rework 비율
- 최근 세션 흐름 요약
- 다음 우선순위 제안

### 4. 설정 최적화 (제안)
- 엔진 추천 (태스크 유형별)
- 스킬셋 최적화
- context-hub 소스 갱신

---

## 트리거 설계

| 트리거 | 시점 | 방식 |
|---|---|---|
| **온보딩** | 새 프로젝트 추가 직후 | 알림 배너 표시 → 사용자 클릭 시 Meta 대화 이동 |
| **온디맨드** | 사용자가 명시적으로 호출 | 사이드바 Meta 고정 항목 클릭 |

백그라운드 자동 개입 없음. 사용자가 원할 때만.

---

## 구현 방식

- 새 엔진 타입 불필요 — **특별한 페르소나 + `conversations.type = "meta"` 대화**
- 기존 tool-request 시스템 활용
- 신규 tool-request 타입: `jobs` (agent_jobs 에러), `trace` (trace 이상)
- 출력 마커: `<!-- tunaflow:meta-suggestion:TYPE -->` → MetaSuggestionCard UI
- 프로젝트별 Meta 대화 싱글턴 (1 프로젝트 = 1 Meta 대화)

---

## Phase 0 — 핵심 인프라

### P0-1. DB 마이그레이션 (v33)

**파일**: `src-tauri/src/db/migrations.rs`

```sql
-- projects 테이블 확장
ALTER TABLE projects ADD COLUMN meta_conversation_id TEXT;
ALTER TABLE projects ADD COLUMN onboarding_done INTEGER DEFAULT 0;
```

`add_column_if_missing` 헬퍼로 멱등성 보장.

---

### P0-2. 프론트엔드 타입 확장

**파일**: `src/types/index.ts`

```typescript
type: "main" | "branch" | "discussion" | "scratchpad" | "meta";
```

**연쇄 영향**: `scratchpads = conversations.filter(c => c.type === "scratchpad")` 패턴은 meta를 자연히 제외하므로 안전. `type !== "scratchpad"` 부정 패턴 grep 필요.

---

### P0-3. `metaConversation.ts` 유틸리티

**파일 (신규)**: `src/lib/metaConversation.ts`

```typescript
// 이 프로젝트의 meta 대화가 없으면 생성, 있으면 기존 ID 반환
async function getOrCreateMetaConversation(projectKey: string): Promise<string>
```

Map<projectKey, Promise<string>> 캐시로 중복 생성 방지.

---

### P0-4. 사이드바 Meta 고정 항목

**파일**: `src/components/tunaflow/Sidebar.tsx`

프로젝트 선택기 바로 아래, 섹션들 위에 `MetaNavItem` 삽입.

```tsx
<MetaNavItem projectKey={selectedProjectKey} />
// 클릭 시: getOrCreateMetaConversation → selectConversation
```

`Bot` 아이콘 + "Meta" 텍스트. 활성 상태 표시.

---

### P0-5. 메타에이전트 시스템 프롬프트

**파일 (신규)**: `agents/meta.md` (tunaFlow 레포 내 번들 에이전트)

핵심 내용:
- **역할 한계 명시**: "You propose only. Every suggestion requires user approval."
- **금지 사항**: "Do NOT produce plan-proposal markers directly. Delegate to Architect after user confirms."
- **tool-request 사용법**: `jobs`, `trace`, `plans`, `lessons`, `rawq` 활용 지침
- **출력 형식**: `<!-- tunaflow:meta-suggestion:TYPE -->` 마커 사용법
- **아키텍트 위임**: `<!-- tunaflow:meta-to-architect:TOPIC -->` 마커

**주의**: `agents/meta.md`는 tunaFlow 번들 경로 — 사용자 프로젝트에 없음.
→ P0에서는 `persona_meta.promptFragment` 방식으로 주입. P1에서 번들 에이전트 경로 지원 검토.

---

### P0-6. 메타에이전트 페르소나 추가

**파일**: `src/lib/defaultPersonas.ts`

```typescript
{
  id: "persona_meta",
  name: "Meta",
  role: "Process Manager",
  summary: "프로젝트 프로세스 관리자. 상태 분석, 이슈 감지, 우선순위 제안. 설계 판단은 Architect에게 위임.",
  builtIn: true,
  priorities: ["프로세스 투명성", "이슈 조기 감지", "제안만, 결정은 사용자"],
  behaviors: [
    "상태를 먼저 요약한 뒤 제안한다",
    "설계 관련 질문은 Architect에게 위임한다",
    "승인 없이 행동하지 않는다"
  ],
  constraints: [
    "기술 구현 판단을 직접 내리지 않는다",
    "plan-proposal 마커를 직접 생성하지 않는다"
  ],
  tone: "analytical",
  outputStyle: "structured",
  promptFragment: "You are a process manager. Analyze project health, detect issues, propose priorities. Never make architectural decisions. Delegate design to Architect. Propose only — the user decides.",
  recommendedSkills: [],
}
```

---

## Phase 1-A — tool-request 확장

### P1-A-1. ToolRequest 타입 확장

**파일**: `src/lib/planProposalParser.ts`

```typescript
type: "docs" | "rawq" | "graph" | "plans" | "memory" | "sessions"
    | "skills" | "artifacts" | "lessons" | "jobs" | "trace";
```

`plans` 타입 query 값 확장: `"pending"` | `"done"` | `"all"`

---

### P1-A-2. toolRequestHandler — `jobs`, `trace` 핸들러 추가

**파일**: `src/lib/toolRequestHandler.ts`

`jobs` 타입:
- `invoke("list_failed_jobs", { projectKey, limit: 20 })` 호출
- 최근 7일 에러를 마크다운 테이블로 포맷

`trace` 타입:
- `invoke("get_trace_anomalies", { projectKey, limit: 30 })` 호출
- context_truncated 건수, 반복 실패 패턴 포맷

---

### P1-A-3. 백엔드 신규 커맨드

**파일**: `src-tauri/src/commands/jobs.rs`

```rust
#[tauri::command]
pub fn list_failed_jobs(project_key: String, limit: Option<i64>, ...) -> Result<Vec<AgentJob>, AppError>
// agent_jobs JOIN conversations WHERE project_key=? AND status='error' ORDER BY updated_at DESC
```

**파일**: `src-tauri/src/commands/tracing.rs`

```rust
#[tauri::command]
pub fn get_trace_anomalies(project_key: String, limit: Option<i64>, ...) -> Result<Vec<TraceAnomaly>, AppError>
// context_truncated=1 집계, 반복 실패(>=3회) 집계, cost 스파이크 검출
```

---

## Phase 1-B — meta-suggestion 마커 & UI

### P1-B-1. meta-suggestion 파서

**파일**: `src/lib/planProposalParser.ts`

```
<!-- tunaflow:meta-suggestion:TYPE -->
...content...
<!-- /tunaflow:meta-suggestion:TYPE -->
```

TYPE: `"onboarding"` | `"issue"` | `"priority"` | `"config"`

```typescript
export interface ParsedMetaSuggestion {
  suggestionType: "onboarding" | "issue" | "priority" | "config";
  title: string;
  description: string;
  severity?: "critical" | "high" | "medium" | "low";
  actionLabel?: string;
  architorTopic?: string;
  raw: string;
}

export function extractMetaSuggestions(content: string): ParsedMetaSuggestion[]
export function hasMetaSuggestion(content: string): boolean
```

---

### P1-B-2. MetaSuggestionCard 컴포넌트

**파일 (신규)**: `src/components/tunaflow/message/MetaSuggestionCard.tsx`

`PlanProposalCard.tsx`를 참조 모델로 사용.

UI 구성:
- 헤더: `Bot` 아이콘 + suggestion type 배지 (issue=red, priority=blue, onboarding=green, config=yellow)
- severity 배지
- title + description
- 액션: "승인 → Architect에 전달" + "무시"

승인 흐름:
1. `insight_findings`에 자동 기록 (`invoke("create_insight_finding", ...)`)
2. `architorTopic` 있으면 Architect 대화로 이동 + topic 전송

---

### P1-B-3. MessageItem 통합

**파일**: `src/components/tunaflow/MessageItem.tsx`

```typescript
// meta 대화에서만 렌더링
const isMetaConversation = conversation?.type === "meta";
if (isMetaConversation && hasMetaSuggestion(content)) {
  // MetaSuggestionCard 렌더링
}
```

---

## Phase 1-C — 온보딩 트리거

### P1-C-1. 프로젝트 추가 훅

**파일**: `src/stores/slices/projectSlice.ts`

`createProject` 완료 후:
1. `getOrCreateMetaConversation(projectKey)` 호출
2. 알림 배너: "Meta 에이전트가 프로젝트 분석을 시작했습니다" → 클릭 시 Meta 대화 이동
3. (자동 이동 없음 — UX 충격 방지)

---

### P1-C-2. `get_meta_context` 커맨드

**파일 (신규)**: `src-tauri/src/commands/meta_context.rs`

```rust
#[derive(Serialize)]
pub struct MetaContext {
    pub failed_jobs: Vec<AgentJobSummary>,
    pub trace_anomalies: Vec<TraceAnomaly>,
    pub pending_plans: Vec<PlanSummary>,
    pub rework_ratio: f64,
    pub recent_lessons: Vec<FailureLessonSummary>,
    pub open_findings: Vec<InsightFindingSummary>,
}

#[tauri::command]
pub fn get_meta_context(project_key: String, ...) -> Result<MetaContext, AppError>
```

단일 커맨드에서 5개 테이블 통합 조회 → 메타에이전트 컨텍스트 초기화 비용 절감.

---

### P1-C-3. `list_context_hub_sources` 커맨드

**파일**: `src-tauri/src/commands/context_hub.rs`

```rust
#[tauri::command]
pub fn list_context_hub_sources(...) -> Result<Vec<ContextHubSource>, AppError>
// context-hub 내부 API로 현재 등록 소스 목록 조회
```

---

## Phase 2 — 프로젝트 상태 분석 & 설정 최적화

P1 완료 후 메타에이전트가 대화를 통해 자연스럽게 수행. 대부분 **시스템 프롬프트 개선**과 **tool-request 활용**.

### P2-1. `agents/meta.md` 프롬프트 확장
- 온보딩 흐름 상세화 (rawq 스캔 → 스택 감지 → 소스 추천 → CLAUDE.md artifact)
- 상태 분석 흐름 (jobs → trace → plans → lessons 순차 조회)

### P2-2. `plans` tool-request 확장
- `"pending"` 쿼리: 진행 중 Plan + rework 비율 반환
- `"all"` 쿼리: 전체 요약

---

## 파일 변경 범위 요약

### 신규 생성 (5개)
| 파일 | 규모 |
|------|------|
| `agents/meta.md` | ~120줄 |
| `src/lib/metaConversation.ts` | ~60줄 |
| `src/components/tunaflow/message/MetaSuggestionCard.tsx` | ~150줄 |
| `src-tauri/src/commands/meta_context.rs` | ~120줄 |

### 수정 (12개)
| 파일 | 변경 내용 |
|------|-----------|
| `src/types/index.ts` | `"meta"` 타입 추가 |
| `src-tauri/src/db/migrations.rs` | v33 마이그레이션 |
| `src/lib/planProposalParser.ts` | meta-suggestion 파서, ToolRequest 타입 확장 |
| `src/lib/toolRequestHandler.ts` | `jobs`, `trace` 핸들러, `plans` 확장 |
| `src/lib/defaultPersonas.ts` | `persona_meta` 추가 |
| `src/components/tunaflow/Sidebar.tsx` | MetaNavItem 삽입 |
| `src/components/tunaflow/MessageItem.tsx` | MetaSuggestionCard 통합 |
| `src/stores/slices/projectSlice.ts` | 온보딩 트리거 |
| `src-tauri/src/commands/jobs.rs` | `list_failed_jobs` 추가 |
| `src-tauri/src/commands/tracing.rs` | `get_trace_anomalies` 추가 |
| `src-tauri/src/commands/context_hub.rs` | `list_context_hub_sources` 추가 |
| `src-tauri/src/lib.rs` + `commands/mod.rs` | 커맨드 등록 |

---

## 구현 순서 (의존성 기반)

```
P0-1 (DB migration)
  └─ P0-2 (타입 확장)
       └─ P0-3 (metaConversation.ts)
            ├─ P0-4 (사이드바 Meta 항목)
            └─ P0-6 (페르소나 추가)
P0-5 (agents/meta.md) — 독립

P1-A-3 (백엔드 신규 커맨드)
  └─ P1-A-1/2 (toolRequestHandler 확장)
       └─ P1-B-1 (파서 확장)
            └─ P1-B-2 (MetaSuggestionCard)
                 └─ P1-B-3 (MessageItem 통합)

P1-C-2 (get_meta_context)
  └─ P1-C-1 (온보딩 트리거) — P0-3 완료 후

P1-C-3 (list_context_hub_sources) — 독립

P2 — P1 전체 완료 후
```

---

## 리스크 & 주의사항

1. **Meta 대화 싱글턴 경쟁 조건**: `Map<projectKey, Promise<string>>` 캐시로 중복 생성 방지
2. **`agents/meta.md` 경로**: 사용자 프로젝트에 없음 → P0는 `persona_meta.promptFragment`, P1에서 번들 에이전트 경로 지원
3. **meta-suggestion 마커 오용**: `MessageItem`에서 `conversation.type === "meta"` 조건으로만 파싱
4. **온보딩 UX 충격**: 자동 이동 대신 알림 배너 방식 사용
5. **`type !== "scratchpad"` 부정 패턴**: meta 포함 여부 grep 검토 필요

---

## 총 규모 추정

| 구분 | LOC |
|------|-----|
| Rust 백엔드 (신규+수정) | ~330 |
| TypeScript 프론트엔드 (신규+수정) | ~500 |
| 에이전트 프롬프트 | ~120 |
| **합계** | **~950** |

P0: 1일 / P1: 3~4일 / P2: 1일
