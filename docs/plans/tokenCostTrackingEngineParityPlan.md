# tunaFlow Token/Cost Tracking 4-Engine Parity 계획

- 작성자: OpenAI Codex
- 작성 시각: 2026-03-29
- 상태: 제안

## 현재 차이

- Claude: usage 비교적 풍부
- Codex: usage 기록 존재
- Gemini: partial
- OpenCode: 없음

이 상태에서는 엔진별 운영 가시성이 맞지 않는다.

## 목표

최소한 다음 항목은 4개 엔진에 공통으로 남겨야 한다.

1. input tokens
2. output tokens
3. total cost 또는 cost unavailable reason
4. message/conversation 누적 usage

## 원칙

1. provider가 cost를 직접 주면 그대로 사용
2. provider가 안 주면 추정치 또는 unavailable 상태를 명확히 기록
3. "없음"과 "미구현"을 구분한다

## 단계

### Phase 1. 공통 usage model 정리

- exact / estimated / unavailable 상태 정의
- DB 및 frontend 표기 규칙 통일

### Phase 2. Gemini/OpenCode 보강

- Gemini partial를 exact/estimated로 명확히 표시
- OpenCode는 최소 unavailable reason부터 기록

### Phase 3. UI parity

- 엔진별 usage 배지/상세 표기를 같은 틀로 정리

## 검증

1. 4개 엔진 모두 usage record가 남음
2. exact/estimated/unavailable가 구분됨
3. conversation 누적 합산이 엔진별로 깨지지 않음

