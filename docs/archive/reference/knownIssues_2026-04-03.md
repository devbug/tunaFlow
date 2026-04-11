# Known Issues — 2026-04-03 (세션 7 종료 시점)

> 실사용 검증 6+ 풀사이클 + 장기기억 테스트에서 발견된 미해결 이슈

---

## P0: 동시 실행 시 이벤트 격리 문제

**현상**: 두 대화(메인+스크래치)를 동시에 에이전트 실행하면:
- 한쪽 대화에 다른 에이전트의 응답이 표시됨
- 메시지 헤더에 잘못된 엔진/모델이 표시됨
- chunk 이벤트가 conversationId 없이 messageId만으로 매칭 → 교차 오염

**원인**: `claude:chunk`, `codex:chunk` 등 스트리밍 이벤트가 `messageId`로만 필터링. 두 대화에서 동시에 에이전트가 실행되면 이벤트 리스너가 교차.

**영향**: 동시 에이전트 실행 시 응답 섞임, 엔진/모델 표시 오류

**수정 방향**:
- 이벤트 페이로드에 `conversationId` 포함 (backend 변경)
- 또는 이벤트 리스너에서 `messageId` → DB 조회로 conversationId 검증
- 또는 동시 실행 방지 (한 프로젝트에서 한 에이전트만)

**임시 대응**: 동시 에이전트 실행 자제. 한 대화의 응답을 기다린 후 다른 대화로 이동.

---

## P1: 채팅 전환 시 행 (macOS 무지개 아이콘)

**현상**: 에이전트 스트리밍 중 다른 채팅으로 이동하면 앱이 잠시 멈춤

**원인**:
1. `selectConversation`이 DB에서 messages/branches/memos/artifacts를 동기 로드 (100+ 메시지)
2. 에이전트 완료 후 백그라운드 작업(compress/index/refresh/rawq)이 Tauri 동기 command로 실행

**현재 완화**:
- 백그라운드 작업 stagger (0.5s → 1.5s → 3s → 5s 간격)
- 스트리밍 throttle (200ms)

**근본 수정**:
- compress/index/refresh를 async Tauri command + tokio::spawn_blocking으로 전환
- selectConversation의 DB 로드를 비동기 + pagination

---

## P1: 브라우저 콘솔 경고 (기능 영향 없음)

### `validateDOMNesting: <button> inside <button>`
- 위치: `ScratchpadSection.tsx:24`
- 수정: 내부 `<button>`을 `<div role="button">`으로 변경

### `planProposalParser schema validation failed` × 6
- 원인: 기존 메시지의 plan-proposal 마커가 zod 스키마 검증 실패 (description 빈 문자열, subtasks 빈 배열)
- 수정: parser에서 graceful fallback 이미 동작. 경고 레벨을 `console.debug`로 변경하거나, 빈 description/subtasks에 기본값 적용

### `rawq fs watcher unavailable`
- 원인: `@tauri-apps/plugin-fs` watch 기능 미설치
- 수정: 의존성 도입 또는 경고 제거 (rawq 인덱싱은 에이전트 완료 시에만 동작)

---

## P2: opencode 모델 불일치

**현상**: 설정은 `ollama/qwen3.5:9b`인데 채팅에 `opencode/big-pickle` 표시

**원인**: opencode CLI가 `--model ollama/qwen3.5:9b`를 전달받아도 내부적으로 다른 모델명을 사용하거나, 응답에 실제 모델명(`big-pickle`)을 반환

**영향**: 표시 문제만. 실제 사용 모델은 opencode 내부 설정에 따름.

**수정 방향**: opencode CLI의 모델 전달/반환 동작 확인 필요

---

## P2: 한국어 파일명 기존 문서 마이그레이션

**현상**: slugify 변경 전 생성된 Plan 문서가 한국어 파일명으로 남아있음

**영향**: URL 인코딩 깨짐, CLI 사용 불편

**수정**: 기존 `docs/plans/분석-*.md` → 영문 slug로 rename + DB plan 참조 업데이트

---

## 참고: 해결된 주요 이슈 (세션 7)

| 이슈 | 해결 |
|------|------|
| 모델이 haiku로 리셋 | resolveModel() — 프로필에서 직접 읽기 |
| Virtuoso 무한 루프 3건 | ref 안정화, Footer 분리, elapsed interval |
| FTS5 검색 0 결과 | 따옴표 strip |
| rawq 94초 타임아웃 | --no-reindex |
| Mutex poison | 3-phase lock |
| verdict 감지 실패 | fallback parser |
| 마커 노출 | vizMarkers 전면 개편 |
| HarnessSummary 미갱신 | refreshKey |
