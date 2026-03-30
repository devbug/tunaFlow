# Live Runtime Trace Parity Validation Plan

상태: 중요 / P1
작성: 2026-03-30

## 배경

Claude parity fix 이후 코드 레벨에서는 다음이 확인되었다.

- 4개 엔진이 동일한 `build_normalized_prompt_with_budget`를 호출
- retrieval / compressed memory / auto mode / budget override가 engine-agnostic
- trace metadata 기록도 `insert_trace_log_with_context`로 통일

즉 구조상 parity는 성립했다.

하지만 아직 남은 검증은:

- 실제 앱 실행 중
- 실제 trace surface에서
- 엔진별로 기대한 섹션과 mode가 보이는지

를 확인하는 것이다.

## 목표

`tauri dev` 기준 실제 runtime에서:

- Claude
- Codex
- Gemini
- OpenCode

의 ContextPack parity를 spot-check한다.

핵심은 “코드가 같아 보인다”가 아니라,
“실행 trace/meta도 기대대로 나온다”를 확인하는 것이다.

## 검증 대상

### 1. Trace surface parity

확인할 것:

- `context_mode`
- active/skipped sections
- chars
- top budget consumers

가 4개 엔진에서 같은 정책으로 보이는가

### 2. Auto mode runtime behavior

확인할 것:

- 짧은 prompt → Lite 또는 Standard
- 구조화된 작업 prompt → Standard 또는 Full
- trace reason이 실제 기대와 맞는가

### 3. Budget override reflection

확인할 것:

- Runtime Settings에서 mode/cap 변경 후
- trace/meta에 실제 반영되는가

### 4. Retrieval / compressed memory 실제 주입

확인할 것:

- 관련 조건이 맞을 때 retrieval이 실제 trace section에 보이는가
- compressed-memory가 생성 후 실제 active layer로 보이는가

## 검증 시나리오

### A. 동일 prompt cross-engine 비교

같은 프로젝트/같은 대화에서:

- Claude
- Codex
- Gemini
- OpenCode

로 같은 입력을 보내고 trace를 비교한다.

### B. Auto mode 짧은 prompt / 긴 prompt 비교

- `응`
- `현재 memory policy를 요약하고 다음 단계 제안해줘`

같은 대비되는 입력으로 mode 전환을 본다.

### C. Budget override

- Auto → Full
- cap 60k → 20k

같은 변경 후 trace를 비교한다.

## 이번 단계에서 하지 않을 것

- 새 기능 구현
- threshold 재조정
- vector retrieval
- RT preset
- startup UX

## 성공 기준

- 4개 엔진에서 trace/meta parity가 실제 surface에서도 확인된다
- Auto mode와 budget override가 실제 runtime에 반영된다
- retrieval / compressed memory가 조건 충족 시 실제로 나타난다
- 코드 레벨 parity와 runtime parity가 서로 모순되지 않는다

## 후속

이 검증이 통과하면:

1. runtime feature validation 라운드를 계속 진행
2. 이후 남은 문제는 parity가 아니라 품질/UX/운영 이슈로 본다
