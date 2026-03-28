# tunaFlow Resume / Continuation 4-Engine Parity 계획

- 작성자: OpenAI Codex
- 작성 시각: 2026-03-29
- 상태: 제안

## 현재 차이

- Claude: native resume token 존재
- Codex/Gemini/OpenCode: native resume 개념이 없거나 미사용

그래서 같은 conversation이라도 엔진을 바꾸면 연속성 경험이 달라진다.

## 목표

resume parity는 "같은 API"가 아니라 "같은 사용자 경험"으로 정의한다.

즉 사용자는:

1. 이전 대화 맥락을 이어서 보낼 수 있고
2. 앱 재시작 후에도 continuation이 유지되며
3. 엔진별로 대화가 끊겼다고 느끼지 않아야 한다

## parity 기준

### Claude

- native resume token 유지

### Codex/Gemini/OpenCode

- synthetic continuation layer 도입
- recent turns replay
- parent anchor
- stable context summary

## 단계

### Phase 1. continuation contract 정의

- native token이 있으면 사용
- 없으면 synthetic continuation 사용
- frontend는 둘을 같은 "resume supported" 경험으로 다룸

### Phase 2. non-Claude continuation 구현

- replay window
- summarized carry-over
- branch/thread anchor 재사용

### Phase 3. 상태 표시 정리

- "resume token 없음"을 단순 미지원으로 둘지
- "continuation supported via synthetic mode"로 재정의할지 정리

## 검증

1. 앱 재시작 후 4개 엔진 모두 대화 연속성 유지
2. branch follow-up에서 parent context 손실이 줄어듦
3. 문서와 UI가 native/synthetic 차이를 숨기지 않으면서도 UX는 동등

