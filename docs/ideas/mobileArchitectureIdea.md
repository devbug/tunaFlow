# tunaFlow 모바일 지원 아키텍처 설계

> Status: idea
> Created: 2026-04-03

---

## 0. 전제조건과 시나리오

### 사용 시나리오

```
PC (데스크탑 tunaFlow)          모바일 (tunaFlow Mobile)
┌──────────────────┐            ┌──────────────────┐
│ 에이전트 실행 중  │ ◄──터널──► │ 진행 상황 확인    │
│ SQLite DB        │            │ 지시/승인         │
│ rawq daemon      │            │ 결과 확인         │
│ ContextPack 조립 │            │ 알림 수신         │
└──────────────────┘            └──────────────────┘
```

- **PC가 켜져있는 게 전제**. 항상 켜진 서버가 아님.
- 모바일은 **원격 뷰어 + 제어기**. 에이전트 실행/DB/임베딩은 모두 PC.
- 핵심 기능: 진행 상황 모니터링, 워크플로우 승인/거부, 채팅 조회, 알림.

### 현재 상태

| 항목 | 상태 |
|------|------|
| Tauri 버전 | v2 (데스크탑 전용) |
| 모바일 설정 | 없음 (tauri.conf.json에 iOS/Android 미설정) |
| HTTP 서버 | 없음 (Tauri command + event로 통신) |
| WebSocket/JSON-RPC | 없음 |
| 터널/원격 | 없음 (daemon roadmap Phase 3에서 IPC 계획만) |
| 네트워크 라이브러리 | reqwest (outbound), tokio (async runtime) |

---

## 1. 터널 자동화 설계

### 1.1 터널 솔루션 비교

| | Cloudflare Tunnel | bore | rathole | localtunnel |
|---|---|---|---|---|
| **바이너리 크기** | ~30MB (cloudflared) | ~3MB | ~5MB | Node.js 필요 |
| **설치 요구** | CF 계정 + 토큰 | 없음 (공개 서버) | 서버 필요 | 없음 |
| **인증** | CF Access, JWT | 없음 (시크릿 옵션) | 토큰 기반 | 없음 |
| **안정성** | 프로덕션 급 | 개인 프로젝트 | 안정 | 불안정 |
| **TLS** | 자동 (CF 인증서) | 없음 | 수동 | 자동 |
| **커스텀 도메인** | 가능 | 불가 | 가능 | 불가 |
| **자체 서버 필요** | 아니오 | 아니오 (공개) 또는 예 (자체) | 예 | 아니오 |
| **무료** | 무료 (Tunnel) | 무료 | 무료 | 무료 |

### 1.2 권장: 2-tier 전략

```
Tier 1 (기본, 제로 설정):  bore
  - 바이너리 sidecar (~3MB)
  - 설정 없이 즉시 동작
  - 공개 bore.pub 서버 사용 (또는 자체 bore 서버)
  - 보안: 앱 레벨 토큰 인증 (bore 자체는 인증 없음)

Tier 2 (고급, 안정적):     Cloudflare Tunnel
  - 사용자가 CF 계정 + 토큰 설정
  - 커스텀 도메인, CF Access 인증
  - 프로덕션 급 안정성
  - Settings > Remote Access에서 설정
```

대부분의 사용자는 Tier 1(bore)로 충분. 기업/프로덕션 환경은 Tier 2.

### 1.3 터널 자동 실행 흐름

```
tunaFlow 데스크탑 시작
  ↓
[Remote Access 활성화 여부 확인] (Settings 토글)
  ├── 비활성 → 종료 (로컬 전용)
  └── 활성 ↓
      [로컬 HTTP/WS 서버 시작]  ← 새로 추가해야 함
        ↓  localhost:19840 (예시 포트)
      [터널 바이너리 실행]
        ↓  bore local 19840 --to bore.pub
      [터널 URL 수신]
        ↓  https://abc123.bore.pub
      [QR 코드 생성 + 표시]
        ↓  RuntimeStatusBar 또는 Settings에 표시
      [연결 상태 모니터링]
        ↓  끊기면 자동 재연결 (3회 재시도)
```

### 1.4 로컬 API 서버 설계

현재 tunaFlow는 Tauri command로 통신한다. 모바일에서 접근하려면 **HTTP/WebSocket API 레이어**가 필요.

```rust
// src-tauri/src/remote/mod.rs (새 모듈)

use axum::{Router, routing::get, routing::post, Json};
use tokio::sync::broadcast;

pub struct RemoteServer {
    port: u16,
    auth_token: String,       // 앱 시작 시 랜덤 생성
    event_tx: broadcast::Sender<ServerEvent>,
}

impl RemoteServer {
    pub async fn start(state: AppState) -> Result<Self> {
        let app = Router::new()
            // 읽기 (모니터링)
            .route("/api/projects", get(list_projects))
            .route("/api/conversations/:id/messages", get(list_messages))
            .route("/api/plans/:id", get(get_plan))
            .route("/api/plans/:id/events", get(list_plan_events))
            .route("/api/agents/status", get(agent_status))
            
            // 쓰기 (제어)
            .route("/api/conversations/:id/send", post(send_message))
            .route("/api/plans/:id/approve", post(approve_plan))
            .route("/api/plans/:id/reject", post(reject_plan))
            
            // 실시간 (WebSocket)
            .route("/ws/events", get(ws_event_stream))
            
            // 인증
            .layer(auth_middleware(token));

        let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
        tokio::spawn(axum::serve(listener, app));
        Ok(Self { port, auth_token, event_tx })
    }
}
```

**핵심**: 기존 Tauri command 로직을 **재구현하지 않는다**. 같은 DB/State를 공유하되 HTTP로 노출만.

### 1.5 인증/보안

```
[PC] tunaFlow 시작 → 랜덤 토큰 생성 (32바이트 hex)
                    → QR 코드에 URL + 토큰 인코딩
                    → bore 터널 시작

[모바일] QR 스캔 → URL + 토큰 획득
                 → 모든 API 요청에 Authorization: Bearer {token} 헤더
                 → 토큰 불일치 → 401 Unauthorized

[보안 계층]
1. bore 터널: 외부에서 접근 가능하지만 URL이 랜덤
2. 앱 토큰: URL을 알아도 토큰 없으면 접근 불가
3. TLS: bore.pub는 TLS 제공 (HTTPS)
4. 세션 만료: 24시간 후 자동 만료, PC에서 재생성
```

### 1.6 QR 코드 / URL 표시

```typescript
// RuntimeStatusBar.tsx 또는 Settings > Remote Access

// QR 데이터 형식
const qrData = JSON.stringify({
  url: "https://abc123.bore.pub",
  token: "a1b2c3d4...",
  version: 1,
});

// 표시 위치
// 1. RuntimeStatusBar에 📱 아이콘 → 클릭 시 QR 모달
// 2. Settings > Remote Access 탭에 상시 표시
```

---

## 2. Tauri Mobile 빌드 고려사항

### 2.1 Tauri 2 Mobile 현재 성숙도

| 항목 | iOS | Android | 비고 |
|------|-----|---------|------|
| 기본 빌드 | ✅ 가능 | ✅ 가능 | Tauri 2 공식 지원 |
| WebView | WKWebView | Android WebView | 네이티브 WebView |
| Rust backend | ✅ 동작 | ✅ 동작 | 동일 코드 |
| 파일 시스템 | 제한적 (샌드박스) | 제한적 | 앱 디렉토리만 |
| Subprocess spawn | ❌ 불가 | ❌ 불가 | **핵심 제약** |
| SQLite | ✅ (bundled) | ✅ | 로컬 캐시용 |
| 플러그인 생태계 | 성장 중 | 성장 중 | 일부 미지원 |

**핵심 제약: 모바일에서 subprocess spawn이 불가능하다.**

Claude Code, Gemini CLI, rawq 등 CLI 에이전트를 모바일에서 직접 실행할 수 없다. 따라서 모바일은 **반드시 PC의 원격 클라이언트**여야 한다.

### 2.2 데스크탑과 모바일 코드베이스 공유 전략

```
src/
├── components/
│   ├── tunaflow/           ← 공유 (대부분)
│   │   ├── chat/           ← 공유
│   │   ├── message/        ← 공유
│   │   ├── context-panel/  ← 데스크탑 전용 (Plan/Review/Test 상세)
│   │   └── ...
│   └── mobile/             ← 모바일 전용 (새로 추가)
│       ├── MobileShell.tsx
│       ├── RemoteConnect.tsx
│       └── CompactPlanView.tsx
├── lib/
│   ├── api/                ← 공유 (invoke → HTTP 어댑터로 분기)
│   └── remote/             ← 모바일 전용 (HTTP 클라이언트)
└── stores/
    └── slices/             ← 공유 (데이터 모델 동일)
```

### 2.3 API 레이어 분기

현재 프론트엔드는 `invoke("command_name", { args })` (Tauri IPC)로 통신. 모바일에서는 HTTP로 바꿔야 한다.

```typescript
// src/lib/api/transport.ts (새 파일)

import { invoke as tauriInvoke } from "@tauri-apps/api/core";

const IS_MOBILE_REMOTE = import.meta.env.VITE_MOBILE_REMOTE === "true";

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (IS_MOBILE_REMOTE) {
    // HTTP로 PC에 요청
    const res = await fetch(`${getRemoteUrl()}/api/${command}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${getToken()}`,
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`Remote error: ${res.status}`);
    return res.json();
  }
  // 데스크탑: 기존 Tauri IPC
  return tauriInvoke<T>(command, args);
}
```

**이 한 파일만 바꾸면** 나머지 코드(stores, components)는 수정 없이 동작.

### 2.4 모바일 UI/UX 차이

| 영역 | 데스크탑 | 모바일 |
|------|---------|--------|
| **레이아웃** | 사이드바 + 센터패널 + 드로어 | 단일 패널 + 바텀 네비게이션 |
| **사이드바** | 항상 표시 | 햄버거 메뉴 또는 바텀 탭 |
| **드로어 (Branch)** | 우측 슬라이드 | 풀스크린 모달 |
| **CenterPanel 탭** | 5-tab 상단 | 바텀 네비 4탭 (Chat/Plan/Review/Settings) |
| **입력** | NewMessageInput (키보드) | 간소화 (음성 입력 옵션) |
| **코드블록** | syntax highlight + collapse | 수평 스크롤 + 복사만 |
| **Settings** | 전체 설정 | 원격 연결 설정만 |
| **rawq/Agent 실행** | 로컬 실행 | 표시만 (PC에서 실행 중) |

**모바일 전용 뷰**:

```
┌─────────────────────────┐
│ 🐟 tunaFlow    ● 연결됨  │ ← 상태바 (연결 상태)
├─────────────────────────┤
│                         │
│   채팅 메시지 목록       │ ← 스크롤
│   (읽기 + 간단한 입력)   │
│                         │
├─────────────────────────┤
│ 💬 Chat  📋 Plan  🔍 Rev │ ← 바텀 네비게이션
└─────────────────────────┘
```

### 2.5 실시간 이벤트

데스크탑의 Tauri event system을 WebSocket으로 브릿지:

```
PC (Tauri events)          모바일 (WebSocket)
agent:completed    ──────►  ws://localhost:19840/ws/events
roundtable:progress ──────►  { type: "agent:completed", payload: {...} }
rawq:indexed       ──────►  { type: "roundtable:progress", payload: {...} }
```

모바일은 WebSocket으로 실시간 업데이트 수신. 끊기면 자동 재연결 + 마지막 상태 폴링.

---

## 3. 구현 순서 (로드맵)

### Phase 0: 데스크탑 안정화 (현재)

```
목표: 워크플로우 풀사이클이 안정적으로 동작
완료 조건:
  - Plan→Dev→Review→Done 3회 이상 성공
  - 긴 대화 (24+ msg) 안정
  - 리팩토링 v2 Tier 1 완료
```

**모바일 관련 준비 없음.** 데스크탑 기능 안정화 집중.

### Phase 1: 로컬 API 서버 (터널 없이)

```
목표: HTTP/WS API로 tunaFlow 데이터에 접근 가능
구현:
  1. axum 기반 로컬 HTTP 서버 (localhost:19840)
  2. 읽기 API 5개 (projects, conversations, messages, plans, agent status)
  3. 쓰기 API 3개 (send, approve, reject)
  4. WebSocket 이벤트 스트림 1개
  5. 토큰 기반 인증
검증: curl/Postman으로 API 동작 확인
변경:
  src-tauri/src/remote/       ← 새 모듈 (~400줄)
  src-tauri/Cargo.toml        ← axum, tower 의존성
  src-tauri/src/lib.rs        ← 서버 시작 로직
```

**이 단계에서 LAN 내 브라우저 접근 가능.** `http://192.168.x.x:19840`로 동일 네트워크 내 접근.

### Phase 2: 터널 자동화

```
목표: 외부 네트워크에서 PC의 tunaFlow에 접근 가능
구현:
  1. bore sidecar 바이너리 번들 (rawq와 동일 패턴)
  2. Settings > Remote Access 토글
  3. 터널 시작/중지 자동화
  4. QR 코드 생성 + 표시
  5. 연결 상태 모니터링 + 자동 재연결
검증: 모바일 브라우저에서 터널 URL 접근
변경:
  src-tauri/src/remote/tunnel.rs  ← bore 관리 (~150줄)
  scripts/build-bore.sh           ← bore sidecar 빌드
  Settings UI                     ← Remote Access 섹션
```

**이 단계에서 모바일 브라우저로 접근 가능.** 네이티브 앱 없이.

### Phase 3: 모바일 웹 뷰 (Progressive Web App)

```
목표: 모바일 최적화 웹 UI
구현:
  1. 반응형 레이아웃 (모바일 전용 Shell)
  2. 바텀 네비게이션
  3. 터치 최적화 (스와이프, 롱프레스)
  4. 오프라인 상태 처리 (연결 끊김 시 캐시된 데이터 표시)
  5. PWA manifest (홈 화면 추가)
검증: 모바일 Safari/Chrome에서 PWA로 설치
변경:
  src/components/mobile/     ← 새 디렉토리 (~500줄)
  src/lib/api/transport.ts   ← invoke 어댑터
  vite.config.ts             ← PWA 플러그인
```

**PWA가 Tauri Mobile보다 현실적인 이유**:
- Tauri Mobile은 subprocess spawn 불가 → 어차피 원격 전용
- 원격 전용이면 WebView 앱 = 브라우저 = PWA
- PWA는 앱스토어 심사 불필요, 즉시 배포

### Phase 4: Tauri Mobile 네이티브 (선택적)

```
목표: 네이티브 앱 (iOS/Android)
구현:
  1. Tauri Mobile 설정 (tauri.conf.json 확장)
  2. 푸시 알림 (에이전트 완료, 리뷰 요청 등)
  3. 네이티브 QR 스캐너
  4. 앱스토어 배포
검증: TestFlight (iOS), 내부 APK (Android)
```

**Phase 3(PWA)로 충분할 가능성이 높다.** Phase 4는 푸시 알림이 필수적일 때만.

---

## 4. 리스크 및 고려사항

### 4.1 PC가 꺼졌을 때

```
PC 꺼짐 → 터널 끊김 → 모바일 WebSocket 끊김
                      ↓
모바일: "연결 끊김" 배너 표시
        마지막 캐시된 데이터는 계속 표시 (읽기 전용)
        재연결 시도 (30초 간격, 3회)
        3회 실패 → "PC가 꺼져있습니다" 메시지
```

**모바일은 PC에 종속.** 이건 의도된 설계. "항상 가용한 서버"가 아니라 "PC 확장".

### 4.2 터널 끊김

```
터널 끊김 (bore 서버 불안정, 네트워크 변경 등)
  ↓
PC 측: 자동 재연결 (5초 간격, 지수 백오프, 최대 5분)
       재연결 성공 → 새 URL 발급 가능 (bore는 URL 변경)
       새 URL → QR 재생성 → 모바일에 알림 (PC 알림)
  ↓
모바일 측: WebSocket 끊김 감지 → 재연결 시도
          URL 변경 시 → QR 재스캔 필요 (단점)
```

**완화**: Cloudflare Tunnel(Tier 2)은 고정 URL 가능. bore의 URL 변경 문제를 해결.

### 4.3 로컬 퍼스트 철학 유지

| 원칙 | 모바일에서 유지? | 방법 |
|------|----------------|------|
| 데이터는 사용자 머신에 | ✅ | 모바일은 뷰어. DB는 PC에만 |
| API 키가 외부로 안 나감 | ✅ | 에이전트 실행은 PC에서만 |
| 오프라인 동작 | ⚠️ 부분적 | 모바일은 PC 연결 필수. PC 자체는 오프라인 가능 |
| 제3자 서버 의존 없음 | ⚠️ bore.pub 의존 | 자체 bore 서버로 대체 가능 |

**bore.pub 의존이 유일한 타협점.** 순수 로컬을 원하면 LAN 모드(Phase 1)만 사용하고 터널을 건너뛸 수 있다.

### 4.4 보안 위협 모델

| 위협 | 대응 |
|------|------|
| 터널 URL 유출 | 앱 토큰 없이는 접근 불가. URL만으로 부족 |
| 토큰 브루트포스 | 32바이트 hex (256비트) → 실질적으로 불가능 |
| 중간자 공격 | bore.pub는 TLS 제공. CF Tunnel도 TLS |
| 비인가 명령 실행 | API 레벨에서 허용된 command만 노출 (send, approve, reject) |
| DB 직접 접근 | 불가. HTTP API만 노출, SQL injection 불가 (파라미터화 쿼리) |

### 4.5 데이터 전송량

```
일반 사용 (채팅 조회):
  메시지 목록: ~5-20KB per request
  Plan 상태: ~1-2KB
  WebSocket 이벤트: ~0.5KB per event
  → 시간당 ~100KB (매우 낮음)

활발한 사용 (에이전트 실행 모니터링):
  스트리밍 청크: ~50-100KB/분
  → 시간당 ~3-6MB (모바일 데이터로 충분)
```

---

## 5. 의존성

### 새로 필요한 Rust 크레이트

| 크레이트 | 용도 | 크기 |
|---------|------|------|
| `axum` | HTTP/WS 서버 | ~50KB (tokio 이미 있음) |
| `tower-http` | CORS, auth middleware | ~30KB |
| `qrcode` | QR 코드 생성 | ~20KB |

### 새로 필요한 npm 패키지

| 패키지 | 용도 | Phase |
|--------|------|-------|
| `vite-plugin-pwa` | PWA manifest/service worker | Phase 3 |
| `qrcode.react` | QR 코드 렌더링 | Phase 2 |

### sidecar 바이너리

| 바이너리 | 크기 | Phase |
|---------|------|-------|
| `bore` | ~3MB | Phase 2 |

---

## 6. 아키텍처 다이어그램

```
Phase 1-2 (API + 터널):

  ┌─ PC ──────────────────────────────────┐
  │                                       │
  │  tunaFlow (Tauri)                     │
  │  ├── Tauri Commands (기존)             │
  │  ├── Remote Server (axum) ← 새로 추가  │
  │  │   ├── HTTP API (REST)              │
  │  │   └── WebSocket (events)           │
  │  ├── SQLite DB                        │
  │  ├── rawq daemon                      │
  │  └── Agent subprocesses              │
  │       ↑                               │
  │  localhost:19840                       │
  │       ↑                               │
  │  bore tunnel                          │
  │       ↑                               │
  └───────┼───────────────────────────────┘
          │
    https://abc123.bore.pub
          │
  ┌───────┼───────────────────────────────┐
  │       ↓                               │
  │  모바일 브라우저 / PWA                  │
  │  ├── invoke() → HTTP fetch 어댑터      │
  │  ├── WebSocket → 실시간 이벤트         │
  │  ├── 로컬 캐시 (IndexedDB)            │
  │  └── 바텀 네비 UI                      │
  │                                       │
  └─ Mobile ──────────────────────────────┘


Phase 3-4 (PWA / Tauri Mobile):

  동일 구조. 모바일 쪽만:
  - Phase 3: PWA (브라우저 기반, 홈 화면 추가)
  - Phase 4: Tauri Mobile (네이티브 앱, 푸시 알림)
```

---

## 7. 최소 구현 범위 (MVP)

Phase 1만으로 **LAN 내 모바일 접근**이 가능하다.

```
MVP (Phase 1):
  ✅ axum 서버 (localhost:19840)
  ✅ GET /api/conversations/:id/messages
  ✅ GET /api/plans/:id
  ✅ GET /api/agents/status
  ✅ POST /api/plans/:id/approve
  ✅ WS /ws/events (agent:completed, roundtable:progress)
  ✅ Bearer 토큰 인증
  ✅ 모바일 브라우저에서 접근 (http://192.168.x.x:19840)

MVP에 없는 것:
  ❌ 터널 (LAN 전용)
  ❌ QR 코드
  ❌ 모바일 최적화 UI
  ❌ PWA / 네이티브 앱
```

이것만으로도 "같은 와이파이에서 폰으로 확인" 시나리오는 커버됨.

---

## 참고

- Tauri 2 Mobile: https://v2.tauri.app/start/prerequisites/#mobile
- bore: https://github.com/ekzhang/bore
- Cloudflare Tunnel: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
- axum: https://github.com/tokio-rs/axum
- 현재 daemon 로드맵: `docs/plans/agentDaemonRoadmapPlan.md`
- 현재 Tauri 설정: `src-tauri/tauri.conf.json`
