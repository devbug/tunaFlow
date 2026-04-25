---
title: Branch adopt 중 실패 시 rollback + 부분 적용 방지
status: ready-to-implement (gray-box plan, Developer 가 audit 단계부터 진행)
priority: P2 (잠재 위험, s25 history 시사)
created_at: 2026-04-25
related:
  - docs/reference/asyncCancelPipelineAudit_2026-04-25.md  # 항목 3
  - src/stores/slices/branchSlice.ts  # adoptBranch line 124
  - src/lib/workflow/branchSync.ts
canonical: true
owners:
  - architect (본 plan 작성)
  - developer (audit + 구현)
---

# 배경

`asyncCancelPipelineAudit_2026-04-25` 의 항목 3 — Branch adopt 실패 처리 미확인.

세션 메모리 (`project_session_2026-04-12_s25.md`) 에 **"adopt 중 스트리밍 메시지 소멸"** 이 s25 에 수정됐다고 기록 → 비슷한 카테고리 잠재 위험. 현재는 adoptBranch (branchSlice.ts:124) grep 만 수행, 본문 미분석.

# 현재 추정 (Developer 가 검증)

`adoptBranch(branchId, conversationId)` 가 일반적으로 거치는 단계:

1. Shadow conversation 의 메시지 / 상태 조회
2. LLM 으로 summary 생성 (프롬프트 + engine 호출)
3. summary 메시지를 main conversation 에 append (DB write)
4. branch status = "adopted" 로 update (DB write)
5. UI store 업데이트 (Zustand)
6. 드로어/뷰 dismiss

각 단계 실패 시 부분 적용 위험:
- step 2 실패 (LLM error / timeout) → main 에 메시지 안 들어감, branch 도 그대로
- step 3 성공 + step 4 실패 → main 에 summary 있는데 branch 는 active 상태 (UX 혼란)
- step 4 성공 + step 5 실패 → DB 와 store 불일치 (UI freshness)

# 의심 시나리오

- 네트워크 단절 → step 2 LLM 호출 timeout → 사용자 "어 왜 안 되지" → 재시도 시 중복 메시지 위험
- DB write 도중 lock → step 3, 4 일부 적용
- 사용자가 도중에 드로어 닫음 → cleanup 누락

# 수정 방향 가설

## Layer A — DB transaction 단위 보장

step 3 + step 4 (DB write 두 건) 을 단일 transaction 으로. 실패 시 둘 다 abort.

## Layer B — LLM 호출 실패 retry/abort 정책

step 2 (LLM summary 생성) 실패 시:
- 재시도 1회 (network 일시 단절 흡수)
- 그래도 실패 시 사용자에게 "summary 생성 실패, 빈 summary 로 adopt 할까요?" prompt
- 또는 그냥 abort + branch 유지 (가장 보수적)

## Layer C — UI dismiss 시 cancel 호출

드로어가 dismiss 되면 (사용자 강제 닫기 포함) 진행 중인 LLM 호출 / DB write 를 cancel command 로 정리. onboarding fix (#189/#190) 와 동일 패턴.

## Layer D — 부분 적용 감지 + 복구

기동 시 `branch.status === "adopting"` 상태인 row 발견하면 (last update 가 N분 이상 전이면) "이전 adopt 가 미완 — 재시도 / 취소" UX 노출.

# Invariants

- **[INV-1]** adopt 완료 후 main conversation 에 summary 메시지가 반드시 존재한다 (또는 branch 가 active 로 유지된다 — 둘 다 아닌 split state 금지)
- **[INV-2]** branch.status 는 활성 상태 ("active") / 완료 상태 ("adopted") / 실패 상태 ("failed") 명확. 중간 상태 ("adopting") 는 transaction 진행 중에만 존재
- **[INV-3]** 동일 branch 의 adopt 가 두 번 호출돼도 부작용 없음 (idempotent)

# Developer 핸드오프 프롬프트

```
[작업] Branch adopt 중 실패 시 rollback + 부분 적용 방지 (Plan branchAdoptRollback / asyncCancel audit #3)

[SSOT] docs/plans/branchAdoptRollbackPlan_2026-04-25.md + docs/reference/asyncCancelPipelineAudit_2026-04-25.md

[배경 3줄]
- s25 (2026-04-12) 의 "adopt 중 스트리밍 메시지 소멸" 부분 fix → 동일 카테고리 잠재 위험
- adoptBranch 의 LLM/DB/store 단계 별 실패 매트릭스 미확인
- onboarding fix 와 동일 패턴 (long-running async + UI dismiss + cancel 누락) 가능성

[수정 범위]

1) Audit:
   - adoptBranch (branchSlice.ts:124) + branchSync.ts adopt 경로 본문 분석
   - 각 단계 실패 시 현재 동작 + DB / store / branch.status 잔여 상태
   - s25 fix 의 정확한 범위 확인 (커밋 git log)
   - 결과: docs/reference/branchAdoptFailureAudit_2026-04-2X.md

2) Layer A — DB transaction
   - step 3 (main append) + step 4 (branch status update) 단일 transaction
   - SQLite 의 BEGIN; ... COMMIT; 또는 Tauri command 단에서 보장

3) Layer B — LLM retry/abort 정책
   - step 2 실패 시 1회 retry (exponential backoff)
   - 최종 실패 시 사용자 prompt (빈 summary 로 진행 / 취소)

4) Layer C — UI dismiss cancel
   - 드로어 dismiss 핸들러에서 invoke("cancel_branch_adopt") 호출
   - rust 쪽 cancel command 신설 (없으면)

5) Layer D — 부분 적용 감지 + 복구 UX
   - 앱 기동 시 branch.status="adopting" + last_update_at < now-5min 인 row 검사
   - 발견 시 사용자 알림 + 재시도/취소 버튼

[검증]
- 수동: 네트워크 차단 → adopt 실행 → 다양한 단계에서 실패 유도
- 자동: branchSlice.test.ts 보강 (mock invoke + transaction 검증)

[커밋 분리]
- docs(ref): branch adopt failure audit
- fix(branch): db transaction for adopt commit
- fix(branch): llm retry + abort prompt
- fix(branch): cancel rust task on drawer dismiss
- feat(branch): partial adopt recovery UX

[셀프 이슈]
"bug: branch adopt may leave partial state on LLM/DB failure (audit follow-up)"
```

# 관련 기록

- `asyncCancelPipelineAudit_2026-04-25` 항목 3
- s25 (2026-04-12) "adopt 중 스트리밍 메시지 소멸" — `project_session_2026-04-12_s25.md`
- 본 plan 은 s25 의 잔여 위험 정리
