---
title: Reviewer verdict → Architect 직행 라우팅 + askMeta UX 폐지
status: ready
phase: planning
priority: P1 (워크플로우 책임 재배분 — 외부 사용자 보고 없음, 내부 의사결정)
created_at: 2026-05-04
canonical: true
related:
  - src/lib/workflow/reviewWorkflow.ts  # processReviewVerdict 진입점 (361~554)
  - src/lib/metaNotifications.ts  # dispatchMetaNotification + MetaNotificationKind
  - src/lib/metaAnalysisTrigger.ts  # Tier 2 분석 (보존)
  - src/components/tunaflow/context-panel/plans/ReviewVerdictCard.tsx  # 사용자 명시 경로
  - src/components/tunaflow/MetaFloatingChat.tsx  # askMeta UX (폐지 대상)
  - src/locales/{ko,en}/workflow.json  # redesign_prompt 등 i18n
  - src/locales/{ko,en}/dialog.json  # action_ask_meta (폐지 대상)
  - docs/plans/metaAgentPlan.md  # Meta-agent 설계 원칙 (참고)
  - docs/reference/branchSessionPolicy.md  # brand session = main session 공유 INV
---

# Reviewer verdict → Architect 직행 라우팅 + askMeta UX 폐지

## 0. Context

### 0.1 현재 상태

`processReviewVerdict()` (`src/lib/workflow/reviewWorkflow.ts:361`) 가 reviewer verdict (pass / fail / conditional) 을 처리하면서 *세 가지 책임* 을 동시에 수행한다:

1. Plan 상태 머신 갱신 (phase / status / event log)
2. Identity-input artifact 생성 (review_outcome / finding_success / finding_failure / rework_reason)
3. **Meta-agent 알림 dispatch + Tier 2 분석 트리거** ← 본 plan 의 변경 대상

현재 dispatch 분포:

| Verdict | dispatchMetaNotification | maybeTriggerMetaAnalysis | Architect 자동 호출 |
|---|---|---|---|
| pass | `review_passed` (417) | `review_passed` (427) | ❌ (주석 451~454: *"Architect is NOT auto-invoked"*) |
| fail (일반) | ❌ | `review_failed` (477) | ❌ |
| fail + doom warn (≥3) | `doom_loop_warning` (544) | ❌ | ❌ — 사용자 결정 |
| fail + doom escalate (≥5) | `doom_loop_escalated` (528) | ❌ | ❌ — phase 만 `subtask_review` 로 |
| conditional | ❌ (createPlanEvent 만) | ❌ | ❌ |

사용자가 *명시 클릭* 으로만 Architect 호출되는 경로는 `ReviewVerdictCard.handleRedesign()` (`ReviewVerdictCard.tsx:80~128`) 한 곳. `sendWithEngine(engine, prompt)` 로 main conv 에 redesign prompt 를 dispatch.

### 0.2 사용자 결정 (이번 세션)

> "현재 리뷰어 결과가 메타에이전트로 가는데 바로 아키텍트로 가도 괜찮을거 같아"

scope 확정 (c-2):
- review verdict 라우팅 (pass / fail / conditional) 모두 **Architect 직행**
- **askMeta UX 폐지** — *"메타에게 물어보기"* 흐름 제거
- **유지**: Meta inbox 자체 (배지 / 알림 카드 / route navigation), Tier 2 분석 (Haiku/Flash brief), identity-trigger, memory auto-trigger, tool-request / insight / plan_promoted / generic 알림

### 0.3 동기 (왜 지금)

- `reviewWorkflow.ts:451~454` 의 *"Meta's oversight role"* 결정은 metaAgentPlan.md "제안하되 결정하지 않는다" 원칙의 산물. 그러나 *plan 사이클 내부* 결정 (다음 우선순위 / 재설계 요청 / rework 계속) 은 Meta 의 read-only 역할보다 Architect 의 design 역할에 더 가깝다.
- Meta 가 *조용한 inbox* + *Tier 2 brief 생성기* 로 축소되는 게 자연스럽다 — *"제안"* 권한은 Architect 가 본래 가진 권한과 중복.
- askMeta UX 가 살아있는 한 사용자는 *어디 누를지* 결정해야 한다 (Architect 클릭 vs Meta 클릭). 의사결정 burden 제거.

## 1. Invariants

| ID | 내용 |
|---|---|
| **INV-RVA-1** | Reviewer pass 시 plan phase=done / status=done / 양쪽 branch (impl + review) archive 동작 보존 |
| **INV-RVA-2** | Reviewer fail 시 phase=rework + saveFailureLessons + identity-input artifact (rework_reason) 생성 보존 |
| **INV-RVA-3** | doom-loop 카운트 / overlap 분석 알고리즘 (`services/doomLoopDetector.ts`) 동작 보존 — 임계값 변경 없음 (warn ≥3 / escalate ≥5) |
| **INV-RVA-4** | conditional 분기의 *Developer 직행* UX (`handleSendToDevDirect`, `ReviewVerdictCard.tsx:51~77`) 보존 — Architect 와 별 axis |
| **INV-RVA-5** | Tier 2 분석 (`maybeTriggerMetaAnalysis`) 의 트리거 시점 (review_passed / review_failed) 과 결과 dispatch 경로 보존 — 본 plan 은 *review-cycle 알림* 만 제거하고 Tier 2 brief 알림은 inbox 유지 |
| **INV-RVA-6** | identity-trigger / memory auto-trigger / Rust `meta_agent/` 모듈은 변경 없음 (별 axis) |
| **INV-RVA-7** | Meta inbox UI (`MetaFloatingChat.tsx`) 의 *알림 카드 표시 / 읽음 처리 / route navigation* 동작 보존 — 폐지 대상은 *askMeta 버튼* 한정 |
| **INV-RVA-8** | tool_request_failed / insight_detected / plan_promoted / generic / architect_redesign_requested 알림 dispatch 경로 보존 |
| **INV-RVA-9** | branchSessionPolicy.md INV-1~5 (brand session = main session 공유 정책) 보존 |
| **INV-RVA-10** | macOS / Windows / Linux 동일 동작 |

## 2. Goals / Non-goals

### Goals

- **G1**: Reviewer verdict (pass / fail / conditional) 처리 시 사용자 클릭 없이 Architect 가 자동으로 *다음 행동 prompt* 를 받는다 — pass 면 *"다음 우선순위 제안"*, fail/escalate 면 *"재설계 요청"*, conditional 은 §3 Task 03 에서 정의.
- **G2**: askMeta 버튼 / `askMetaAbout` callback / `action_ask_meta` i18n 키 / *"메타에게 물어보기"* 흐름이 코드와 UI 양쪽에서 사라진다.
- **G3**: Tier 2 분석 (저비용 Haiku/Flash brief) 은 review_passed / review_failed 시점에 그대로 트리거되고, 결과는 inbox 에 dispatch 된다 — *별도 kind* (예: `tier2_brief`) 로 분리.
- **G4**: doom-loop escalate 시 dispatchMetaNotification 대신 Architect 직접 호출 + plan_event_log 에 *시스템 자동 결정* 흔적 보존 (사용자 가시성 유지).
- **G5**: Architect 자동 dispatch 의 prompt template 이 i18n (ko/en) 로 분리되고, 기존 `redesign_prompt` 와 일관된 형식.

### Non-goals

- ❌ Meta-agent role 전면 해체 (c-3 — 별 plan)
- ❌ Tier 2 분석 엔진 / 모델 / 트리거 임계값 변경
- ❌ identity-trigger / memory auto-trigger / Rust `meta_agent/` 모듈 수정
- ❌ Architect persona / system prompt 자체 수정 — 입력 prompt 형식만 통일
- ❌ doom-loop 임계값 (warn ≥3 / escalate ≥5) 변경
- ❌ Reviewer / Developer subagent 정의 변경
- ❌ Meta conversation 자체 폐지 — `getOrCreateMetaConversation` 는 Tier 2 brief mirror 용도로 유지
- ❌ Plan / Subtask DB 스키마 변경

## 3. Subtasks

### Task 01 — Reviewer pass → Architect 직행 + Tier 2 분리 [P0, 라우팅 본체]

**Changed files**:
- `src/lib/workflow/reviewWorkflow.ts` (406~454 — pass 분기)
- `src/lib/metaAnalysisTrigger.ts` (review_passed dispatch 의 kind 분리)
- `src/locales/{ko,en}/workflow.json` (Architect *next-priority* prompt 신규 키)

**Change description**:
- 417~425 의 `dispatchMetaNotification({ kind: "review_passed", ... })` 제거
- 신규: `dispatchArchitectNextPriority(plan)` 호출 — `useChatStore.getState().sendWithEngine(engine, prompt)` 로 main conv 에 *"plan X 완료. 다음 우선순위 제안 또는 후속 plan 분기 제안"* prompt dispatch
- `maybeTriggerMetaAnalysis(projectKey, "review_passed", ...)` 는 그대로 호출. 단 `metaAnalysisTrigger.ts` 내부에서 결과 dispatch 시 `kind: "tier2_brief"` (신규) 로 변경 — review-cycle kind 를 사용하지 않음
- 451~454 주석 (*"Architect is NOT auto-invoked"*) 갱신 — 새 정책 반영
- 신규 i18n 키:
  - `review.verdict.next_priority_prompt` (Plan 통과 + 다음 우선순위 요청 형식)

**Verification**:
- `npx vitest run src/lib/workflow/reviewWorkflow.test.ts` (있으면, 없으면 신규 추가)
- 수동: Plan A pass → main conv 에 Architect 자동 prompt 도착 확인 + Meta inbox 에 review_passed kind 알림 *없음* 확인 + Tier 2 brief 알림 *있음* 확인 (config 가 off 가 아닐 때)

**회귀 위험 가드**:
- INV-RVA-1: archive_branch (impl + review) 두 호출 순서 / loadBranches 호출 순서 변경 금지
- INV-RVA-5: maybeTriggerMetaAnalysis 호출 시점은 *그대로*. dispatch kind 만 분리
- failureLessonsApi.resolveFailureLessonsByPlan / insightApi.resolveInsightFindingsByPlan 호출 보존
- createVerdictArtifact / createReviewOutcomeArtifact 호출 보존

**위험**: Architect 가 사용자 의도 없이 매 plan pass 마다 prompt 받으면 토큰 비용 증가 — config 로 toggle (`autoArchitectOnPass: boolean`, 기본 true) 추가 검토.

### Task 02 — Reviewer fail / doom-loop escalate → Architect 직행 [P0, 라우팅 본체]

**Changed files**:
- `src/lib/workflow/reviewWorkflow.ts` (455~551 — fail 분기 + doom 분기)
- `src/locales/{ko,en}/workflow.json` (재설계 prompt 자동 dispatch 변형 키)

**Change description**:
- doom escalate 분기 (514~534): `dispatchMetaNotification({ kind: "doom_loop_escalated", ... })` 제거. 대신 `dispatchArchitectRedesign(plan, verdict, failCount)` helper 호출 — `redesign_prompt` i18n 재사용 + failCount 노트 추가
- doom warn 분기 (535~551): `dispatchMetaNotification({ kind: "doom_loop_warning", ... })` 제거. 대신 plan_event_log 에 `doom_loop_warning` event 만 추가하고 *Architect 자동 호출 안 함* — warn 단계는 사용자 결정 (continue rework vs redesign) 으로 유지. UX 는 plan_event_log 가 ReviewVerdictCard 에 표시됨으로 충족
- escalate 시 `archiveReviewBranchForHandoff(plan)` 호출 보존 (522~524)

**Verification**:
- 수동: 같은 plan 5회 fail → main conv 에 Architect 재설계 prompt 자동 도착 + plan phase=`subtask_review` 확인
- 수동: 3회 fail (warn 단계) → plan_event_log 에 `doom_loop_warning` 만 보임, Architect 호출 *없음* 확인
- doom_loop_escalated event 자체는 plan_event_log 에 보존 (시스템 자동 결정 흔적)

**회귀 위험 가드**:
- INV-RVA-3: computeDoomLoopState / computeFindingOverlap 알고리즘 변경 금지
- design_review_suggested event (500~510) 보존
- saveFailureLessons / createReworkReasonArtifact 호출 보존
- archive_branch / loadBranches 시퀀스 변경 금지

**위험**: 자동 escalate 시 Architect 가 main conv 의 *현재 사용자 작업* 을 끊고 들어와 UX 마찰 가능 — branch / plan 분리 dispatch 채널 검토 필요. Task 02 본문에서 main conv 가 아닌 *plan-attached conv* 로 dispatch 옵션 검토.

### Task 03 — Reviewer conditional → Architect 위임 옵션 [P1, 정책 결정 필요]

**Changed files**:
- `src/lib/workflow/reviewWorkflow.ts` (552~554 — conditional 분기)
- `src/components/tunaflow/context-panel/plans/ReviewVerdictCard.tsx` (51~77, 214~225 — conditional UX)

**Change description**:

옵션 (i) — *최소 변경* (권장 default):
- conditional 분기 코드 변경 없음. 현재도 dispatchMetaNotification 호출 안 함
- ReviewVerdictCard 의 conditional UI (Developer 직행 / 사용자 결정) 보존 — *Architect 직행* 이 conditional 의 자연 행동 아님
- 본 task 는 *no-op 결정* 을 plan 문서에 명시하는 게 deliverable

옵션 (ii) — *Architect 가 conditional 도 받음*:
- conditional 시 `dispatchArchitectConditional(plan, verdict)` 신규 helper 호출 — *"리뷰 conditional, findings 검토 후 Developer 보낼지 redesign 할지 판단 요청"* prompt
- ReviewVerdictCard 의 conditional UI 는 fallback 으로 유지 (사용자 manual override)

**결정 기준**: Task 01/02 머지 후 사용자가 conditional 사례를 1~2회 겪고 *"여기서도 Architect 가 필요하다"* 판단할 때 옵션 (ii) 로 follow-up. 본 plan 은 옵션 (i) 로 머지.

**Verification**:
- 옵션 (i): conditional verdict 발생 시 동작이 *현재와 동일* (Developer 직행 / 사용자 결정) 인지 확인
- 옵션 (ii) 채택 시: conditional → Architect prompt 도착 + Developer 직행 버튼 fallback 동작

**회귀 위험 가드**:
- INV-RVA-4: handleSendToDevDirect (Developer 직행) 동작 보존

### Task 04 — askMeta UX 폐지 [P0, UX 표면]

**Changed files**:
- `src/components/tunaflow/MetaFloatingChat.tsx` (199~221 — `askMetaAbout` + 579 줄 버튼)
- `src/locales/ko/dialog.json` (117 — `action_ask_meta`)
- `src/locales/en/dialog.json` (117 — `action_ask_meta`)
- 추가: `meta_chat.ask_about_*` 관련 i18n 키 (workflow.json / dialog.json) 도 같이 정리

**Change description**:
- `askMetaAbout` callback (199~221) 제거
- 알림 항목의 *"메타에게 물어보기"* 버튼 제거 (579) — 알림 카드 클릭 시 route navigation 만 동작
- locales 의 `action_ask_meta` + `ask_about_header` + `ask_about_summary` + `ask_about_instruction` 키 제거 (ko/en)
- 결과: 알림 카드는 *읽기 / dismiss / route 이동* 만 가능. *메타 채팅에 자동 prompt 주입* 흐름 종결

**Verification**:
- `npx vitest run src/components/tunaflow/MetaFloatingChat.test.tsx` (있으면 갱신, 없으면 추가)
- 수동: 알림 항목 우측 버튼 영역에 *"메타에게 물어보기"* 가 안 보임. 알림 본문 클릭 시 route 이동만 동작
- `rg askMeta src/` 결과 0건

**회귀 위험 가드**:
- INV-RVA-7: 알림 카드 표시 / 읽음 처리 (`mark_meta_notification_read`) / route navigation 동작 보존
- Meta floating chat 자체 (탭, 채팅 입력, 메시지 표시) 보존 — 사용자가 직접 메타에게 질문할 수 있는 UX 는 *입력창 사용* 이 대체

### Task 05 — Architect dispatch helper 추출 + 통합 [P1, 리팩토링]

**Changed files**:
- `src/lib/workflow/architectDispatch.ts` (신규)
- `src/lib/workflow/reviewWorkflow.ts` (Task 01/02 helper 호출부)
- `src/components/tunaflow/context-panel/plans/ReviewVerdictCard.tsx` (handleRedesign 의 dispatch 부분)

**Change description**:
- 신규 모듈 `src/lib/workflow/architectDispatch.ts`:
  - `dispatchArchitectNextPriority(plan): Promise<void>` — pass 직후 다음 우선순위 prompt
  - `dispatchArchitectRedesign(plan, verdict, opts: { failCount?: number; reason: "user-redesign" | "doom-escalate" }): Promise<void>` — fail/escalate prompt
  - 내부에서 `useChatStore.getState().sendWithEngine` 호출 + i18n key 분기
- `ReviewVerdictCard.handleRedesign` 의 본체 (97~119) 를 `dispatchArchitectRedesign(plan, verdict, { reason: "user-redesign" })` 호출로 교체
- `reviewWorkflow.ts` Task 01/02 의 자동 호출도 같은 helper 사용

**Verification**:
- `npx vitest run src/lib/workflow/architectDispatch.test.ts` (신규)
- 수동: handleRedesign 클릭 시 기존 동작 유지 (회귀 없음)
- TypeScript: `npx tsc --noEmit` 통과

**회귀 위험 가드**:
- handleRedesign 의 phase=done / status=abandoned 갱신 + subtask reset 로직은 helper 외부에 보존 (helper 는 *dispatch 만* 책임)
- prompt template 의 i18n 키 변경 시 ko/en 동시 갱신

### Task 06 — Tier 2 brief kind 분리 + dispatchMetaNotification 정리 [P1, 알림 분류]

**Changed files**:
- `src/lib/metaNotifications.ts` (15~25 — `MetaNotificationKind` 정리)
- `src/lib/metaAnalysisTrigger.ts` (81~95 — Tier 2 결과 dispatch)

**Change description**:
- `MetaNotificationKind` 에서 `review_passed` / `review_failed` / `doom_loop_warning` / `doom_loop_escalated` 제거
- `tier2_brief` 신규 kind 추가 — Tier 2 분석 결과 dispatch 전용
- metaAnalysisTrigger.ts:81~95 의 dispatch 호출에서 kind 를 `tier2_brief` 로 변경
- 잔존 dispatch caller (`toolRequestHandler.ts:263`, `SubtaskReviewView.tsx:407`) 는 kind 검증 — review-cycle kind 미사용 확인

**Verification**:
- `rg "review_passed|review_failed|doom_loop_warning|doom_loop_escalated" src/` 결과 0건 (i18n / 주석 / 테스트 fixture 제외)
- `npx tsc --noEmit` 통과 — 타입 좁히기 (literal union) 가 컴파일러에서 누락 처리 catch
- 수동: Tier 2 brief 알림이 inbox 에 도착 + 알림 카드 표시 정상

**회귀 위험 가드**:
- INV-RVA-8: 다른 kind (tool_request_failed / insight_detected / plan_promoted / generic / architect_redesign_requested) 보존
- DB 스키마 (notifications.kind 컬럼) 는 free-text 라 마이그레이션 불필요. 단 기존 row 의 `kind="review_passed"` 등은 그대로 남음 — 표시상 *"알 수 없는 kind"* fallback 처리만 추가

**위험**: 기존 사용자의 inbox 에 남은 `review_passed` / `review_failed` 알림 row 가 코드상 kind 인식 안 됨. fallback UI 라벨 (*"이전 워크플로우 알림"*) 처리 또는 옵트인 마이그레이션 (사용자 dismiss-all 안내) 검토.

### Task 07 — Test 보강 [P0, 회귀 가드]

**Changed files**:
- `src/lib/workflow/__tests__/reviewWorkflow.test.ts` (신규 또는 갱신)
- `src/lib/workflow/__tests__/architectDispatch.test.ts` (신규)
- `src/components/tunaflow/__tests__/MetaFloatingChat.test.tsx` (askMeta 제거 케이스 추가)

**Change description**:
- pass / fail / conditional / doom-warn / doom-escalate 5 가지 분기에 대해:
  - dispatchMetaNotification 호출 *횟수* 와 *kind* 검증
  - Architect dispatch helper 호출 여부 검증
  - Tier 2 trigger 호출 여부 검증
- handleRedesign 클릭 → dispatchArchitectRedesign(reason: "user-redesign") 1회 호출 검증
- MetaFloatingChat: askMeta 버튼 DOM 비존재 검증

**Verification**:
- `npx vitest run` 401 + 신규 → 모두 통과
- `cd src-tauri && cargo test --lib` 614 → 변동 없음 (Rust 영역 미변경)

**회귀 위험 가드**:
- 기존 reviewWorkflow 테스트가 있으면 *Meta dispatch 호출* 을 단언하는 케이스가 깨질 수 있음 — 명시적으로 갱신해야 함

## 4. Cross-cutting risks

| 위험 | 대응 |
|---|---|
| Tier 2 분석이 review_passed/review_failed 트리거를 의존하면서도 dispatch kind 가 분리됨 — 트리거와 dispatch 분리가 메타 conv mirror 동작 영향 | Task 01/06 PR 분리. metaAnalysisTrigger 의 mirror 호출 (metaConversation.ts) 유지 — kind 만 변경 |
| 기존 inbox 의 deprecated kind row | Task 06 의 fallback UI 라벨 또는 명시적 dismiss 안내. release notes 에 기재 |
| Architect 자동 호출이 main conv 의 사용자 작업 끊는 UX 마찰 | Task 02 본문 *plan-attached conv* dispatch 옵션 검토. 1차는 main conv 유지, 마찰 보고 시 follow-up plan |
| 토큰 비용 — pass 마다 Architect prompt 자동 dispatch | Task 01 의 `autoArchitectOnPass` config toggle (기본 true). 사용자 비활성화 가능 |
| i18n 누락 — ko/en 양쪽 신규 키 동시 갱신 필요 | Task 04/05 PR description 에 ko/en 키 diff 명시 + reviewer (eyeball) 검증 |
| 기존 metaAgentPlan.md (*"제안하되 결정하지 않는다"*) 원칙과의 일관성 | metaAgentPlan.md 갱신 항목 추가 — Meta 가 *review-cycle 의 brief 만* 담당하고 plan-cycle 결정은 Architect 책임으로 명시 |
| handleRedesign 의 명시적 Architect 호출과 자동 doom-escalate 호출이 동일 helper 사용 — reason 구분 필요 | Task 05 helper signature 의 `reason: "user-redesign" \| "doom-escalate"` 로 분기 + plan_event_log 에 reason 기록 |

## 5. Rollback

- **Task 01**: 단독 revert 가능. 17 줄 dispatch 복원 + Architect helper 호출 1줄 제거
- **Task 02**: 단독 revert 가능. doom-escalate / warn 의 dispatchMetaNotification 복원
- **Task 03**: 옵션 (i) 채택 시 변경 없음 (revert 불필요). 옵션 (ii) 채택 후 revert 시 dispatchArchitectConditional 제거
- **Task 04**: 단독 revert 가능. askMetaAbout callback + 버튼 + i18n 키 복원
- **Task 05**: helper 추출은 revert 시 호출부를 inline 으로 되돌림. handleRedesign 의 inline dispatch 복원
- **Task 06**: kind 정리는 revert 가능하나 *기존 row 의 deprecated kind* 는 그대로 남음 — 사용자 영향 없음
- **Task 07**: 테스트 추가는 revert 의 reverse-direction (테스트가 더 적어짐) 으로 안전

전체 revert 시퀀스: Task 07 → 04 → 06 → 05 → 02 → 01 (역순). 각 task 가 git axis 분리되어 PR 단위 revert 가능.

## 6. 다음 step

1. **Developer 핸드오프 작성** (`tunaflow-developer-handoff` skill)
   - PR 분리 권장: Task 04 (UX 표면, 단독), Task 05 + 01 + 02 (helper + pass + fail/escalate, dependency chain), Task 06 + 07 (kind 정리 + test, 마지막)
   - 즉 3 PR 시나리오:
     - PR-1: Task 04 (askMeta UX 폐지) — 가장 작고 axis 분리
     - PR-2: Task 05 + 01 + 02 (Architect helper + pass/fail 라우팅) — 본 plan 의 본체
     - PR-3: Task 06 + 07 (Tier 2 kind 분리 + test 보강)
   - Task 03 은 옵션 (i) default 라 PR 불필요. 옵션 (ii) 결정되면 별 PR
2. **PR-2 머지 후 1~2회 cycle 동안 conditional 사례 관찰** — Task 03 옵션 (ii) 필요성 재평가
3. **metaAgentPlan.md 갱신** — Meta 의 책임 범위 (brief 전용) 명시. 본 plan PR-2 와 동시 머지 권장
4. **release timing**: v0.1.6-beta 에 포함 여부 결정 — 외부 사용자 영향이 *알림 inbox 변화 + askMeta 버튼 사라짐* 으로 가시적이라 release notes 강조 필요
5. **후속 plan 가능성**: c-3 (Meta-agent role 전면 해체) 검토 — Tier 2 분석을 Architect 의 background job 으로 흡수할지, 별 sub-agent 로 유지할지. 본 plan 머지 후 1~2주 사용 데이터 후 결정
