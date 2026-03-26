# tunaFlow 핸드오프 문서

> **최종 갱신**: 2026-03-26 (코드 기준 검증 완료)
> **이 문서는 새 작업자가 가장 먼저 읽는 문서다.**

---

## 1. 프로젝트 한줄 정의

**tunaFlow는 Tauri 2 + React + Rust + SQLite 기반의 3패널 멀티에이전트 오케스트레이션 IDE다.**

로컬 CLI 에이전트(Claude Code, Codex, Gemini CLI, OpenCode)를 동시에 관리하며,
대화 분기(Branch), 원탁회의(Roundtable), 계획(Plan), 메모/아티팩트, 스킬 시스템을 제공한다.

---

## 2. 절대 원칙

1. **src-tauri 변경 최소화** — 백엔드 수정은 반드시 근거 확인 후, 명확한 목적이 있을 때만 한다.
2. **DB 스키마 변경 = 마이그레이션** — `src-tauri/src/db/schema.rs`에 새 버전으로 추가. 기존 테이블 직접 수정 금지. 현재 v6.
3. **단일 Store** — 프론트엔드 상태는 `src/stores/chatStore.ts` 하나로 관리 (Zustand v5).
4. **ContextPack은 runtime-only** — DB에 영속화하지 않음. 매 요청마다 동적 조립.
5. **DB lock 패턴** — 에이전트 subprocess 실행 중에는 반드시 DB 락 해제.

---

## 3. 현재 구현 완료 범위

### 백엔드 (src-tauri)
- **4개 CLI 에이전트**: Claude (one-shot + streaming), Codex (stdin), Gemini (node 직접), OpenCode
- **ContextPack 조립**: Claude full 5단계 (Agent prompt → Skills → Plan → rawq → Cross-session → Context summary). 비Claude 엔진은 lite context.
- **Roundtable**: Sequential + Deliberative 모드, 라운드별 참가자 선택, /follow 명령어, per-participant progress event, cooperative cancel
- **Plan CRUD**: 8개 command + ContextPack 연결 (active plan 주입) + Artifact 연결 (subtask_id)
- **Branch**: shadow conversation, branch-scoped plan 지원, plan lookup canonical id 보정
- **Memo/Artifact CRUD**: subtask_id 연결 포함
- **Evaluation harness**: eval_runs + eval_results (backend only)
- **Capability registry**: skills + MCP tool definitions
- **OTel trace**: trace_id/span_id/parent_span_id/operation/engine/duration_ms/status. RT는 root+participant 2레벨 span.
- **Migration 안전성**: idempotent add_column_if_missing (v2/v4/v6)

### 프론트엔드 (src)
- **3패널 레이아웃**: Sidebar(224px) + ChatPanel(flex) + ContextPanel(256px)
- **ContextPanel 6개 서브패널**: context-panel/ (BranchesPanel, ArtifactsPanel, MemosPanel, SkillsPanel, PlansPanel, CrossSessionPanel)
- **Plans UI**: 생성/조회/상태변경/subtask + branch scope 토글
- **RT 모드바**: 참가자 토글 칩, 모드 셀렉터 (Sequential/Deliberative)
- **Thinking placeholder**: 모든 엔진에서 응답 전 TypingIndicator 표시
- **API layer**: src/lib/api/ (plans, artifacts, memos)
- **Tailwind CSS v4** 다크 테마

### 테스트
- Rust unit 27개 + DB integration 13개 + Frontend API 13개 = **53 tests**
- CI: `.github/workflows/ci.yml`

---

## 4. 아직 부족한 부분

| 영역 | 상태 | 비고 |
|---|---|---|
| Evaluation UI | backend only | frontend 미연결 |
| Capability UI | backend only | frontend 미연결 |
| FTS 검색 | 미구현 | 스키마만 존재 |
| Workspace 스캔 | 미구현 | |
| Branch-git 연동 | 미구현 | |
| Soft delete | 미구현 | |
| rawq 실제 연동 | 부분 | 기본 keyword 검색만 |
| OTLP collector 전송 | 미구현 | JSON export만 |

---

## 5. 주요 문서 링크

| 문서 | 경로 | 역할 |
|---|---|---|
| **이 문서** | `docs/prompts/handoffMaster.md` | 최상위 진입점 |
| 도메인 모델 SSOT | `docs/reference/dataModelRevised.md` | 엔티티 정의 기준 |
| 구현 상태 | `docs/reference/implementationStatus.md` | 기능별 구현 상태표 |
| 프론트엔드 아키텍처 | `docs/reference/frontendArchitecture.md` | UI 구조 |
| 작업 규칙 | `docs/reference/workingRulesForAgents.md` | 수정 시 주의사항 |
| 패치 이력 | `docs/reference/patchLog.md` | 변경 기록 |
| 테스트 계획 | `docs/plans/masterTestPlan.md` | 테스트 전략 |

---

## 6. 코드 구조

```
tunaFlow/
├── src/                              ← 프론트엔드 (React + Vite + Tailwind v4)
│   ├── stores/chatStore.ts           ← Zustand 단일 Store
│   ├── types/index.ts                ← TS 타입 정의
│   ├── lib/
│   │   ├── api/                      ← invoke wrapper (plans, artifacts, memos)
│   │   ├── constants.ts              ← DEFAULT_MODEL, ROUNDTABLE_PARTICIPANTS
│   │   └── utils.ts                  ← cn(), AGENT_COLORS
│   ├── components/tunaflow/
│   │   ├── AppShell.tsx              ← 3패널 레이아웃
│   │   ├── ChatPanel.tsx             ← 중앙 패널
│   │   ├── NewMessageInput.tsx       ← 입력 (엔진/RT 모드/참가자 선택)
│   │   ├── RoundtableView.tsx        ← RT 카드 뷰
│   │   ├── ContextPanel.tsx          ← 우측 패널 (orchestration)
│   │   └── context-panel/            ← 6개 서브패널
│   └── tests/                        ← vitest 테스트
│
├── src-tauri/src/                    ← 백엔드 (Rust + Tauri 2)
│   ├── lib.rs                        ← 진입점, CancelFlag, 53개 command 등록
│   ├── db/                           ← schema (v1-v6), migrations, models
│   ├── commands/
│   │   ├── agents.rs                 ← 5개 엔진 command
│   │   ├── agents_helpers/           ← context_pack, compression, trace_log
│   │   ├── roundtable.rs             ← run, followup, cancel
│   │   ├── roundtable_helpers/       ← prompt, executor, persist
│   │   ├── plans.rs                  ← 8개 plan command
│   │   ├── evaluation.rs             ← 6개 eval command
│   │   ├── capabilities.rs           ← list_capabilities
│   │   ├── tracing.rs                ← list_traces, export_traces_otel
│   │   └── context_queries.rs        ← 공통 DB helper
│   └── agents/                       ← CLI 래퍼 (claude, codex, gemini, opencode)
│
├── src-tauri/tests/                  ← Rust integration tests
├── docs/                             ← 목적별 분류 (explanation/plans/prompts/reference/how-to)
└── .github/workflows/ci.yml          ← CI pipeline
```

---

## 7. 작업 시 주의사항

- DB 스키마 변경 시 새 V{N}_SCHEMA + apply_v{N}() + idempotent 패턴 사용
- 모든 에이전트 subprocess는 `std::env::temp_dir()`을 cwd로 사용
- Windows: Codex는 stdin 모드, Gemini는 `node index.js` 직접 호출
- Roundtable은 매 호출당 1라운드. 배치 라운드 없음.
- Branch stream의 conversation_id = `"branch:{branch_id}"` → plan lookup 시 canonical id 보정 필요
