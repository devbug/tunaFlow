<div align="center">

# tunaFlow

**AI Agent Orchestration Client**

[![Tauri 2](https://img.shields.io/badge/Tauri-2.0-FFC131?logo=tauri&logoColor=white)](https://v2.tauri.app/)
[![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![Rust](https://img.shields.io/badge/Rust-stable-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-420_passing-22c55e)](.)
[![DB Schema](https://img.shields.io/badge/DB_Schema-v30-8b5cf6)](.)

[![Language: Korean](https://img.shields.io/badge/Language-한국어-2563eb)](./README.md)
[![English](https://img.shields.io/badge/English-9ca3af)](./README.en.md)

> **Of the agent, By the agent, For the agent**

</div>

---

사용자 편의만을 위한 채팅 앱이 아닙니다. 에이전트가 더 적은 마찰로, 더 좋은 컨텍스트를 가지고, 덜 낭비하며 작업하게 만드는 것을 우선하는 도구입니다.

사용자가 **도메인 지식과 방향을 결정**하고, 에이전트가 그 결정을 **최적의 조건**에서 실행합니다. 에이전트가 편해야 결과가 좋아진다는 철학 — ContextPack, identity, memory, retrieval 등 모든 설계는 "에이전트가 불필요한 토큰 낭비 없이, 정확한 맥락으로, 역할 혼동 없이 작업할 수 있는가"를 기준으로 판단합니다.

> **100% AI-authored codebase** — 모든 코드는 Claude Code가 작성했으며, 사용자는 아키텍처와 방향만 결정합니다.

### 왜 이렇게 설계했나

멀티 에이전트 오케스트레이션에는 [세 가지 근본 문제](https://shalomeir.substack.com/p/multi-agent-orchestration-problems)가 있습니다:

| 문제 | 비율 | tunaFlow 대응 |
|------|------|--------------|
| **맥락 붕괴** — 위임 단계마다 원래 의도 변질, 토큰 10배+ 증가 | 41.8% | ContextPack이 매 요청마다 전체 맥락 재조립 (Plan + 메모리 + 역할 문서) |
| **유령 위임** — DONE 신호 보냈지만 인수인계 실패, 무한 대기 | 36.9% | orphan 자동 복구 + doom loop 감지 (3회 실패 → Architect 에스컬레이션) |
| **검증 오류** — 자기가 쓴 답을 자기가 채점 → 환각 통과 | 21.3% | Developer ≠ Reviewer 역할 분리 + Review RT 교차 검증 + 기계적 테스트 |

tunaFlow는 "에이전트 여러 개를 회사처럼 돌리는" 접근이 아니라, **총괄-워커 패턴**(Architect가 Plan 유지, Developer/Reviewer는 워커)과 **블랙보드 패턴**(DB가 공유 상태)으로 이 문제들을 구조적으로 회피합니다. DeepMind 연구에 따르면 에이전트 4개를 넘으면 조율 이득이 사라지는데, tunaFlow는 3-role + RT 2-agent로 이 범위 안에서 동작합니다.

---

## 목차

- [왜 이렇게 설계했나](#왜-이렇게-설계했나)
- [주요 기능](#주요-기능)
- [아키텍처](#아키텍처)
- [기술 스택](#기술-스택)
- [사전 준비](#사전-준비)
- [시작하기](#시작하기)
- [DB 스키마](#db-스키마-v29)
- [프로젝트 구조](#프로젝트-구조)
- [개발 이력](#개발-이력)
- [참고 문헌](#참고-문헌)
- [연락처](#연락처)
- [라이선스](#라이선스)

---

## 주요 기능

### 1. 멀티엔진 에이전트 실행

5개 엔진을 통합 지원하며, 모든 실행은 background thread/tokio task에서 동작합니다.

| 엔진 | 연동 방식 | 스트리밍 |
|------|----------|---------|
| Claude (Anthropic) | CLI subprocess | stream-json |
| Codex (OpenAI) | CLI subprocess | JSONL synthetic |
| Gemini (Google) | CLI subprocess | stream-json |
| OpenCode | CLI subprocess | one-shot |
| OpenAI Compatible (Ollama/LM Studio/vLLM) | HTTP SSE | SSE streaming |

- **Agent Profiles**: engine/model/persona/default-skill을 프로필로 묶어 빠르게 전환
- **Tool Steps 가시화**: Claude/Codex/Gemini의 중간 작업(thinking, tool_use, file_change)을 실시간 표시
- **Model Discovery**: 각 엔진의 사용 가능한 모델 자동 탐색
- **CLI 자동 탐색**: fnm/nvm 경로까지 포함한 바이너리 자동 resolve

### 2. Roundtable (RT) — 멀티에이전트 토론

여러 에이전트가 하나의 주제에 대해 토론합니다.

- **Sequential 모드**: 에이전트가 순서대로 발언하며 이전 발언을 참고
- **Deliberative 모드**: 모든 에이전트가 동시에 응답, completion-order로 수집
- **참가자별 identity 주입**: 이름/엔진/역할이 프롬프트에 명시되어 역할 혼동 방지
- **ContextPack RT 주입**: 상용 엔진은 auto context, 로컬 엔진은 lite(15k cap) + RtContextCache 캐싱
- **Branch 확장 모드**: 모든 RT는 Branch의 확장이며 드로어에서 동작

### 3. Branch & Adopt — 대화 분기

대화 중간 지점에서 분기하여 독립 실험 후 요약을 채택합니다.

- 메인 대화의 임의 메시지에서 Branch 생성
- Branch 안에서 독립적인 대화/RT 실행
- **Adopt**: Branch 결과를 요약하여 부모 대화에 삽입
- 모든 Branch는 오른쪽 드로어(슬라이더)로 열림 (최대 80% 너비)
- Branch 내 Branch 중첩 지원 (parent_branch_id chain)

### 4. 오케스트레이션 워크플로우 파이프라인

Plan 기반 3-role 자동화 파이프라인입니다.

```
Chat → Plan 승격 → Approval(승인/검토/보류)
  → Implementation Branch → Developer 자동 호출
  → Review RT(2-agent) → Verdict(pass/fail/conditional)
  → Done 또는 Rework 루프
```

**3-Role 시스템**:

| 역할 | 책임 | 에이전트 |
|------|------|---------|
| **Architect** | Plan 설계, subtask 분할, task 파일 작성 | 메인 채팅 에이전트 |
| **Developer** | task 파일 기반 구현, 검증 명령 실행 | Implementation Branch |
| **Reviewer** | 코드 읽기 기반 리뷰, verdict 판정 | Review RT (2-agent) |

**주요 기능**:
- `<!-- tunaflow:plan-proposal -->` 등 **마커 기반 자동 감지**: plan-proposal, impl-plan, impl-complete, review-verdict, subtask-done 5종
- **PlanProposalCard / ApprovalGate / ImplPlanCard / ReviewVerdictCard** UI 컴포넌트
- **Doom Loop 감지**: review 3회 실패 시 자동 에스컬레이션 → Architect 재설계 요청
- **subtask 타겟 rework**: failed_subtask_ids로 실패한 subtask만 재작업
- **zod 스키마 검증**: 5개 워크플로우 스키마 (graceful degradation)
- **후속 Plan**: parent_plan_id로 Plan 계보 추적

### 5. Failure Learning — 실패 학습 시스템

Review fail에서 학습하여 같은 실수 반복을 방지합니다.

- Review fail 시 findings를 `failure_lessons` 테이블에 자동 저장 (파일 경로, 패턴 자동 추출)
- **Rework 프롬프트에 유사 실패 자동 주입**: FTS5 키워드 검색 + 파일 경로 매칭 하이브리드
- Review pass 시 미해결 lessons에 resolution 자동 채움
- 프로젝트 범위 내 검색 (다른 프로젝트의 실패는 포함하지 않음)

### 6. Insight — 프로젝트 품질 분석

기존 Test 탭을 대체한 프로젝트 전체 품질 분석 시스템입니다. Review 탭은 워크플로우 verdict/findings 전용으로 유지됩니다.

**핵심 원칙**: 에이전트에게 "프로젝트 전체를 읽어봐"가 아니라, **시스템이 사전 추출한 데이터만** 분석하게 하여 토큰을 절감합니다 (50k~200k → 5k~20k).

```
사전 추출 (rawq/CRG/lessons/test/memory)
  → 카테고리별 컨텍스트 조립
  → 에이전트 타겟 분석
  → findings 파싱 + fix_difficulty 평가
  → Quadrant 뷰로 표시 (Quick Wins / Strategic / Fill-ins / Deprioritize)
```

**6개 분석 카테고리**:

| 카테고리 | 분석 대상 | 데이터 소스 |
|----------|----------|------------|
| 안정성 (stability) | 에러 처리, panic, silent catch | rawq + failure_lessons |
| 테스트 (test) | 커버리지 갭, 실패 테스트 | test_runner + rawq |
| 아키텍처 (architecture) | 순환참조, 커플링, 레이어 위반 | code-graph + memory |
| 성능 (performance) | 불필요한 복사, N+1, 블로킹 호출 | rawq |
| 보안 (security) | 인젝션, XSS, 시크릿 노출 | rawq |
| 기술 부채 (debt) | dead code, TODO/FIXME, deprecated | rawq + code-graph |

**Auto Fix 파이프라인** (CodeCureAgent 패턴):
- `auto` 난이도 findings → 에이전트 자동 수정 → 테스트 검증 → rawq 재스캔 → 패턴 사라짐 확인
- 실패 시 사용자에게 보고 (git revert 필요)

**Quadrant 우선순위** (SQALE + Impact×Cost):
- **Quick Wins**: auto + critical/major → "Run All" 버튼으로 일괄 자동 수정
- **Strategic**: guided + high impact → Architect에게 Plan 생성 요청
- **Fill-ins**: low impact → 여유 있을 때 수정
- **Deprioritize**: manual → 메모 또는 무시


### 7. ContextPack — 4-engine 공통 프롬프트 조립

매 요청마다 동일한 구조의 normalized prompt를 조립하여 모든 엔진에 전달합니다.

```
┌─ Identity ────────────────────────────┐
│ Profile → Engine → Model → Persona    │
│ 한국어 응답 규칙                        │
├─ Context ─────────────────────────────┤
│ Recent messages (author attribution)  │
│ Parent/Thread inheritance             │
│ Compressed conversation memory        │
│ Cross-session context                 │
├─ Knowledge ───────────────────────────┤
│ Plan document + task files            │
│ Findings + Artifacts                  │
│ Skills (phase-based auto-injection)   │
│ rawq code search results              │
│ context-hub library docs              │
│ code-review-graph dependency info     │
│ Failure lessons (rework only)         │
├─ Agent Role Document ─────────────────┤
│ docs/agents/{architect|developer|     │
│ reviewer}.md (워크플로우 역할별)        │
└───────────────────────────────────────┘
```

- **Context modes**: Lite / Standard / Full / Auto (대화 길이 기반 자동 선택)
- **Budget control**: section별 압축 목표, total cap 조정 (Settings에서 설정)
- **Multi-agent context**: participants meta + budget-based dynamic window + per-agent last-message guarantee
- **마커 기반 멀티턴 도구 호출**: `<!-- tunaflow:tool-request:TYPE:QUERY -->` — docs/rawq/graph/plans 4종

### 8. 장기기억 & 벡터 검색

- **주제별 메모리**: 12+ 메시지 시 JSON 배열 토픽 분할 저장 (1-5개 토픽/대화), provenance/model 기록
- **자동 세션 발견**: FTS5 + Vector 하이브리드로 관련 대화 자동 연결 (session_links 테이블)
- **Vector DB**: rawq embed CLI 활용 (snowflake-arctic-embed-s 384차원), conversation_chunks BLOB 임베딩, brute-force cosine 검색
- **수동 핀**: 사용자가 관련 대화를 직접 연결 가능

### 9. rawq — 코드 검색 엔진

- **Sidecar binary**: 앱 시작 시 daemon 자동 실행, 임베딩 모델 상주 (30분 idle timeout)
- `.gitignore` 존중 인덱싱 (node_modules, target 등 자동 제외)
- **SearchOptions**: rerank, token-budget, text-weight, rrf-weight 지원
- 개념 쿼리 vs 코드 쿼리 자동 감지 → 가중치 자동 조정
- `prompt_needs_rawq()` 게이트: 10자+ 프롬프트에 자동 포함
- 에이전트 완료 시 자동 re-index (fs watcher)

### 10. code-review-graph 통합

- CLI query/impact 명령으로 의존성/영향도 분석
- Rust sidecar 통합 + ContextPack 자동 주입
- `agent:completed` 시 auto update
- 마커 기반 도구 호출: `<!-- tunaflow:tool-request:graph:QUERY -->`

### 11. Skills — 스킬 시스템

4-layer 스킬 아키텍처:

| Layer | 설명 |
|-------|------|
| **A** 프로젝트 자동 감지 | 프로젝트 스택에 맞는 스킬 자동 추천 |
| **B** 프로젝트별 영속 | 프로젝트에 고정된 스킬팩 |
| **C** 프롬프트 동적 활성화 | 프롬프트 키워드 매칭으로 스킬 자동 활성화 |
| **D** Persona 추천 | Persona별 recommendedSkills |

- `~/.tunaflow/skills/` vendor별 스킬 snapshot
- **skills.sh 레지스트리**: API 검색 + 다운로드 설치
- **멀티툴 스킬 스캔**: 12개 도구 경로 + Claude 플러그인 수집
- **워크플로우 phase별 자동 주입**: 각 phase에 맞는 스킬 자동 포함

### 12. Artifacts — 산출물 관리

- **Plan별 그룹핑**: 각 artifact가 plan_id로 자동 연결, Artifacts 탭에서 Plan별 접힘/펼침 그룹 표시
- **워크플로우 자동 생성**: Plan 승인 → architect-decision, Review RT → test-report, Review verdict → review-findings
- **타입 필터**: All / Notes / Code / Specs / Harness
- **Harness 타입**: task-brief, test-report, review-findings, architect-decision
- **Forward**: 다른 에이전트에게 artifact 전달 가능

### 13. UI/UX

- **Linear-inspired 레이아웃**: 사이드바 + 5-tab CenterPanel (Chat/Plan/Artifacts/Review/Insight) + 드로어 + RuntimeStatusBar
- **react-virtuoso**: 대량 메시지 가상 스크롤 (followOutput + scrollToIndex)
- **cmdk**: Cmd+K 커맨드 팔레트 (탭/대화/프로젝트 전환, 새 대화, 설정)
- **RuntimeStatusBar**: trace(active/skipped) + context mode + memory + rawq 상태 + cost + tok/s + context %
- **커스텀 타이틀바**: macOS overlay + 프로젝트명 표시
- **우클릭 컨텍스트 메뉴**: 메시지/사이드바 대화별 메뉴 (Shift+우클릭 devtools 유지)
- **Settings**: Agents / Personas / Runtime 섹션 분리
- **Project-first startup**: 프로젝트 미선택 시 ProjectStartup 화면
- **스마트 scaffold**: 프로젝트 생성 시 스택 자동 감지 → CLAUDE.md + docs/ 자동 생성

---

## 아키텍처

```
┌──────────────────────────────────────────────────────────────┐
│ Frontend (React 18 + Zustand 5 + Tailwind CSS 4)            │
│ ├─ Sidebar — Project selector / Chats / Artifacts / Skills  │
│ ├─ CenterPanel — Chat / Plan / Artifacts / Review / Insight  │
│ ├─ Drawers — Branch / RT (오른쪽 슬라이더)                    │
│ ├─ Settings — Agents / Personas / Runtime                   │
│ └─ RuntimeStatusBar + TraceModal + CommandPalette           │
├──────────────────────────────────────────────────────────────┤
│ Tauri 2 Host (Rust + Tokio async)                           │
│ ├─ Commands — CRUD + background agent execution             │
│ ├─ Agents — claude, codex, gemini, opencode, ollama + SDKs  │
│ ├─ Context — ContextPack, compression, vector search        │
│ ├─ Workflow — Plan/Approval/Review/Verdict pipeline         │
│ ├─ Failure Learning — FTS5 search + rework injection        │
│ ├─ Insight — pre-extraction + agent analysis pipeline        │
│ └─ DB — SQLite WAL, dual read/write, v29 schema            │
├──────────────────────────────────────────────────────────────┤
│ CLI Agents / Sidecars                                       │
│ ├─ claude (Anthropic) — CLI subprocess                      │
│ ├─ codex (OpenAI) — CLI subprocess                          │
│ ├─ gemini (Google) — CLI subprocess                         │
│ ├─ opencode — CLI subprocess                                │
│ ├─ ollama/LM Studio/vLLM — OpenAI-compatible HTTP           │
│ ├─ rawq — code retrieval + embedding sidecar                │
│ ├─ code-review-graph — dependency analysis sidecar          │
│ └─ context-hub — knowledge search sidecar                   │
└──────────────────────────────────────────────────────────────┘
```

---

## 기술 스택

| 계층 | 기술 |
|------|------|
| Desktop | Tauri 2 |
| Frontend | React 18, TypeScript, Zustand 5, Tailwind CSS 4 |
| Backend | Rust, Tokio (async), rusqlite (bundled SQLite) |
| Virtual scroll | react-virtuoso |
| Command palette | cmdk |
| Toast | sonner |
| Markdown | react-markdown, remark-gfm, react-syntax-highlighter (Prism + oneDark) |
| Schema validation | zod |
| Icons | Lucide React |
| Testing | Vitest + jsdom (frontend), Cargo test (Rust) |

---

## 사전 준비

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://www.rust-lang.org/tools/install) stable
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/)
- 아래 에이전트 CLI 중 최소 1개 이상:
  - `claude` — [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
  - `codex` — [OpenAI Codex CLI](https://github.com/openai/codex)
  - `gemini` — [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- (선택) rawq sidecar — `./scripts/build-rawq.sh`로 빌드
- (선택) Ollama — 로컬 LLM 실행 시

---

## 시작하기

```bash
# 의존성 설치
npm install

# 개발 실행
npm run tauri dev

# 프로덕션 빌드
npm run tauri build
```

### 빌드 검증

```bash
npx tsc --noEmit              # TypeScript check
npx vite build                # Frontend build
cd src-tauri && cargo check   # Rust check

# Tests
npx vitest run                # Frontend (188 tests)
cd src-tauri && cargo test --lib  # Rust unit (232 tests)
```

현재 Rust 232 + Frontend 188 = **420개 테스트** 통과.

---

## DB 스키마 (v29)

| 테이블 | 용도 |
|--------|------|
| `projects` | 프로젝트 (path, type, soft-delete) |
| `conversations` | 대화 (chat/roundtable mode, rt_config JSON) |
| `messages` | 메시지 (role, content, engine, model, persona) |
| `messages_fts` | FTS5 전문 검색 (트리거 동기화) |
| `branches` | 대화 분기 (chat/roundtable mode, parent chain, git_branch) |
| `plans` | 워크플로우 플랜 (phase, 3-role engines, parent_plan_id, slug) |
| `plan_subtasks` | 플랜 하위 작업 (depends_on, parallel_group) |
| `plan_events` | 플랜 이벤트 타임라인 |
| `artifacts` | 산출물 (type, status, subtask/plan 연결) |
| `failure_lessons` | 실패 학습 (finding, pattern, file_path, resolution) |
| `failure_lessons_fts` | FTS5 실패 학습 검색 (트리거 동기화) |
| `insight_sessions` | Insight 분석 세션 (status, categories, summary) |
| `insight_findings` | Insight 발견사항 (category, severity, fix_difficulty, status) |
| `insight_reports` | Insight 카테고리/메타 보고서 |
| `memos` | 메모 (message 연결, tags) |
| `trace_log` | ContextPack 트레이스 (mode, sections, length, truncation) |
| `agent_jobs` | 에이전트 작업 레지스트리 |
| `conversation_memory` | 주제별 압축 메모리 (topic, provenance, model) |
| `session_links` | 자동 세션 발견 링크 (score, method) |
| `conversation_chunks` | 벡터 임베딩 (BLOB, 384차원) |

29개 migration + FTS5 가상 테이블 2개.

---

## 프로젝트 구조

```
tunaFlow/
├── src-tauri/                # Rust backend
│   ├── src/
│   │   ├── lib.rs            # Tauri app builder + command registration
│   │   ├── agents/           # CLI adapters (claude, codex, gemini, opencode, ollama, rawq)
│   │   ├── commands/         # Tauri commands + helpers
│   │   │   ├── agents.rs               # 5-engine background stream commands
│   │   │   ├── agents_helpers/         # ContextPack, identity, send_common
│   │   │   ├── roundtable.rs           # RT orchestration
│   │   │   ├── roundtable_helpers/     # RT executor, prompt, persist
│   │   │   ├── failure_lessons.rs      # 실패 학습 CRUD + FTS5 검색
│   │   │   ├── conversation_memory.rs  # 주제별 압축 메모리
│   │   │   ├── session_discovery.rs    # FTS5+Vector 세션 발견
│   │   │   ├── vector_search.rs        # 벡터 임베딩/검색
│   │   │   └── ...
│   │   ├── db/               # SQLite schema, migrations (v1-v29), models
│   │   ├── errors.rs         # AppError enum
│   │   └── guardrail.rs      # Context budget limits
│   ├── binaries/             # rawq sidecar (gitignored)
│   └── Cargo.toml
├── src/                      # React frontend
│   ├── components/tunaflow/
│   │   ├── chat/             # Markdown rendering, FileViewer
│   │   ├── context-panel/    # Plans, Review, Insight, Trace, Skills, Artifacts, Evaluation
│   │   ├── settings/         # Agents, Personas, Runtime sections
│   │   ├── input/            # EngineSelector, ModelSelector, RoundtableControls
│   │   ├── message/          # MessageMeta, MessageActions, ProgressSurface
│   │   ├── sidebar/          # Chats, TreeRow, Artifacts, Files
│   │   ├── CenterPanel.tsx   # 5-tab center (Chat/Plan/Artifacts/Review/Insight)
│   │   └── RuntimeStatusBar.tsx
│   ├── stores/slices/        # Zustand slices (6개)
│   ├── lib/                  # utils, schemas, parsers, api/, engineConfig
│   └── tests/                # vitest tests
├── docs/
│   ├── plans/                # 구현 계획 (~100개, index.md 참조)
│   ├── prompts/              # 실행 프롬프트
│   ├── reference/            # SSOT 문서
│   ├── ideas/                # 아이디어 (Insight 탭 설계 등)
│   └── how-to/               # 운영 가이드
├── scripts/                  # build-rawq.sh, publish-skills.sh
├── CLAUDE.md                 # Claude Code handoff document
└── package.json
```

---

## 개발 이력

### 프로젝트 계보

tunaFlow는 4개 프로젝트의 경험이 수렴된 결과물입니다.

```
tunaDish (채팅 UI, 3/20)  ──┐
                             ├→ tunaChat (합체 1차, Python sidecar, 3/24)
tunaPi (브릿지 서버, 3/22) ──┘           │
                                        ↓
                                  tunaFlow (합체 2차, 전체 Rust, 3/26~)
                                        ↑
tunaInsight (분석 서비스) ──────────────┘ (Insight 탭으로 통합)
```

| 프로젝트 | 역할 | 주요 기여 |
|---------|------|----------|
| **tunaPi** | 채팅앱 ↔ AI 에이전트 브릿지 (Python) | RT 토론, Branch, rawq, 크로스 세션, 3,538 tests |
| **tunaDish** | tunaPi 전용 웹/모바일 UI | Tauri v2, 브랜치 UI, 실시간 스트리밍, 모바일 |
| **tunaChat** | 스탠드얼론 데스크톱 1차 시도 | tunaDish+tunaPi 합체, Python sidecar 아키텍처 |
| **tunaInsight** | 멀티 에이전트 GitHub 분석 | 페르소나별 병렬 분석 → tunaFlow Insight 탭으로 흡수 |
| **tunaFlow** | 최종 통합 — 전체 Rust 전환 | 위 4개 프로젝트의 핵심 기능을 네이티브로 재구현 |

### 세션별 성과

12일, 415 commits, 42k lines — 모든 코드는 Claude Code가 작성했습니다.

| 세션 | 날짜 | 핵심 성과 |
|------|------|----------|
| 1 | 2026-03-28~29 | Linear UI, 4-engine parity, Branch/RT 통합, Skills, Agent Profile/Persona |
| 2 | 2026-03-30 | ContextPack 전체 파이프라인, identity, compressed memory |
| 3 | 2026-03-30 | Claude parity fix, agents.rs 1168→260줄 리팩토링 |
| 4 | 2026-03-31 | Multi-agent context 3-layer, project scaffold, rawq fs watcher |
| 5 | 2026-04-01 | 오케스트레이션 워크플로우 Phase A-E 전체 완료 |
| 6 | 2026-04-02 | zod 스키마, Ollama 엔진, Tool Steps 가시화 |
| 7 | 2026-04-02~03 | 장기기억 4단계, Vector DB, virtuoso, cmdk, 실사용 검증 50+ 버그 수정 |
| 8-9 | 2026-04-03~04 | 이벤트 격리, RT 전면 수정, 스트리밍 race condition 해결 |
| 10 | 2026-04-04 | 스킬 4-layer + 레지스트리, CRG 통합, 마커 기반 도구 호출, DB v25 |
| 11 | 2026-04-04 | 전수조사, 문서 정합성 복구, expect 패닉 제거 |
| 12 | 2026-04-05 | 테스트 180→352, 3-role 프롬프트 근본 수정, 에스컬레이션 경로 완성 |
| 13 | 2026-04-05~06 | Review 자동 감지, doom loop 안정화, 코드 품질 감사 7항목 |
| 14 | 2026-04-06 | Failure Learning, Artifacts Plan 그룹핑, Insight 탭 설계 |
| 15 | 2026-04-07 | **Insight 탭 구현** (Phase A~G), 사전 추출 파이프라인, Auto Fix, 5탭→5탭 (Test→Insight) |

---

## 문서

| 문서 | 용도 |
|------|------|
| [CLAUDE.md](./CLAUDE.md) | Claude Code용 상세 handoff (아키텍처, 스키마, 컨벤션) |
| [Data Model](./docs/reference/dataModelRevised.md) | 도메인 모델 SSOT |
| [Implementation Status](./docs/reference/implementationStatus.md) | 기능별 구현 현황 |
| [Plans Index](./docs/plans/index.md) | 구현 계획 인덱스 (~100개) |
| [Insight Design](./docs/ideas/insightTabDesign.md) | Insight 탭 설계 (카테고리 기반 프로젝트 분석) |
| [Multi-Agent Analysis](./docs/reference/multiAgentOrchestrationAnalysis.md) | 오케스트레이션 문제 분석 + tunaFlow 대응 |
| [Known Issues](./docs/reference/knownIssues_2026-04-05.md) | 미해결 이슈 |

---

## 참고 문헌

이 프로젝트의 설계에 참고한 연구 및 방법론입니다.

### 멀티 에이전트 오케스트레이션

0. shalomeir, "Multi-Agent Orchestration Problems", 2025. — 맥락 붕괴(41.8%), 유령 위임(36.9%), 검증 오류(21.3%) 분석. 총괄-워커/블랙보드 패턴 권장. [Substack](https://shalomeir.substack.com/p/multi-agent-orchestration-problems)

### 에이전트 코드 수정 성공률 연구

1. C. E. Jimenez et al., "SWE-bench: Can Language Models Resolve Real-world Github Issues?", 2024. — 수정 파일/라인 수와 에이전트 성공률의 강한 음의 상관관계. [GitHub](https://github.com/SWE-bench/SWE-bench)

2. Scale AI, "SWE-bench Pro: Can AI Agents Solve Long-Horizon Software Engineering Tasks?", 2025. — 평균 107줄/4.1파일 수정 문제에서 에이전트 성능 급격 저하. [Paper](https://static.scale.com/uploads/654197dc94d34f66c0f5184e/SWEAP_Eval_Scale%20(9).pdf)

3. I. Bouzenia et al., "RepairAgent: An Autonomous, LLM-Based Agent for Program Repair", ICSE 2025. — 파일 수가 수정 난이도의 가장 좋은 프록시. [Paper](https://software-lab.org/publications/icse2025_RepairAgent.pdf)

4. "CodeCureAgent: Automatic Classification and Repair of Static Analysis Warnings", 2025. — SonarQube 경고 96.8% 자동 수정, Change Approver 패턴. [arXiv](https://arxiv.org/pdf/2509.11787)

### 기술 부채 관리 방법론

5. J.-L. Letouzey, "The SQALE Method for Evaluating Technical Debt", MTD 2012. — remediation/non-remediation cost 기반 ROI 우선순위. [ACM](https://dl.acm.org/doi/abs/10.5555/2666036.2666042)

6. Sonar, "SQALE, the ultimate Quality Model to assess Technical Debt". — SonarQube의 SQALE 구현. [Blog](https://www.sonarsource.com/blog/sqale-the-ultimate-quality-model-to-assess-technical-debt/)

7. "On the Technical Debt Prioritization and Cost Estimation with SonarQube tool". — SonarQube 추정 대비 실제 수정 시간 50% 이하. [ResearchGate](https://www.researchgate.net/publication/345632101)

8. vFunction, "How to Prioritize Tech Debt: Strategies for Effective Management", 2025. — Quadrant Method (Impact x Cost). [Blog](https://vfunction.com/blog/how-to-prioritize-tech-debt-strategies-for-effective-management/)

### LLM 기반 소프트웨어 엔지니어링

9. "A Survey of LLM-based Automated Program Repair", 2025. — LLM APR 전체 서베이. [arXiv](https://arxiv.org/pdf/2506.23749)

10. "LLM-based Agents for Automated Bug Fixing: How Far Are We?", 2024. — 에이전트 기반 버그 수정 한계와 가능성. [arXiv](https://arxiv.org/html/2411.10213v2)

11. "LLM-Based Agentic Systems for Software Engineering", 2026. — SE 에이전트 패러다임 비교. [arXiv](https://arxiv.org/pdf/2601.09822)

---

## 연락처

- Email: d9ng@outlook.com

---

## 라이선스

Private project.
