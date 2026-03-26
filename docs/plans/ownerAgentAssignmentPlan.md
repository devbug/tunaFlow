# owner_agent 설정 경로 고도화 방안

- 작성자: OpenAI Codex
- 작성 시각: 2026-03-26 08:41 KST
- 대상 프로젝트: `D:\privateProject\tunaFlow`

---

## 목적

현재 tunaFlow는 `plan_subtasks.owner_agent`와 `plan_subtasks.last_updated_by`를 갖고 있다.

하지만 실제 사용 흐름에서는:

- `last_updated_by`는 갱신됨
- `owner_agent`는 거의 설정되지 않음

즉, ownership 개념은 스키마와 UI에 일부 존재하지만,
아직 **실제 할당 경로**가 완성되지 않았다.

이 문서는 `owner_agent`를 실제로 설정할 수 있게 만드는 최소 고도화 방안을 정리한다.

---

## 현재 상태

확인된 구현 상태:

- DB 컬럼 존재
- model 필드 존재
- PlansPanel에서 `owner_agent` 표시 가능
- 일반 사용자 흐름에서 `owner_agent`를 설정하는 명시적 UI/command는 없음

즉 현재 ownership은
“담당자(assign)”라기보다 “표시 가능한 빈 슬롯”에 가깝다.

---

## 목표

subtask 단위로 아래가 가능하게 한다.

- 어떤 agent가 이 subtask를 담당하는지 설정
- 현재 ownership을 UI에서 확인
- 필요하면 ownership을 변경 또는 해제

예:

- `Subtask A → Codex`
- `Subtask B → Claude`
- `Subtask C → Gemini`

---

## 권장 구현 범위

### 1. 최소 backend 추가

가장 작은 경로로는 아래 중 하나면 충분하다.

- `update_subtask_owner`
- 또는 기존 `update_subtask_status`와 분리된 작은 command

권장:

- ownership 변경은 status 변경과 분리
- 이유: 의미가 다르고, UI 동작도 다름

예상 입력:

- `id`
- `owner_agent` (`claude`, `codex`, `gemini`, `opencode`, `null`)

### 2. 최소 UI 추가

PlansPanel의 subtask 영역에 아주 작은 owner selector를 둔다.

권장 형태:

- `owner: none / claude / codex / gemini`
- badge 클릭 순환
- 또는 작은 dropdown

중요:

- planner를 크게 만들지 말 것
- status 버튼 옆에 과한 컨트롤을 붙이지 말 것

### 3. 표시 규칙

- owner가 있으면 `owner: codex`
- 없으면 표시하지 않거나 `owner: none`
- `last_updated_by`는 그대로 유지

즉:

- `owner_agent` = 담당
- `last_updated_by` = 마지막 변경자

역할을 명확히 분리한다.

---

## 구현 단계

### Phase A

- backend command 추가
- UI에서 읽기 전용 표시 유지
- 수동 API 호출로 ownership 설정 가능

### Phase B

- PlansPanel에 작은 ownership 변경 UI 추가

### Phase C

- follow-up / routing과 ownership 연결
- 예: `owner_agent = codex`면 follow-up 기본 추천값으로 사용

---

## 권장 구현 위치

백엔드:

- `src-tauri/src/commands/plans.rs`

프론트:

- `src/components/tunaflow/context-panel/PlansPanel.tsx`
- 필요 시 `src/lib/api/plans.ts`

---

## 기대 효과

- plan이 실제 작업 분배 보드처럼 동작
- “누가 맡았는지”가 구조적으로 남음
- 향후 plan 기반 follow-up과 자연스럽게 연결 가능

---

## 리스크

- ownership UI가 과하면 panel이 복잡해질 수 있음
- 지원 engine 목록을 어디까지 열지 결정 필요
- 사용자가 ownership과 last_updated_by를 혼동할 수 있음

---

## 완료 기준

이 문서 기준으로 완료로 보는 상태:

1. subtask의 `owner_agent`를 실제로 설정 가능
2. PlansPanel에서 owner를 확인 가능
3. ownership 변경이 기존 status 흐름을 깨지 않음
4. `last_updated_by`와 의미가 구분됨

---

## 결론

`owner_agent`는 이미 구조는 깔려 있고,
지금 필요한 것은 아주 작은 **설정 경로**뿐이다.

즉 이 작업은 큰 기능 추가가 아니라,
현재 plan collaboration 모델을 완성하는 마지막 연결 작업에 가깝다.
