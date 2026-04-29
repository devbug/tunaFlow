---
title: bkit-claude-code reference 채택 idea — Context Engineering / Role Redistribution / Hooks
status: idea (다음 update 시 PR-ready)
created_at: 2026-04-29
canonical: false
external_reference:
  repo: https://github.com/popup-studio-ai/bkit-claude-code
  license: Apache-2.0
  compat: tunaFlow Apache-2.0 호환 ✅
  attribution_required: 인용 시 출처 명시 (file header 코멘트 또는 NOTICE 한 줄)
related:
  - src-tauri/src/commands/agents_helpers/send_common/context_loading.rs
  - src-tauri/src/commands/project_tools.rs
  - CLAUDE.md
  - src/components/tunaflow/RuntimeStatusBar.tsx
---

# bkit-claude-code reference 채택 idea

## 0. Context

`~/privateProject/_research/_util/bkit-claude-code/` 의 3 영역을 tunaFlow 와 비교 분석. 다음 update cycle 시 PR-ready 단위로 적용 가능한 idea 9 개 정리.

세 영역:
1. **Context Engineering** (`docs/context-engineering.md`, 108 줄)
2. **AI-native Role Redistribution** (`docs/ai-native-role-redistribution.md`, 495 줄)
3. **Hooks System** (`hooks/hooks.json` + `hooks/startup/*.js`, 19 hook 종류)

## 1. License + Attribution 처리

bkit Apache-2.0 = tunaFlow Apache-2.0. 직접 코드/패턴 인용 가능. **단**:

- 패턴/명세 한 두 줄 인용: 코멘트로 출처 명시 (예: `// pattern from popup-studio-ai/bkit-claude-code/docs/context-engineering.md:18 (Apache-2.0)`)
- 함수/모듈 통째 인용: 파일 header 에 LICENSE + NOTICE 명시
- `NOTICE` 파일이 tunaFlow 에 있다면 한 줄 추가 권장 (`bkit-claude-code (Apache-2.0): https://github.com/popup-studio-ai/bkit-claude-code — patterns referenced in ContextPack/role/hooks design`)

## 2. 영역 A — Context Engineering

### 2.1 bkit 명세 요약 (context-engineering.md)

3 핵심 기능:

| 기능 | 명세 | 위치 |
|---|---|---|
| **Hook output budget** | CC enforced 10K char cap, bkit defensive 8K (2K safety margin) | `lib/core/context-budget.js → applyBudget()` |
| **Priority preserve** | MANDATORY / 마커 우선 보존 → 나머지 document order 로 budget 채움 → truncation notice 첨부 | 동일 |
| **SHA-256 fingerprint dedup** | session-isolated SHA + TTL 1h + atomic write (`.pid.ts.tmp` + rename) + GC (30 day stale + 100 LRU) | `lib/core/session-ctx-fp.js` |
| **3-way toggle** | `enabled` (master) / `sections` (8 builders) / `maxChars` / `priorityPreserve` | `bkit.config.json:ui.contextInjection` |

추가 ADR-style 한계:
- CC `once: true` 가 settings-level hook 에 미동작 → PreCompact/PostCompact 시 SessionStart 재실행 → 같은 12KB context 가 2~3회 inject 회귀
- 해결: fingerprint dedup (ENH-239)

### 2.2 tunaFlow 현황

| 영역 | 현 상태 |
|---|---|
| budget allocation | `build_normalized_prompt_with_budget()` Lite/Standard/Full auto mode (60K Standard) |
| memory policy | structured (plan/findings/artifacts) + conversational + skipped (session-continuation) — `[memory_policy]` 로그 |
| priority preserve | **명시적 정의 없음** — top=[platform/agent-role/skills] 등 우선순위는 implicit |
| dedup | session-continuation skip (binary on/off), fingerprint 기반 dedup 없음 |
| 사용자 토글 | Settings → Runtime 에 ContextPack 모드 토글 일부 있음 (mode auto/lite/standard/full) — section 단위 X, maxChars 조정 X |

### 2.3 Gap 분석

| Gap | 영향 | 우선 |
|---|---|---|
| priority section 명시 X | 큰 query 일 때 핵심 (identity/agent-role) 가 truncate 될 위험. 현재 implicit ordering 만 | **P2** |
| fingerprint dedup 부재 | 같은 ContextPack 이 같은 conv 에 중복 inject 되는 케이스 (예: branch adopt 직후 재send) 차단 못 함 | P3 (회귀 보고 시 격상) |
| 사용자 section 단위 토글 X | 고급 사용자 / 디버깅 시 ContextPack 일부 끄기 불가 — 매번 Lite 모드로 전체 축소만 가능 | P2 |
| 3-way toggle 명시 X | maxChars 조정이 mode 단위 (60K/15K/4K) 라 fine-tuning 불가 | P3 |

### 2.4 적용 idea (PR-ready)

#### **Idea A1 — ContextPack Priority Preserve 명시** [P2]

**bkit 패턴**: `priorityPreserve: ["MANDATORY", "Previous Work Detected", "AskUserQuestion"]` — 이 키워드 포함 섹션은 budget 초과 시 절대 truncate X.

**tunaFlow 적용**:
- `context_loading.rs` 의 ContextPack assemble 시 markers 정의:
  ```rust
  const PRIORITY_PRESERVE_MARKERS: &[&str] = &[
      "MANDATORY", "INV-", "🔴", "[CRITICAL]",
      "agent-role", "platform", "identity",
  ];
  ```
- assemble 함수가 budget 초과 감지 시:
  1. priority preserve 섹션 먼저 채움 (`top=[...]`)
  2. 나머지 섹션을 document order 로 채움
  3. 잘림 발생 시 마커 (`[truncated by memory_policy]`) 마지막 섹션에 첨부
- `[memory_policy]` 로그에 `preserved=[platform,agent-role,...]` 명시 (현재도 일부 있지만 명시 강화).

**변경 영역**: `src-tauri/src/commands/agents_helpers/send_common/context_loading.rs` (memory_policy assemble 부분), 약 30~50 LoC.

**위험**: 기존 implicit ordering 과 결과 차이 — baseline ContextPack 출력 회귀 비교 (동일 input → 동일 output) 검증 필요.

#### **Idea A2 — SHA-256 ContextPack Fingerprint Dedup** [P3, 회귀 보고 시 격상]

**bkit 패턴**: SHA-256 of assembled context + session_id + TTL 1h. 같은 fingerprint 재발생 시 빈 context (메타만 유지).

**tunaFlow 적용**:
- 새 모듈 `src-tauri/src/commands/agents_helpers/send_common/contextpack_fp.rs`:
  - `fp(context: &str, conv_id: &str) -> String` — SHA-256 hex
  - `is_duplicate(fp: &str, conv_id: &str, ttl_secs: u64) -> bool` — TTL check
  - 저장: SQLite 테이블 `contextpack_fingerprints (conv_id, fp, ts)` (또는 `~/.tunaflow/runtime/contextpack-fp.json` atomic write)
- `build_normalized_prompt_with_budget()` 마지막에 fp check → 중복이면 메타만 (system_prompt) 유지, body 비움
- 메모리 정책: `~/.tunaflow/CLAUDE.md` 의 `auto memory` 시스템과 분리 (다른 axis)

**변경 영역**: 새 파일 1 + `context_loading.rs` 후크 1줄, 약 100 LoC + DB migration v49.

**위험**: dedup 너무 공격적이면 정상 흐름 차단 가능. TTL 1h 보수적 + 옵션 OFF 토글 (`TUNAFLOW_DISABLE_CTXPACK_DEDUP=1`). 회귀 보고 누적 후 격상.

#### **Idea A3 — Settings 에 ContextPack section 단위 토글 + maxChars 조정** [P2]

**bkit 패턴**: `bkit.config.json:ui.contextInjection` 의 `enabled / sections / maxChars / priorityPreserve` 4-way 토글.

**tunaFlow 적용**:
- Settings → Runtime 또는 신규 "ContextPack" 섹션:
  - `enabled` toggle (master) — OFF 시 prompt = user message + system_prompt 만 (디버깅 / 비용 절감)
  - section 체크박스 8 개: `identity / agent-role / platform / skills / memory / retrieval / docs / crg`
  - `maxChars` slider/input — 기본 60000 / Standard, 사용자 fine-tune 가능
  - `priorityPreserve` text input — 사용자 정의 마커 추가 (Idea A1 의 default 외)
- 영구화: 기존 settings.json 패턴
- `context_loading.rs` 가 settings 읽어 분기

**변경 영역**:
- `src/components/tunaflow/settings/ContextPackSection.tsx` 신규
- `src/components/tunaflow/SettingsPanel.tsx` 섹션 등록
- `src/stores/settingsStore.ts` 새 state
- `src-tauri/src/commands/settings.rs` 영구화
- `context_loading.rs` 분기 read

약 200 LoC.

**위험**: 사용자가 너무 적극적으로 끄면 응답 품질 저하 → tooltip 으로 "초보 사용자는 default 권장" 안내. enabled=false 는 명시 경고.

## 3. 영역 B — AI-native Role Redistribution

### 3.1 bkit 핵심 철학 추출

12 섹션 중 tunaFlow Architect/Developer/Reviewer 모델과 매칭 영역:

| bkit 섹션 | 핵심 인사이트 | tunaFlow 매칭 |
|---|---|---|
| §1 Why Role Redistribution | "Humans → judges, AI → executors". "Why / 충분한가 / 다음 / 철학 일치" 4 핵심은 인간 영역 | tunaFlow `CLAUDE.md` "사용자가 도메인 지식과 방향을 결정, 에이전트가 실행" 과 동일 철학 |
| §2 CTO Maturity Model | Level 1 도구 / 2 위임 / 3 팀 운영 / 4 AI 시스템 설계 / 5 AI 가 AI 관리 — 현 시점 Level 3, Level 4 준비 | tunaFlow 자체가 Level 3~4 도달 도구. 사용자 관점 명시 가치 |
| §2 Core Competencies | (1) AI Resource Orchestration (2) Context Design (3) Quality Gate (4) Course Correction (5) Limitation Management | tunaFlow 영역 — Architect 가 (1)(2)(4) 담당, Reviewer 가 (3) — (5) 부재 |
| §4 PM AI Native | "누가 언제 무엇" → "어떤 컨텍스트에서 어떤 순서로 AI 실행" | tunaFlow Architect 핸드오프 prompt 가 정확히 그 구조. 강화 가치 |
| §7 Frontend → "UX 측정자" | 코드 작성보다 UX 결과 측정 | tunaFlow Reviewer 의 Frontend 영역 부재 (Codex 가 코드만 보고 UX 미검증) |
| §9 QA → "Quality Designer" | 테스트 실행보다 quality 정의 | tunaFlow Reviewer Verification 항목이 그 역할. 강화 가능 |

### 3.2 Gap 분석

| Gap | 영향 | 우선 |
|---|---|---|
| Maturity Model (Level 1~5) tunaFlow 자체 위치 명시 X | 사용자가 도구 활용 단계 자가진단 불가. 메타 가치 | P3 |
| AI Limitation Management 명시 X | 사용자가 ContextPack 토큰 소모 / cost / accuracy 한계 가시화 부족 (RuntimeStatusBar 일부만) | **P2** |
| Course Correction Capability 명시 X | rework / escalate 시점이 implicit. 명시적 "사용자 개입 시점" 정의 부재 | P3 |
| Frontend UX measurer 역할 부재 | Reviewer 가 코드만 보고 UX 미검증. 외부 사용자 보고 (batmania52 #2/#5) 가 그 빈틈 노출 | **P2** |

### 3.3 적용 idea (PR-ready)

#### **Idea B1 — `CLAUDE.md` 에 Maturity Model + 자가진단 한 줄** [P3, 메타]

**bkit 패턴**: Level 1~5 모델로 사용자가 자가 위치 진단.

**tunaFlow 적용**:
- `CLAUDE.md` 첫 부분 (§1 프로젝트 개요) 에 한 단락:
  > **Maturity Position**: tunaFlow 는 사용자가 Level 3~4 (AI 팀 운영 → AI 시스템 설계) 단계에서 활용. Level 1~2 (단일 작업 위임) 사용자에게는 학습 곡선 있을 수 있음. 메타에이전트 + workflow 자동화가 Level 4 구현 진행 중. 참고: bkit-claude-code/docs/ai-native-role-redistribution.md (Apache-2.0).
- 이 한 단락이 신규 사용자에게 "이 도구의 위치" 명확화

**변경 영역**: `CLAUDE.md` 한 단락 추가. 코드 변경 0.

**위험**: 0. 메타 명시일 뿐.

#### **Idea B2 — RuntimeStatusBar 에 AI Limitation Visibility 강화** [P2]

**bkit 패턴**: "context, cost, accuracy 한계 이해 후 자원 배분" 은 사용자 영역.

**tunaFlow 적용**:
- RuntimeStatusBar 에 항상 보이는 3 indicator:
  1. **Context budget**: 현재 ContextPack mode + 사용량 % (예: `Standard 35K/60K (58%)`)
  2. **Session cost**: 현재 session 누적 cost ($USD) — 이미 trace 에 있는 데이터, 가시화만
  3. **Last response accuracy hint**: 최근 결과의 self-doubt 마커 카운트 (e.g. "검토 필요" 표현 빈도) — 옵션
- 클릭 시 자세한 dashboard 또는 trace 페이지로 navigate

**변경 영역**:
- `src/components/tunaflow/RuntimeStatusBar.tsx` (3 indicator)
- `src-tauri/src/commands/trace.rs` (cost aggregation)
- 약 80 LoC

**위험**: 정보 과다 → 토글 가능 (Settings 에서 indicator 표시 ON/OFF). 첫 사용자 default 는 context budget 만.

#### **Idea B3 — Frontend UX Reviewer 역할 도입 검토** [P3, 별 plan]

**bkit 패턴**: Frontend 가 "UX measurer" — 코드 작성보다 측정.

**tunaFlow 적용** (별 plan):
- 새 reviewer role: `frontend_reviewer` — 코드 변경 후 dev 모드 띄워서 manual smoke screenshot 1장 + UI 정상 렌더 확인
- Architect 가 frontend 관련 PR 시 자동 frontend_reviewer 트리거
- 메타 reviewer (Codex) 와 별 axis — 코드 결함 vs UX 결함 분리 판정

**변경 영역**: 큰 변경. 별 plan `frontendReviewerRolePlan_<date>.md` 작성 후 진행. 약 300+ LoC.

**위험**: subagent spawn 비용 증가, 모든 PR 에 추가 round. 외부 사용자 보고 누적 (UX 회귀) 후 P2 격상 권장.

## 4. 영역 C — Hooks System

### 4.1 bkit hook 종류 (hooks.json, 19 종)

| 카테고리 | hook |
|---|---|
| Session 라이프사이클 | SessionStart, SessionEnd, InstructionsLoaded, ConfigChange, CwdChanged |
| Tool 호출 | PreToolUse / PostToolUse (Write/Edit/Bash/Skill matcher) + PostToolUseFailure |
| User 상호작용 | UserPromptSubmit, PermissionRequest, Notification |
| Compaction | PreCompact / PostCompact (matcher: auto/manual) |
| Task | TaskCreated, TaskCompleted |
| Subagent | SubagentStart / SubagentStop / TeammateIdle |
| Workflow | Stop / StopFailure |
| Filesystem | FileChanged (matcher: docs/**/*.md) |

bkit `hooks/startup/*.js` 7 모듈:
- `context-init.js` — context 초기화
- `first-run.js` — 첫 실행 onboarding tutorial (FR-α3)
- `migration.js` — 버전 migration
- `onboarding.js` — onboarding 흐름
- `preflight.js` — preflight check (FR-α4/5)
- `restore.js` — session restore
- `session-context.js` — session context build

### 4.2 tunaFlow 현황

- **자체 hook 시스템 0** — Claude Code hook 은 사용자가 별도로 등록 가능하지만 tunaFlow 워크플로우 (plan/dev/review) 단계에 사용자 정의 훅 끼워넣을 수 없음
- ContextPack assemble 전후 / send 전후 / RT 라운드 전후 모두 *내부 코드* 만 흐름 control. 사용자 확장 점 없음
- compaction (memory budget 초과 시) 도 자동 — 사용자 정의 압축 전략 X

### 4.3 Gap 분석

| Gap | 영향 | 우선 |
|---|---|---|
| 사용자 정의 hook 부재 | 고급 사용자 / 외부 contributor 가 워크플로우 확장 불가. plugin 패러다임 부재 | **P3** (큰 변경) |
| PreCompact / PostCompact hook 부재 | 사용자 정의 압축 전략 / 압축 전 외부 저장 / 압축 후 cleanup 불가 | P3 |
| SubagentStart / SubagentStop hook 부재 | Architect 가 spawn 한 Developer subagent 의 metadata 자동 logging / cleanup 불가 (현재 trace 일부만) | P3 |
| FileChanged hook 부재 | docs 변경 시 자동 reindex 또는 알림 트리거 불가 (현재 rawq fs watcher 만) | P3 |

### 4.4 적용 idea (PR-ready)

#### **Idea C1 — tunaFlow 자체 hook 시스템 도입 (Plugin v0)** [P3, 큰 변경]

**bkit 패턴**: `hooks.json` JSON 설정 + `${PLUGIN_ROOT}/scripts/*.js` 실행. matcher (Write/Edit/Bash/Skill) + timeout.

**tunaFlow 적용**:
- 새 디렉토리: `~/.tunaflow/hooks/` (사용자 hook 스크립트) + `~/.tunaflow/hooks.json` (등록)
- 지원 hook (초기 6 종):
  1. `OnSessionStart` — tunaFlow 앱 시작 시
  2. `OnContextPackBuild` — ContextPack assemble 직후 (modify 가능)
  3. `OnSendBefore` — agent send 직전 (prompt 검증 / 변형)
  4. `OnReceiveAfter` — agent 응답 직후 (parse / log)
  5. `OnRTRoundComplete` — RT 라운드 1회 완료 시
  6. `OnPlanCreate` — plan 생성 시 (외부 도구 sync)
- 실행: bash script 또는 node script (timeout 5s default)
- I/O: stdin = JSON event payload, stdout = JSON result (modify hint 포함)

**변경 영역**: 새 영역, 큰 변경:
- `src-tauri/src/hooks/` 신규 모듈 (등록 / 실행 / timeout)
- 6 hook trigger 위치 코드 추가
- Settings → Hooks 섹션 신규
- 문서 (`docs/how-to/hooks.md`)

약 500~800 LoC. 별 plan `tunaFlowHooksSystemPlan_<date>.md` 작성 후 진행 권장.

**위험**:
- 사용자 hook 이 timeout / crash 시 tunaFlow 자체 차단 가능 — sandbox + timeout 엄격
- 보안: 임의 script 실행이라 사용자 명시 enable 필요 (Settings)

#### **Idea C2 — ContextPack PreCompact / PostCompact Hook (C1 의 부분)** [P3]

**bkit 패턴**: PreCompact (compaction 직전) + PostCompact (직후) 분리. fingerprint dedup 과 묶음.

**tunaFlow 적용**:
- C1 의 6 hook 중 `OnContextPackBuild` 의 sub-event 로 `OnContextPackBudgetExceeded` 추가
- 압축 전: 사용자가 외부 저장 (예: Notion/Obsidian) 트리거 가능
- 압축 후: cleanup / 알림

**변경 영역**: C1 의 일부. C1 우선, C2 는 자연스럽게 따라옴.

#### **Idea C3 — SubagentStart / SubagentStop Hook + metadata 가시화** [P3]

**bkit 패턴**: Subagent spawn / stop 시 hook → metadata logging.

**tunaFlow 적용**:
- C1 의 6 hook 외 추가: `OnSubagentSpawn` / `OnSubagentComplete`
- 메타데이터 자동 기록: spawn 시점 / parent agent / 작업 description / exit status / duration / cost
- Insight 탭에 subagent 활동 history 표시

**변경 영역**:
- C1 hook 시스템 위에 빌드
- `src-tauri/src/db/migrations/v49_subagent_history.sql` (새 테이블)
- `src/components/tunaflow/InsightPanel.tsx` 의 새 섹션

약 150 LoC + C1 의존.

## 5. 적용 우선순위 + 타이밍

### 다음 update cycle (1~2 주 내) 권장

| Idea | 우선 | 예상 LoC | 의존 | 비고 |
|---|---|---|---|---|
| **A1** Priority Preserve | P2 | 30~50 | 없음 | 작은 ContextPack 보강. 즉시 PR 가능 |
| **A3** ContextPack Settings 토글 | P2 | ~200 | 없음 | UX 영향. dev/UX 비용 중간 |
| **B2** RuntimeStatusBar Limitation Visibility | P2 | ~80 | 없음 | 사용자 가시 가치 큼 |
| **B1** CLAUDE.md Maturity 명시 | P3 메타 | <20 | 없음 | 5분 작업. 첫 PR cycle 마지막에 묶음 가능 |

### 중기 (1~2 개월)

| Idea | 우선 | 예상 LoC | 의존 |
|---|---|---|---|
| **A2** Fingerprint Dedup | P3 (회귀 보고 시 격상) | ~100 + DB | 없음 |
| **B3** Frontend UX Reviewer | P3 별 plan | 300+ | 메타에이전트 plan 활성화 후 |
| **C1** Hooks System v0 | P3 큰 변경 | 500~800 | plugin 영역 사용자 수요 누적 후 |
| **C3** Subagent Hook + Insight | P3 | ~150 | C1 의존 |

### 장기 (3 개월+)

- **C2** PreCompact/PostCompact — C1 의 자연스러운 확장. C1 안정화 후

## 6. Attribution 처리 가이드 (모든 idea 공통)

각 idea 적용 시 PR 단위로:

1. **PR description 에 출처 명시** 한 줄:
   ```
   Pattern referenced from: popup-studio-ai/bkit-claude-code (Apache-2.0)
   - context-engineering.md (Idea A1, A2)
   - ai-native-role-redistribution.md (Idea B1, B2)
   - hooks/hooks.json (Idea C1, C2, C3)
   ```

2. **코드 인용 시 file header 코멘트**:
   ```rust
   // Pattern adapted from popup-studio-ai/bkit-claude-code/lib/core/context-budget.js
   // (Apache-2.0). See docs/ideas/bkitReferenceAdoptionIdea_2026-04-29.md.
   ```

3. **NOTICE 파일 한 줄 추가** (대규모 인용 시 — Idea C1 같은 경우):
   ```
   This product references patterns from bkit-claude-code by popup-studio-ai
   (Apache-2.0): https://github.com/popup-studio-ai/bkit-claude-code
   ```

4. **idea 별 cross-reference**: 본 문서 (`docs/ideas/bkitReferenceAdoptionIdea_2026-04-29.md`) 를 PR description 에 link.

## 7. 다음 step

본 문서는 **idea 수집 단계**. 적용 결정 후:

1. P2 batch (A1 + A3 + B2 + B1) 를 한 묶음 plan `bkitInspiredContextEngineeringEnhancementPlan_<date>.md` 로 정리 → Developer 핸드오프
2. P3 (A2, B3, C1, C2, C3) 는 각각 별 plan 으로 분리 — 실제 수요 또는 회귀 신호 발생 시 활성화
3. 본 idea 문서는 SSOT 로 유지. 적용된 idea 는 frontmatter 에 `applied: [Idea-A1, ...]` 표시

## 8. 본 idea 의 가치 측정

bkit 와 tunaFlow 가 같은 영역 (Claude Code 활용 + agent orchestration) 의 OSS 라 패턴 호환성 매우 높음. 직접 코드 fork 보다 **명세/패턴 인용** 이 효율적 — Apache-2.0 라이선스 호환 + attribution 만 처리하면 OSS 윤리도 충족.

특히 Idea **A1, A3, B2** 는 즉시 사용자 가치 (ContextPack 안정성 + 가시성) 라 다음 update cycle 에서 우선 처리할 가치 있음.
