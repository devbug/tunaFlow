# plan 기반 Follow-up 고도화 방안

- 작성자: OpenAI Codex
- 작성 시각: 2026-03-26 08:41 KST
- 대상 프로젝트: `D:\privateProject\tunaFlow`

---

## 목적

현재 tunaFlow의 follow-up UX는 다음 source에서 동작한다.

- assistant message
- artifact

하지만 plan/subtask에서는 직접 다른 agent에게 넘기는 UX가 없다.

이 문서는 plan/subtask를 기준으로 follow-up handoff를 실행할 수 있게 만드는 방안을 정리한다.

---

## 현재 상태

이미 있는 것:

- `sendFollowup(...)` 실행 경로
- message 기준 forward
- artifact 기준 forward
- plan ownership 메타데이터
- ContextPack에 plan / findings / artifacts 포함

없는 것:

- subtask에서 바로 “Claude로 넘기기 / Codex로 구현 / Gemini로 검토” 같은 액션

---

## 목표

사용자가 plan/subtask를 보고 바로 다음 작업을 넘길 수 있게 한다.

예:

- `이 subtask를 Codex로 구현`
- `이 subtask를 Claude로 정리`
- `이 subtask를 Gemini로 검토`

즉, plan이 단순 표시판이 아니라
**실제 작업 분배 시작점**이 되게 한다.

---

## 권장 UX

### 최소형

SubtaskRow 또는 PlanCard 안에 아주 작은 action 추가

예:

- `→ Claude`
- `→ Codex`
- `→ Gemini`

또는

- `Send to Agent`

버튼 + 작은 메뉴

### 권장 이유

- 기존 Message / Artifact follow-up UX와 패턴을 맞출 수 있음
- 새로운 화면이 필요 없음

---

## handoff payload 권장 형태

subtask 기반 follow-up prompt는 아래 요소를 포함하면 충분하다.

- source type: `subtask`
- subtask title
- subtask details
- 현재 plan title
- expected outcome
- owner / last updated 정보가 있으면 짧게 포함

예시:

```text
[Follow-up: subtask]
Plan: login error cleanup
Subtask: unify token refresh error handling
Details: refresh race와 retry 흐름 정리
Owner: codex

위 subtask를 기준으로 작업해주세요.
```

ContextPack은 기존대로:

- active plan
- findings
- artifacts
- context summary

를 포함하므로, handoff prompt는 짧게만 붙여도 충분하다.

---

## 권장 구현 단계

### Phase A

- PlansPanel에 plan/subtask follow-up 액션 추가
- 기존 `sendFollowup(...)` 재사용

### Phase B

- `owner_agent`가 있으면 해당 engine을 기본 추천

예:

- owner가 `codex`면 `→ Codex`를 우선 노출

### Phase C

- 자연어 handoff와 연결
- 예: “이 subtask를 Codex로” 같은 해석과 연결

---

## 권장 구현 위치

프론트:

- `src/components/tunaflow/context-panel/PlansPanel.tsx`
- `src/stores/chatStore.ts`

필요 시:

- `src/types/index.ts`

백엔드:

- 별도 새 command 없이도 시작 가능
- follow-up은 기존 send 경로 재사용 가능

---

## 기대 효과

- plan이 실제 handoff 허브가 됨
- 사용자가 task 단위로 agent를 바꿔가며 작업시킬 수 있음
- ownership과 follow-up이 자연스럽게 연결됨

---

## 리스크

- subtask UI가 과하게 복잡해질 수 있음
- 너무 많은 엔진 버튼을 붙이면 panel이 지저분해질 수 있음
- message/artifact/plan 세 군데 UX 일관성 설계가 필요함

---

## 완료 기준

이 문서 기준 완료 상태:

1. subtask에서 직접 follow-up 실행 가능
2. 최소 2개 이상 엔진 선택 가능
3. 기존 message/artifact follow-up 패턴과 일관됨
4. plan 정보를 handoff prompt에 포함

---

## 결론

plan 기반 follow-up은 현재 tunaFlow 협업 모델에서 가장 자연스러운 다음 단계다.

이미 있는:

- plan
- ownership
- findings
- artifacts
- follow-up 실행 경로

를 연결만 하면 되기 때문에,
비용 대비 체감 효과가 크다.
