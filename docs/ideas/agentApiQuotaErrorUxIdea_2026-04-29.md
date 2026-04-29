---
title: Agent API quota / 인증 에러의 사용자 친화 UX
status: idea
created_at: 2026-04-29
canonical: false
priority: P3 (사용자 보고 누적 시 격상)
trigger:
  reported_at: 2026-04-29
  reporter: 사용자 (d9ng)
  symptom: |
    backend stderr `API Error: 400 invalid_request_error: "You're out of extra usage.
    Add more at claude.ai/settings/usage and keep going."` 가 채팅 메시지에 raw 노출.
    그러나 사용자는 본인 quota 가 충분히 남아있다고 인지 — mismatch case.
related:
  - src-tauri/src/agents/claude.rs (result error 분기)
  - src-tauri/src/agents/{codex,gemini,ollama,lmstudio}.rs
  - src/components/tunaflow (에러 모달 / 토스트 영역)
---

# Agent API quota / 인증 에러 UX

## 0. Context

Anthropic / OpenAI / Google 등 외부 API 가 반환하는 4xx 에러는 backend stderr 를 거쳐 채팅 메시지에 그대로 노출됨. 사용자가 *원인 + 해결 path* 를 raw error 메시지에서 추론해야 하는 부담.

특히 **사용자 인지와 API 응답이 mismatch** 하는 case 가 발생: "사용량 남아있는데 quota 초과 거부 받음". 이는 단순 quota 가 아니라:
- 다른 계정/구독 단계 (Plus/Pro/Max + extra usage)
- claude CLI 인증 token 이 다른 계정
- organization vs personal billing 분리
- minute/hour rate limit 을 quota 메시지로 표시

같은 가능성. 사용자가 raw error 만으로는 원인 좁히기 어려움.

## 1. 현황

- `agents/claude.rs:325-327` (또는 인근) 의 `result` event `is_error: true` 분기 에서 `parsed.result` 본문을 그대로 `AppError::Agent(...)` 로 wrap → frontend 에서 시스템 메시지로 표시
- 다른 엔진 (`codex.rs`, `gemini.rs`, etc) 동일 패턴 추정
- 별도 분류 X — quota / auth / rate limit / model unavailable / safety filter 모두 같은 통로

## 2. Idea — 4 Layer 개선

### Layer 1 — Error 분류 (backend) [P2]

`agents/{claude,codex,gemini,ollama,lmstudio}.rs` 에 error parser 모듈 추가. 4xx response body 의 keyword 로 분류:

```rust
enum ApiErrorKind {
    QuotaExceeded { provider: String, billing_url: String },
    RateLimited { retry_after_secs: Option<u64> },
    AuthFailure { provider: String, fix_hint: String },
    ModelUnavailable { model: String },
    SafetyFilter { reason: String },
    Unknown(String), // fallback raw
}
```

provider 별 에러 패턴 mapping:

| Provider | Quota keyword | Rate limit | Auth |
|---|---|---|---|
| Anthropic | `"out of extra usage"`, `"credit balance"`, `"usage_limit"` | `"rate_limit_error"`, `429` | `401`, `"invalid api key"` |
| OpenAI | `"insufficient_quota"`, `"billing_hard_limit"` | `"rate_limit_exceeded"`, `429` | `401`, `"Incorrect API key"` |
| Google | `"quota exceeded"`, `RESOURCE_EXHAUSTED` | `429` | `403`, `"API key not valid"` |

**변경 영역**: 새 파일 `src-tauri/src/agents/api_errors.rs` + 5 engine 의 error 분기 호출. 약 200 LoC.

### Layer 2 — Frontend 친화적 표시 [P2]

분류된 error 를 시스템 메시지 대신 dedicated UI 로:

| Kind | UI 표시 | Action 버튼 |
|---|---|---|
| QuotaExceeded | "[Provider] 사용량 한도 도달" 모달 | 1) `billing_url` 링크 직접 열기 2) 다른 엔진 전환 제안 (자동 detect 활성 엔진) |
| RateLimited | 토스트 + retry 카운트다운 (`retry_after_secs` 있으면) | 자동 재시도 또는 수동 재시도 |
| AuthFailure | "[Provider] 인증 실패" 모달 + fix_hint | Settings → API keys 진입 link |
| ModelUnavailable | "모델 미사용 가능" 인라인 알림 | 다른 모델 선택 dropdown |
| SafetyFilter | "안전 필터 트리거됨" 인라인 + 사유 | 메시지 재작성 안내 |
| Unknown | 기존 raw 표시 (fallback) | "이슈 보고" 링크 (GitHub issues) |

**변경 영역**: `src/components/tunaflow/agent-errors/{QuotaExceededModal,RateLimitToast,AuthFailureModal,...}.tsx` 신규. `src/stores/streamStore.ts` (에러 routing). 약 400 LoC + i18n.

### Layer 3 — Mismatch case 자가 진단 hint [P3]

특히 quota mismatch (사용자 인지 vs API 응답 다름) case 에 대한 hint 섹션 모달 안에:

- "사용량 남아있다고 생각하시나요?" expandable 섹션
- 자가 진단 4 step:
  1. `[Provider] 의 사용량 페이지` 링크 직접 확인
  2. terminal 에서 직접 CLI 호출해 같은 에러 재현 여부 (예: `claude -p "test"`)
  3. CLI 인증 상태 확인 (`claude /login status` 또는 비슷)
  4. organization vs personal billing 분리 가능성 안내

**변경 영역**: Layer 2 의 모달 컴포넌트 안 expandable 섹션. 추가 ~50 LoC.

### Layer 4 — Auto fallback 제안 [P3]

`QuotaExceeded` 발생 시 backend 가 활성 엔진 list 조회 → frontend 에 dropdown 제안:

```
"Claude 사용량 한도 도달. 다른 엔진으로 같은 메시지 재전송하시겠습니까?"
[Codex] [Gemini] [Ollama] [LM Studio]  (사용자 환경에서 활성 엔진만)
```

선택 시 자동으로 engine 전환 + 같은 user message 재전송. ContextPack 은 새 엔진으로 재assemble.

**변경 영역**: `src-tauri/src/commands/agents.rs` 의 engine availability 조회 + frontend 모달에 dropdown. 약 100 LoC.

## 3. 트리거 case (사용자 보고 2026-04-29)

backend stderr:
```
[claude-code error] claude reported error: API Error: 400
{"type":"error","error":{"type":"invalid_request_error",
"message":"You're out of extra usage. Add more at claude.ai/settings/usage and keep going."},
"request_id":"req_011CaXktKLNk5muJFA424zpC"}
```

사용자 응답: "사용량은 엄청 남았는데?"

**가능 원인**:
1. claude CLI 의 인증 token 이 사용자 인지 외 계정 (예: organization vs personal)
2. tunaFlow v0.1.4-beta 의 `-p --resume` transport flip 후 claude CLI 가 다른 billing context 에 연결?
3. Anthropic 의 "extra usage" 영역만 별도 소진 (사용자 보는 main quota 와 분리)
4. minute/hour rate limit 인데 API 가 quota 메시지로 표시 (rare)

본 idea 의 Layer 3 (자가 진단 hint) 가 정확히 이런 mismatch case 를 사용자가 즉시 좁힐 수 있게 도움.

## 4. 우선순위 + 적용 시점

| Layer | 우선 | LoC | 적용 시점 |
|---|---|---|---|
| **Layer 1** error 분류 backend | P2 | ~200 | 다음 update cycle (사용자 보고 누적 시 P1 격상) |
| **Layer 2** Frontend 친화 UI | P2 | ~400 | Layer 1 다음 |
| Layer 3 Mismatch hint | P3 | ~50 | Layer 1+2 안정화 후 |
| Layer 4 Auto fallback | P3 | ~100 | Layer 1+2 안정화 후. 메타에이전트 plan 과 cross-axis |

## 5. 별 plan 작성 시점

본 idea 가 plan 으로 격상될 조건:
- 같은 mismatch case 외부 사용자 보고 추가 1~2건
- 또는 mac architect / Windows architect 가 작업 중 같은 막힘
- 또는 release publish 후 사용자 onboarding 단계에서 흔히 발생 인지

조건 충족 시 plan 이름: `agentApiErrorClassificationPlan_<date>.md`

## 6. 진단 hint 정리 (즉시 활용 — 본 사용자 case 한정)

Layer 3 이 도입되기 전이지만, 현 사용자가 즉시 활용 가능한 자가 진단:

1. **Anthropic usage 페이지 직접 확인**: https://claude.ai/settings/usage — main quota / extra usage 분리 표시 확인
2. **claude CLI 직접 호출**: `claude -p "test"` (tunaFlow 외부) → 같은 에러면 CLI 측 (인증 / billing context), 다르면 tunaFlow transport 측
3. **claude CLI 인증 상태**: `claude` (interactive 모드 진입 시) 의 status bar 또는 `/login` 명령으로 활성 계정 확인
4. **tunaFlow 외 다른 클라이언트 (Anthropic Console / claude.ai 웹) 에서 같은 시간대 호출**: 정상이면 CLI 측 인증 분리, 비정상이면 계정 자체 일시 제한
