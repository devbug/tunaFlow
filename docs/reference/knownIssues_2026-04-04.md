# Known Issues — 2026-04-04 (세션 9 종료 시점)

> 세션 8-9에서 발견/수정된 이슈 정리

---

## ✅ 해결됨 (세션 8-9)

| 이슈 | 해결 |
|------|------|
| 동시 실행 이벤트 교차 오염 | ChunkPayload에 conversationId 추가 + 리스너 필터링 |
| 채팅 전환 시 행 (동기 command) | compress/refresh/index → async + spawn_blocking |
| 콘솔 경고 3종 | button nesting, parser validation, fs watcher |
| RT tokio panic | RT command 4개 pub fn → pub async fn |
| RT 라운드 번호 이중 가산 | next_round_number() + 1 제거 |
| Participant Status 모든 RT에 표시 | rtStatusConversationId로 스코핑 |
| RT 이벤트 중복 수신 | roundtable:progress message ID dedup |
| 스트리밍 stuck (race condition) | pendingChunk=null before cleanup + atomic set |
| Virtuoso re-render 안 됨 | messagesRef → context prop |
| Trace duration 음수 | ms vs s 단위 통일 |
| Persona "Tester · Tester" 중복 | profile.label === persona.name 체크 |

---

## P1: RT INTENT 표시 오류

**현상**: Round 2의 INTENT에 다른 Scratchpad에서 보낸 프롬프트가 나타남.

**추정 원인**: 이전 세션 버그(이벤트 중복, 메시지 교차)로 오염된 DB 데이터. 새 RT에서 재현 확인 필요.

**수정 방향**: 새 RT에서 재현되면 `roundTopics` 매핑 로직 재점검.

---

## P1: RT에서 ollama 단독 라운드 사라짐

**현상**: ollama 혼자 참가한 Round가 UI에서 통째로 누락.

**추정 원인**: trace_log LEFT JOIN에서 중복 행 발생 → message 중복 → groupIntoRounds 깨짐. GROUP BY subquery로 dedup 적용했으나 재검증 필요.

**수정 방향**: 새 RT에서 재현 확인. 재현되면 trace_log.message_id 중복 여부 DB 직접 조회.

---

## P1: RT 전용 페르소나

**현상**: RT 참가자에게 행동 지침이 없어 역할 분화가 약함. participant_identity()가 이름/엔진/역할 라벨만 전달.

**수정 방향**: RT 페르소나 시스템 설계 필요. "비판적 평가", "구현 관점 답변" 등 행동 지침 주입.

---

## P2: OpenCode RT 성능

**현상**: opencode가 RT에서 4분+ 무응답 (15초 간단 프롬프트도 응답 안 됨).

**원인**: opencode → Ollama(qwen3.5:9b) 경로에서 4096 context window + 느린 추론. tunaFlow 버그 아님.

**대응**: RT에서 opencode 대신 ollama 엔진 직접 사용 권장.

---

## P2: 로컬 모델 context 제약 안내

**현상**: 작은 context window (4096-8192) 로컬 모델이 RT ContextPack을 처리 못함.

**대응**: README에 로컬 모델 제약 안내 추가 예정.

---

## 참고: 이전 이슈 상태

| 이전 이슈 | 상태 |
|----------|------|
| opencode 모델 불일치 (big-pickle) | 해소 (identity 모델명 추가) |
| 한국어 파일명 마이그레이션 | tunaInsight 전용, 불필요 |
| window-state dev 모드 | 변경 없음 (X 버튼 종료 필요) |
| integration test 부재 | 변경 없음 |
