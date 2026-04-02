# Gemini SDK 직접 통합 실행 계획

> Status: active
> Created: 2026-04-02
> 선행: 워크플로우 안정화 완료
> 참고: docs/ideas/sdkIntegrationIdea.md §3, §6

---

## 목표

Gemini CLI (`gemini -p`) → Google AI SDK (HTTP API) 직접 호출로 전환.

### 기대 효과
- 네이티브 SSE 스트리밍 (현재 synthetic)
- 정확한 토큰/비용 추적 (현재 추정치)
- Function calling 지원 (마커 파싱 대체 가능)
- Context caching (비용 절감)
- CLI 바이너리 의존 제거

---

## 구현 순서

### Step 1: 의존성 + API 키 관리

```toml
# Cargo.toml
reqwest = { version = "0.12", features = ["json", "stream"] }
```

reqwest는 이미 tokio 런타임에서 동작 (tokio 이미 추가됨).

API 키: `GEMINI_API_KEY` 환경변수 또는 Settings에서 관리.

### Step 2: gemini_sdk.rs — 기본 HTTP 호출

```rust
// src-tauri/src/agents/gemini_sdk.rs

pub async fn stream_run(input: RunInput, on_progress, on_chunk) -> Result<RunOutput> {
    // 1. Build request body (contents, system_instruction, generationConfig)
    // 2. POST to https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent
    // 3. Parse SSE stream → on_progress (thinking) + on_chunk (text)
    // 4. Extract usage metadata → RunOutput
}
```

### Step 3: agents.rs — start_gemini_stream 변경

기존 CLI spawn → SDK async 호출로 전환.
`prepare_engine_run` 결과의 `enriched_prompt`를 SDK request body로 변환.

### Step 4: 토큰/비용 추적

SDK 응답의 `usageMetadata` 필드에서:
- promptTokenCount
- candidatesTokenCount
- cachedContentTokenCount
- totalTokenCount

### Step 5: Function calling (선택적, Phase 2)

review-verdict, subtask-done 등을 tool call로 구조화.
Phase 1에서는 텍스트 응답 + 마커 파싱 유지.

---

## API 레퍼런스

```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?key={API_KEY}

Content-Type: application/json

{
  "contents": [
    { "role": "user", "parts": [{ "text": "prompt" }] }
  ],
  "systemInstruction": {
    "parts": [{ "text": "system prompt" }]
  },
  "generationConfig": {
    "temperature": 1.0,
    "maxOutputTokens": 65536
  }
}

Response: SSE stream of JSON objects
```

---

## 파일 변경

| 파일 | 변경 |
|------|------|
| `Cargo.toml` | reqwest 추가 (이미 있으면 features 확인) |
| `src-tauri/src/agents/gemini_sdk.rs` | 신규 — SDK HTTP 호출 |
| `src-tauri/src/agents/mod.rs` | `pub mod gemini_sdk;` 추가 |
| `src-tauri/src/commands/agents.rs` | `start_gemini_stream` 변경 |
| `src-tauri/src/agents/gemini.rs` | CLI 버전 유지 (fallback) |

---

## Fallback 전략

API 키가 없으면 기존 CLI로 fallback:

```rust
if std::env::var("GEMINI_API_KEY").is_ok() {
    gemini_sdk::stream_run(...)
} else {
    gemini::stream_run(...)  // 기존 CLI
}
```
