# 레퍼런스 레포 재검토 (v2) — 현재 개발 상태 기준

> Status: idea
> Created: 2026-04-04
> 이전: 세션 5에서 최초 분석, 이번 세션에서 상세 재검토

---

## 1. 재검토 배경

tunaFlow가 세션 5 이후 크게 진척됨:
- 워크플로우 풀사이클 (Plan→Dev→Review→Done) 4회 완료 (tunaInsight)
- 벡터 검색 + FTS5 하이브리드 구현
- 토픽별 메모리 압축
- 스킬 자동 적용 (A/B/C/D 전부)
- Doom Loop 감지 + Budget Pressure
- Compression pre-pass
- 리팩토링 v2 Tier 1 완료

이 상태에서 `_research/_util/` 레포들을 재평가.

---

## 2. code-review-graph — 워크플로우 Reviewer 강화

### 개요

Python 12,900줄. tree-sitter 18언어. SQLite 그래프 스토어. MCP 서버 내장 (22개 도구). 486+ 테스트.

### rawq와의 역할 분담

```
rawq:              "이 키워드와 관련된 코드 어디에?"  → 검색 (Search)
code-review-graph: "이 코드를 바꾸면 어디가 깨져?"  → 탐색 (Traverse)
```

| 기능 | rawq | code-review-graph |
|------|------|-------------------|
| 의미 기반 코드 검색 | ✅ 주력 | 보조 (사용 안 함) |
| 관계 그래프 (caller/callee) | ❌ | ✅ 주력 |
| blast-radius 분석 | ❌ | ✅ BFS 2-hop |
| 테스트 매핑 | ❌ | ✅ TESTED_BY 엣지 |
| risk scoring | ❌ | ✅ 중심성+보안 |
| 커뮤니티 감지 | ❌ | ✅ Leiden 알고리즘 |
| 실행 흐름 추적 | ❌ | ✅ entry point → flow |
| 임베딩 daemon | ✅ ONNX 상주 | ❌ |
| 대화 임베딩 제공 | ✅ embed_text() | ❌ |

**겹치는 부분** (코드 검색, AST 파싱, 파일 인덱싱)은 rawq가 담당. code-review-graph는 **그래프 탐색 전용**으로 사용.

### 통합 방식: sidecar (rawq 패턴)

```rust
// agents/crg.rs (~150줄)
// rawq.rs와 완전히 같은 패턴

pub fn impact_radius(project_path: &str, changed_files: &[String], depth: u32) 
    -> Result<ImpactResult, CrgError> 
{
    let output = Command::new(resolve_bin()?)
        .args(["detect-changes", "--json", "--max-depth", &depth.to_string()])
        .args(changed_files)
        .current_dir(project_path)
        .output()?;
    parse_impact_json(&output.stdout)
}

pub fn callers_of(project_path: &str, qualified_name: &str) -> Result<Vec<GraphNode>, CrgError> {
    // code-review-graph query --callers-of "path::fn_name" --json
}

pub fn tests_for(project_path: &str, qualified_name: &str) -> Result<Vec<GraphNode>, CrgError> {
    // code-review-graph query --tests-for "path::fn_name" --json
}
```

**왜 MCP가 아니라 sidecar인가**: 워크플로우 중에만 호출 (드묾). 상시 Python 프로세스(~50MB)를 띄울 이유 없음.

**Python 의존성**: 사용자가 `pip install code-review-graph`. 미설치 시 graceful skip. 나중에 PyInstaller 바이너리 옵션.

### 활용 위치

| 워크플로우 단계 | 호출 | 목적 |
|---------------|------|------|
| Developer 실행 시 | `impact_radius(changed_files)` | "이 파일 수정 시 영향 범위" 프롬프트에 포함 |
| Reviewer 실행 시 | `tests_for(changed_functions)` | "변경 함수의 테스트 커버리지" 리뷰 프롬프트에 포함 |
| Reviewer 실행 시 | `detect_changes(diff)` | risk-scored 변경 목록 제공 |

### 도입 트리거 (기존 문서 유지)

1. "변경 영향 범위를 놓쳤다"는 리뷰 피드백이 2회 이상 반복
2. "테스트 커버리지 판단이 어렵다"는 Reviewer 불만
3. 프로젝트 규모 100+ 파일
4. 워크플로우 풀사이클 3회 이상 완료 ← **이미 충족 (tunaInsight 4회)**

**4번이 충족되었으므로**, 1-2번 피드백이 한 번 더 나오면 도입 시점입니다.

### Rust 재구현 (장기)

sidecar 검증 후, 호출 빈도가 높거나 Python 의존성이 문제되면 핵심만 Rust 포팅. tree-sitter는 rawq에서 이미 사용 중이라 파서 재활용 가능. 다만 graph.py(893줄) + parser.py(1923줄) 포팅은 확실한 필요성 확인 후에.

---

## 3. claw-code — SDK 전환 시 하네스 설계 참고

### 개요

Claude Code 클린룸 리라이트. Rust 20K줄, 6개 크레이트 (api, runtime, tools, commands, cli, compat-harness).

### 참고할 패턴

| 패턴 | claw-code 구현 | tunaFlow 적용 시점 |
|------|---------------|-------------------|
| **3-tier Permission** | ReadOnly / WorkspaceWrite / DangerFullAccess | SDK 전환 후 (에이전트별 도구 제한) |
| **Pre/PostToolUse Hook** | 쉘 스크립트 실행, exit code로 allow/deny | SDK 전환 후 (function calling 시 검증) |
| **Config 3단계** | user → project → local 오버라이드 | Settings 리팩토링 시 |
| **Token 기반 Compaction** | 200K 토큰 초과 시 자동 요약 | 현재 12+ 메시지 트리거 → 토큰 기반으로 변경 검토 |
| **MCP 네임스페이싱** | `mcp__server__tool` | MCP 통합 시 |

### 현재 tunaFlow에 없는 것 중 가치 있는 것

**Permission 모델**:
```
현재: 모든 에이전트가 동일한 권한. Developer도 Reviewer도 같은 도구 사용 가능.
claw-code: ReadOnly (Reviewer) / WorkspaceWrite (Developer) / DangerFullAccess (관리자)
```

SDK 전환 후 function calling에서 역할별 도구 제한에 직접 적용. `allowedTools` (clawSouls 패턴)과 결합.

**Hook 시스템**:
```
현재: 에이전트 실행 전후에 커스텀 로직 없음.
claw-code: PreToolUse → "rm -rf 명령 감지 → 차단", PostToolUse → "파일 변경 로그"
```

tunaFlow의 guardrail 강화에 활용 가능. 현재 `PLATFORM_TIER0` 프롬프트 주입만으로 제어하는 것의 한계.

### 적용 시점

**SDK 전환 아이디어 (`sdkIntegrationIdea.md`)가 구현될 때.** 현재 CLI subprocess 방식에서는 Permission 모델과 Hook이 의미 없음 (에이전트 내부를 제어할 수 없으므로).

---

## 4. agentscope — 선택적 패턴 채택

### 개요

Python. 기업급 멀티 에이전트 프레임워크. MsgHub, Pipeline, PlanNotebook, OTel tracing.

### 재평가 결과

**tunaFlow가 이미 agentscope보다 더 정교한 부분**:
- 토픽 기반 메모리 압축 (agentscope는 flat summary)
- 인간 참여 워크플로우 (agentscope는 에이전트 자율)
- 선택적 메모리 주입 (agentscope는 전체 주입)

**agentscope에서 가져올 가치가 있는 것**:

| 패턴 | 가치 | 적용 시점 |
|------|------|----------|
| **OTel 중첩 스팬** | 높음 | Trace 고도화 시 — RT round → agent → LLM call 트리 시각화 |
| **Plan Hints** | 중간 | 지금 — Developer에게 "현재 subtask 상태" 힌트 주입 (~10줄) |
| **MsgHub 브로드캐스트** | 중간 | RT 리팩토링 시 — event→reload 대신 subscriber 패턴 |
| Memory Mark 필터링 | 낮음 | 불필요 — 토픽 기반이 이미 더 좋음 |
| Pipeline 추상화 | 낮음 | 불필요 — 현재 규모에서 과도 |

### OTel 중첩 스팬 상세

현재 trace_log는 **flat** (스팬 간 부모-자식 관계 없음):
```
span1: agent.stream claude 2000ms
span2: agent.stream gemini 3000ms
span3: agent.stream claude 1500ms
```

OTel 중첩으로 전환하면:
```
RT round 1 (6500ms)
├── Reviewer-A claude (2000ms, $0.02)
├── Reviewer-B gemini (3000ms, $0.01)
└── Synthesizer claude (1500ms, $0.015)
```

어떤 에이전트/모델이 비싼지, 느린지 한눈에 파악. `traceEnhancementAbtopIdea.md`의 토큰 속도 시각화와 결합하면 강력한 디버깅 도구.

---

## 5. 나머지 레포 — 추가 검토 불필요

| 레포 | 상태 | 이유 |
|------|------|------|
| **chops** | 보류 | 멀티툴 스킬 스캔은 스킬 100+개 시. 현재 246개지만 tunaFlow 단독 사용이라 불필요 |
| **entroly** | 완료 | SimHash+LSH는 5000+ 청크 시 검토. 나머지 불채택 확정 |
| **opendev** | 완료 | Doom Loop, compression pre-pass 모두 구현 완료 |
| **hermes-agent** | 완료 | Budget pressure, Toolset composition 구현 완료 |
| **speedy-claude** | 완료 | CLI 도구 최적화 실측까지 완료 |
| **claw-compactor** | 완료 | QuantumLock은 SDK 전환 시. 나머지 불채택 |
| **claude-code** | 완료 | SDK 패턴 문서화 완료 |
| **abtop** | 완료 | Trace 고도화 문서화 완료 |
| **takopi/\*** | 불필요 | 메시징 플랫폼 연동 — tunaFlow와 무관 |

---

## 6. 우선순위 정리

### 지금 할 수 있는 것

| 항목 | 출처 | 규모 |
|------|------|------|
| **Plan Hints** — Developer에게 현재 subtask 상태 힌트 | agentscope | ~10줄 (ContextPack 조립에 추가) |

### 트리거 충족 시

| 항목 | 출처 | 트리거 |
|------|------|--------|
| **code-review-graph sidecar** | code-review-graph | 리뷰 피드백 "영향 범위 누락" 1-2회 더 |
| **OTel 중첩 스팬** | agentscope | Trace 고도화 착수 시 |

### SDK 전환 시

| 항목 | 출처 |
|------|------|
| **Permission 모델 (3-tier)** | claw-code |
| **Pre/PostToolUse Hook** | claw-code |
| **MCP 네임스페이싱** | claw-code |
| **QuantumLock (캐시 안정화)** | claw-compactor |

---

## 참고

### 레포 위치
- code-review-graph: `_research/_util/code-review-graph/` (Python 12,900줄)
- claw-code: `_research/_util/claw-code/` (Rust 20K줄)
- agentscope: `_research/_util/agentscope/` (Python)

### 관련 아이디어 문서
- `workflowGraphEnhancementIdea.md` — 워크플로우에서 graph 활용 설계
- `rawqGraphEvolutionStrategyIdea.md` — rawq + graph 통합 전략
- `sdkIntegrationIdea.md` — SDK 전환 설계 (Permission, Hook 적용 시점)
- `traceEnhancementAbtopIdea.md` — Trace 고도화 (OTel과 결합)
- `clawSoulsPersonaSpecIdea.md` — allowedTools 패턴 (Permission과 결합)

### 핵심 파일 참조
- code-review-graph:
  - `code_review_graph/parser.py` (1923줄) — AST 파싱
  - `code_review_graph/graph.py` (893줄) — 그래프 스토어 + impact 분석
  - `code_review_graph/changes.py` (295줄) — risk-scored 변경 분석
  - `code_review_graph/search.py` (391줄) — hybrid 검색 (사용 안 함, rawq 담당)
- claw-code:
  - `rust/crates/runtime/src/permissions.rs` — 3-tier Permission
  - `rust/crates/runtime/src/hooks.rs` — Pre/PostToolUse Hook
  - `rust/crates/runtime/src/config.rs` — 3단계 config 계층
  - `rust/crates/runtime/src/compact.rs` — 토큰 기반 compaction
- agentscope:
  - `src/agentscope/tracing/_trace.py` (647줄) — OTel 데코레이터
  - `src/agentscope/pipeline/_msghub.py` (157줄) — 메시지 브로드캐스트
  - `src/agentscope/plan/_plan_notebook.py` (400줄) — Plan Hints
