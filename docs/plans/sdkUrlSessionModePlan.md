---
title: SDK URL Session Mode — claude --sdk-url 로컬 WS 세션
status: in-progress
created_at: 2026-04-15
priority: P1
related: engineServerModePlan.md, betaReleaseReadinessPlan.md
---

# SDK URL Session Mode — `--sdk-url` 로컬 WebSocket 세션

> claude 바이너리의 숨겨진 `--sdk-url` 플래그를 활용해
> PTY ANSI 파싱 제거 + 슬래시 커맨드 지원 + ContextPack 토큰 효율화를 달성한다.

---

## 1. 발견 경위

2026-04-15 세션에서 claude 바이너리(`strings` 분석) 중 발견.
`--help`에 노출되지 않는 숨겨진 플래그이나 Desktop 앱이 내부적으로 사용하는 안정적 경로.

### 바이너리에서 확인한 플래그 정의

```
--sdk-url <url>  "Use remote WebSocket endpoint for SDK I/O streaming
                  (only with -p and stream-json format)"
```

`.hideHelp()` 처리 — `--help`에 미노출, 하지만 완전히 구현된 기능.

---

## 2. Desktop 앱 스폰 패턴 (바이너리 분석)

### 2.1 자식 프로세스 실행 인수

```bash
claude \
  --print \
  --sdk-url ws://127.0.0.1:<PORT>/<session_id> \
  --session-id <uuid> \
  --input-format stream-json \
  --output-format stream-json \
  --replay-user-messages \
  --verbose \
  --permission-mode <mode>
```

### 2.2 환경 변수

```
CLAUDE_CODE_OAUTH_TOKEN=undefined          # 기존 OAuth 토큰 제거
CLAUDE_CODE_ENVIRONMENT_KIND=bridge
CLAUDE_CODE_SESSION_ACCESS_TOKEN=<token>  # WS 인증 토큰
CLAUDE_CODE_POST_FOR_SESSION_INGRESS_V2=1 # 선택적 (HybridTransport 활성)
```

### 2.3 Transport 선택 로직 (바이너리에서 확인)

```js
function s8K(url, headers, sessionId, getHeaders) {
  if (CLAUDE_CODE_USE_CCR_V2)   → SSETransport (oJH)  [클라우드 전용]
  if (url.protocol === "ws:")
    if (POST_FOR_SESSION_INGRESS_V2) → HybridTransport (DD8): WS 수신 + HTTP POST 송신
    else                             → WebSocketTransport (a3_): 순수 WS 양방향
  else throw "Unsupported protocol"
}
```

**tunaFlow 선택: 순수 WebSocket (`a3_`)** — `POST_FOR_SESSION_INGRESS_V2` 미설정, `CCR_V2` 미설정.

### 2.4 WebSocket 인증

claude 자식 프로세스가 WS 연결 시 헤더:
```
Authorization: Bearer <CLAUDE_CODE_SESSION_ACCESS_TOKEN>
```

tunaFlow WS 서버에서 토큰 검증 후 연결 수락.

---

## 3. Remote Control vs Desktop 모드 비교

| | Remote Control (`replBridge`) | Desktop/SDK URL | `-p` |
|--|--|--|--|
| 경로 | 로컬 claude ↔ Anthropic 클라우드 ↔ claude.ai | 로컬 WS 직접 | stdin/stdout |
| 세션 지속 | ✅ (클라우드 릴레이) | ✅ (로컬 직접) | ❌ |
| 슬래시 커맨드 | ✅ | ✅ | ❌ |
| 클라우드 경유 | 필수 | 없음 | 없음 |
| ANSI 파싱 | 불필요 | 불필요 | 불필요 |
| permission UI | `control_request` 이벤트 | `control_request` 이벤트 | bypassPermissions |

---

## 4. 3가지 모드 비교 (tunaFlow 관점)

| | PTY | `--sdk-url` | `-p stream-json` (현재) |
|--|--|--|--|
| 프로세스 생존 | 세션 내내 | 세션 내내 | 메시지마다 재생성 |
| 출력 형식 | raw ANSI | 구조화 JSON | 구조화 JSON |
| 슬래시 커맨드 | ✅ | ✅ | ❌ |
| 인터랙티브 bash | ✅ (실시간) | ❌ | ❌ |
| permission 요청 | 텍스트 파싱 | WS `control_request` | bypassPermissions |
| 세션 지속 | ✅ | ✅ | ❌ (--resume만) |
| ANSI 파싱 | 필요 | 불필요 | 불필요 |
| ContextPack | 매 메시지 전체 재전송 | 초기 1회 주입 | 매 메시지 전체 재전송 |
| P1 완료 감지 | 불안정 | 명확 (`result` 이벤트) | 대체로 안정 |

---

## 5. 목표 아키텍처

```
┌─────────────────────────────────────────────────┐
│  tunaFlow Rust backend                           │
│                                                  │
│  ClaudeSessionManager                            │
│    ├── per conv: ClaudeSession {                 │
│    │     ws_server_port, auth_token,             │
│    │     child_process, session_id               │
│    │   }                                         │
│    └── axum WS 서버 (이미 의존성 있음)           │
│                                                  │
│  → Tauri event emit: claude:chunk / claude:progress│
│    (기존 프론트엔드 변경 없음)                   │
└─────────────────────────────────────────────────┘
         ↕ WebSocket ws://127.0.0.1:<port>/<session>
┌─────────────────────────────────────────────────┐
│  claude subprocess                               │
│  (--print --sdk-url ... --input-format stream-json)│
└─────────────────────────────────────────────────┘
```

### WS 메시지 형식 (stream-json 동일)

**tunaFlow → claude (사용자 메시지):**
```json
{"type": "user", "message": {"role": "user", "content": "..."}}
```

**claude → tunaFlow (이벤트):**
```json
{"type": "system", "subtype": "init", ...}
{"type": "assistant", "message": {"content": [...]}, ...}
{"type": "result", "result": "...", "total_cost_usd": ..., ...}
{"type": "control_request", "request": {"subtype": "can_use_tool", "tool_name": "..."}}
```

---

## 6. ContextPack 재설계

### 현재 (매 메시지)
```
[시스템 프롬프트] + [전체 히스토리 + 플랜 + 스킬 + RAG] + [사용자 메시지]
```
→ O(n²) 토큰. 대화 길어질수록 비용 폭증.

### 신규 (세션 시작 1회)
```
세션 생성 시: [시스템 프롬프트 = persona + project_path + active_skills + plan_summary]
각 메시지:   [사용자 메시지] + [per-message 필수만: RAG 결과, 현재 파일 등]
```
→ O(n) 토큰. 세션 내 히스토리는 claude가 관리.

### 세션 만료 처리
- context window 80% 도달 시 → 새 세션 + 이전 세션 요약 주입
- 대화 전환 시 → 세션 종료 + 새 세션 생성

---

## 7. 구현 단계

### Phase 1 — Claude `--sdk-url` 세션 (P1)

**작업:**
- [ ] `src-tauri/src/agents/claude_sdk_session.rs` 생성
  - `ClaudeSession` struct: port, auth_token, child, session_id
  - `start_session()`: WS 서버 바인딩 → 자식 프로세스 스폰 → WS 연결 대기
  - `send_message()`: WS로 user 메시지 전송
  - `kill_session()`: 프로세스 종료 + WS 서버 해제
- [ ] axum WS 핸들러: token 검증 + stream-json 이벤트 라우팅
- [ ] `start_claude_stream` 커맨드에서 `use_sdk_url` 경로 분기
  - feature-flag: `TUNAFLOW_USE_SDK_URL=1` 또는 DB 설정
  - 기존 `-p` 경로 유지 (fallback)
- [ ] `control_request` → Tauri 이벤트 → 프론트엔드 permission UI
- [ ] interrupt: WS로 `{"type": "control_request", "request": {"subtype": "interrupt"}}` 전송

**검증:**
- 기존 `-p` 테스트 케이스 동일 통과
- 슬래시 커맨드 (`/review`, `/compact`) 동작 확인

---

### Phase 2 — Codex 유사 플래그 조사 (후순위)

> codex CLI에도 `--sdk-url` 유사 플래그 또는 bidirectional stdio 모드가 있을 가능성.
> 조사 포인트:
> - `codex app-server` 프로토콜 상세
> - `codex exec --json` 이상의 세션 지속 방법
> - `strings $(which codex)` 분석으로 hidden flag 탐색

---

## 8. 위험 요소

| 위험 | 대응 |
|------|------|
| `--sdk-url` 숨겨진 플래그 — 버전 업에서 변경 가능 | `-p` fallback 유지, 기능 플래그로 분리 |
| WS 인증 프로토콜 변경 | 에러 로그 + 자동 fallback |
| 세션 누수 (zombie process) | 프로세스 그룹 kill + Tauri 앱 종료 훅 |
| context window 초과 | 메시지 수 / 토큰 추정으로 세션 갱신 |

---

## 9. 관련 파일

| 파일 | 역할 |
|------|------|
| `src-tauri/src/agents/claude.rs` | 현재 `-p stream-json` 구현 |
| `src-tauri/src/commands/agents.rs` | `start_claude_stream` 진입점 |
| `src-tauri/src/http_api/ws.rs` | 기존 axum WS 서버 (참조) |
| `src-tauri/src/agents/claude_sdk_session.rs` | 신규 생성 예정 |
