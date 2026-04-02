# Tool Call Handler — Function Calling으로 마커 대체

> Status: draft
> Created: 2026-04-02
> 선행: SDK Phase 1~4 완료 (Gemini/OpenAI/Anthropic SDK 직접 통합)
> 참고: docs/ideas/sdkIntegrationIdea.md §3.1, §3.2

---

## 1. 목표

에이전트 응답에서 **HTML 코멘트 마커 파싱**을 **SDK Function Calling**으로 대체.

### 현재 (마커 기반)
```
에이전트 응답 → "<!-- tunaflow:review-verdict -->verdict: pass..." → 파서가 추출 → UI 반영
```
- 에이전트가 형식을 안 지키면 실패
- 자유 형식 텍스트에서 추출 → 파싱 오류 가능
- 에이전트가 마커를 잊거나 다른 형식으로 쓰면 감지 불가

### 목표 (Function Calling 기반)
```
에이전트 → tool call: submit_review_verdict({ verdict: "pass", findings: [...] }) → JSON 구조화 → 자동 처리
```
- JSON Schema 강제 → 형식 이탈 불가
- 에이전트가 도구를 호출 → tunaFlow가 자동 실행 → 결과 반환
- 마커 파서 불필요

---

## 2. Tool 정의

### 2.1 워크플로우 제어 Tools

| Tool | 호출자 | 기능 |
|------|--------|------|
| `submit_plan_proposal` | Architect | Plan 제안 (title, description, subtasks[]) |
| `mark_subtask_done` | Developer | Subtask 완료 보고 (subtask_number, summary) |
| `mark_implementation_complete` | Developer | 전체 구현 완료 (summary) |
| `submit_review_verdict` | Reviewer | 리뷰 판정 (verdict, findings[], recommendations[]) |

### 2.2 코드베이스 접근 Tools (선택적, Phase 2)

| Tool | 기능 |
|------|------|
| `search_codebase` | rawq 검색 |
| `read_file` | 파일 읽기 |
| `list_directory` | 디렉토리 목록 |

---

## 3. Tool Schema 정의

### submit_review_verdict

```json
{
  "name": "submit_review_verdict",
  "description": "리뷰 결과를 제출합니다. pass/fail/conditional 중 하나를 선택하고 findings와 recommendations를 포함하세요.",
  "parameters": {
    "type": "object",
    "properties": {
      "verdict": {
        "type": "string",
        "enum": ["pass", "fail", "conditional"]
      },
      "findings": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "description": { "type": "string" },
            "file": { "type": "string" },
            "severity": { "type": "string", "enum": ["critical", "major", "minor"] }
          },
          "required": ["description"]
        }
      },
      "recommendations": {
        "type": "array",
        "items": { "type": "string" }
      }
    },
    "required": ["verdict", "findings"]
  }
}
```

### submit_plan_proposal

```json
{
  "name": "submit_plan_proposal",
  "description": "구현 계획을 제안합니다.",
  "parameters": {
    "type": "object",
    "properties": {
      "title": { "type": "string" },
      "description": { "type": "string" },
      "expected_outcome": { "type": "string" },
      "subtasks": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "title": { "type": "string" },
            "details": { "type": "string" }
          },
          "required": ["title"]
        }
      },
      "constraints": { "type": "array", "items": { "type": "string" } },
      "non_goals": { "type": "array", "items": { "type": "string" } }
    },
    "required": ["title", "description", "subtasks"]
  }
}
```

### mark_subtask_done

```json
{
  "name": "mark_subtask_done",
  "description": "Subtask 완료를 보고합니다.",
  "parameters": {
    "type": "object",
    "properties": {
      "subtask_number": { "type": "integer" },
      "summary": { "type": "string" }
    },
    "required": ["subtask_number"]
  }
}
```

### mark_implementation_complete

```json
{
  "name": "mark_implementation_complete",
  "description": "전체 구현 완료를 보고합니다.",
  "parameters": {
    "type": "object",
    "properties": {
      "summary": { "type": "string" }
    },
    "required": ["summary"]
  }
}
```

---

## 4. 아키텍처

### 4.1 Tool Call 처리 흐름

```
SDK 요청 (tools 포함)
  → 에이전트 응답: tool_call
  → ToolCallHandler.execute(tool_name, input)
  → DB/파일 업데이트
  → tool result 반환
  → 에이전트가 결과 기반으로 이어서 응답
```

### 4.2 Rust 구조

```rust
// src-tauri/src/agents/tool_handler.rs

pub struct ToolCallHandler {
    tools: Vec<ToolDefinition>,
}

pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value, // JSON Schema
}

pub struct ToolCallResult {
    pub success: bool,
    pub output: String,
}

impl ToolCallHandler {
    pub fn workflow_tools() -> Self { ... }

    pub async fn execute(
        &self,
        tool_name: &str,
        input: serde_json::Value,
        ctx: &ToolContext,
    ) -> ToolCallResult { ... }
}

pub struct ToolContext {
    pub conversation_id: String,
    pub plan_id: Option<String>,
    pub project_path: Option<String>,
    pub db: DbState,
}
```

### 4.3 SDK별 Tool 전달 방식

| SDK | 요청 필드 | 응답 필드 |
|-----|----------|----------|
| Gemini | `tools[].functionDeclarations` | `candidates[].content.parts[].functionCall` |
| OpenAI | `tools[].function` | `choices[].message.tool_calls` |
| Anthropic | `tools[].input_schema` | `content[].type == "tool_use"` |

각 SDK 모듈에서 공통 `ToolDefinition`을 엔진별 포맷으로 변환.

---

## 5. 마이그레이션 전략

### Phase 1: Tool 정의 + Handler (이번)
- ToolCallHandler 구조체 + 4개 워크플로우 tool
- 각 SDK 모듈에 tool 전달 코드 추가
- tool call 응답 파싱 + 실행

### Phase 2: 마커와 공존
- SDK 사용 시: function calling 우선
- CLI 사용 시: 기존 마커 파싱 유지
- 둘 다 감지: tool call 결과가 있으면 마커 무시

### Phase 3: 마커 파서 제거 (선택적)
- 모든 엔진이 SDK 전환 완료 후
- CLI fallback이 완전히 불필요해지면
- 현재로서는 마커 파서 유지 (CLI 사용 시 필요)

---

## 6. 절대 하지 말 것

1. 마커 파서를 Phase 1에서 제거하지 않음 — CLI fallback에서 필요
2. Tool handler에서 DB write lock을 오래 잡지 않음
3. Tool call 실패 시 silent fail 금지 — 에이전트에게 에러 반환
4. 모든 엔진에 tool을 강제하지 않음 — SDK 사용 엔진만

---

## 7. 파일 변경 예상

| 파일 | 변경 |
|------|------|
| `src-tauri/src/agents/tool_handler.rs` | 신규 — Tool 정의 + 실행 |
| `src-tauri/src/agents/gemini_sdk.rs` | tools 파라미터 추가 + tool call 파싱 |
| `src-tauri/src/agents/openai_sdk.rs` | tools 파라미터 추가 + tool call 파싱 |
| `src-tauri/src/agents/anthropic_sdk.rs` | tools 파라미터 추가 + tool call 파싱 |
| `src-tauri/src/agents/mod.rs` | `pub mod tool_handler;` |
| `src-tauri/src/commands/agents.rs` | ToolCallHandler 생성 + 전달 |
