# tunaFlow 문서 버전관리 정책

- 작성자: OpenAI Codex
- 작성 시각: 2026-03-30
- 목적: Claude Code, Codex, 사람이 문서를 갱신할 때 같은 규칙으로 버전과 현재성을 관리하게 하는 기준

## 핵심 판단

문서 버전관리는 Git만으로 충분하지 않다.

에이전트는 커밋 히스토리를 보기 전에
현재 문서인지, 과거 문서인지, 새 문서를 만들어야 하는지,
기존 문서를 갱신해야 하는지를 문서 자체에서 판단할 수 있어야 한다.

따라서 tunaFlow는
`파일명 + 상태 + 메타 + 인덱스`를 함께 쓰는 문서 버전관리 방식을 가져야 한다.

## 기본 원칙

### 1. Reference는 가급적 같은 파일을 갱신한다

대상:

- `docs/reference/*.md`
- `CLAUDE.md`

원칙:

- 같은 주제의 현재 기준 문서는 하나를 유지한다
- 새 날짜 파일을 계속 만들지 않는다
- `updated_at`, `last_verified_at` 같은 메타를 갱신한다

예외:

- 성격이 완전히 다른 새 reference가 생길 때만 새 파일 허용

### 2. Plan/Prompt는 작업 단위별 새 문서를 만들 수 있다

대상:

- `docs/plans/*.md`
- `docs/prompts/**/*.md`

원칙:

- 작업 단위가 독립적이면 날짜 기반 새 문서 허용
- 대신 인덱스와 관계 메타가 반드시 필요하다

이유:

- 여러 구현 흐름이 병렬로 존재할 수 있기 때문

### 3. 브레인스토밍 문서는 current SSOT로 취급하지 않는다

대상:

- 외부 레퍼런스
- 비교 메모
- 아이디어 수집 문서

원칙:

- `canonical: false`
- 현재 구현 기준 문서 경로 명시
- 실행 계획처럼 읽히는 표현 자제

### 4. 오래된 문서는 삭제보다 아카이브 우선

원칙:

- 현재 기준에서 벗어난 문서는 바로 삭제하지 않는다
- `archived` 상태 또는 명시적 경고를 붙인다
- 가능하면 `superseded_by`로 대체 문서를 연결한다

## 새 파일을 만들 때 vs 기존 파일을 갱신할 때

### 기존 파일 갱신이 맞는 경우

1. 같은 주제의 현재 기준을 최신화하는 경우
2. 구현 상태가 바뀌어 reference를 수정하는 경우
3. 같은 계획 문서의 진행 상태만 바뀌는 경우

예:

- `implementationStatus.md`
- `CLAUDE.md`
- `dataModelRevised.md`

### 새 파일 생성이 맞는 경우

1. 기존 문서와 목적이 다른 새 작업이 생긴 경우
2. 독립적인 새 plan/prompt가 필요한 경우
3. 브레인스토밍/비교/참고용 문서를 분리해야 하는 경우

예:

- 새 UI 리팩토링 계획
- 특정 세션용 실행 프롬프트
- 외부 기술 검토 메모

## 파일명 규칙

### Reference

권장:

- 날짜 없는 안정 이름

예:

- `implementationStatus.md`
- `workingRulesForAgents.md`

### Plan / Prompt

권장:

- 기능명 + 목적 + 날짜

예:

- `agentProfileChatInputBindingPlan_2026-03-29.md`
- `runtime_settings_implementation_prompt.md`

### Brainstorm / Review / Memo

권장:

- 성격이 드러나는 이름 + 날짜

예:

- `chatUiVsTunaChatGapReview_2026-03-29.md`
- `tunaflow_references_2026-03-30.md`

## 필수 상태 관리

문서 상단에는 가능하면 아래를 둔다.

- `type`
- `status`
- `updated_at`
- `canonical`

상태 값:

- `draft`
- `in_progress`
- `partial`
- `done`
- `archived`

## 관계 관리

버전관리에서 중요한 관계 메타:

- `related`
- `paired_plan`
- `paired_prompt`
- `supersedes`
- `superseded_by`
- `read_before`

이 메타가 있어야 에이전트가 낡은 문서를 덜 읽는다.

## 인덱스 규칙

문서 버전관리는 `index.md`와 함께 굴러가야 한다.

### index가 해야 하는 일

1. 현재 유효 문서 표시
2. 부분 완료 / 보류 / 아카이브 구분
3. 읽기 순서 제시
4. 새 문서 추가 시 링크 반영

## Claude/Codex 작업 규칙

### 문서 수정 시 반드시 판단할 것

1. 이 변경은 기존 문서를 갱신하는 것이 맞는가?
2. 새 문서를 만들어야 하는가?
3. 이 문서는 current 기준인가, 참고용인가?
4. 인덱스 업데이트가 필요한가?
5. 대체된 문서가 있다면 관계를 남겼는가?

### 특히 피해야 할 것

1. 같은 주제 reference를 날짜 파일로 계속 복제
2. 새 plan/prompt를 만들고 index를 안 고침
3. 아카이브 문서를 현재 기준처럼 방치
4. 브레인스토밍 문서를 구현 현황처럼 작성

## 최소 실무 규칙

지금 당장 강제할 최소 규칙:

1. reference는 기존 파일 우선 갱신
2. plan/prompt는 새 파일 가능, 단 index 필수 업데이트
3. 브레인스토밍/외부 참고는 `canonical: false` 성격 명시
4. 대체 문서는 `superseded_by` 또는 상단 경고 추가

## 최종 판단

좋은 문서 버전관리는
“파일이 많이 생기지 않게 하는 것”이 아니라,
“에이전트가 현재 문서를 빠르게 고를 수 있게 하는 것”이다.

