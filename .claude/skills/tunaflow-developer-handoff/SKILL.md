---
name: tunaflow-developer-handoff
description: tunaFlow Architect가 Developer subagent 또는 다른 Claude 세션에 일감을 넘길 때 쓰는 핸드오프 문서를 작성한다. 한 plan을 1~3개의 정확한 PR로 쪼개고, DO/DO NOT/Verification/CI 정책/보고 포맷을 명시해 다른 세션이 가정 없이 그대로 따라갈 수 있게 만든다. tunaFlow에서 일하면서 "developer 핸드오프", "Plan 의 Task 를 누군가에게 넘기자", "Developer subagent 에게 dispatch 할 프롬프트", "이 작업을 다른 세션에서 진행할 수 있게 정리", "PR 분리 전략 + 회귀 가드 명시" 같은 의도가 보이면 반드시 이 스킬을 사용한다. 외부 사용자 issue 대응 시에도 plan 작성 후 곧바로 핸드오프로 이어지므로 함께 트리거한다.
---

# tunaFlow Developer Handoff Writer

Architect 가 Developer 에게 일감을 넘기는 문서를 만든다. 출력은 `docs/prompts/<slug>DeveloperHandoff_YYYY-MM-DD.md` 1 개 파일이다.

## 왜 이 형식인가

핸드오프는 *코드 수정 전 알아야 할 모든 것* 을 한 곳에 모은 SSOT 다. Developer 세션이 plan 만 보고 출발하면 *plan 의 의도와 다른 변경* 을 하기 쉽다 — plan 은 *왜* 를 말하지만 *어디까지가 OK 인지* 는 핸드오프가 정한다. 회귀 가드가 명시되지 않으면 Developer 가 "더 좋아 보이는" 인근 영역을 같이 손대고, 한 PR 에 두 axis 가 섞여서 revert 가 어려워진다. CI 정책이 명시되지 않으면 watch / wait / merge timing 이 세션마다 다르게 해석된다. 이 모든 갭을 한 문서로 닫는 게 핸드오프다.

## 언제 쓰는가

- Plan 머지 직후 — plan §6 "다음 step" 첫 줄이 거의 항상 "Developer 핸드오프 작성"
- 외부 issue 대응 사이클: plan 작성 후 같은 날 안에 핸드오프
- Architect 가 직접 코드 수정 안 하고 다른 Claude 세션 / subagent 에게 dispatch 할 때

## Frontmatter 형식

```yaml
---
title: Developer 핸드오프 — <짧은 영역 한 줄>
plan: docs/plans/<plan-slug>_YYYY-MM-DD.md
issue: GitHub #N (외부 보고면 명시, 내부 작업이면 생략)
created_at: YYYY-MM-DD
---
```

## 본문 구조 (9개 섹션 고정)

### 0. 한 줄 요약

1~2 문장. *무엇을 왜* 만 — root cause 한 줄 + fix axis. 외부 issue 면 사용자 주체 명시 (예: "외부 사용자(devbug)가 보고한 회귀를…").

### 1. 작업 개요 — task 표

Plan §3 Subtasks 를 Developer 행동 단위 표로 압축한다. 컬럼: `Task | 파일 | 핵심 변경 | 우선`. 본문에 진행 순서 + PR 분리 전략을 1~2줄로 명시 ("Task 01 → 02 순서. 두 영역 분리되어 PR 도 분리 권장. Task 01 단독으로도 root cause 차단 가능하므로 Task 02 막히면 Task 01 만 먼저 PR 가능").

### 2. DO — 반드시 지킬 것

순번 매긴 indicative 명령. 다음 항목을 반드시 포함:

1. Plan §X 의 Verification 명령을 **task 마다 실제로 실행** 하고 결과 chat 으로 보고
2. Task 진행 순서 (어느 task 가 어느 task 의 결과에 의존하는지)
3. 각 task 의 회귀 위험 가드 위반 여부 작업 전후 확인 — 어떤 영역이 *건드리면 안 되는* 인지 grep 으로 확인 가능한 형태로
4. feature 브랜치 분리 (`fix/<axis>` / `feat/<axis>` / `chore/<axis>`)
5. Commit 단위 task 별 분리 (커밋 메시지 형식 예시 1~2 개)
6. PR description 에 plan 링크 + issue 링크 + 각 task Verification 결과 첨부 — **Closes 키워드는 마지막 PR 에만** (중간 PR 은 "Refs #N" / "Closes part of #N" 대신 다음 PR 까지 close 미반영)

### 3. DO NOT — 사이드 이펙트 차단

`❌` 글머리표. 다음 카테고리를 통과:
- Plan §2 Non-goals 가 명시한 영역
- 같은 함수 안의 다른 분기 (예: "Task 01: `context_loading.rs` 의 다른 phase 분기는 절대 수정 금지")
- 인근 호출 사이트 (직접 fix 영역과 같은 store / module 의 다른 export 함수)
- DB 스키마 / migration / settings store
- 새 dependency 추가
- README / CLAUDE.md 같은 cross-cutting 문서 (영역 외)

각 항목은 *왜 안 되는지* 한 줄 — 단순히 "수정 금지" 가 아니라 "(다른 caller 영향 / PR #N 정책 / branchSessionPolicy.md INV 영역 / 등)" 같은 이유.

### 4. 변경 후 검증 (전체)

PR 머지 직전 통과 명령. 항상 포함:
```bash
cd src-tauri && cargo check --message-format=short
cd src-tauri && cargo test --lib
npx tsc --noEmit
npx vitest run
```

이어서 회귀 grep — 변경 영역의 *경계* 가 살아있는지 확인하는 패턴 (예: `rg "phase ==.*\"completed\"" src/components/...` 또는 `git diff <untouched-file>` 가 빈 출력인지).

테스트 카운트 baseline 기록 후 작업 후 동일 또는 +N (새 unit test 만큼). **감소 시 회귀** — 즉시 원인 파악.

### 5. e2e 수동 검증

PR 직전 필수 시나리오. 다음 두 카테고리를 항상 분리:
- **회귀 시나리오** (사용자 보고 / fix 의도): 사용자 입장에서 fix 가 작동하는지
- **회귀 가드 시나리오**: 정상 path 가 깨지지 않는지 (정상 plan 진행 / 새 plan 단독 / 다른 phase 분기 등)

GUI 가 필요한 변경에서 subagent 환경 제약상 e2e 실행 불가하면 unit test 로 시뮬레이션 하고 그 사실 명시 — *next release 외부 사용자 검증으로 최종 확인* 으로 위임.

### 6. CI 정책

기본 정책 한 단락:
- PR 직후 admin merge 즉시 가능 (CI watch 불필요)
- 자체 검증 §4 + e2e §5 통과한 상태로 self-merge
- merge 후 main 에서 회귀 발생 시 즉시 revert PR 생성

migration / DB / release 영향 task 면 release timing 명시 (예: "Task 02 는 migration 동작이라 머지 후 다음 release 에 포함되어야 외부 사용자 자가 회복 path 회복. release note 에 백업 파일 위치 + sentinel 사용법 한 줄 명시 권장.").

### 7. 보고 포맷

작업 완료 시 chat 으로 보고할 형식 (Developer subagent 가 정확히 이 형식으로 회신하면 Architect 가 다음 step 진행 가능):
- task 별 변경 라인 수
- 각 Verification PASS/FAIL + 핵심 출력
- e2e 수동 검증 결과 (회귀 시나리오 + 회귀 가드 각각 1줄)
- PR URL (각 task 별)
- 회귀 위험 가드 위반 없음 확인 (`<금지 영역> diff 0`)

### 8. 막히면

다음 패턴으로 escalate:
- 진단 단계가 timeout (예: 1시간) 도달 시 chat 보고 + Architect 에게 escalate. 무리한 우회 금지
- root cause 가 backend 영역 (DO NOT 영역) 으로 진단되면 frontend hotfix 보류 + Architect 에게 escalate (별 plan)
- store schema / DB schema 변경 필요 → 별 PR + 영향 0 우선
- 분기 조건 광범위 변경 위험 → "조건 좁히기" (예: `phase === "completed"` 만 hide) 가 안전

### 9. 사용자 답변 정책 (외부 issue 면 추가)

devbug 등 외부 사용자에게 답변하는 주체 / timing 명시:
- Plan 머지 후 Architect 가 issue 댓글
- Task 머지 후 자동 회복 안내 (다음 release URL)
- 임시 workaround 가 있으면 인정 + 명시

## 톤 / 표현 규칙

- 한국어 본문, 코드 / 경로 / 식별자 / commit 메시지 / branch 이름은 원문
- "절대 / 반드시 / 금지" 같은 강한 표현은 회귀 위험 가드에서만 — 본문 흐름은 사실 진술
- ❌ 글머리표는 DO NOT 섹션 전용
- ✅ 글머리표는 e2e 검증 시나리오 통과 표시 전용
- 표는 4 컬럼 이내 (모바일 가독성)
- "참고로" / "혹시" / "필요하면" 같은 약화 표현은 escalate 안내에서만 사용

## Plan 과의 관계

핸드오프는 plan 의 *번역본* 이지 plan 의 대체물이 아니다. Plan 이 "왜 / 무엇이 invariant" 를 정하면 핸드오프는 그것을 *행동 단위 명령* 으로 옮긴다. Plan 의 Verification / 회귀 가드 / Non-goals 와 핸드오프 §4 / §3 / §3 가 1:1 대응해야 한다. 대응이 안 맞으면 plan 을 먼저 수정.

## 산출물 검증 체크

작성 완료 후 self-check:

- [ ] Plan SSOT 경로가 frontmatter 와 본문 §1 양쪽에 명시됐는가
- [ ] Issue 번호가 (외부 보고 케이스에) frontmatter + §0 + §1 task 표 + §9 모두에 일관되게 등장하는가
- [ ] DO NOT 의 각 ❌ 항목에 *왜 안 되는지* 가 한 줄 따라붙는가
- [ ] §4 grep 명령이 "이 영역은 안 건드린다" 의 *경계 검증* 으로 작동 가능한가
- [ ] §7 보고 포맷의 각 항목이 §4/§5 와 1:1 대응되는가 (Developer 가 보고할 때 빠짐없이 채울 수 있는가)

## 참고 — 좋은 핸드오프 예시 (이 repo 안)

같은 형식의 모범 사례:
- `docs/prompts/scaffoldUserCustomizationPreservationDeveloperHandoff_2026-05-03.md` — 2 task 분리 PR, migration 안전 가드, 외부 issue 대응
- `docs/prompts/branchChatInputRegressionDeveloperHandoff_2026-05-03.md` — 진단 + hotfix 2 task, frontend 한정, 1 hour timeout
- `docs/prompts/resultMdContaminationFixDeveloperHandoff_2026-04-29.md` — 4 task 분리 PR, P0 우선순위 명시
- `docs/prompts/watchdogAndReviewerReadGuardDeveloperHandoff_2026-04-29.md` — 단일 PR 내 2 영역 통합

새 핸드오프 작성 시 가장 가까운 axis 의 예시를 참고. 단 *예시를 그대로 복붙하지 말 것* — 형식만 맞고 본문은 현재 작업의 특수성 반영.

## 마지막에 갱신

작성 완료 후 `docs/prompts/index.md` 활성 핸드오프 섹션 최상단에 한 줄 추가:

```markdown
- [<slug>DeveloperHandoff_YYYY-MM-DD](./<slug>DeveloperHandoff_YYYY-MM-DD.md) — **<우선순위> fix 핸드오프**. Plan: `<plan-slug>`. <한 줄 요약 — 작업 영역 + task 수 + 외부 issue 연결>.
```

이 한 줄 인덱스는 다음 세션이 *현재 진행 중인 핸드오프* 를 찾는 1차 entry point 다. 누락되면 인덱스가 stale.
