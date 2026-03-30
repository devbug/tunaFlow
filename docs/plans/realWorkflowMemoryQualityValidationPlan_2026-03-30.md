# Real Workflow Memory Quality Validation Plan

상태: 중요 / P1
작성: 2026-03-30

## 배경

이제 다음은 코드/trace 레벨 검증이 아니라,
실제 작업 흐름에서 memory 계층이 품질에 도움이 되는지 보는 단계다.

이미 확인된 것:

- 4-engine ContextPack parity
- trace/meta parity
- memory policy surface
- auto mode 표시/약어/색상/skip 가시화

즉 “무엇이 들어갔는가”는 보인다.
이제 확인해야 할 것은 “그 결과 실제 응답 품질이 좋아졌는가”다.

## 목표

실제 프로젝트 기반 시나리오에서:

- compressed memory
- retrieval
- auto mode
- budget override

가 응답 품질과 continuity에 어떤 영향을 주는지 검증한다.

## 이번 검증 대상

### 1. Compressed Memory 품질

확인할 것:

- 긴 대화 이후 이전 결정/맥락을 제대로 유지하는가
- recent window 밖 정보가 실제로 보존되는가
- 요약이 너무 뭉개지거나 잘못된 사실을 만들지 않는가

### 2. Retrieval 품질

확인할 것:

- 다른 대화의 관련 Q&A/anchor/brief를 실제로 도움 되는 형태로 가져오는가
- 관련 없는 chunk가 noise로 끼어들지 않는가
- structured memory와 중복될 때 retrieval이 적절히 약해지는가

### 3. Auto Mode 판단 품질

확인할 것:

- 짧은 follow-up에 Lite가 실제로 적절한가
- 구조화된 작업 지시에서 Full 또는 Standard가 적절한가
- Auto가 “표시만 바뀌고 실제 품질 차이는 없는” 상태가 아닌가

### 4. Budget Override 체감 효과

확인할 것:

- 20k/60k/120k 수준에서 응답 품질과 비용 차이가 실감나는가
- 큰 budget이 항상 더 좋은 것이 아니라 noise를 늘리는 경우가 있는가

## 검증 시나리오

### A. Long chat continuity

- 한 주제를 길게 이어간 뒤
- 예전 결정/전제/열린 질문을 다시 물어본다

### B. Cross-conversation recall

- 같은 프로젝트 안에 관련 대화 2~3개를 만든 뒤
- 새 대화에서 과거 결정을 다시 끌어오게 한다

### C. Auto mode contrast

- 짧은 확인 질문
- 구조화된 구현 지시
- review/test 요청

를 각각 보내 mode와 결과를 비교한다.

### D. Budget contrast

- 같은 질문을 낮은 cap / 기본 cap / 높은 cap에서 비교한다.

## 이번 단계에서 하지 않을 것

- threshold 재조정부터 먼저 하지 않음
- 새 memory layer 추가
- vector/embedding 도입
- startup UX

## 성공 기준

- memory/retrieval/auto/budget이 실제 응답 품질에 의미 있는 차이를 만든다는 근거를 얻는다
- noise가 큰 케이스와 도움 되는 케이스를 구분한다
- 다음 조정이 필요하면 “어느 layer를 더 줄이거나 강화할지”가 명확해진다

## 후속

검증 결과에 따라:

1. memory quality tuning
2. retrieval threshold/weight 재조정
3. auto mode heuristic 보정

중 하나로 이어간다.
