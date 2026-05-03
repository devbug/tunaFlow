---
title: branch view chat input 사라짐 회귀 — adoptBranch / plan 수정 흐름 진단 + hotfix
status: ready
phase: planning
priority: P1 (외부 사용자 보고 #255)
created_at: 2026-05-03
canonical: true
related:
  - src/components/tunaflow/context-panel/SubtaskReviewView.tsx  # branch chat 진입 분기
  - src/stores/threadSlice.ts  # branch state
  - src-tauri/src/commands/branch_sync.rs (있다면)  # adoptBranch backend
  - docs/reference/branchSessionPolicy.md  # INV-1~5
issue_source: GitHub #255 — devbug (2026-05-02)
---

# branch view chat input 회귀

## 0. Context

### 0.1 외부 사용자 보고 (devbug, GitHub #255)

> "plan 을 진행 중에 해당 플랜을 수정하기 위한 새로운 플랜을 발행하고, 해당 플랜을 먼저 완료해서 기존 플랜을 수정했을 때
> 기존 플랜이 아직 개발까지만 진행 됐으면 리뷰 진행 전이니 개발자와 대화가 가능해야 하고,
> 리뷰 진행 후에도 리뷰어와 대화가 가능해야 하는데 기존 플랜의 브런치를 열었을 때 대화 내역만 보이고 대화창이 사라지고 있습니다.
>
> 그냥 메인 창에 개발자/리뷰어와 대화한게 보이고 있고 그래서 그냥 그걸로 대화하면 되긴 한데 그냥 없어지고 있습니다."

### 0.2 시나리오 정확화

```
1. plan A 발행 → impl branch (dev:p-A) 생성 → developer 가 작업 진행 중
2. plan A 의 어떤 항목을 수정할 plan B 발행 (plan revision flow)
3. plan B 가 먼저 머지/완료 → plan A 자체 본문 수정 (revision 누적)
4. 사용자 가 plan A 의 dev branch 다시 열기
5. ❌ chat 내역은 보이는데 chat input 사라짐
```

### 0.3 Root cause 가설

| 가설 | 근거 |
|---|---|
| **(a) Branch state 의 phase reset** — plan B 머지 시 plan A 의 phase 가 변경 → branch view 의 chat input mount 분기 깨짐 | INV-1~5 (branchSessionPolicy.md) 위반 가능성 |
| (b) Frontend store 의 conversation_id resolve race | adoptBranch 흐름 후 store 의 brand_id 또는 active_conv 미정합 |
| (c) UI 컴포넌트 conditional render 분기 — `phase === "review"` 또는 비슷한 분기에서 input hide | SubtaskReviewView.tsx 에서 chat 진입 분기 정확화 필요 |
| (d) plan revision 시 branch 의 status 변경 → input disabled 상태 | plan event log 추적 필요 |

가장 가능성 높음: **(c) 또는 (d)** — UI 분기 issue. backend state 는 정상 (사용자 fact: chat 내역은 보임 + 메인 창에서 같은 대화 가능).

## 1. Invariants

| ID | 내용 |
|---|---|
| **INV-BCI-1** | branch view 의 chat input 은 *그 branch 의 phase 가 종료 (review verdict pass + plan completed) 되기 전까지* 항상 노출 |
| **INV-BCI-2** | plan B 머지 → plan A revision 흐름이 plan A 의 branch chat input 정책 변경 X |
| **INV-BCI-3** | branchSessionPolicy.md 의 INV-1~5 그대로 — brand session = main session 공유 정책 보존 |
| **INV-BCI-4** | macOS / Windows / Linux 동일 동작 |

## 2. Goals / Non-goals

### Goals

- (G1) branch view 에서 *phase = "dev"* 또는 *"review"* 인 branch 의 chat input 항상 노출
- (G2) plan revision 흐름 후에도 branch chat input 보존 — phase 변경 시점에 mount 분기 정확
- (G3) 사용자 가 branch chat 으로 *개발자/리뷰어와 대화 가능* (메인 창 workaround 의존 X)
- (G4) 진단 path 명확 — backend log 에 phase 변화 흔적 + frontend store state 로 추적

### Non-goals

- ❌ branchSessionPolicy.md 의 INV-1~5 변경 (기존 정책 유지)
- ❌ adoptBranch 의 backend 흐름 변경 (frontend UI 분기만 fix)
- ❌ plan revision 흐름 자체 변경

## 3. Subtasks

### Task 01 — 진단: branch chat input 의 mount 분기 정확화 [P1, 진단 우선]

**Changed files**: 없음 (read-only)

**Change description**:
- `SubtaskReviewView.tsx` + `BranchView.tsx` (있다면) 또는 인근 component 의 chat input 렌더 분기 read
- 분기 조건 (예: `phase === "..."`, `is_active_branch`, `developer_session_active` 등) 식별
- 사용자 시나리오 (plan revision 후) 의 phase / state 가 어떻게 변하는지 추적
- frontend store (`threadSlice.ts` 또는 `branchSync.ts`) 의 branch 별 state schema read

**Output**: chat hide 의 정확한 분기 조건 + 사용자 시나리오에서의 그 조건 fact

**위험**: 분기 복잡할 가능성 (multi-conditional). 시간 가변.

### Task 02 — Hotfix: chat input 분기 보강 [P1, Task 01 진단 결과에 따라]

**Changed files**:
- 분기 한정 — 일반적으로 frontend component 1~2 파일

**Change description**:
- Task 01 의 진단 결과로 정확한 분기 조건 fix
- 가설별 fix 후보:
  - (c) 분기 조건 — `phase` 외 다른 조건 추가 또는 `phase === "completed"` 만 hide 로 좁힘
  - (d) status 변경 — plan revision 후 branch status 가 "active" 유지되도록 (기존 동작 정책)

**Verification**:
- dev 모드 manual smoke 시나리오:
  - plan A 진행 → plan B 발행 → plan B 머지 → plan A branch 열기 → chat input 노출 확인
  - 다른 시나리오 회귀 0 (정상 plan 진행 / 리뷰 직접 / etc.)

**위험**: 다른 phase 분기 영향 (예: completed branch 의 input hide 정책). 회귀 manual smoke 필수.

### Task 03 — 사용자 가시화 (선택) [P2]

**Changed files**: 인근 component

**Change description**:
- branch 의 *phase = "review"* 또는 *"dev"* 일 때 chat input header 에 *현 phase + persona* 표시
- 사용자 가 *어떤 agent 와 대화 중* 인지 가시화

**Verification**: visual smoke

## 4. Cross-cutting risks

| 위험 | 대응 |
|---|---|
| Task 01 진단 시간 가변 (UI 분기 복잡) | 1시간 timeout 후 chat 보고 + 사용자 결정 |
| Task 02 fix 가 다른 phase 의 input hide 정책 영향 (예: completed branch) | manual smoke 의 회귀 시나리오 명시 |
| backend 영역 (adoptBranch / plan revision) 까지 root cause 영향 | 진단 결과로 escalate. backend 영역이면 별 plan |
| frontend store schema 변경 필요 | DB schema 영향 없는 store-only 변경 우선. 영향 시 별 PR |

## 5. Rollback

- Task 02 단독 revert 가능 (분기 조건 변경 1 줄 또는 작은 area)
- Task 03 (사용자 가시화) 는 보조 — revert 영향 0

## 6. 다음 step

본 plan 머지 후:

1. **Task 01 진단 (Architect 직접 또는 Developer subagent)** — 1시간 내 완료 가능 영역
2. 진단 결과로 hotfix code 작성 + PR + admin merge
3. **devbug 에게 답변** — workaround (메인 창 사용) 인정 + hotfix 머지 후 자동 회복 안내

진단 결과에 따라 다음 PR 1개 또는 별 plan 분리.
