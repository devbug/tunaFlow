---
name: tunaflow-plan-writing
description: tunaFlow Architect가 작업 영역을 plan 문서로 형식화한다. 외부 사용자 issue 분석, 회귀 진단, 새 feature 설계, 리팩토링 묶음 — 모두 docs/plans/<slug>Plan_YYYY-MM-DD.md로 떨어진다. tunaFlow 작업 중 "plan 작성하자", "이슈 분석해서 plan으로 정리", "회귀 root cause 분해해서 task로 쪼개자", "구현 전 invariant + non-goals 명시", "이 작업을 어떻게 진행할지 문서화", "여러 PR로 분리될 작업의 그림 그리기" 같은 의도가 보이면 반드시 이 스킬을 사용한다. Plan 이 있어야 그 다음 단계인 developer 핸드오프로 이어지므로, plan 미존재 상태에서 갑자기 코드 수정으로 가지 말고 먼저 이 스킬을 거친다.
---

# tunaFlow Plan Writer

Architect 가 작업 영역을 SSOT 문서로 형식화한다. 출력은 `docs/plans/<slug>Plan_YYYY-MM-DD.md` 1 개 파일이다.

## 왜 plan 부터 쓰는가

코드 수정 직전에 plan 을 거치는 이유는 *비용 비대칭* 이다 — plan 단계에서 발견된 설계 결함은 텍스트 수정으로 끝나지만, 구현 후 발견된 설계 결함은 PR revert + 재작업이다. tunaFlow 의 Plan → Dev → Review 파이프라인 자체가 이 비대칭을 활용한 구조고, plan 문서는 그 첫 단계의 산출물이다. Plan 없이 시작한 작업은 "왜 이렇게 했지" 가 git log 와 PR description 에 흩어져서 6개월 후 후속 fix 시 root cause 추적이 막힌다.

## 언제 쓰는가

- 외부 사용자 issue 가 들어왔는데 1 PR 로 끝날 axis 인지 다중 영역인지 불분명
- 회귀 보고를 받았는데 root cause 가설이 2 개 이상
- Feature 추가가 frontend + backend + DB 셋 다 건드림
- 리팩토링이 5 파일 이상 영향
- v0.X.Y release 단위로 묶을 작업 set
- 복수 PR 로 분리될 작업 — 각 PR 의 경계와 의존성을 사전 정의해야 함

단일 파일, 단일 axis, 1 PR 로 끝나는 fix 면 plan 생략 가능 — 그 경우는 PR description 자체가 plan 역할.

## Frontmatter 형식

```yaml
---
title: <짧은 한 줄 — 영역 + 동사>
status: ready
phase: planning
priority: P0/P1/P2 (외부 issue 연결시 "(외부 사용자 보고 #N)" 같은 reason 추가)
created_at: YYYY-MM-DD
canonical: true
related:
  - <연관 파일 1>
  - <연관 파일 2>  # comment 로 역할 설명
  - <연관 plan / reference 문서>
issue_source: GitHub #N — <username> (YYYY-MM-DD)  # 외부 보고만 명시
---
```

`canonical: true` 는 *이 문서가 SSOT* 임을 명시. 분석 / 비교 문서면 `canonical: false`. `related` 는 *이 plan 을 작업할 때 참조해야 하는 영역* — 단순 grep 결과 모음이 아니라 의도적 큐레이션.

## 본문 구조 (6 + 1 섹션 고정)

### # <plan title>

Frontmatter title 과 동일.

### ## 0. Context

배경 단락. 외부 issue 면 다음 sub-section:

#### 0.1 외부 사용자 보고 (<username>, GitHub #N)

원문 인용 (blockquote `>`). 사용자 표현 그대로 — 의역 금지. 사용자가 *증상* 을 말한 vs *원인* 을 말한 vs *workaround* 를 말한 영역 분리가 root cause 분석의 단서.

#### 0.2 시나리오 정확화

코드 블록 / 단계 번호로 *재현 path* 명시. 사용자 보고 보다 더 구체적인 형태 — *어느 컴포넌트 / 어느 버튼 / 어느 store state 에서 발생* 까지.

#### 0.3 Root cause 가설

표 형식. 컬럼: `가설 | 근거`. 가설 (a) ~ (d) 정도. 마지막에 *가장 가능성 높음* 한 줄 + 그 근거 (보통 사용자 fact 와 일치하는 가설).

내부 작업 (외부 issue 없는 경우) 면 0.1 → 0.2 → 0.3 대신 *현재 상태 / 문제 / 동기* 단락으로 대체.

### ## 1. Invariants

표 형식. 컬럼: `ID | 내용`. ID 는 `INV-<영역>-N` (예: `INV-BCI-1` for BranchChatInput). 각 invariant 는 *plan 적용 후에도 유지되어야 하는 사실* — 이 plan 이 *깨면 안 되는 영역* 의 명시.

예:
| ID | 내용 |
|---|---|
| **INV-BCI-1** | branch view 의 chat input 은 *그 branch 의 phase 가 종료되기 전까지* 항상 노출 |
| **INV-BCI-2** | plan B 머지 → plan A revision 흐름이 plan A 의 branch chat input 정책 변경 X |
| **INV-BCI-3** | branchSessionPolicy.md 의 INV-1~5 그대로 — brand session = main session 공유 정책 보존 |
| **INV-BCI-4** | macOS / Windows / Linux 동일 동작 |

Invariant 가 명시 안 되면 Developer 가 *어디까지 변경해도 되는지* 모르고, 핸드오프 §3 DO NOT 도 정의 못 한다.

### ## 2. Goals / Non-goals

#### Goals

순번 매긴 (G1) ~ (G4). 각 goal 은 *측정 가능한 사용자 / 시스템 상태 변화*.

#### Non-goals

`❌` 글머리표. 명시적으로 *이 plan 이 다루지 않는 영역* — Developer 가 인근 영역까지 확장하지 않도록 경계 설정. Non-goals 가 명시되지 않으면 PR scope creep 발생.

### ## 3. Subtasks

각 task 는 다음 4 항목 fixed structure:

```markdown
### Task NN — <짧은 동사 + 영역> [우선, 추가 단서]

**Changed files**:
- `<경로>` (선택적: 라인 범위 / 함수명)

**Change description**:
- bullet 1
- bullet 2

**Verification**:
- 명령 또는 시나리오 (cargo / vitest / e2e)

**회귀 위험 가드**:
- 어떤 영역이 *건드리면 안 되는* 인지 — 핸드오프 §3 DO NOT 으로 직접 옮겨갈 형태

**위험** (선택): timeout / 추정 시간 / blocker 가능성
```

진단이 우선인 task (read-only) 면 명시: `[P1, 진단 우선]` 같은 라벨 + Output 섹션 (코드 변경 대신 *Architect 에게 회신할 fact*).

### ## 4. Cross-cutting risks

표 형식. 컬럼: `위험 | 대응`. 단일 task 에 묶이지 않는 영역 — task 간 의존 / 외부 환경 / migration 안전성 / DB 스키마 영향 등.

예:
| 위험 | 대응 |
|---|---|
| Task 01 진단 시간 가변 | 1시간 timeout 후 chat 보고 + 사용자 결정 |
| Task 02 fix 가 다른 phase 의 input hide 정책 영향 | manual smoke 의 회귀 시나리오 명시 |
| backend 영역까지 root cause 영향 | 진단 결과로 escalate. backend 영역이면 별 plan |

### ## 5. Rollback

각 task 의 revert 가능성 + 영향. 가능한 형태:
- 단독 revert 가능 (분기 조건 변경 1줄)
- migration 영향 task 는 *백업 fact 명시* (revert 시 사용자가 백업 복구 가능)
- destructive 한 task 는 *왜 destructive 한지* + Rollback 시 사용자 안내 필요 여부

### ## 6. 다음 step

본 plan 머지 후 무엇을 할지. 거의 항상:

```markdown
1. **Developer 핸드오프 작성** — Task 01/02/.. 분리 PR 권장 (axis 다름)
2. **<외부 사용자> 에게 답변** — workaround 인정 + hotfix 머지 후 자동 회복 안내
```

추가:
- 진단 결과 따라 다음 PR 1개 또는 별 plan 분리 가능성
- release timing (다음 release 에 포함되어야 하는지)
- 후속 plan 으로 escalate 가능성 시나리오

## 톤 / 표현 규칙

- 한국어 본문, 코드 / 경로 / 식별자 / 함수명 / 변수명 원문
- 사용자 fact 인용은 blockquote — 의역 금지
- "추측 / 가설" 단계는 §0.3 한정. §1~§3 는 *결정사항*
- 표는 4 컬럼 이내, 마크다운 가독성 우선
- 외부 issue 인용 시 사용자 username 명시 (감사 / 추적 목적)
- 한국어 어미는 "한다" 톤 (architect 작업 문서 — "합니다" 아닌 "한다")

## 산출물 검증 체크

작성 완료 후 self-check:

- [ ] Frontmatter 의 `priority` 가 §0 의 외부 issue / 회귀 심각도와 일치
- [ ] §1 Invariants 가 §3 각 task 의 회귀 위험 가드에서 직접 인용 가능한 형태
- [ ] §2 Non-goals 가 §3 각 task 의 회귀 위험 가드에서 *건드리지 말 것* 으로 옮겨감
- [ ] §3 각 task 의 Verification 명령이 §6 다음 step 에서 핸드오프 §4 로 직접 옮겨갈 형태
- [ ] §4 Cross-cutting risks 가 task 간 의존 / 외부 환경 / migration 영역 모두 cover
- [ ] §6 다음 step 첫 줄이 "Developer 핸드오프 작성"

## index.md 갱신

작성 완료 후 `docs/plans/index.md` 의 적절한 카테고리 (보통 *최근 ready / planning*) 에 한 줄 추가. 기존 plan 과 supersede / extend 관계 있으면 명시.

## 참고 — 좋은 plan 예시 (이 repo 안)

같은 형식의 모범 사례:
- `docs/plans/scaffoldUserCustomizationPreservationPlan_2026-05-03.md` — 외부 issue 영역 A/B 분해, INV-SUC-1~4
- `docs/plans/branchChatInputRegressionPlan_2026-05-03.md` — 회귀 root cause 가설 4개, 진단 + hotfix 분리
- `docs/plans/claudeTransportFlipHardeningPlan_2026-04-29.md` — 12 task 누적 fix, 사용자 architectural insight 반영
- `docs/plans/resultMdContaminationFixPlan_2026-04-29.md` — 4 task 분리 PR, P0 release blocker

가장 가까운 axis 의 예시를 참고하되 *예시를 복붙하지 말 것* — 형식만 맞고 본문은 현재 작업의 특수성 반영.

## Plan 과 핸드오프의 분업

| | Plan | 핸드오프 |
|---|---|---|
| 형식 | SSOT — *왜 / 무엇이 invariant* | 번역본 — *어디까지 / 어떻게* |
| 독자 | Architect / 미래 세션 / 외부 사용자 | Developer subagent / 다른 Claude 세션 |
| 수명 | 영구 (canonical) | 1 cycle (해당 PR 머지까지) |
| 주요 출력 | Subtasks / Invariants / Non-goals | DO / DO NOT / Verification 명령 |

Plan 작성 후 핸드오프로 이어지는 흐름이 표준이다. Plan 만 쓰고 핸드오프 없이 Developer dispatch 하면 *plan 의 의도와 다른 변경* 위험이 커진다. 두 단계를 묶어서 한 cycle 로 본다.
