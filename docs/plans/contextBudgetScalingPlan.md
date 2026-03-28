# tunaFlow Context Budget Scaling Plan

- 작성자: OpenAI Codex
- 작성 시각: 2026-03-28 22:20 KST
- 상태: 진행 예정

## 목적

현재 `tunaFlow`의 ContextPack guardrail은 총 `60,000 chars`이며,
프로젝트 내부 추정으로는 대략 `15k tokens` 전후를 상정하고 있다.

이 문서는 이를 즉시 대폭 확대하는 구현 계획이 아니라,
**베타 단계에서 엔진별/모드별로 점진적으로 context budget을 늘려보는 실험 계획**을 정리한 것이다.

중요:

- 현재 한도는 모델 한계가 아니라 앱 내부의 보수적 guardrail이다.
- 장기 agent 실행 구조(background worker + event + DB SSOT)가 먼저 안정화되어야 한다.
- budget 확장은 품질/속도/비용/노이즈를 같이 봐야 한다.

## 현재 상태

### 전체 guardrail

현재 `guardrail.rs` 기준:

- `MAX_TOTAL_PROMPT = 60_000`
- char 기반 추정: `~4 chars ≈ 1 token`
- 대략 `15k token` 전후로 운영 중

### 섹션별 상한

- skills: `8,000`
- rawq: `4,000`
- cross-session: `6,000`
- context summary: `8,000`
- plan: `2,000`
- findings: `3,000`
- artifacts: `2,000`

### 현재 리스크

현재 리스크는 “모델이 못 받는다”보다 아래에 가깝다.

1. 중요한 정보가 뒤쪽 섹션에서 잘릴 수 있음
2. 엔진별 실제 컨텍스트 허용량을 충분히 활용하지 못함
3. 긴 branch / RT / review 흐름에서 context recall이 일찍 부족해질 수 있음
4. 모든 엔진에 동일한 보수적 상한을 적용하고 있음

## 왜 지금 바로 크게 올리지 않는가

### 1. 실행 구조가 먼저 안정화되어야 함

현재 우선순위는 장기 agent 실행의 background/event 전환이다.
긴 프롬프트는:

- subprocess 실행 시간 증가
- 첫 응답 지연 증가
- 비용 증가
- UI 체감 악화

를 동반할 수 있으므로,
실행 구조가 안정화되기 전에 budget만 올리면 원인 분리가 어렵다.

### 2. 많이 넣는다고 항상 좋아지지 않음

`ContextPack`은 단순 저장소가 아니라 모델에게 주는 작업 문맥이다.
너무 많은 내용을 넣으면:

- 현재 질문과 무관한 잡음 증가
- 우선순위 혼선
- 답변 품질 하락

이 생길 수 있다.

즉 이 문제는 “최대치까지 채우기”보다 **어디까지 늘렸을 때 품질이 좋아지는가**의 실험 문제다.

## 권장 방향

### Phase 0 — 현재 유지

- `60,000 chars` 유지
- background agent execution 구조 먼저 안정화
- context traceability/visibility 보강 검토

### Phase 1 — 베타 상향 실험

목표:

- 내부/베타 사용자 대상으로 보수적 상향 테스트
- 예: `60k → 120k chars`

실험 포인트:

- 일반 chat
- branch
- RT follow-up
- review/test decision 흐름

관찰 항목:

- 첫 응답 지연
- 전체 완료 시간
- 답변 품질 체감
- truncation 발생 위치
- rawq / cross-session / plan section 포함률

### Phase 2 — 엔진별 budget 분리

공통 상한 하나 대신 engine-aware budget을 검토한다.

예시:

- Claude: 더 큰 budget 허용
- Gemini: 더 큰 budget 허용 가능성 검토
- Codex/OpenCode: 더 보수적 유지

중요:

- 실제 모델/CLI 제약과 응답 품질을 같이 봐야 함
- “1M 가능”과 “실사용에서 1M이 항상 유리”는 다름

### Phase 3 — 모드별 budget 분리

- Lite
- Standard
- Full
- RT
- Review/Test

처럼 사용 시나리오별 예산 분리를 검토한다.

예:

- Lite는 작게 유지
- Standard는 중간
- Full/RT/review는 더 크게

### Phase 4 — 섹션 우선순위 재조정

예산이 커져도 무조건 균등 분배할 필요는 없다.

검토 항목:

- rawq를 더 키울지
- cross-session을 줄일지
- findings/plan/artifacts 우선순위를 어떻게 둘지
- truncation을 tail-cut이 아니라 섹션별 우선순위 기반으로 할지

## 베타 실험 시 확인해야 할 것

### 필수 측정

- prompt 총 길이(chars)
- 추정 token 수
- section별 실제 포함 길이
- 어떤 섹션이 truncate 되었는지
- 응답 시작 시간
- 완료 시간
- 모델별 실패율

### 체감 품질 체크

- 이전 결정을 더 잘 기억하는가
- branch / RT / review에서 맥락 손실이 줄었는가
- 오히려 답변이 산만해지지 않는가

### 비용/성능 체크

- Claude/Gemini 지연 증가 폭
- Codex/OpenCode 품질 대비 지연
- 긴 prompt에서 streaming 시작 지연

## 구현 전에 필요한 보조 작업

### 1. ContextPack 추적성

`contextPackTraceabilityPlan`과 연결된다.

budget을 올리기 전에 아래가 보이면 좋다.

- context mode
- sections included
- system prompt length
- truncation 여부

### 2. 엔진별 측정 로그

- agent별 첫 응답 시간
- 전체 실행 시간
- prompt length correlation

### 3. 베타 플래그

권장:

- 설정 또는 feature flag로 상향 실험
- 전체 사용자 대상 일괄 적용 금지

## 현재 판단

### 결론

- `15k token` 수준은 1M 컨텍스트 시대 기준으로 넉넉하지 않다.
- 하지만 바로 크게 확장하는 것은 시기상조다.
- **베타 단계에서 2배~수배 수준으로 단계적으로 올려보며 측정하는 전략**이 가장 안전하다.

### 추천 순서

1. background execution 안정화
2. context traceability 보강
3. 베타에서 `60k → 120k` 수준 실험
4. 결과가 좋으면 engine-aware budget 검토
5. 그 다음 모드별/섹션별 예산 정교화
