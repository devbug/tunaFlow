# HTTP API — 모바일 + E2E 테스트 + MCP 통합 인프라

> Status: idea
> Created: 2026-04-10
> 관련: `mobileArchitectureIdea.md` (Phase 1과 동일 구현)
> 원칙: 한 번 만들면 3가지 용도 — 모바일 접근, E2E 테스트, MCP 래핑

---

## 1. 문제

### E2E 테스트 불가

현재 tunaFlow의 Tauri command는 **앱 내부에서만 호출 가능**합니다.

```
React Frontend → invoke("start_claude_stream") → Tauri IPC → Rust backend
                  ↑ 이 경로만 존재. 외부 접근 불가.
```

코더 Opus가 tunaFlow를 테스트하려면:
- ❌ Tauri command 직접 호출 — 외부 API 없음
- ❌ UI 자동화 — Tauri WebView는 Playwright 미지원
- ✅ DB 직접 읽기 — `sqlite3` CLI로 가능 (상태 확인만)
- ❌ 에이전트 실행 → 결과 확인 흐름 — 불가능

**결과**: 단위 테스트(vitest, cargo test)는 있지만, **워크플로우 풀사이클 E2E 테스트는 사람이 직접 해야** 합니다.

### 모바일 접근 불가

`mobileArchitectureIdea.md`에서 이미 식별한 문제. HTTP API가 없어서 외부 접근 불가.

---

## 2. 해결: HTTP API (axum)

`mobileArchitectureIdea.md` Phase 1과 **동일한 구현**입니다. 한 번 만들면:

```
HTTP API (localhost:19840)
  ├── 모바일 원격 접근 (원래 목적)
  ├── E2E 테스트 (코더 Opus가 curl로 호출)
  └── MCP 서버 래핑 (선택적, 위에 얹기만)
```

---

## 3. E2E 테스트 시나리오

### 코더 Opus가 할 수 있는 테스트

```bash
# 1. 대화 생성
curl -X POST localhost:19840/api/conversations \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"projectKey":"tunaFlow","label":"E2E Test"}'

# 2. 메시지 전송 (에이전트 실행)
curl -X POST localhost:19840/api/conversations/$CONV_ID/send \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"engine":"claude","prompt":"Hello","model":"claude-sonnet-4-6"}'

# 3. 에이전트 완료 대기 (WebSocket 또는 폴링)
curl localhost:19840/api/agents/status \
  -H "Authorization: Bearer $TOKEN"

# 4. 메시지 확인
curl localhost:19840/api/conversations/$CONV_ID/messages \
  -H "Authorization: Bearer $TOKEN"

# 5. Plan 생성 확인
curl localhost:19840/api/plans?conversationId=$CONV_ID \
  -H "Authorization: Bearer $TOKEN"

# 6. Plan 승인
curl -X POST localhost:19840/api/plans/$PLAN_ID/approve \
  -H "Authorization: Bearer $TOKEN"

# 7. Review verdict 확인
curl localhost:19840/api/plans/$PLAN_ID/events \
  -H "Authorization: Bearer $TOKEN"
```

### 자동화 가능한 풀사이클 테스트

```bash
#!/bin/bash
# e2e-workflow-test.sh — 코더 Opus가 실행

# 1. 대화 생성
CONV=$(curl -s -X POST .../conversations -d '...' | jq -r '.id')

# 2. Architect에게 Plan 요청
curl -s -X POST .../conversations/$CONV/send \
  -d '{"engine":"claude","prompt":"인증 미들웨어 리팩토링 Plan 만들어줘"}'

# 3. 완료 대기 (폴링)
while [ "$(curl -s .../agents/status | jq -r '.running')" != "false" ]; do sleep 2; done

# 4. Plan 생성 확인
PLAN=$(curl -s .../plans?conversationId=$CONV | jq -r '.[0].id')
[ -z "$PLAN" ] && echo "FAIL: Plan not created" && exit 1

# 5. Plan 승인
curl -s -X POST .../plans/$PLAN/approve

# 6. Developer 실행 대기
while [ "$(curl -s .../agents/status | jq -r '.running')" != "false" ]; do sleep 5; done

# 7. Review verdict 확인
VERDICT=$(curl -s .../plans/$PLAN/events | jq -r '[.[] | select(.event_type=="review_passed" or .event_type=="review_failed")][0].event_type')
echo "Review result: $VERDICT"
```

---

## 4. MCP 서버 래핑 (선택적)

HTTP API 위에 MCP 프로토콜을 얹으면, Claude Code에서 tunaFlow를 MCP tool로 호출 가능:

```json
// .mcp.json
{
  "servers": {
    "tunaflow": {
      "type": "http",
      "url": "http://localhost:19840/mcp"
    }
  }
}
```

MCP tools:
```
tunaflow_list_conversations    → GET /api/conversations
tunaflow_send_message          → POST /api/conversations/:id/send
tunaflow_approve_plan          → POST /api/plans/:id/approve
tunaflow_get_plan_status       → GET /api/plans/:id
tunaflow_list_artifacts        → GET /api/artifacts
```

**MCP는 HTTP API 위의 얇은 래퍼**. HTTP API가 있으면 MCP 추가는 ~100줄.

**주의**: 이전에 "MCP 도입 안 함"이라고 판단했는데, 이건 **에이전트가 MCP 클라이언트로서 외부 서비스에 접근**하는 것과 다릅니다. 여기서 말하는 건 **tunaFlow가 MCP 서버가 되어** 코더 Opus에게 기능을 노출하는 것. 토큰 낭비 이슈 없음.

---

## 5. API 엔드포인트 설계

### 읽기 (테스트 검증용)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/projects` | 프로젝트 목록 |
| GET | `/api/conversations?projectKey=X` | 대화 목록 |
| GET | `/api/conversations/:id/messages` | 메시지 목록 |
| GET | `/api/plans?conversationId=X` | Plan 목록 |
| GET | `/api/plans/:id` | Plan 상세 (subtasks, phase, events) |
| GET | `/api/plans/:id/events` | Plan 이벤트 타임라인 |
| GET | `/api/artifacts?conversationId=X` | Artifact 목록 |
| GET | `/api/agents/status` | 실행 중 에이전트 상태 |
| GET | `/api/trace?conversationId=X` | Trace 로그 |

### 쓰기 (테스트 실행용)

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/conversations` | 대화 생성 |
| POST | `/api/conversations/:id/send` | 메시지 전송 (에이전트 실행) |
| POST | `/api/plans/:id/approve` | Plan 승인 |
| POST | `/api/plans/:id/reject` | Plan 거부 |
| POST | `/api/branches` | Branch 생성 |
| POST | `/api/roundtable` | RT 시작 |

### 실시간 (이벤트 수신)

| Method | Path | 설명 |
|--------|------|------|
| WS | `/ws/events` | agent:completed, roundtable:progress 등 |

### 인증

```
앱 시작 시 랜덤 토큰 생성 (32바이트 hex)
모든 API 요청에 Authorization: Bearer {token} 필수
토큰은 Settings에서 확인 가능
```

---

## 6. 구현 순서

```
Phase 1: HTTP API 코어 (모바일 + 테스트 공용)
  → axum 서버 + 읽기 API + 쓰기 API + WS
  → Bearer 토큰 인증
  → ~400줄 Rust

Phase 2: E2E 테스트 스크립트
  → bash 스크립트로 워크플로우 풀사이클 테스트
  → 코더 Opus가 실행 + 결과 확인
  → ~100줄 bash

Phase 3: MCP 래핑 (선택적)
  → HTTP API → MCP tool 변환 레이어
  → Claude Code에서 tunaFlow 제어 가능
  → ~100줄 Rust
```

Phase 1은 `mobileArchitectureIdea.md`의 Phase 1과 **완전히 동일**. 한 번 구현으로 두 가지 목적 달성.

---

## 7. 기대 효과

### 현재 → 변경 후

```
현재:
  단위 테스트: ✅ vitest 175개 + cargo test 197개
  E2E 테스트: ❌ 사람이 직접 앱에서 클릭
  워크플로우 검증: ❌ 사람이 Plan→Dev→Review 직접 실행

변경 후:
  단위 테스트: ✅ 기존 유지
  E2E 테스트: ✅ 코더 Opus가 curl로 자동 실행
  워크플로우 검증: ✅ bash 스크립트로 풀사이클 자동화
  모바일 접근: ✅ 같은 API로
  MCP 연동: ✅ 선택적
```

### 코더 Opus 워크플로우 변화

```
현재:
  코드 수정 → cargo test + vitest → "테스트 통과"
  → 하지만 실제 워크플로우가 동작하는지는 사람이 확인

변경 후:
  코드 수정 → cargo test + vitest → E2E 스크립트 실행
  → "Plan 생성 ✅, 승인 ✅, Dev 실행 ✅, Review pass ✅"
  → 사람 확인 없이도 워크플로우 검증 가능
```

---

## 8. 리스크

| 리스크 | 대응 |
|--------|------|
| **보안**: localhost에 API 노출 | Bearer 토큰 필수 + localhost만 바인딩 |
| **동시 접근**: API + 앱 UI 동시 조작 | 같은 DB 공유 (WAL 모드로 읽기 동시 가능) |
| **테스트 오염**: E2E 테스트가 실제 데이터 변경 | 테스트용 프로젝트 키 사용 + 테스트 후 정리 |
| **에이전트 비용**: E2E에서 실제 에이전트 호출 | 테스트 모드에서 mock 에이전트 옵션 |

---

## 참고

- 모바일 아키텍처 (Phase 1 동일): `docs/ideas/mobileArchitectureIdea.md`
- 현재 테스트: vitest 175개 (`src/tests/`), cargo test 197개
- 시니어 리뷰 지적: "50+ critical functions untested, production bugs unfound"
- Tauri command 목록: `src-tauri/src/lib.rs` (command 등록)
- axum: https://github.com/tokio-rs/axum
