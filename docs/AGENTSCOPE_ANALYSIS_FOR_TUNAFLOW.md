# AgentScope Analysis for tunaFlow

## A. Executive Summary
AgentScope는 Python 기반의 에이전트 프레임워크지만, tunaFlow 관점에서 중요한 건 프레임워크 전체보다 몇 개의 잘 잘린 런타임 패턴이다. README 기준으로 AgentScope는 memory, planning, MCP/A2A, message hub, evaluation, OTel tracing을 핵심 축으로 내세운다 ([README.md](/D:/privateProject/_research/_util/agentscope/README.md#L58), [README.md](/D:/privateProject/_research/_util/agentscope/README.md#L68)).

tunaFlow는 이미 Tauri/Rust 기반 오케스트레이션 IDE, Branch 전용 스트림, Roundtable, ContextPack, Skill, Memo/Artifact, guardrail, streaming을 갖고 있다. 그래서 가치가 있는 건 AgentScope처럼 다시 만들자가 아니라, 이미 있는 구조에 바로 얹을 수 있는 작은 단위다.

실제 코드 기준으로 가장 유의미한 후보는 5개다.
1. 대화 이력 압축형 메모리
2. MsgHub식 멀티에이전트 broadcast/workflow 패턴
3. PlanNotebook식 계획 상태 관리와 frontend hook
4. Toolkit의 tool-group/MCP/skill 추상화
5. OTel 기반 tracing

반대로 runtime/sandbox는 이 repo 내부 모듈이 아니라 외부 `agentscope-runtime` 링크 중심이라, 현재 저장소만 기준으로는 core 이식 대상으로 보기 어렵다 ([README.md](/D:/privateProject/_research/_util/agentscope/README.md#L91)).

## B. Confirmed Features Worth Considering

| 기능명 | AgentScope 내 위치 | 실제 하는 일 | tunaFlow와 닿는 지점 | 도입 우선순위 |
|---|---|---|---|---|
| Short-term memory compression | [`ReActAgent.CompressionConfig` in `_react_agent.py`](/D:/privateProject/_research/_util/agentscope/src/agentscope/agent/_react_agent.py#L107), [`_compress_memory_if_needed`](/D:/privateProject/_research/_util/agentscope/src/agentscope/agent/_react_agent.py#L1011), [`MemoryBase`](/D:/privateProject/_research/_util/agentscope/src/agentscope/memory/_working_memory/_base.py#L11) | 토큰 임계치 초과 시 오래된 메시지를 구조화 요약으로 압축하고, 원본 메시지엔 `compressed` mark를 붙여 제외 | ContextPack, Branch, cross-session context, Guardrail, Memo | 높음 |
| Marked memory + DB backends | [`AsyncSQLAlchemyMemory`](/D:/privateProject/_research/_util/agentscope/src/agentscope/memory/_working_memory/_sqlalchemy_memory.py#L30), [`InMemoryMemory`](/D:/privateProject/_research/_util/agentscope/src/agentscope/memory/_working_memory/_in_memory_memory.py#L10) | 메시지에 mark를 붙이고, compressed summary를 prepend하며, 메모리를 SQLite/Postgres/MySQL로 저장 가능 | 현재 `memos`, `messages`, branch stream, cross-session context | 중간 |
| MsgHub broadcast hub | [`MsgHub`](/D:/privateProject/_research/_util/agentscope/src/agentscope/pipeline/_msghub.py#L14), multi-agent conversation example ([main.py](/D:/privateProject/_research/_util/agentscope/examples/workflows/multiagent_conversation/main.py#L48)) | 참여자 구독을 리셋하고, participant reply를 다른 participant에게 자동 broadcast | Roundtable, multi-agent routing, branch 내 토론 스트림 | 높음 |
| Sequential/Fanout/stream workflow | [`sequential_pipeline`](/D:/privateProject/_research/_util/agentscope/src/agentscope/pipeline/_functional.py#L10), [`fanout_pipeline`](/D:/privateProject/_research/_util/agentscope/src/agentscope/pipeline/_functional.py#L47), [`stream_printing_messages`](/D:/privateProject/_research/_util/agentscope/src/agentscope/pipeline/_functional.py#L107) | 순차 실행, 병렬 fanout, 실행 중간 메시지 수집 스트림 제공 | Roundtable 2라운드, future harness, streaming UI | 높음 |
| Plan notebook + hooks | [`PlanNotebook`](/D:/privateProject/_research/_util/agentscope/src/agentscope/plan/_plan_notebook.py#L172), [`list_tools`](/D:/privateProject/_research/_util/agentscope/src/agentscope/plan/_plan_notebook.py#L821), [`get_current_hint`](/D:/privateProject/_research/_util/agentscope/src/agentscope/plan/_plan_notebook.py#L845), [`register_plan_change_hook`](/D:/privateProject/_research/_util/agentscope/src/agentscope/plan/_plan_notebook.py#L866) | 계획 생성/수정/복구/완료를 tool로 노출하고, 현재 plan을 hint message로 주입하며, 변경 훅으로 외부 UI 갱신 가능 | Branch, Artifact, future harness, planner UI | 높음 |
| Tool groups + meta tool | [`Toolkit`](/D:/privateProject/_research/_util/agentscope/src/agentscope/tool/_toolkit.py#L117), [`register_tool_function`](/D:/privateProject/_research/_util/agentscope/src/agentscope/tool/_toolkit.py#L269), [`reset_equipped_tools`](/D:/privateProject/_research/_util/agentscope/src/agentscope/tool/_toolkit.py#L1027) | 도구를 group으로 묶고 활성/비활성 전환, notes를 prompt에 반영 | Skill, future tool routing, Guardrail | 높음 |
| MCP client abstraction | [`HttpStatelessClient`](/D:/privateProject/_research/_util/agentscope/src/agentscope/mcp/_http_stateless_client.py#L16), [`StatefulClientBase`](/D:/privateProject/_research/_util/agentscope/src/agentscope/mcp/_stateful_client_base.py#L16), [`Toolkit.register_mcp_client`](/D:/privateProject/_research/_util/agentscope/src/agentscope/tool/_toolkit.py#L817) | stateful/stateless MCP client를 만들고 tool 목록을 가져와 Toolkit에 등록 | MCP support, Skill/Tool abstraction, external tool server 연계 | 높음 |
| Agent skill registration | [`register_agent_skill`](/D:/privateProject/_research/_util/agentscope/src/agentscope/tool/_toolkit.py#L1105), [`get_agent_skill_prompt`](/D:/privateProject/_research/_util/agentscope/src/agentscope/tool/_toolkit.py#L1188) | SKILL.md 메타데이터를 읽어 system prompt용 skill index를 구성 | 현재 tunaFlow skill 최소 버전의 상위 패턴 | 중간 |
| OTel tracing | [`agentscope.init(...tracing_url...)`](/D:/privateProject/_research/_util/agentscope/src/agentscope/__init__.py#L72), [`setup_tracing`](/D:/privateProject/_research/_util/agentscope/src/agentscope/tracing/_setup.py#L11), tracing decorators ([`_trace.py`](/D:/privateProject/_research/_util/agentscope/src/agentscope/tracing/_trace.py#L192)) | agent/tool/formatter/model 호출을 OpenTelemetry span으로 기록 | `trace_log` schema, usage 추적, Roundtable 관측성, future harness | 높음 |
| Evaluation + resumable storage | [`EvaluatorBase`](/D:/privateProject/_research/_util/agentscope/src/agentscope/evaluate/_evaluator/_evaluator_base.py#L18), [`FileEvaluatorStorage`](/D:/privateProject/_research/_util/agentscope/src/agentscope/evaluate/_evaluator_storage/_file_evaluator_storage.py#L16) | solution/evaluation 결과를 파일로 저장하고, 미완료 task를 건너뛰며 집계 가능 | evaluation harness, regression check, roundtable quality eval | 중간 |
| A2A agent-card resolvers | [`FileAgentCardResolver`](/D:/privateProject/_research/_util/agentscope/src/agentscope/a2a/_file_resolver.py#L15), well-known/nacos resolvers | remote agent card를 파일/URL/Nacos에서 읽음 | 장기적 multi-agent routing, external agent registry | 낮음 |
| HITL interruption pattern | [`handle_interrupt`](/D:/privateProject/_research/_util/agentscope/src/agentscope/agent/_react_agent.py#L795), cancellation handling ([`_react_agent.py`](/D:/privateProject/_research/_util/agentscope/src/agentscope/agent/_react_agent.py#L623)) | 스트리밍 중 취소 시 tool_result 보정과 후속 응답 제공 | streaming UI, stop/resume UX | 중간 |

## C. Best Migration Candidates for tunaFlow

### 1. Memory compression
- 왜 좋은가: tunaFlow는 이미 `ContextPack`을 조합하고 섹션별 길이 제한도 둔다 ([agents.rs](/D:/privateProject/tunaFlow/src-tauri/src/commands/agents.rs#L379), [guardrail.rs](/D:/privateProject/tunaFlow/src-tauri/src/guardrail.rs#L7)). 그런데 현재는 잘라내기 중심이고, AgentScope는 구조화 요약으로 대체한다.
- 어디에 붙일까: `send_with_claude`/streaming 경로의 ContextPack 조립 직전, Branch/parent/cross-session 로딩 결과를 압축 요약 캐시로 교체.
- 전체 도입 vs 부분 차용: 전체 도입이 아니라 `_compress_memory_if_needed`의 알고리즘과 `SummarySchema` 패턴만 차용.
- 난이도: 중간
- 리스크: 요약 품질이 낮으면 분기별 맥락 손실 가능. raw truncation보다 검증 포인트가 하나 더 필요.

### 2. MsgHub + fanout/sequential workflow
- 왜 좋은가: tunaFlow Roundtable은 현재 프롬프트를 직접 조합해서 participant를 순서대로 돌린다 ([roundtable.rs](/D:/privateProject/tunaFlow/src-tauri/src/commands/roundtable.rs#L76)). AgentScope의 MsgHub는 누가 누구를 observe해야 하는가를 별도 abstraction으로 분리한다.
- 어디에 붙일까: Roundtable executor 내부. 특히 `prior_round_refs`, `current_round_refs`를 계산하는 부분을 broadcast graph로 일반화.
- 전체 도입 vs 부분 차용: 전체 subsystem이 아니라 MsgHub의 participant/subscriber 패턴과 `fanout_pipeline` 실행 전략만 Rust로 재구현.
- 난이도: 중간
- 리스크: 현재 DB message persist 순서와 UI 표시 순서를 유지해야 한다.

### 3. PlanNotebook + plan change hook
- 왜 좋은가: tunaFlow는 Branch/Artifact/Conversation 구조가 이미 있으므로 계획 그 자체를 별도 1급 상태로 다루면 multi-step 작업 가시성이 급상승한다. AgentScope는 plan을 tool 집합으로 노출하고, hook으로 frontend 반영 지점을 제공한다 ([`register_plan_change_hook`](/D:/privateProject/_research/_util/agentscope/src/agentscope/plan/_plan_notebook.py#L866)).
- 어디에 붙일까: Branch 또는 Conversation 스코프의 planning panel. Subtask 완료 시 Artifact/Memo 생성 트리거와 연결 가능.
- 전체 도입 vs 부분 차용: 전체 plan 모듈 이식보다 `Plan`, `SubTask`, history restore, hook 인터페이스만 차용.
- 난이도: 중간
- 리스크: DB 스키마 확장이 필요할 가능성이 높다. 현재 구조를 깨지 않으려면 별도 `plan_state`류 테이블이 안전하다.

### 4. Toolkit의 tool-group/MCP abstraction
- 왜 좋은가: tunaFlow skill은 현재 `SKILL.md` 로딩과 prompt 주입에 가깝다 ([skills.rs](/D:/privateProject/tunaFlow/src-tauri/src/commands/skills.rs#L25), [agents.rs](/D:/privateProject/tunaFlow/src-tauri/src/commands/agents.rs#L91)). AgentScope는 여기에 tool group activation, MCP bulk registration, notes 기반 prompt generation까지 얹는다.
- 어디에 붙일까: 현재 command layer 위의 tool capability registry 계층. Skill, MCP tool, local command tool을 같은 슬롯으로 관리.
- 전체 도입 vs 부분 차용: 전체 Toolkit 이식이 아니라 `group`, `active/inactive`, `notes`, `register_mcp_client` 개념만 차용.
- 난이도: 중간
- 리스크: 지금은 엔진별 호출 경로가 단순해서, 도구 스키마를 너무 빨리 일반화하면 오히려 복잡해질 수 있다.

### 5. OTel tracing
- 왜 좋은가: tunaFlow는 대화/토큰/비용 누적은 있지만, span 단위 관측은 없다. `trace_log`는 스키마만 있고 실제 기록은 확인되지 않았다 ([schema.rs](/D:/privateProject/tunaFlow/src-tauri/src/db/schema.rs#L125)). AgentScope는 agent/tool/model/formatter 호출을 전부 span으로 감싼다.
- 어디에 붙일까: `commands/agents.rs`, `commands/roundtable.rs`, 엔진 adapter 호출부.
- 전체 도입 vs 부분 차용: 전체 tracing decorator 시스템이 아니라 span taxonomy와 attribute schema만 차용해 Rust `tracing` + OTel exporter로 구현.
- 난이도: 중간
- 리스크: 초기에는 데이터량이 많아질 수 있다. conversation/branch/message id 중심의 최소 span schema부터 시작해야 한다.

## D. What NOT to Migrate
- AgentScope 전체 ReActAgent 프레임워크: tunaFlow는 이미 multi-engine CLI adapter와 Tauri command layer가 중심이라, core agent runtime을 통째로 바꾸면 구조 충돌이 크다.
- Long-term memory 통합체 `mem0`/`ReMe`: 실제로는 외부 라이브러리와 벡터 저장소 의존이 크다. 지금 tunaFlow의 Memo/Artifact 수준과는 결이 다르다.
- A2A의 Nacos resolver: enterprise registry 전제가 강하다. 현재 tunaFlow 로컬 엔진 오케스트레이션에는 과하다.
- Realtime voice/TTS: AgentScope에 존재하지만 tunaFlow 현재 문제축과 직접 연결되는 근거가 약하다.
- Runtime/sandbox: 이 repo 내부 기능이 아니라 외부 `agentscope-runtime` 중심이다. 현재 저장소만 기준으로는 이식 대상 코드를 확인할 수 없다 ([README.md](/D:/privateProject/_research/_util/agentscope/README.md#L91)).
- Deployment 예제 전체: Quart 서버 기반 예제는 참고용이며, Tauri desktop command model과 직접 맞지 않는다 ([planning_agent README](/D:/privateProject/_research/_util/agentscope/examples/deployment/planning_agent/README.md#L3)).

## E. Suggested Next Steps

### 1단계
- ContextPack 압축 실험을 먼저 하라.
- `current_context + parent_context + cross_session_data`를 입력으로 받아 `Task Overview / Current State / Important Discoveries / Next Steps / Context to Preserve` 형식의 요약 캐시를 만드는 작은 Rust 모듈을 붙이는 게 가장 ROI가 크다.

### 2단계
- Roundtable executor를 MsgHub 패턴으로 리팩터링하라.
- DB/메시지 스키마는 그대로 두고, 내부 실행 모델만 `broadcast`, `fanout`, `sequential` 전략으로 분리하면 재사용성이 생긴다.

### 3단계
- 관측성과 평가를 묶어 future harness를 만들어라.
- 우선 OTel span과 file-based eval result 저장부터 만들고, 그 위에 roundtable 품질 회귀 테스트를 올리는 순서가 맞다.

## F. File Map
- [README.md](/D:/privateProject/_research/_util/agentscope/README.md): AgentScope가 공식적으로 어떤 기능을 핵심으로 보는지 확인하는 출발점. tunaFlow에 무엇을 볼 가치가 있는지 우선순위를 잡는 근거.
- [src/agentscope/agent/_react_agent.py](/D:/privateProject/_research/_util/agentscope/src/agentscope/agent/_react_agent.py): memory compression, plan integration, interrupt handling의 핵심 구현.
- [src/agentscope/memory/_working_memory/_base.py](/D:/privateProject/_research/_util/agentscope/src/agentscope/memory/_working_memory/_base.py): compressed summary와 message mark 개념의 최소 인터페이스.
- [src/agentscope/memory/_working_memory/_sqlalchemy_memory.py](/D:/privateProject/_research/_util/agentscope/src/agentscope/memory/_working_memory/_sqlalchemy_memory.py): DB-backed memory가 실제로 어떻게 잘리는지 확인하는 파일.
- [src/agentscope/pipeline/_msghub.py](/D:/privateProject/_research/_util/agentscope/src/agentscope/pipeline/_msghub.py): Roundtable에 가장 직접적으로 참고할 broadcast orchestration 패턴.
- [src/agentscope/pipeline/_functional.py](/D:/privateProject/_research/_util/agentscope/src/agentscope/pipeline/_functional.py): sequential/fanout/stream 수집 전략.
- [src/agentscope/plan/_plan_notebook.py](/D:/privateProject/_research/_util/agentscope/src/agentscope/plan/_plan_notebook.py): plan state, recover, hint, frontend hook까지 들어 있는 핵심 파일.
- [src/agentscope/tool/_toolkit.py](/D:/privateProject/_research/_util/agentscope/src/agentscope/tool/_toolkit.py): tool-group, MCP 등록, agent skill prompt 패턴이 모여 있음.
- [src/agentscope/mcp/_http_stateless_client.py](/D:/privateProject/_research/_util/agentscope/src/agentscope/mcp/_http_stateless_client.py): 가벼운 MCP client 패턴.
- [src/agentscope/tracing/_setup.py](/D:/privateProject/_research/_util/agentscope/src/agentscope/tracing/_setup.py): OTel exporter 연결 지점.
- [src/agentscope/tracing/_trace.py](/D:/privateProject/_research/_util/agentscope/src/agentscope/tracing/_trace.py): agent/tool/model span 래핑 방식.
- [src/agentscope/evaluate/_evaluator/_evaluator_base.py](/D:/privateProject/_research/_util/agentscope/src/agentscope/evaluate/_evaluator/_evaluator_base.py): future harness용 resumable evaluation 집계 패턴.
- [src/agentscope/evaluate/_evaluator_storage/_file_evaluator_storage.py](/D:/privateProject/_research/_util/agentscope/src/agentscope/evaluate/_evaluator_storage/_file_evaluator_storage.py): file-based evaluation persistence 패턴.
- [src-tauri/src/commands/agents.rs](/D:/privateProject/tunaFlow/src-tauri/src/commands/agents.rs): tunaFlow의 현재 ContextPack 조립 지점. memory compression과 tool/skill abstraction이 붙을 자리.
- [src-tauri/src/commands/roundtable.rs](/D:/privateProject/tunaFlow/src-tauri/src/commands/roundtable.rs): MsgHub/pipeline 패턴을 부분 차용할 1순위 위치.
- [src-tauri/src/guardrail.rs](/D:/privateProject/tunaFlow/src-tauri/src/guardrail.rs): 현재는 truncation 기반이라 compression 대체 가치가 큰 지점.
- [src-tauri/src/db/schema.rs](/D:/privateProject/tunaFlow/src-tauri/src/db/schema.rs): `trace_log`, memos, artifacts, branches가 정의돼 있어 tracing/plan/eval 도입 시 제약을 판단하는 기준.
