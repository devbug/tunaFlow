---
title: Developer 핸드오프 — Reviewer verdict → Architect 직행 라우팅 + askMeta UX 폐지
plan: docs/plans/reviewerVerdictDirectArchitectPlan_2026-05-04.md
created_at: 2026-05-04
---

# Developer 핸드오프 — Reviewer verdict → Architect 직행 + askMeta UX 폐지

## 0. 한 줄 요약

Reviewer verdict (pass/fail/conditional) 처리 시 Meta-agent inbox 로 가던 알림을 *Architect 직행* 으로 전환하고, *"메타에게 물어보기"* (askMeta) UX 를 폐지한다. Tier 2 brief / identity-trigger / memory auto-trigger / inbox 자체는 보존 — Meta role 의 *부분 축소* 이지 전면 해체가 아니다 (c-2 scope).

## 1. 작업 개요 — task 표

Plan §3 의 7 task 를 3 PR 로 분리한다. PR-1 → PR-2 → PR-3 순서로 진행. PR-1 단독으로도 UX 정리는 완료되므로 PR-2/3 막히면 PR-1 만 먼저 머지 가능. Task 03 (conditional) 은 plan §3 옵션 (i) default = no-op 으로 결정 — **이번 핸드오프에서는 PR 불필요**, 사용 데이터 1~2 cycle 후 옵션 (ii) 채택 여부 재평가.

| Task | 파일 | 핵심 변경 | 우선 |
|---|---|---|---|
| **PR-1** | | | |
| 04 | `MetaFloatingChat.tsx`, `locales/{ko,en}/dialog.json`, `locales/{ko,en}/workflow.json` | askMetaAbout callback + 버튼 + i18n 키 (`action_ask_meta`, `ask_about_*`) 제거 | P0 |
| **PR-2** | | | |
| 05 | `lib/workflow/architectDispatch.ts` (신규), `ReviewVerdictCard.tsx` | Architect dispatch helper 2종 (`dispatchArchitectNextPriority` / `dispatchArchitectRedesign`) 추출. handleRedesign 의 inline dispatch → helper 호출로 교체 | P0 |
| 01 | `lib/workflow/reviewWorkflow.ts` (406~454), `locales/{ko,en}/workflow.json` | pass 분기의 `dispatchMetaNotification(review_passed)` 제거 + `dispatchArchitectNextPriority(plan)` 호출. `next_priority_prompt` i18n 신규 | P0 |
| 02 | `lib/workflow/reviewWorkflow.ts` (455~551) | doom escalate 분기의 `dispatchMetaNotification(doom_loop_escalated)` 제거 + `dispatchArchitectRedesign(plan, verdict, { reason: "doom-escalate", failCount })` 호출. doom warn 분기의 dispatch 제거 (plan_event_log 만 남김 — Architect 호출 없음) | P0 |
| **PR-3** | | | |
| 06 | `lib/metaNotifications.ts` (15~25), `lib/metaAnalysisTrigger.ts` (81~95) | `MetaNotificationKind` 에서 review_passed/review_failed/doom_loop_warning/doom_loop_escalated 제거. `tier2_brief` 신규 추가. metaAnalysisTrigger 의 dispatch kind 를 `tier2_brief` 로 변경 | P1 |
| 07 | `lib/workflow/__tests__/reviewWorkflow.test.ts`, `lib/workflow/__tests__/architectDispatch.test.ts` (신규), `components/tunaflow/__tests__/MetaFloatingChat.test.tsx` | 5 분기 (pass/fail/conditional/doom-warn/doom-escalate) 의 dispatch 호출 횟수 + kind 검증. Architect helper 호출 검증. askMeta 버튼 DOM 비존재 검증 | P0 |

**제외 — Task 03 (conditional)**: plan §3 옵션 (i) default = no-op. 현재 conditional 분기 (`reviewWorkflow.ts:552~554`) 는 dispatchMetaNotification 호출 없이 createPlanEvent 만 — 변경 불필요. ReviewVerdictCard 의 `handleSendToDevDirect` (Developer 직행) UX 도 *별 axis* 라 보존. 이번 핸드오프 PR 에서 conditional 영역 손대지 말 것 (DO NOT 영역).

## 2. DO — 반드시 지킬 것

1. **Plan §3 의 Verification 명령을 task 마다 실제 실행** 하고 결과를 chat 으로 보고 — 특히 PR-2 의 e2e (Plan A pass → Architect prompt 도착 / 5회 fail → Architect 재설계 prompt 도착) 는 수동 시나리오라 §5 결과 첨부 필수
2. **PR 진행 순서**: PR-1 (단독) → PR-2 (Task 05 → 01 → 02 의존 순서) → PR-3 (Task 06 → 07). PR-2 내부에서 Task 05 helper 가 먼저 존재해야 Task 01/02 가 helper 호출 가능 — 같은 PR 안에서 commit 분리하되 push 전 전체 cargo check + tsc 통과 확인
3. **회귀 위험 가드 grep 으로 사전 확인**:
   - PR-1 작업 전: `rg "askMeta|action_ask_meta|ask_about_" src/ src/locales/` 결과 baseline 기록 → 작업 후 0건 확인
   - PR-2 작업 전: `rg "dispatchMetaNotification" src/lib/workflow/reviewWorkflow.ts` 4건 baseline → 작업 후 0건 확인
   - PR-3 작업 전: `rg "review_passed|review_failed|doom_loop_warning|doom_loop_escalated" src/` baseline → 작업 후 i18n / 주석 / fixture 외 0건 확인
4. **feature 브랜치 분리**:
   - PR-1: `chore/askmeta-ux-removal`
   - PR-2: `feat/reviewer-verdict-architect-direct`
   - PR-3: `chore/tier2-brief-kind-split`
5. **Commit 단위 task 별 분리** — 한 PR 안에서도 각 task 가 독립 commit:
   - 예 PR-2: `refactor(workflow): extract architectDispatch helper (Task 05)` → `feat(workflow): route review pass to architect (Task 01)` → `feat(workflow): route doom escalate to architect (Task 02)`
   - 예 PR-3: `refactor(meta): split tier2_brief kind from review-cycle kinds (Task 06)` → `test(workflow): cover verdict→architect dispatch branches (Task 07)`
6. **PR description**: plan 링크 (`docs/plans/reviewerVerdictDirectArchitectPlan_2026-05-04.md`) 첨부 + 각 task §4/§5 Verification 결과 + 회귀 grep 결과 (baseline → after) 명시. 외부 issue 없으므로 `Closes` 키워드 사용 안 함

## 3. DO NOT — 사이드 이펙트 차단

- ❌ **Tier 2 분석 (`maybeTriggerMetaAnalysis`) 의 *호출 시점* 변경 금지** — INV-RVA-5. plan §2 Non-goals. 본 plan 은 dispatch *kind* 만 분리. trigger 시점 (review_passed / review_failed) 은 보존
- ❌ **identity-trigger / memory auto-trigger / Rust `meta_agent/` 모듈 수정 금지** — INV-RVA-6. 별 axis. 본 PR scope 외
- ❌ **Architect persona / system prompt 자체 수정 금지** — Plan §2 Non-goals. dispatch *prompt template* 만 i18n 으로 분리하되 Architect 가 받는 system prompt 는 변경 없음
- ❌ **doom-loop 임계값 (warn ≥3 / escalate ≥5) 변경 금지** — INV-RVA-3. `services/doomLoopDetector.ts` 알고리즘 보존
- ❌ **conditional 분기 (`reviewWorkflow.ts:552~554`) 수정 금지** — Task 03 옵션 (i) default 결정. 변경 시 Plan 위반
- ❌ **`handleSendToDevDirect` (`ReviewVerdictCard.tsx:51~77`) 수정 금지** — INV-RVA-4. Developer 직행은 Architect 직행과 별 axis. PR-1 의 askMeta 폐지 작업 시 이 함수 영역에 손 닿지 않게 주의
- ❌ **archive_branch / loadBranches 호출 시퀀스 변경 금지** — INV-RVA-1/2. PR-2 의 Task 01 작업 시 dispatch 만 빼내고 후속 archive 흐름 (439~450) 그대로 보존
- ❌ **DB 스키마 / migration 변경 금지** — Plan §2 Non-goals. notifications.kind 컬럼은 free-text 라 마이그레이션 불필요. 기존 row 의 deprecated kind 는 Task 06 의 fallback UI 라벨로 처리 (별 mig 추가 금지)
- ❌ **Meta floating chat 자체 (탭 / 채팅 입력 / 메시지 표시) 폐지 금지** — INV-RVA-7. PR-1 폐지 대상은 *askMeta 버튼 + callback + i18n* 한정. 사용자가 직접 Meta 입력창에 질문하는 흐름은 보존
- ❌ **`architect_redesign_requested` / `tool_request_failed` / `insight_detected` / `plan_promoted` / `generic` kind 제거 금지** — INV-RVA-8. PR-3 의 Task 06 에서 *review-cycle 4 kind* 만 제거
- ❌ **새 dependency 추가 금지** — 본 PR 영역은 모두 기존 helper / Tauri command / Zustand store 재사용
- ❌ **README / CLAUDE.md / metaAgentPlan.md 수정 시도 금지** — metaAgentPlan.md 갱신은 Plan §6 *4번* 항목으로 Architect 가 PR-2 와 동시 머지 시점에 직접 처리. Developer scope 외

## 4. 변경 후 검증 (전체)

각 PR 머지 직전 통과 명령:

```bash
cd src-tauri && cargo check --message-format=short
cd src-tauri && cargo test --lib
npx tsc --noEmit
npx vitest run
```

테스트 카운트 baseline (2026-05-04 기준):
- Rust: **614 tests** — 본 PR 들은 frontend 만 변경. cargo test 결과 614 유지 확인 (감소 시 회귀)
- Frontend: **401 tests** — PR-1 후 401 유지 (askMeta 관련 기존 테스트 있으면 갱신, 없으면 동일). PR-2 후 +N (architectDispatch 단위 테스트). PR-3 후 +N (verdict 분기 + askMeta 비존재)

PR 별 회귀 grep:

**PR-1 머지 직전**:
```bash
rg "askMeta|action_ask_meta|ask_about_" src/  # 0건 (테스트 fixture 제외)
git diff src/components/tunaflow/MetaFloatingChat.tsx | grep -E "메타에게 물어보기|메타 채팅 탭"  # 0건
git diff src/components/tunaflow/context-panel/plans/ReviewVerdictCard.tsx  # 빈 출력 (PR-1 영역 아님)
```

**PR-2 머지 직전**:
```bash
rg "dispatchMetaNotification" src/lib/workflow/reviewWorkflow.ts  # 0건
rg "dispatchArchitectNextPriority|dispatchArchitectRedesign" src/lib/workflow/  # 양 함수 모두 정의 + 호출
git diff src/lib/metaAnalysisTrigger.ts  # 빈 출력 (PR-2 영역 아님)
git diff src/lib/workflow/services/doomLoopDetector.ts  # 빈 출력 (INV-RVA-3)
git diff src/components/tunaflow/context-panel/plans/ReviewVerdictCard.tsx | grep -E "handleSendToDevDirect|conditional"  # 0건 (DO NOT 영역)
```

**PR-3 머지 직전**:
```bash
rg "review_passed|review_failed|doom_loop_warning|doom_loop_escalated" src/  # i18n / 주석 / 테스트 fixture 외 0건
rg "tier2_brief" src/lib/  # metaNotifications.ts + metaAnalysisTrigger.ts 양쪽 정의/사용
git diff src/lib/workflow/reviewWorkflow.ts  # 빈 출력 (PR-3 영역 아님)
git diff src-tauri/  # 빈 출력 (Rust 영역 미변경)
```

## 5. e2e 수동 검증

각 PR 머지 직전 실행. 회귀 시나리오 + 회귀 가드 분리.

### PR-1 (askMeta UX 폐지)

**회귀 시나리오** (사용자 보고 의도 = UX 단순화):
- ✅ Meta floating chat 열림 → inbox 항목 우측에 *"메타에게 물어보기"* 버튼이 **보이지 않음**
- ✅ inbox 항목 본문 클릭 시 route navigation (탭 전환 / planId 포커스) 정상 동작
- ✅ inbox 항목의 읽음 처리 / dismiss 동작 보존

**회귀 가드** (정상 path 깨지지 않음):
- ✅ Meta floating chat 의 *채팅 탭* 직접 열어 메시지 입력 → Tauri command 정상 동작 (사용자가 직접 메타 질문 가능)
- ✅ 다른 UI (PlansPanel / InsightPanel / ReviewVerdictCard) 모두 정상 렌더 — askMeta 키 누락으로 인한 i18n 에러 없음

### PR-2 (verdict → Architect 직행)

**회귀 시나리오**:
- ✅ Plan A 진행 → Reviewer pass → main conv 에 Architect 자동 prompt 도착 (*"plan A 완료, 다음 우선순위 제안"* 형태) 확인
- ✅ Plan B 진행 → Reviewer fail 5회 누적 → main conv 에 Architect 재설계 prompt 자동 도착 + plan phase=`subtask_review`
- ✅ ReviewVerdictCard 의 *"Plan 재설계"* 버튼 (handleRedesign) 클릭 → 기존 동작 유지 (회귀 없음)

**회귀 가드**:
- ✅ Reviewer fail 3회 (warn 단계) → Architect 자동 호출 **없음** + plan_event_log 에 `doom_loop_warning` 이벤트만 표시 + 사용자 결정 UI 보존
- ✅ Reviewer conditional → Architect 자동 호출 **없음** + Developer 직행 / 사용자 결정 UI 정상
- ✅ Plan pass 직후 양쪽 branch (impl + review) archive 되고 사이드바 stale 없음 (INV-RVA-1)
- ✅ Tier 2 brief 알림 (Haiku/Flash) 이 inbox 에 도착 — config 가 off 가 아닌 경우

### PR-3 (Tier 2 kind 분리 + test)

**회귀 시나리오**:
- ✅ Plan pass → Tier 2 brief 분석 결과 알림이 inbox 에 `tier2_brief` kind 로 표시
- ✅ 신규 vitest 케이스 모두 통과 (architectDispatch.test / reviewWorkflow.test 갱신 / MetaFloatingChat.test 갱신)

**회귀 가드**:
- ✅ 기존 inbox 의 deprecated kind row (review_passed 등) 가 fallback 라벨로 표시되고 클릭 시 route 이동 동작 — 폭주하거나 빈 카드 표시 없음
- ✅ tool_request_failed / insight_detected / plan_promoted / generic / architect_redesign_requested 알림 정상 표시 (INV-RVA-8)

GUI 환경 제약상 일부 e2e 가 subagent 환경에서 실행 불가하면 unit test 시뮬레이션으로 대체하고 *"v0.1.6-beta release 외부 사용자 검증으로 최종 확인"* 위임 — 그 사실 명시하여 chat 보고.

## 6. CI 정책

기본 정책:
- PR 직후 admin merge 즉시 가능 (CI watch 불필요)
- 자체 검증 §4 + e2e 수동 검증 §5 통과한 상태로 self-merge
- merge 후 main 에서 회귀 발생 시 즉시 revert PR 생성

release timing:
- 본 plan 의 변경은 *알림 inbox 표면 변화 + askMeta 버튼 사라짐* 으로 외부 사용자 가시. **v0.1.6-beta release notes 강조 필요**:
  - "메타 알림이 review-cycle 외 항목 (Tier 2 brief / tool / insight) 으로 좁아짐. plan pass/fail 은 Architect 가 직접 받음"
  - "*'메타에게 물어보기'* 버튼 폐지 — 메타 입력창 직접 사용으로 대체"
- 기존 inbox 의 deprecated kind row 처리: release notes 에 *"이전 알림은 fallback 라벨로 표시. 필요시 dismiss-all"* 안내 포함 권장
- 3 PR 모두 같은 release cycle (v0.1.6-beta) 안에 머지 권장 — 부분 머지 시 *kind 정합성 깨짐* (PR-2 만 머지하면 review-cycle kind 가 정의돼 있는데 dispatch 안 함)

## 7. 보고 포맷

작업 완료 시 chat 으로 다음 형식 회신:

```
## PR-1 (askMeta UX 폐지)
- 변경 라인: +N / -M (MetaFloatingChat.tsx, locales/{ko,en}/dialog.json, locales/{ko,en}/workflow.json)
- §4 Verification:
  - cargo check: PASS
  - cargo test --lib: 614 → 614 (감소 없음)
  - tsc --noEmit: PASS
  - vitest run: 401 → 40N (askMeta 비존재 케이스 +n)
- §5 e2e 수동:
  - 회귀 시나리오: ✅ inbox 버튼 비존재 + route 이동 동작
  - 회귀 가드: ✅ 메타 채팅 입력창 정상 / 다른 UI 렌더 정상
- 회귀 grep: rg askMeta src/ → 0건 / git diff ReviewVerdictCard.tsx → 빈 출력
- PR URL: https://github.com/hang-in/tunaFlow/pull/<n>

## PR-2 (verdict → Architect 직행)
[같은 형식]

## PR-3 (Tier 2 kind 분리 + test)
[같은 형식]

## DO NOT 영역 침범 없음 확인
- maybeTriggerMetaAnalysis 호출 시점 보존 (INV-RVA-5): grep 결과 첨부
- doomLoopDetector.ts diff 0
- conditional 분기 (reviewWorkflow.ts:552~554) diff 0
- handleSendToDevDirect 영역 diff 0
- src-tauri/ diff 0
```

## 8. 막히면

- **PR-2 의 Architect 자동 dispatch 가 main conv 의 사용자 작업 흐름을 끊는 UX 마찰** → 1차로 main conv dispatch 유지 (현재 plan §4 Cross-cutting risks 기재). 마찰이 강하면 chat 보고 + Architect 에게 escalate (별 plan: *plan-attached conv* 분리 dispatch)
- **`autoArchitectOnPass` config toggle 추가 시 settings store 영향** → settings schema 변경이 필요하면 **별 PR / 별 axis** 로 분리. 본 PR-2 는 toggle 없이 *항상 자동 호출* 로 머지하고, toggle 은 follow-up plan
- **PR-3 의 deprecated kind fallback UI 가 광범위 컴포넌트 변경 필요** → 1차로 *kind 모르면 generic 라벨* 의 단순 fallback 만 추가. 더 세밀한 라벨링은 별 PR
- **i18n key 누락으로 ko/en 간 차이 발생** → ko 만 추가하고 en 누락 시 PR description 에 *"en 보완 follow-up"* 명시 + 같은 release 안에 보완 PR. 머지 차단 사유 아님 (영어 fallback 가능)
- **신규 vitest 가 기존 reviewWorkflow 테스트 깨뜨림** → 기존 테스트가 *Meta dispatch 호출* 을 단언하는 케이스면 본 plan 의 의도대로 갱신. *변경된 행동* 을 reflect 하는 게 맞음 — fixture 무리하게 보존하지 말 것
- **진단 단계가 1시간 도달** → chat 보고 + Architect escalate. 무리한 우회 금지
- **root cause 가 Rust `meta_agent/` 영역 (DO NOT) 으로 진단되면** → frontend hotfix 보류 + Architect escalate (별 plan)
