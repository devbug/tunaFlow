# tunaFlow Harness Engineering 적용 설계

- 작성자: OpenAI Codex
- 작성 시각: 2026-03-26 20:01 KST

## 목적

`tunaFlow`에 이미 존재하는 plan, branch, RT branch, handoff, project boundary, rawq, review 흐름을
Stavros식 harness 관점으로 재구성해, 장기 작업에서도 일관성 있는 품질과 추적성을 확보한다.

이 문서는 `agents/` 폴더에 준비된 역할 문서와 현재 `tunaFlow` 코드베이스를 기준으로:

1. 지금 바로 적용 가능한 부분
2. 제품 기능으로 승격해야 하는 부분
3. 단계별 도입 절차
4. 주의사항과 테스트 전략

을 정리한다.

## 참고 전제

프로젝트 루트의 에이전트 문서:

- `D:\privateProject\tunaFlow\agents\architect.md`
- `D:\privateProject\tunaFlow\agents\developer.md`
- `D:\privateProject\tunaFlow\agents\code-reviewer.md`
- `D:\privateProject\tunaFlow\agents\code-reviewerer.md`
- `D:\privateProject\tunaFlow\agents\repo-scout.md`
- `D:\privateProject\tunaFlow\agents\diff-summarizer.md`

현재 문서 기준으로 확인되는 특징:

- `architect.md`
  - architect가 직접 구현하지 않고 `Task Brief`만 작성하는 모델
  - `@developer`, `@code-reviewer`, `@code-reviwerer` / `@code-reviewerer` 호출 전제
  - signoff를 `approved` 텍스트 하나로 받도록 설계
- `developer.md`
  - `misc/coding-team/<topic>/<NNN>-task.md` 기준 단일 task 실행
  - 자체 검증 후 architect에게 보고
- `code-reviewer.md`
  - read-only reviewer
  - 요약이 아니라 실제 VCS diff 검토

즉 역할 모델 자체는 이미 상당히 잘 준비돼 있다.

## 현재 tunaFlow와의 적합성

### 이미 있는 것

`tunaFlow`에는 harness의 핵심 구성요소가 상당 부분 이미 존재한다.

- 프로젝트 경계
  - project onboarding
  - project path / rawq 상태 / 기본 conversation
- 작업 단위
  - plans
  - subtasks
  - owner_agent
- 위임 경로
  - message / artifact / plan forward
  - 자연어 handoff
- 작업 분기
  - branches
  - RT branch
  - adopt summary
- 컨텍스트 레이어
  - rawq
  - progress-first streaming
  - Claude context 경량화 계획
- 런타임 제어
  - thread-local queue
  - thread-aware cancel 1차

즉 새로운 제품을 처음부터 만드는 단계가 아니라,
이미 있는 기능을 **architect-developer-reviewer workflow**로 엮는 단계에 가깝다.

### 아직 부족한 것

다만 현재는 기능이 흩어져 있고, harness로서의 핵심 규율이 제품에 강제되지는 않는다.

부족한 지점:

1. 역할별 권한이 프롬프트에만 있고 런타임 RBAC로 강제되지 않음
2. 승인 게이트가 구조화된 UI 상태머신이 아님
3. `Task Brief`, `review findings`, `architect decision`, `workspace snapshot`이 1급 artifact가 아님
4. reviewer lane이 기능적으로는 가능하지만 제품의 표준 실행 경로로 고정되지 않음
5. git/worktree 격리가 아직 없어 동일 워크스페이스 상태 mismatch 위험이 남아 있음

## 목표 상태

`tunaFlow`가 궁극적으로 가져야 할 harness 동작은 다음과 같다.

1. 사용자는 기본적으로 architect lane과만 상호작용한다.
2. architect는 사용자 요구를 plan과 task brief로 구조화한다.
3. developer는 정확히 하나의 Task Brief만 구현한다.
4. reviewer는 실제 diff와 task brief를 기준으로 read-only 리뷰를 수행한다.
5. 승인, 재시도, adopt/merge는 텍스트가 아니라 UI gate로 제어한다.
6. 진실원은 채팅 누적이 아니라 artifact store가 된다.
7. 추적성은 transcript + tool trace + diff + test report + findings로 유지한다.

## UX/UI 원칙

### 탭은 "채팅하는 객체"만 가진다

이 문서에서 권장하는 기본 UX는 메인 채팅창 상단 탭 구조다.

다만 탭에 모든 것을 넣는 것이 아니라, **실제로 대화가 오가는 객체만 탭으로 둔다.**

권장 탭:

- `Architect`
- `Developer Branch`
- `RT Branch`
- 필요 시 `Reviewer Thread`

즉 탭은 "누구와 어떤 thread에서 대화 중인가"를 나타내는 용도여야 한다.

### 우측 패널은 작업 보조 정보에 집중한다

다음은 채팅 탭이 아니라 우측 패널에 두는 것이 맞다.

- Plan
- Subtasks
- Owner agent
- Approval state
- Review findings
- Test report
- Task brief
- Architect decision
- Diff summary
- Trace / run log

즉 harness의 진실원은 우측 패널의 structured artifact와 상태 영역에 두고,
메인 중앙은 conversation/thread에 집중시키는 쪽이 맞다.

### 우측 패널은 단순 적층이 아니라 workspace panel로 재설계해야 한다

Plan, Reviews, Tests, Artifacts, Trace를 모두 단순히 우측 패널에 세로로 쌓기만 하면,
현재 `tunaFlow` UI는 금방 과적재된다.

따라서 harness 도입 시 우측 패널은 단순 "섹션 추가"가 아니라,
**작업 단계에 따라 포커스를 바꾸는 workspace panel**로 재설계하는 것이 맞다.

권장 방향:

- 우측 패널 상단에 작은 mode 전환
  - `Plan`
  - `Reviews`
  - `Tests`
  - `Artifacts`
  - `Trace`
- 한 번에 하나의 주 모드만 전면 표시
- 나머지는 badge/count/summary만 노출

즉 우측 패널 내부도 사실상 "작업용 탭" 또는 "모드 전환형 패널"이어야 한다.

### 왜 이 구성이 맞는가

`tunaFlow`는 이미 메인 채팅 + 컨텍스트 패널 구조를 갖고 있다.

따라서 harness를 넣을 때도:

- 중앙: conversation/thread
- 우측: plan/review/tests/artifacts/trace

로 나누는 편이 현재 구조와 가장 잘 맞는다.

반대로 plan/review/tests까지 모두 탭으로 올리면:

- "지금 누구와 대화 중인지"
- "지금 무엇을 보고 있는지"

가 섞여서 메인 작업 흐름이 흐려질 수 있다.

### 1차 MVP 권장 형태

- 중앙 상단 탭
  - `Architect`
  - 현재 활성 `Developer Branch`
  - 현재 활성 `RT Branch`
- 우측 패널 모드
  - `Plan`
  - `Reviews`
  - `Tests`
  - `Artifacts`
  - `Trace`

이 구성이 현재 `tunaFlow`의 구조를 가장 덜 깨면서 harness 철학을 반영하는 방식이다.

## 역할 매핑

현재 `tunaFlow` 관점에서 가장 자연스러운 1차 매핑은 아래와 같다.

### Architect

- 메인 conversation
- plan 생성/수정
- subtask 분해
- 승인 요청
- developer / reviewer 호출 트리거

### Developer

- branch 또는 work branch
- 특정 task brief만 받아 구현
- 테스트/검증 실행
- diff와 요약 반환

### Reviewer

- RT branch 또는 dedicated review branch
- read-only review lane
- diff + task brief + test report 기준 findings 생성

### Repo Scout

- project context
- rawq
- 향후 code-review-graph
- repo summary / commands / conventions

## 핵심 설계 원칙

### 1. 기본 writer는 1명

같은 워크스페이스에서 동시에 코드를 수정하는 writer를 여러 명 두는 것은 기본 비활성화가 맞다.

허용 병렬화:

- repo scout
- code reviewer
- diff summarizer
- 구조/검색 분석 도구

기본 직렬화:

- 실제 code write lane

### 2. 채팅이 아니라 artifact가 진실원

최소한 아래 artifact는 표준화해야 한다.

- `plan`
- `task-brief`
- `repo-scout-report`
- `workspace-snapshot`
- `diff`
- `test-report`
- `review-findings`
- `architect-decision`

### 3. 승인 게이트는 UI 상태여야 한다

문자열 `approved` 감지는 제품 기능으로는 brittle하다.

필수 gate 예:

- Plan 승인
- Task 시작 승인
- Review 후 재작업 승인
- Adopt/merge 승인
- Budget 초과 승인
- 위험 도구 승인

### 4. 역할별 권한은 런타임에서 강제해야 한다

예:

- architect
  - read, plan write, delegate
  - code write/edit 금지
- developer
  - code write/edit/test 허용
- reviewer
  - read/diff/test만 허용
- scout
  - read/search/graph만 허용

현재 `agents/architect.md`는 frontmatter에 write/edit가 켜져 있고 본문은 구현 금지를 요구하므로,
프롬프트만으로는 충분하지 않다.

### 5. 워크스페이스 상태를 명시적으로 고정해야 한다

reviewer는 developer가 작업한 정확한 상태를 봐야 한다.

즉 아래가 필요하다.

- snapshot id
- branch/worktree id
- diff base
- review target

## 권장 도입 절차

### Phase 1. Harness artifact 표준화

목표:

- plan과 subtask를 그대로 쓰되, `task-brief`, `review-findings`, `architect-decision`, `test-report`를 명시적 artifact로 추가

핵심:

- DB 또는 파일 스토어에서 artifact type을 구분
- handoff source와 reviewer 입력을 artifact 중심으로 재배치

완료 기준:

- 특정 task에 대해 brief, diff, tests, findings, decision을 연결해 조회할 수 있다

### Phase 2. Architect lane + 승인 게이트

목표:

- architect conversation을 메인 진입점으로 고정
- plan 승인과 task 시작을 UI action으로 전환

핵심:

- `approved` 텍스트 파싱 제거
- plan 승인 버튼
- task 시작 버튼

완료 기준:

- architect가 사용자의 signoff를 구조화된 상태로 받는다

### Phase 3. Developer lane 정식화

목표:

- branch를 developer work branch로 더 명확히 해석
- task brief 기반 실행 경로 고정

핵심:

- `create branch from subtask`
- branch 메타에 `owner_agent`, `task_brief_id`, 향후 `git_branch` 연결 지점 추가

완료 기준:

- 특정 subtask를 developer branch로 분기해 구현하는 경로가 표준화된다

### Phase 4. Reviewer lane 정식화

목표:

- RT branch와 별도로 read-only reviewer 경로를 제품 기능으로 명확히 한다

핵심:

- review request 생성
- diff + task brief + test report + repo scout context 전달
- reviewer finding 구조화

완료 기준:

- reviewer 결과가 architect가 판정 가능한 artifact로 남는다

### Phase 5. Snapshot / workspace / git 연결

목표:

- harness를 실제 장기 작업 체계로 완성

핵심:

- snapshot pinning
- git-aware branch
- 향후 worktree

완료 기준:

- developer와 reviewer가 서로 다른 시점의 상태를 보지 않게 된다

## 주의사항

### 1. 한 번에 다 바꾸지 말 것

현재 `tunaFlow`는 이미 다양한 흐름이 살아 있다.

따라서 harness 도입은:

- 기존 기능 제거
- 새 시스템 일괄 치환

이 아니라

- 기존 plan/branch/handoff를 재해석
- 점진적으로 gate/artifact/RBAC를 추가

방식이 맞다.

### 2. RT와 reviewer를 동일시하지 말 것

RT branch는 토론과 비교에 강하고,
reviewer lane은 read-only 검증에 맞다.

둘은 겹칠 수는 있지만 같은 개념은 아니다.

### 3. reviewer는 diff 중심이어야 한다

채팅 전체 맥락을 reviewer에게 넘기면 노이즈가 커진다.

reviewer의 핵심 입력:

- task brief
- diff
- test report
- 필요 시 repo scout report

### 4. rawq와 graph는 scout/review 보조 레이어로 써야 한다

rawq와 향후 `code-review-graph`를 harness에 넣더라도,
모든 요청에 자동 주입하면 다시 prompt 병목이 생긴다.

### 5. naming mismatch를 먼저 정리해야 한다

현재 `architect.md`에는 `@code-reviwerer` 오타가 남아 있다.
이런 라우팅 오타는 실제 제품에선 치명적이다.

### 6. 채팅 탭과 작업 패널을 혼합하지 말 것

탭은 thread/conversation 전환용이어야 하고,
plan/review/tests/artifacts는 우측 패널의 structured view로 유지하는 것이 맞다.

즉 "대화 객체"와 "작업 상태/산출물"을 같은 계층의 네비게이션으로 취급하면 안 된다.

### 7. 우측 패널은 정적 정보판이 아니라 현재 작업 패널이어야 한다

우측 패널은 가능한 한 "지금 해야 하는 작업"에 맞는 하나의 모드만 강하게 보여줘야 한다.

예:

- Plan 승인 중이면 `Plan` 모드 중심
- 리뷰 판정 중이면 `Reviews` 모드 중심
- 테스트 실패 디버깅 중이면 `Tests` 모드 중심

즉 우측 패널은 단순 정보 누적 영역이 아니라,
현재 workflow 단계에 따라 중심이 이동하는 패널이어야 한다.

## 테스트 전략

### A. 역할/권한 테스트

- architect가 code write를 시도해도 차단되는지
- reviewer가 edit/write를 시도해도 차단되는지
- developer만 수정 권한을 갖는지

### B. 승인 게이트 테스트

- plan 미승인 상태에서는 task 시작 불가
- task 진행 중 승인 취소/보류 처리
- review findings 이후 재시작/재작업 분기

### C. artifact 일관성 테스트

- task brief 없이 developer lane 시작 불가
- review request에 diff/test-report/task-brief가 모두 연결되는지
- architect decision이 findings와 연결되는지

### D. 워크플로 통합 테스트

1. architect가 plan 작성
2. 사용자 승인
3. subtask에서 developer branch 생성
4. developer 결과/테스트 보고
5. reviewer 병렬 리뷰
6. architect adjudication
7. adopt/merge 또는 retry

이 전체 흐름이 같은 프로젝트 안에서 추적 가능한지 확인해야 한다.

## 현재 판정

이 harness는 `tunaFlow`에 적용 가능성이 높다.

이유:

- 필요한 핵심 primitive가 이미 많이 구현돼 있고
- 남은 문제도 대부분 “기능 부재”보다는 “구조화 부족”에 가깝기 때문이다.

따라서 올바른 방향은 새 앱 철학을 추가하는 것이 아니라,
현재 기능들을 **artifact 중심, 승인 게이트 중심, 역할 권한 중심**으로 재정렬하는 것이다.
