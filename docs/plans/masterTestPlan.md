# TUNAFLOW_MASTER_TEST_PLAN.md

## 목적

이 문서는 `D:\privateProject\tunaFlow` 프로젝트에 테스트 체계를 **처음 도입하는 단계부터**,  
최종적으로 **핵심 기능에 대한 안정적인 커버리지와 회귀 방지 체계**를 갖추는 단계까지를 순차적으로 안내하는 마스터 실행 문서다.

목표는 단순히 커버리지 숫자를 올리는 것이 아니다.

- branch / plan / roundtable / trace / migration 같은 핵심 흐름이 깨지지 않게 만들 것
- 프론트와 Tauri/Rust 양쪽에서 회귀를 조기에 잡을 것
- 외부 LLM CLI 의존성 때문에 테스트가 불안정해지지 않도록 경계를 명확히 나눌 것
- 최종적으로는 “기능 고도화 이후에도 안전하게 수정 가능한 코드베이스”를 만들 것

---

## 현재 전제

> **2026-03-26 갱신**: 테스트 기반 도입 완료. 아래는 현재 상태.

현재 코드베이스 기준:

- **프론트 테스트 러너**: vitest + jsdom + @testing-library/react 설치 완료
- **프론트 테스트**: API layer 테스트 13개 (plans/artifacts/memos invoke shape 검증)
- **Rust unit tests**: 27개 (context_pack, prompt, trace_log)
- **Rust DB integration tests**: 13개 (in-memory SQLite, migration~CRUD~trace)
- **CI**: `.github/workflows/ci.yml` (cargo check/test + tsc + vitest + vite build)
- **커버리지**: `@vitest/coverage-v8` 설치, API layer 92.3%
- Playwright/Cypress E2E 없음 (의도적 후순위)
- Tauri command 기반 구조
- 핵심 로직 축: agents, roundtable, plans, artifacts, evaluation, tracing, migrations, context_queries

Step 1-3, 6, 8-9 완료 상태. Step 4-5 (컴포넌트 테스트)와 Step 7 (E2E)이 남음.

---

## 최종 목표

최종적으로 도달하고 싶은 상태:

1. Rust 단위 테스트가 핵심 helper와 DB 로직을 덮는다.
2. Rust 통합 테스트가 migration / plan / branch / trace 핵심 흐름을 검증한다.
3. 프론트 컴포넌트 테스트가 주요 패널과 상태 전이를 검증한다.
4. 최소 E2E smoke test가 실제 사용자 워크플로우를 검증한다.
5. CI에서 빌드 + 타입체크 + 테스트가 자동으로 돌아간다.
6. 커버리지는 숫자보다 핵심 경로를 우선하지만, 최종적으로는 측정 가능한 형태로 관리한다.

---

## 테스트 원칙

### 1. 커버리지 숫자보다 핵심 경로 우선

처음부터 전체 80%를 목표로 하지 않는다.

우선순위:

- migration 안정성
- branch conversation 흐름
- plan 저장/조회/상태 전이
- roundtable prompt/persist 흐름
- trace 기록
- context 조립

### 2. 외부 엔진 호출은 직접 테스트하지 않는다

다음은 초반 테스트 대상이 아니다.

- 실제 Claude CLI 호출
- 실제 Codex/Gemini/OpenCode CLI 호출
- 실제 네트워크 기반 MCP/A2A

이들은 mock boundary 바깥으로 둔다.

테스트 대상은:

- 프롬프트/컨텍스트 조립
- DB 기록
- 상태 전이
- helper 로직
- command 내부 흐름 중 외부 실행 전후 처리

### 3. 얇은 도입, 점진 확장

도입 순서:

1. Rust 단위 테스트
2. Rust DB 통합 테스트
3. 프론트 Vitest/RTL 테스트
4. E2E smoke test
5. CI 통합

### 4. 테스트도 리팩토링 친화적으로

- 테스트는 모듈 경계를 반영해서 작성
- 거대한 end-to-end만 쌓지 말 것
- helper / persistence / panel 단위로 나눌 것

---

## 권장 도구

### 프론트엔드

- `vitest`
- `@testing-library/react`
- `@testing-library/user-event`
- `jsdom`

### 백엔드

- Rust 기본 test framework
- 가능하면 `rusqlite` in-memory DB 활용

### E2E

- `playwright`

---

## 단계별 실행 계획

## Step 1. 테스트 기반 설치

### 목표

프론트 테스트 러너와 기본 실행 스크립트를 추가한다.

### 해야 할 일

- `vitest`
- `@testing-library/react`
- `@testing-library/user-event`
- `jsdom`

추가

- `package.json`에 테스트 script 추가
- 필요하면 `vitest.config.ts` 또는 `vite.config.ts` 확장
- 테스트 셋업 파일 추가

### 완료 조건

- `npm run test` 또는 이에 준하는 테스트 명령이 동작
- 빈 샘플 테스트 1개 통과
- 기존 `build`와 충돌 없음

### 권장 결과

- 프론트 테스트 실행 환경만 먼저 안정적으로 확보

---

## Step 2. Rust 단위 테스트 도입

### 목표

순수 helper 또는 DB 의존이 거의 없는 로직부터 테스트를 붙인다.

### 우선 대상 파일

- `src-tauri/src/commands/agents_helpers/context_pack.rs`
- `src-tauri/src/commands/context_queries.rs`
- `src-tauri/src/commands/agents_helpers/compression.rs`
- `src-tauri/src/commands/agents_helpers/trace_log.rs`
- `src-tauri/src/commands/roundtable_helpers/prompt.rs`

### 반드시 테스트할 항목

#### context_pack

- `build_context_summary`
  - current only
  - parent only
  - branch mode
  - empty input

- `build_plan_section`
  - active plan 없음
  - active plan 있음
  - in_progress / todo / done 조합에 따른 요약

- `resolve_plan_conversation_id`
  - 일반 conversation id
  - branch conversation id
  - 존재하지 않는 branch id

#### context_queries

- 최근 메시지 로드 순서
- conversation label fallback

#### roundtable prompt

- sequential mode prompt 조립
- prior/current refs 계산 보조 로직

### 완료 조건

- 최소 10개 이상의 Rust unit test
- `cargo test` 통과

---

## Step 3. Rust DB 통합 테스트 도입

### 목표

SQLite in-memory DB를 사용해 실제 schema/migration/CRUD 흐름을 검증한다.

### 우선 대상

- `db/migrations.rs`
- `commands/plans.rs`
- `commands/artifacts.rs`
- `commands/evaluation.rs`
- `commands/tracing.rs`

### 반드시 테스트할 시나리오

#### migrations

- 빈 DB에서 v1~v6까지 정상 적용
- 재실행 시 안전
- v2/v4/v6 idempotent column add 경로 검증

#### plans

- create plan + subtasks
- list by conversation
- update plan status
- update subtask status
- replace subtasks

#### branch / plan 연결

- branch shadow conversation 존재
- branch conversation에서 canonical conversation id 해석
- active plan lookup 동작

#### artifacts

- artifact 생성
- artifact-subtask link

#### tracing

- trace_log insert
- list_traces
- export_traces_otel 직렬화

#### evaluation

- eval_run 생성
- eval_result 추가
- list / status update

### 완료 조건

- in-memory DB 기반 통합 테스트 확보
- migration 회귀를 잡는 테스트 존재
- `cargo test` 전체 통과

---

## Step 4. Plans / Context UI 테스트

### 목표

가장 자주 깨질 수 있는 UI부터 컴포넌트 테스트를 붙인다.

### 우선 대상 파일

- `src/components/tunaflow/context-panel/PlansPanel.tsx`
- `src/components/tunaflow/context-panel/BranchesPanel.tsx`
- `src/components/tunaflow/ContextPanel.tsx`
- `src/lib/api/plans.ts`

### 반드시 테스트할 시나리오

#### PlansPanel

- conversation 선택 시 plan 목록 로드
- 새 plan 생성 폼 열기/닫기
- 생성 성공 후 목록 반영
- plan card expand
- subtasks lazy load
- plan status 변경
- subtask status 변경

#### branch-scoped plan UI가 도입된 이후

- branch stream일 때 scope 선택 노출
- 일반 conversation일 때 branch scope 비노출
- branch 생성 payload 검증

### mocking 원칙

- `invoke` 직접 mock 또는 API layer mock
- store state는 가능한 최소 mock

### 완료 조건

- PlansPanel 핵심 플로우 테스트 존재
- Vitest 기반으로 안정적으로 통과

---

## Step 5. 채팅/브랜치/라운드테이블 UI 테스트

### 목표

실제 사용 흐름에서 중요한 패널 간 상호작용을 검증한다.

### 우선 대상

- `ChatPanel.tsx`
- `NewMessageInput.tsx`
- `BranchThreadPanel.tsx`
- `RoundtableView.tsx`

### 반드시 테스트할 시나리오

- conversation 선택 후 메시지 렌더
- branch stream 진입/종료
- branch 모드에서 UI 상태 반영
- roundtable progress 이벤트 이후 메시지 갱신
- cancel 동작 시 store 상태 정리

### 완료 조건

- branch 관련 회귀를 막는 컴포넌트 테스트 존재
- roundtable 진행 표시 최소 smoke test 존재

---

## Step 6. API Layer 테스트

### 목표

리팩토링 후 추가된 API wrapper가 command 이름/인자 shape 회귀를 막도록 한다.

### 우선 대상 파일

- `src/lib/api/plans.ts`
- `src/lib/api/artifacts.ts`
- `src/lib/api/memos.ts`

### 테스트 항목

- 올바른 command name 사용
- 인자 shape 검증
- null/undefined 처리

### 완료 조건

- wrapper별 최소 1~2개 테스트

---

## Step 7. E2E Smoke Test 도입

### 목표

실제 사용자 워크플로우를 최소 개수로 검증한다.

### 권장 도구

- Playwright

### 최소 시나리오 4개

#### 시나리오 1. Conversation 기본 흐름

- 프로젝트 선택
- conversation 생성
- 메시지 전송
- 응답 표시

#### 시나리오 2. Branch 흐름

- branch 생성
- branch stream 진입
- branch 상태 표시
- 다시 parent conversation 복귀

#### 시나리오 3. Plans 흐름

- plan 생성
- subtask 표시
- subtask 상태 변경

#### 시나리오 4. Roundtable 흐름

- roundtable 실행
- participant 메시지 표시
- roundtable archive 생성 확인 또는 메시지 persist 확인

### 중요한 원칙

- E2E는 적게
- flaky test 금지
- mock/stub 가능한 엔진이면 stub 우선

### 완료 조건

- 최소 3~4개의 smoke scenario 안정 통과

---

## Step 8. 커버리지 측정 도입

### 목표

이제부터 숫자도 관리하되, 현실적인 범위로 시작한다.

### 권장 기준

#### 1차 목표

- Rust 핵심 helper/DB 로직: 50%+
- 프론트 핵심 패널/API: 35%+

#### 2차 목표

- Rust 핵심 영역: 65%+
- 프론트 핵심 영역: 50%+

#### 최종 실무 목표

- `plans`, `migrations`, `context_pack`, `roundtable prompt/persist`, `tracing`:
  사실상 고위험 영역 70%+

### 주의

- 전체 프로젝트 총합 80%를 처음부터 목표로 두지 말 것
- 외부 CLI boundary 때문에 숫자만 올리는 테스트는 가치가 낮다

---

## Step 9. CI 통합

### 목표

PR/변경마다 최소 검증이 자동으로 돌도록 한다.

### 최소 CI 파이프라인

1. `npm install`
2. `cargo check`
3. `cargo test`
4. `npm run test`
5. `npm run build`

### 이후 확장

- Playwright smoke
- coverage report upload

### 완료 조건

- 로컬뿐 아니라 CI에서도 반복 가능

---

## 우선순위 높은 실제 테스트 목록

### Rust 최우선

1. `resolve_plan_conversation_id`
2. `build_plan_section`
3. migration 재실행 안전성
4. `build_context_summary`
5. trace row insert/export
6. eval run/result CRUD

### 프론트 최우선

1. `PlansPanel`
2. branch stream 관련 UI 상태
3. Context panel 분기
4. API wrapper payload shape

### E2E 최우선

1. conversation → send
2. branch open → branch chat
3. plan create → subtask update
4. roundtable run

---

## 커버리지 운영 원칙

### 좋은 커버리지

- 핵심 로직 회귀를 막는다
- branch/plan/migration/trace 같은 비싼 버그를 조기에 잡는다
- 리팩토링 후 구조 변경에도 유지된다

### 나쁜 커버리지

- 단순 getter/setter만 테스트
- UI 문구만 과하게 검사
- 외부 CLI를 직접 쏴서 flaky하게 만듦
- 숫자만 높고 핵심 흐름은 비어 있음

---

## 단계별 완료 보고 형식

각 단계가 끝날 때 아래 형식으로 짧게 보고한다.

```md
## Test Step Report

- Step:
- Status: completed / partial / blocked
- Added:
- Covered:
- Verification:
- Remaining:
- Risks:
- Next:
```

예시:

```md
## Test Step Report

- Step: Step 2. Rust unit tests
- Status: completed
- Added: context_pack.rs test 8개, context_queries.rs test 3개
- Covered: plan lookup, branch canonical id, context summary
- Verification: cargo test 통과
- Remaining: migration integration tests
- Risks: external CLI path는 아직 미포함
- Next: Step 3 진행
```

---

## 최종 완료 기준

이 문서 기준으로 테스트 체계가 “도입 완료”로 간주되는 조건:

1. 프론트 테스트 러너 설치 완료
2. Rust unit/integration test 존재
3. Plans/Branch/Roundtable 최소 UI 테스트 존재
4. 3개 이상 E2E smoke test 존재
5. CI에서 테스트가 실행됨
6. 핵심 고위험 모듈에 대한 회귀 방어가 가능함

---

## 바로 시작할 추천 순서

지금 tunaFlow 상태에서 가장 현실적인 시작 순서는 다음이다.

1. Step 1. 프론트 테스트 기반 설치
2. Step 2. Rust unit test
3. Step 3. Rust DB 통합 test
4. Step 4. PlansPanel test
5. Step 7. 최소 E2E smoke

즉, 처음부터 UI 전체나 Playwright부터 가지 말고,
**Rust 핵심 로직 + PlansPanel + 최소 smoke** 순서로 가는 것이 가장 효율적이다.
