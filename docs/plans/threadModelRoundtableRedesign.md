# tunaFlow Thread Model / Roundtable 리디자인 설계

- 작성자: OpenAI Codex
- 작성 시각: 2026-03-26 09:03 KST

## 목적

현재 `tunaFlow`의 Roundtable은 대화와 같은 레벨의 별도 기능처럼 보인다. 하지만 실제 사용 흐름을 보면 Roundtable은 다음 두 요구를 모두 만족해야 한다.

1. 아무 대화가 없어도 바로 시작할 수 있어야 한다.
2. 기존 대화에서 파생된 분기 문맥으로도 시작할 수 있어야 한다.

즉 Roundtable은 단순히 `Conversation`과 같은 레벨의 독립 기능도 아니고, `Branch`로만 취급해도 부족하다. 더 자연스러운 모델은 `chat`과 `roundtable`을 같은 축의 **thread type**으로 보고, branch는 thread 간의 부모-자식 관계로 다루는 방식이다.

## 현재 문제

지금 구조 감각은 대략 아래처럼 보인다.

- Conversation
- Branch
- Roundtable

이 상태에서는 다음이 어색해진다.

- 대화가 없는 상태에서 바로 RT를 시작하는 흐름
- 기존 대화 중 일부만 RT로 분기하는 흐름
- RT 결과를 branch 결과물처럼 다시 메인으로 가져오는 흐름
- plan / artifact / memo / findings / follow-up 과의 연결

## 현재 코드베이스 호환성 분석

실제 코드 기준으로 보면, 현재 `tunaFlow`는 이미 `conversation / branch / roundtable`이 서로 강하게 얽혀 있다.

### 1. Conversation은 이미 `mode`를 가짐

스키마:
- `conversations.mode = "chat" | "roundtable"`

즉 Roundtable은 완전히 별도 테이블이 아니라, 이미 conversation-level mode로 부분 통합되어 있다.

관련 파일:
- `src-tauri/src/db/schema.rs`
- `src-tauri/src/db/models.rs`
- `src-tauri/src/commands/conversations.rs`
- `src/components/tunaflow/Sidebar.tsx`
- `src/components/tunaflow/ChatPanel.tsx`

### 2. Branch는 독립 테이블이지만, 실제 메시지는 shadow conversation에 저장됨

현재 branch는:
- `branches` 테이블에 메타를 저장하고
- 실제 branch 대화는 `conversation_id = "branch:{branchId}"` 형식의 shadow conversation에 저장한다

즉 현재 branch는 이미 "대화 thread 비슷한 것"으로 동작한다.

관련 파일:
- `src-tauri/src/commands/branches.rs`
  - `open_branch_stream()`
  - `delete_branch()`
- `src/stores/chatStore.ts`
  - `openBranchStream()`
  - `openThread()`
  - `sendThreadMessage()`

이 구조 때문에 `branch`는 단순 메타가 아니라, 사실상 `thread handle + metadata` 역할을 하고 있다.

### 3. Roundtable은 별도 run 엔티티 없이 현재 conversation에서 직접 실행됨

현재 roundtable은:
- `roundtable_run()`
- `roundtable_followup()`
가 현재 conversation에 직접 system/user/assistant 메시지를 쌓는다

즉:
- RT 전용 `thread`나 `run` 루트가 아직 없다
- conversation mode가 `roundtable`이면 `ChatPanel`이 `RoundtableView`를 보여주는 방식이다

관련 파일:
- `src-tauri/src/commands/roundtable.rs`
- `src/components/tunaflow/ChatPanel.tsx`
- `src/components/tunaflow/RoundtableView.tsx`

### 4. UI는 이미 "새 Chat / 새 RT"를 Conversation 레벨에서 생성한다

현재 Sidebar는 프로젝트 아래에:
- `New` = `mode: chat`
- `RT` = `mode: roundtable`

를 바로 만든다.

즉 "대화가 없어도 바로 RT 시작"은 이미 만족한다.
반면 "기존 대화에서 RT로 분기"는 아직 없다.

### 5. 가장 큰 구조적 제약은 branch와 RT의 저장 위치가 다르다는 점

- chat branch: shadow conversation `branch:{id}` 사용
- roundtable: 현재 선택된 conversation에 직접 메시지 적재

이 차이 때문에:
- branch를 RT로 만들려면 어디에 메시지를 저장할지부터 정해야 한다
- 기존 RT를 branch처럼 다루려면 현재 conversation mode 기반 UI도 손봐야 한다

## 호환성 판단

위 분석 기준으로 보면, 이 문서에서 처음 제안한 "thread 전면 일반화"를 바로 구현하는 것은 아직 위험하다.

이유:
- `conversations.mode`
- `branches + shadow conversations`
- `roundtable_run`의 직접 적재 방식
- `ChatPanel` / `RoundtableView` 분기
가 이미 현재 UX를 떠받치고 있기 때문이다.

즉 지금은 새 `thread` 엔티티를 바로 만드는 것보다, 현재 구조 위에서 **해석을 정리하는 1차 리디자인**이 맞다.

## 현실적인 1차 리디자인 범위

### 포함할 것

1. `Branch`에도 실행 모드 개념을 도입할 수 있는지 검토
   - 예: `chat` / `roundtable`
2. 기존 대화에서 `RT로 분기` UX를 추가
3. RT branch는 우선 shadow conversation 위에서 동작하게 해석
4. 기존 독립 RT 시작 (`mode = roundtable` conversation)은 유지

### 이번 단계에서 하지 않을 것

1. 새 `thread` 테이블 도입
2. roundtable run/history를 별도 엔티티로 완전 분리
3. branch와 conversation을 하나의 물리 모델로 통합

## 1차 리디자인 권장 순서

### Phase A. 호환성 보존형 UX 확장

- 기존 chat conversation → `RT로 분기` 액션 추가
- branch 생성 후 shadow conversation을 RT 모드로 여는 방식 검토
- 독립 RT 생성은 그대로 유지

### Phase B. Branch mode/type 도입

- `branches`에 `mode` 또는 `thread_type` 같은 필드 추가
- 기본값 `chat`
- RT branch는 `roundtable`

### Phase C. 실행 경로 정리

- RT branch일 때 `roundtable_run`이 shadow conversation을 대상으로 실행되도록 연결
- `RoundtableView` / `ChatPanel`이 branch conversation에서도 mode 기반으로 동일하게 동작하게 함

### Phase D. 장기 일반화

- 필요하면 그때 `thread` 일반화 검토

## 지금 바로 구현 프롬프트를 쓰기 전에 확인할 것

1. RT branch의 메시지를 어디에 저장할지
   - 가장 안전한 선택은 기존 shadow conversation 재사용
2. branch mode를 DB 필드로 둘지, shadow conversation mode를 source of truth로 둘지
3. 기존 `Sidebar`의 독립 RT 생성 UX를 유지할지
   - 현재는 유지하는 편이 맞다

## 현재 결론

현재 `tunaFlow`는 이미:
- conversation-level RT
- branch-level shadow conversation
두 모델이 공존한다.

따라서 바로 "thread 모델 전면 교체"로 가기보다,
**기존 branch를 RT capable하게 확장하는 방식**이 현실적인 첫 단계다.

## 제안 모델

### 핵심 개념

- `Conversation`
  - 하나의 작업 묶음
  - 프로젝트/장기 작업의 상위 단위
- `Thread`
  - 실제 대화/토론이 일어나는 작업 단위
  - 타입:
    - `chat`
    - `roundtable`
  - 시작 방식:
    - 독립 생성
    - 기존 thread에서 분기 생성

즉:

- Roundtable은 `thread.type = roundtable`
- 일반 대화는 `thread.type = chat`
- branch는 `parent_thread_id`가 있는 thread

### 관계 구조

- parent가 없으면:
  - conversation 안의 독립 시작 thread
- parent가 있으면:
  - 기존 thread에서 파생된 branch

이렇게 되면 아래 둘 다 자연스럽다.

1. 새 Roundtable 시작
2. 기존 chat thread에서 Roundtable branch 생성

## UX 목표

### 시작 방식

사용자는 다음 네 가지를 할 수 있어야 한다.

1. 새 일반 대화 시작
2. 새 Roundtable 시작
3. 기존 대화에서 일반 branch 생성
4. 기존 대화에서 Roundtable branch 생성

### UI 감각

중요한 건 `RT 만들기`가 별도 특수 기능처럼 보이지 않는 것이다.

대신 다음처럼 보여야 한다.

- `새 스레드`
  - `일반 대화`
  - `라운드테이블`
- 기존 thread에서
  - `분기`
  - `라운드테이블로 분기`

즉, 사용자가 느끼기엔 “작업 단위를 새로 만들거나 분기하는 것”이고, Roundtable은 그 thread의 한 타입이다.

## 데이터 모델 방향

### 권장 방향

현재 구조를 한 번에 뒤집지 말고, 개념적으로는 아래 방향으로 간다.

- `conversation`
  - 상위 묶음
- `thread`
  - `id`
  - `conversation_id`
  - `parent_thread_id` nullable
  - `type` = `chat` | `roundtable`
  - `title`
  - `created_at`
  - `updated_at`
- `thread_messages`
  - 가능하면 기존 message 테이블을 최대한 재사용
- `roundtable_runs`
  - thread_id FK
  - participants
  - rounds
  - config/state

### 점진적 해석

현재 `Branch`가 이미 있다면, 바로 새 테이블을 만들기보다 먼저 다음 식의 해석 레이어로 시작할 수 있다.

- 기존 `branch` = `thread`의 1차 구현
- `branch.mode` 또는 `branch.type` 추가
  - `chat`
  - `roundtable`

이 방식이면:

- 지금 코드베이스를 덜 흔들고
- UX는 먼저 바꿀 수 있다
- 이후 필요할 때 `thread` 개념으로 일반화할 수 있다

## 권장 구현 단계

### Phase 1. UX 모델 정리

- RT를 별도 최상위 진입점으로만 두지 않는다
- 기존 대화에서 `RT로 분기` 액션 추가
- 새로 시작 시 `새 라운드테이블`도 허용
- 내부적으로는 기존 branch + RT 실행을 재사용

### Phase 2. branch/type 도입

- 기존 branch에 `type` 또는 `mode` 개념 추가
- `chat branch`
- `roundtable branch`
- UI에서 이 차이를 표시

### Phase 3. thread 모델 정리

- 필요하면 branch와 독립 RT 시작을 공통 thread 모델로 통합
- 이 단계는 후순위

## 현재 코드베이스에 맞는 현실적 접근

지금 `tunaFlow`는 이미 다음을 갖고 있다.

- branch 전용 대화 스트림
- roundtable 실행/추적
- shared brief / findings / artifact handoff
- plan / ownership / follow-up

따라서 가장 현실적인 리디자인은:

1. **당장은 branch에 RT mode를 얹는다**
2. 동시에 **conversation에서 독립 RT 시작도 허용한다**
3. 데이터 모델은 급하게 전면 교체하지 않는다

즉, 개념적으로는 thread 모델을 목표로 삼되, 구현은 branch 확장부터 시작하는 방식이 맞다.

## UX 예시

### 예시 1. 바로 RT 시작

- 사용자가 새 작업 시작
- `새 라운드테이블` 선택
- participants 설정
- 빈 독립 RT thread 생성
- 바로 토론 시작

### 예시 2. 대화에서 RT 분기

- 일반 대화 중 특정 쟁점 등장
- `라운드테이블로 분기`
- 현재 대화 문맥을 가져와 RT thread 생성
- 토론 후 shared brief 생성
- 메인 대화에 다시 반영

### 예시 3. RT 후 일반 대화로 이어가기

- RT thread에서 결론 도출
- 같은 thread 안에서 후속 대화를 일반 chat처럼 이어가거나
- 결과를 parent thread에 handoff

## 판단

Roundtable을 Conversation과 같은 레벨의 별도 기능으로 유지하는 것보다, `chat`과 `roundtable`을 같은 축의 thread type으로 재정의하는 편이 UX와 작업 흐름에 더 자연스럽다.

다만 구현은 한 번에 thread 전면 재설계로 가지 말고:

- branch 확장
- 독립 RT 시작 허용
- 후속 thread 일반화

순으로 가는 것이 안전하다.

---

## 실행 프롬프트

아래 프롬프트를 그대로 사용하면, 이 설계를 검토한 뒤 실제 코드 기준으로 리디자인 작업을 진행할 수 있다.

```md
# tunaFlow Roundtable / Branch / Thread 모델 리디자인

프로젝트:
- `D:\privateProject\tunaFlow`

참고 문서:
- `D:\privateProject\tunaFlow\docs\plans\threadModelRoundtableRedesign.md`

이번 작업 목표는:
현재 `tunaFlow`에서 Roundtable이 conversation과 별도 최상위 기능처럼 보이는 UX를 정리하고,
다음 요구를 만족하는 방향으로 리디자인하는 것이다.

요구:
1. 아무 대화 없이도 바로 Roundtable 시작 가능
2. 기존 대화에서 Roundtable로 분기 가능
3. 일반 branch와 Roundtable branch를 같은 작업 단위 축에서 다룰 수 있어야 함

중요:
- 추측 금지
- 실제 코드 기준으로만 작업
- 기존 구조를 한 번에 전면 재설계하지 말 것
- 우선은 점진적 리디자인 방향으로 구현할 것
- 기존 data/DB를 최대한 존중할 것

중요:
- 이번 단계에서는 새 `thread` 테이블을 만들지 말 것
- 우선 기존 `branches + shadow conversation + conversations.mode` 위에서 1차 리디자인만 진행할 것

## 먼저 확인할 파일

### 백엔드
- `D:\privateProject\tunaFlow\src-tauri\src\commands\roundtable.rs`
- `D:\privateProject\tunaFlow\src-tauri\src\commands\branches.rs`
- `D:\privateProject\tunaFlow\src-tauri\src\commands\conversations.rs`
- `D:\privateProject\tunaFlow\src-tauri\src\db\schema.rs`
- `D:\privateProject\tunaFlow\src-tauri\src\db\models.rs`

### 프론트
- `D:\privateProject\tunaFlow\src\components\tunaflow\Sidebar.tsx`
- `D:\privateProject\tunaFlow\src\components\tunaflow\ChatPanel.tsx`
- `D:\privateProject\tunaFlow\src\components\tunaflow\BranchesPanel.tsx`
- `D:\privateProject\tunaFlow\src\stores\chatStore.ts`

## 구현 원칙

### 1. 목표 모델
개념적으로는:
- `chat`
- `roundtable`
를 같은 축의 thread type처럼 다루는 방향을 목표로 삼는다.

하지만 이번 단계에서는 실제 구현을 아래 범위로 제한하라.
- 기존 branch 구조를 재사용
- branch가 `roundtable`로도 동작할 수 있게 확장
- 독립 RT conversation 생성 흐름은 유지

### 2. 저장 모델
우선 RT branch의 실제 메시지는 기존 shadow conversation에 저장하는 방향을 우선 검토하라.
즉:
- branch 메타는 `branches`
- branch 대화는 `branch:{branchId}` conversation

이 구조를 깨지 않는 범위에서 RT 분기 UX를 추가하라.

### 2. 이번 단계 목표
최소한 아래 중 현실적으로 가능한 범위까지 구현하라.

- 기존 대화에서 `RT로 분기` 가능한 진입점
- 새로 바로 `RT 시작` 가능한 진입점
- 일반 branch와 RT branch를 UI에서 구분 가능
- RT 결과가 branch 문맥 아래에서 이해되도록 연결

### 3. 데이터 모델
기존 DB를 크게 깨지 말 것.
필요하면 최소한의 mode/type 필드 또는 해석 레이어만 추가하라.

### 4. UX
별도 “RT 전용 특수 기능”처럼 보이게 하지 말 것.
사용자에게는:
- 새 대화
- 새 라운드테이블
- 브랜치 생성
- RT로 분기
정도로 보이면 충분하다.

## 하지 말 것

- thread 전면 재구현
- 기존 message 구조 전체 교체
- 대규모 라우팅/UI 재설계
- plan/artifact 시스템까지 같이 뒤집기

## 검증

작업 후 반드시 아래를 해라.

1. 어떤 모델로 정리했는지 설명
2. branch와 roundtable의 관계를 어떻게 재해석했는지 설명
3. 새로 가능한 UX 흐름을 설명
4. 어떤 파일을 수정했는지 정리
5. 타입체크/빌드/가능한 검증 수행
6. 남은 리스크 적기

## 출력 형식

### A. Changes Made
### B. Files Modified
### C. UX Model
### D. Verification
### E. Remaining Risks

모든 응답과 보고는 한국어로만 작성하라.
바로 코드 수정까지 진행하라.
```
