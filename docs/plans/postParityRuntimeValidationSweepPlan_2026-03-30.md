# Post-Parity Runtime Validation Sweep Plan

상태: 중요 / P1
작성: 2026-03-30

## 배경

방금 수정으로 Claude 경로가 레거시 수동 context 조립을 벗어나,
다른 엔진과 동일한 `build_normalized_prompt_with_budget` 통합 파이프라인을 사용하게 되었다.

이 변경으로:

- compressed memory
- conversation retrieval
- auto mode
- budget control override
- skills / rawq / cross-session

이 Claude에서도 실제로 반영되기 시작했다.

즉 이전까지의 일부 검증 결과는
“기능 자체 문제”가 아니라
“Claude 경로만 통합 파이프라인을 안 타던 구조적 문제”의 영향을 받았을 가능성이 높다.

## 목표

파이프라인 parity 수정 이후,
핵심 runtime 기능을 다시 짧고 명확하게 재검증한다.

이번 라운드는 새 기능 개발이 아니라:

- parity fix가 실제로 효과를 냈는지
- Claude와 다른 엔진의 체감/trace 차이가 줄었는지

를 확인하는 회귀 검증이다.

## 우선 검증 대상

### 1. Claude ContextPack parity

확인할 것:

- Claude send / stream 경로 모두 통합 ContextPack을 타는가
- trace의 section / chars / skipped / top consumers가 다른 엔진과 같은 규칙으로 보이는가

### 2. Compressed Memory

확인할 것:

- Claude 요청에서도 compressed-memory가 실제 주입되는가
- budget tight 시 skip 규칙이 정상 동작하는가

### 3. Retrieval

확인할 것:

- Claude에서도 retrieval chunk가 실제 주입되는가
- recent/structured와 overlap suppression이 동일하게 동작하는가

### 4. Auto Mode / Budget Override

확인할 것:

- Claude가 Auto score 기반으로 Lite/Standard/Full을 바꾸는가
- Runtime Settings override가 Claude에도 동일하게 반영되는가

### 5. Cross-engine spot check

동일하거나 유사한 입력으로:

- Claude
- Codex
- Gemini
- OpenCode

를 짧게 비교해,
trace/meta 기준 parity가 유지되는지 확인한다.

## 이번 단계에서 하지 않을 것

- 새 memory layer 추가
- threshold 재조정
- startup UX
- RT preset
- context-hub 고급 통합

## 검증 방식

### A. 실제 실행 기준

코드 추적만 하지 않고:

- 실제 send
- 실제 stream
- TracePanel / RuntimeStatusBar

를 같이 본다.

### B. Claude 우선 재검증

이번 수정의 핵심이 Claude 경로였으므로,
Claude를 먼저 확인한다.

### C. 최소 교차 검증

모든 엔진을 깊게 다 보는 대신,
같은 입력에 대해 trace/meta parity를 짧게 비교한다.

## 성공 기준

- Claude가 더 이상 레거시 context 조립 경로를 타지 않는다
- compressed memory / retrieval / auto mode / budget override가 Claude에서도 확인된다
- 4-engine trace/meta parity가 다시 성립한다
- 새로 발견되는 regressions가 없거나, 발견 시 즉시 수정된다

## 후속

이 라운드가 통과하면:

1. 기존 runtime validation plan을 계속 진행
2. 실제 사용 시나리오 기반 품질 검증으로 넘어간다

즉 이번 단계는 “parity fix 이후 재검증”에 해당한다.
