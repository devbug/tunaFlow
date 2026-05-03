---
title: Developer 핸드오프 — branch view chat input 사라짐 회귀 진단 + hotfix
plan: docs/plans/branchChatInputRegressionPlan_2026-05-03.md
issue: GitHub #255 (devbug, 2026-05-02)
created_at: 2026-05-03
---

# Developer 핸드오프 — branch view chat input 회귀

## 0. 한 줄 요약

외부 사용자(devbug)가 plan A 진행 중 plan B 발행/머지 → plan A revision 후 plan A 의 dev branch 다시 열 때 chat 내역만 보이고 *chat input 이 사라짐*. backend state 정상 (메인 창에서는 같은 대화 가능). **frontend UI 분기 문제 가능성 높음** — Task 01 진단 후 Task 02 hotfix.

## 1. 작업 개요 — 2 task 진행 (Task 03 은 선택)

**Plan SSOT**: `docs/plans/branchChatInputRegressionPlan_2026-05-03.md`. §3 Subtasks 의 Output / Verification / 위험을 그대로 따를 것.

| Task | 성격 | 파일 | 핵심 변경 | 우선 |
|---|---|---|---|---|
| 01 | 진단 (read-only) | `src/components/tunaflow/context-panel/SubtaskReviewView.tsx` + 인근 BranchView / 분기 component + `src/stores/threadSlice.ts` 또는 `src/stores/branchSync.ts` | chat input 의 정확한 mount 분기 식별 + 사용자 시나리오에서 그 조건의 fact | P1 |
| 02 | hotfix | Task 01 결과로 한정된 frontend component 1~2 파일 | 분기 조건 보강 (예: phase === "completed" 만 hide / status 체크 추가 등) | P1 (Task 01 결과 의존) |
| 03 | 사용자 가시화 | 인근 component | branch 의 *phase = "review/dev"* 일 때 chat input header 에 *현 phase + persona* 표시 | P2 (선택) |

**진행 순서**: Task 01 진단 우선. 진단 결과로 hotfix 위치/방향 결정.

## 2. DO — 반드시 지킬 것

1. **Task 01 진단을 1시간 timeout** 으로 시작:
   - `SubtaskReviewView.tsx` 의 chat input 렌더 분기 read
   - 같은 area 의 다른 component (`BranchView.tsx`, `BranchPanel.tsx`, `DevProgressView.tsx` 등) 에서 chat input 분기 grep
   - 분기 조건 식별 — 예: `phase === "..."`, `is_active_branch`, `developer_session_active`, `status === "..."`, `branch_completed` 등
   - frontend store (`threadSlice.ts` / `branchSync.ts`) 의 branch 별 state schema 와 phase/status 변화 path 추적
   - **사용자 시나리오 reproduce path 확정**:
     ```
     1. plan A 발행 → impl branch 생성 → developer 진행 중
     2. plan A 의 어떤 항목 수정할 plan B 발행
     3. plan B 머지 → plan A 본문 수정
     4. plan A 의 dev branch 다시 열기
     5. 그 시점의 frontend store state 로그 capture
     ```
2. **Task 01 의 출력**: chat input hide 의 정확한 분기 조건 + 사용자 시나리오에서 그 조건이 어떻게 충족되는지 fact 보고. 그 보고만으로 Architect 가 hotfix 방향 confirm 가능.
3. **Task 02 hotfix 방향 (Task 01 결과 의존)**:
   - 가설 (c): 분기 조건이 `phase` 외 다른 조건도 결합 → 정확한 조건만 hide 로 좁힘
   - 가설 (d): plan revision 후 branch status 가 비정상 → status 변경 path 정정
   - 진단 결과로 *최소 분기 1줄 변경* 을 우선. 큰 area 변경 시 Architect 에게 escalate.
4. **회귀 manual smoke 필수** (Plan §3 Task 02 Verification):
   - 정상 plan 진행 (revision 없이 dev → review → completed) 시 chat input 노출 정책 변화 0
   - completed branch 의 chat input hide 정책 (있다면) 보존
   - plan revision 시나리오에서 chat input 노출 ✅
5. **feature 브랜치**: `fix/branch-chat-input-regression`.
6. **Commit 단위**:
   - Task 01 은 진단 보고만 (commit 없음)
   - Task 02 는 단일 commit `fix(branch): preserve chat input across plan revision (Task 02)`
7. **PR description 에 Plan 링크 + Issue #255 링크 + Task 01 진단 결과 + Task 02 fix diff** 첨부.

## 3. DO NOT — 사이드 이펙트 차단

다음은 Plan §2 Non-goals 또는 회귀 위험 영역. **절대 수정 금지**.

- ❌ `docs/reference/branchSessionPolicy.md` 의 INV-1~5 (brand session = main session 공유 정책 — 변경 X).
- ❌ `adoptBranch` 의 backend 흐름 (`src-tauri/src/commands/branch_sync.rs` 또는 비슷) — frontend UI 분기만 fix.
- ❌ plan revision 흐름 자체 (`src-tauri/src/commands/plans.rs` 의 revision 관련 함수).
- ❌ branch state schema 변경 (DB 또는 store schema) — schema 변경 필요 시 Architect 에게 escalate, 별 PR.
- ❌ 다른 phase 분기 (예: completed branch 의 chat input hide 정책) — *완료된 branch 는 hide* 가 의도라면 보존.
- ❌ 메인 창의 chat input 분기 — branch view 의 input 만 영역.
- ❌ 새 dependency 추가.

## 4. 변경 후 검증 (전체)

```bash
# Frontend
npx tsc --noEmit
npx vitest run

# Task 02 회귀 grep — 분기 조건 변경이 다른 component 영향 없는지
rg -n "phase ==.*\"completed\"|phase ==.*\"review\"|phase ==.*\"dev\"" src/components/tunaflow/context-panel/
rg -n "chat.*input|ChatInput|MessageInput" src/components/tunaflow/

# branch session policy invariant 가 살아있는지 (수정되지 않았는지 확인)
git diff docs/reference/branchSessionPolicy.md  # 빈 출력이어야 함
git diff src-tauri/src/commands/branch_sync.rs  # 있다면 빈 출력
```

테스트 카운트 baseline 기록 후 작업 후 동일 또는 +N. **감소 시 회귀** — 즉시 원인 파악.

## 5. e2e 수동 검증 (Task 02 PR 직전 필수)

dev 모드에서:

1. **회귀 시나리오 (사용자 보고)**:
   - plan A 발행 → impl 진행 중
   - plan B 발행 (plan A revision 목적)
   - plan B 머지 → plan A 본문 수정 확인
   - plan A 의 dev branch 다시 열기
   - chat input **노출** 확인 ✅
   - input 으로 developer/reviewer 와 대화 가능 ✅
2. **회귀 가드 시나리오**:
   - 정상 plan 진행 (dev → review → completed): chat input 노출 / 완료 후 정책 변화 0
   - 새 plan 단독: chat input 정상
   - branch 직접 review 진입: chat input 정상
3. **다른 OS** (가능하면 macOS + Windows): 동일 동작 확인 (Plan §1 INV-BCI-4)

회귀 시나리오 통과 + 회귀 가드 시나리오 0 변화면 ok. 실패 시 즉시 보고.

## 6. CI 정책

- PR 직후 admin merge 즉시 가능 (CI watch 불필요). 자체 검증 §4 + e2e §5 통과한 상태로 self-merge.
- merge 후 main 에서 회귀 발생 시 즉시 revert PR 생성.
- frontend 한정 변경이라 다음 release 에서 외부 사용자 자가 회복 가능.

## 7. 보고 포맷

작업 완료 시 chat 에:
- **Task 01 진단 보고** (분기 조건 + 사용자 시나리오 fact + 가설별 매칭)
- **Task 02 변경 라인 수** (작은 area 권장 — 1~10줄)
- 각 Verification 결과 (PASS/FAIL + 핵심 출력)
- e2e 수동 검증 결과 (회귀 시나리오 + 회귀 가드 시나리오 각각 1줄)
- PR URL
- 회귀 위험 가드 위반 없음 확인 (branchSessionPolicy.md / branch_sync.rs / plans.rs revision 관련 diff 0)

## 8. 막히면

- **Task 01 진단이 1시간 timeout 도달** 시 chat 보고 + Architect 에게 escalate. 무리한 우회 금지. UI 분기가 multi-conditional 로 복잡하면 *minimal repro 영역* 한정으로 진단 범위 축소.
- root cause 가 backend (adoptBranch / plan revision) 라고 진단되면 **Task 02 frontend hotfix 보류** + Architect 에게 escalate → 별 plan 분리.
- frontend store schema 변경이 필요하다고 판단되면 **별 PR + DB schema 영향 0** 우선. 현 PR 은 store-only minimal 변경에 한정.
- hotfix 가 다른 phase 분기 (예: completed branch input hide) 의도된 정책을 깰 위험 있으면 *분기 조건 좁히기* (`phase === "completed"` 만 hide) 가 안전. 광범위 변경 금지.

## 9. 사용자 답변 정책 (참고)

devbug 에게 답변 (Architect 영역):
- Plan 머지 후 Architect 가 issue #255 에 진행 상황 댓글
- 임시 workaround 인정: 현재는 메인 창에서 같은 대화 가능 (devbug 이미 알고 있음)
- Task 02 머지 후 다음 release 자동 회복 안내
