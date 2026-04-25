---
title: startReviewRT 진입 실패 시 phase rollback + 재시도 UX
status: ready-to-implement (gray-box plan, Developer 가 audit 단계부터 진행)
priority: P2 (잠재 위험 — 실측 사용자 보고 없음)
created_at: 2026-04-25
related:
  - docs/reference/asyncCancelPipelineAudit_2026-04-25.md  # 항목 2
  - docs/plans/onboardingCancelLeakFixPlan_2026-04-25.md  # 같은 카테고리
  - src/lib/workflow/reviewWorkflow.ts
canonical: true
owners:
  - architect (본 plan 작성)
  - developer (audit + 구현)
---

# 배경

`asyncCancelPipelineAudit_2026-04-25` 의 항목 2 — startReviewRT 진입 시 실패 처리 미확인. line 244 의 코멘트 "Review RT 진입 자체가 throw 되던 버그. s37 재현 로그로 특정" 가 **과거 동일 카테고리 버그가 있었음을 시사**. s37 fix 가 완전한지, 다른 await 단계 실패에도 견고한지 불명.

# 현재 추정 (Developer 가 검증)

`startReviewRT` 진입 시 거치는 단계 (audit grep 으로 식별):

1. ManualVerificationGate 호출 (이번 PR #190 으로 정리됨)
2. `planApi.updatePlanPhase(plan.id, "review")` — phase 전환
3. `planApi.createPlanEvent(plan.id, "impl_completed", "developer")` — 이벤트 기록
4. `syncResultReport(...)` — fire-and-forget
5. `getOrCreateReviewBranch(...)` — 브랜치 생성
6. `buildPlanContext(plan)` — context 조립
7. `saveConversationEngine` (line 262 catch 있음 — 유일하게 명시적)
8. RT spawn (`startConversationRoundtable`)

**각 단계 실패 시 phase 가 어디서 멈추는지, rollback 보장 여부가 불명**. 특히 step 2 (phase=review) 가 성공하고 step 5 (브랜치 생성) 가 실패하면 phase 는 review 인데 RT 가 시작 안 된 stuck 상태가 됨.

# 의심 시나리오 (재현 가능성 미확정)

- 네트워크 일시 단절 → step 5 실패 → phase=review 인데 RT 미생성
- DB lock 또는 write 충돌 → step 7 실패 → 비슷한 stuck
- LLM/엔진 타임아웃 → step 8 실패 → RT 빈 껍데기

# 수정 방향 가설

## Layer A — 단계별 catch + phase rollback

각 critical await 를 try/catch 로 감싸고, 실패 시 `updatePlanPhase(plan.id, "ready")` 로 rollback.

```ts
try {
  await planApi.updatePlanPhase(plan.id, "review");
  await planApi.createPlanEvent(plan.id, "impl_completed", "developer");
  // ... 후속 단계
} catch (e) {
  await planApi.updatePlanPhase(plan.id, "ready").catch(() => {});
  await planApi.createPlanEvent(plan.id, "review_entry_failed", "system",
    JSON.stringify({ stage: "...", reason: String(e) })).catch(() => {});
  throw e;  // 호출자가 toast 표시
}
```

## Layer B — UI 재시도

DevProgressView 가 "review_entry_failed" plan_event 를 감지하면 "재시도" 버튼 노출. 사용자가 클릭하면 startReviewRT 재호출.

## Layer C — 단계 식별 로그

각 stage 진입 직전 `console.debug` 또는 trace_log 로 진행 단계 기록. 실패 분석 시 마지막 도달 stage 확인 가능.

# Invariants

- **[INV-1]** plan.phase === "review" 이면 RT 가 반드시 존재한다 (또는 review_entry_failed event 가 있다)
- **[INV-2]** review_entry_failed event 가 발생한 plan 은 phase 가 "ready" 로 rollback 된 상태다
- **[INV-3]** 사용자에게 실패 사유가 즉시 표면화된다 (toast 또는 DevProgressView 에러 영역)

# Developer 핸드오프 프롬프트

```
[작업] startReviewRT 진입 실패 시 phase rollback + 재시도 UX (Plan reviewRTEntryFailureRollback / asyncCancel audit #2)

[SSOT] docs/plans/reviewRTEntryFailureRollbackPlan_2026-04-25.md + docs/reference/asyncCancelPipelineAudit_2026-04-25.md

[배경 3줄]
- onboarding fix 로 발견된 카테고리 (long-running async + UI dismiss → orphaned task) 의 sibling
- startReviewRT 의 8 단계 중 어느 단계 실패가 phase rollback 보장 안 하는지 불명
- s37 의 "Review RT 진입 throw" 버그가 부분 fix 였는지 검증 필요

[수정 범위 — 단, 1 단계는 audit]

1) Audit (Developer 가 코드 깊이 들어가서 검증):
   - startReviewRT 의 모든 await 단계 (8개) 별 실패 매트릭스
   - 각 단계 실패 시 현재 동작 (phase 어디 멈추는지, UI 어떻게 보이는지)
   - 실측 재현 가능한 시나리오 발굴 (DB lock, 네트워크 단절, LLM timeout)
   - 결과 문서: docs/reference/reviewRTEntryFailureAudit_2026-04-2X.md (별 reference)

2) Layer A — 단계별 catch + phase rollback
   - 각 critical await 를 try/catch
   - 실패 시 updatePlanPhase(plan.id, "ready") + createPlanEvent("review_entry_failed", reason)

3) Layer B — DevProgressView 재시도 UX
   - review_entry_failed event 감지 시 "재시도" 버튼 노출
   - 클릭 → startReviewRT 재호출 (idempotent 확인 필요)

4) Layer C — 단계 식별 로그
   - 각 단계 진입 직전 trace_log("startReviewRT.stage", { stage })
   - 디버깅 시 마지막 도달 stage 확인 가능

[검증]
- npx tsc --noEmit / vitest run
- 수동 재현: 네트워크 차단 / DB lock / 강제 timeout 시나리오로 각 단계 실패 유도

[커밋 분리]
- docs(ref): startReviewRT entry failure audit (Step 1 결과)
- fix(workflow): step-wise catch + phase rollback in startReviewRT (Layer A)
- feat(ui): retry button on review_entry_failed (Layer B)
- chore(workflow): stage trace logs (Layer C)

[셀프 이슈]
"bug: startReviewRT entry failure may leave plan.phase=review without RT (audit reviewRTEntryFailureAudit follow-up)"
```

# 관련 기록

- `asyncCancelPipelineAudit_2026-04-25` 항목 2
- s37 (2026-04-18) 의 "Review RT 진입 throw" 부분 fix
- `reviewWorkflow.ts:244` 코멘트 단서
