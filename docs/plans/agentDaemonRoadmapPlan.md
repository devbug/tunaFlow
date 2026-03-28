# tunaFlow Agent Daemon Roadmap Plan

- 작성자: OpenAI Codex
- 작성 시각: 2026-03-28 22:40 KST
- 상태: Phase 1-2 구현 완료, Phase 3 이후 진행 예정

## 목적

`tunaFlow`의 장기 agent 실행 구조를 현재의 **Tauri command 중심 실행**에서 벗어나,
최종적으로는 **별도 agent daemon (`agentd`) 기반 구조**로 승격하는 장기 로드맵을 정리한다.

이 문서는 단기 실행 프롬프트가 아니라 상위 설계 문서다.

핵심 목표:

1. 답변 중에도 UI가 막히지 않음
2. 앱 재시작/이벤트 누락이 있어도 결과 유실 없이 복구 가능
3. Claude / Codex / Gemini / OpenCode / RT를 공통 job 모델로 다룸
4. 장기적으로 `tunaChat` / `tunaDish` / `tunaFlow`가 공유 가능한 실행 백엔드 기반을 마련

## 배경

현재 `tunaFlow`는 Tauri app 내부에서:

- 긴 subprocess 실행
- progress / chunk event emit
- DB 기록
- cancel 처리

를 함께 수행한다.

프론트 렌더 최적화를 일부 진행한 뒤에도,
agent 진행 중 스크롤/패널 상호작용이 막히는 현상이 남아 있다.

이는 단순 React 문제를 넘어서,
**장기 실행이 여전히 앱 프로세스와 너무 가깝게 결합되어 있기 때문**으로 보는 것이 타당하다.

반면 `tunaChat` / `tunaDish` 계열은 `pi/tunapi`가 장기 실행을 맡아 UI 응답성은 더 좋았지만,
websocket disconnect 시 응답 유실 리스크가 있었다.

`tunaFlow`의 목표는 이 둘의 장점을 결합하는 것이다.

- 응답성은 `tunapi` 수준으로 개선
- 복구성은 SQLite SSOT 기반으로 강화

## 최종 목표 구조

```text
Frontend (Tauri WebView)
  -> local app shell / UI / event subscribe / DB requery
  -> lightweight control commands only

Tauri host
  -> window/app lifecycle
  -> local DB access
  -> daemon connection bridge

Agent Daemon (agentd)
  -> job queue
  -> subprocess lifecycle
  -> progress/chunk/completed/error events
  -> cancel/retry/reconnect support
  -> engine adapters (claude/codex/gemini/opencode/rt)

SQLite
  -> jobs / messages / traces / checkpoints / final SSOT
```

핵심 원칙:

- daemon은 실행 담당
- DB는 진실원(SSOT)
- UI는 event를 놓쳐도 DB로 복구

## 왜 daemon이 필요한가

### 1. UI 응답성 분리

가장 큰 이유는 프로세스 분리다.

장기 subprocess 실행과 stdout/stderr 파싱, chunk emission이
앱 프로세스 밖에서 일어나면,
WebView/윈도우 입력 응답성과 분리하기 쉬워진다.

### 2. 공통 job 모델

현재는 엔진별 구현이 조금씩 다르다.

- Claude: stream-json
- Gemini: stream-json
- Codex: JSONL/one-shot 계열
- OpenCode: one-shot
- RT: multi-participant loop

daemon으로 가면 이들을 모두 아래 공통 모델로 수렴시키기 쉽다.

- job start
- progress
- chunk
- complete
- error
- cancel

### 3. 앱 재시작 복구

daemon + DB 구조면,
앱이 재시작되어도:

- 현재 실행 중 job 상태 재조회
- 마지막 메시지 상태 재조회
- trace/job registry 재동기화

가 가능해진다.

즉 `tunapi/ws`의 “끊기면 유실” 문제를 그대로 반복하지 않아도 된다.

### 4. 제품군 공용 백엔드 가능성

장기적으로는 `tunaChat`, `tunaDish`, `tunaFlow`가
같은 실행 백엔드를 공유하는 것도 가능하다.

이 문서는 그 가능성을 열어두되,
지금 당장 그 범위까지 구현하자는 뜻은 아니다.

## 왜 바로 daemon으로 가지 않는가

바로 daemon으로 가면 한 번에 늘어나는 문제가 많다.

- 프로세스 lifecycle
- local IPC/ws/named pipe 프로토콜
- reconnect
- version skew
- daemon crash recovery
- install/start/stop/update
- security boundary
- DB ownership 정리

즉 최종 방향은 daemon이 맞지만,
구조적으로는 **단계적 승격**이 더 안전하다.

## 단계별 로드맵

### Phase 1 — In-process background worker ✅ 구현 완료 (2026-03-28)

참조 문서:
- `backgroundAgentExecutionPlan.md`

구현 결과:
- `start_claude_stream`, `start_gemini_stream`, `start_codex_run`, `start_opencode_run` 커맨드 추가
- `DbState.write`를 `Arc<Mutex<Connection>>`으로 전환하여 background thread 공유
- `agent:completed`, `agent:error` 이벤트로 완료/에러 통지
- Frontend runtimeSlice를 event-driven 패턴으로 전환
- Gemini CLI `--output-format stream-json` 기반 실시간 스트리밍 추가

목표:

- 긴 agent 실행을 synchronous command lifecycle에서 분리
- `start_*` command는 즉시 반환
- 실제 실행은 background worker/task에서 수행
- 진행/완료는 event
- 결과는 DB에 기록

범위:

- Claude
- Gemini
- Codex
- OpenCode
- RT는 후속

이 단계의 의미:

- UI block의 가장 직접적 원인을 줄인다
- 이후 daemon 전환을 위한 job/event/DB 구조를 앱 내부에서 먼저 검증한다

### Phase 2 — Durable job registry ✅ 구현 완료 (2026-03-28)

구현 결과:
- DB migration v10: `agent_jobs` 테이블 (id, conversation_id, message_id, engine, kind, status, error, started_at, updated_at)
- `create_job`, `complete_job`, `list_active_jobs`, `cleanup_stale_jobs` 커맨드
- 4개 start_* agent + 2개 start_roundtable_* 커맨드에 job 기록 통합
- App startup 시 stale job/streaming message 자동 정리
- TracePanel에 Active Jobs 가시화

목표:

- in-memory 기준의 실행 상태를 durable하게 기록
- 앱 재시작/복구/관측을 위해 job 테이블 또는 job 상태 레이어 도입

권장 데이터:

- `job_id`
- `conversation_id`
- `engine`
- `kind` (`agent`, `roundtable`, `followup`, ...)
- `status`
- `started_at`
- `updated_at`
- `message_id`
- `error`

이 단계에서 가능한 것:

- 실행 중 job 복구 표시
- stale placeholder 정리
- cancel/retry 진단 개선

### Phase 3 — Local daemon extraction

목표:

- background worker 계층을 별도 로컬 daemon 프로세스로 분리
- 앱은 control plane 역할만 수행

형태 예시:

- `tunaflow-agentd`
- 로컬 named pipe / websocket / local TCP / stdio bridge 중 하나

권장 기능:

- job start
- job cancel
- event subscribe
- health check
- reconnect handshake

중요:

- DB는 여전히 app/daemon이 공유하는 로컬 SSOT여야 함
- event 유실보다 DB 복구가 우선

### Phase 4 — RT / multi-job orchestration 승격

목표:

- RT를 daemon 레벨 orchestration job으로 올림
- participant run, intermediate progress, brief 저장, cancel/retry를 daemon이 담당

이 단계가 되면:

- RT는 더 이상 Tauri 내부 루프가 아니라
- 하나의 orchestration job으로 동작

### Phase 5 — Shared execution backend 가능성 검토

장기 검토 단계.

여기서만 아래를 검토한다.

- `tunaChat` / `tunaDish` / `tunaFlow` 공통 execution backend
- protocol 공유
- capability negotiation

현재는 방향성 메모 수준이며,
즉시 범위는 아니다.

## 아키텍처 원칙

### 1. DB가 최종 SSOT

이 원칙은 모든 phase에서 유지한다.

반드시 DB에 남아야 할 것:

- user message
- placeholder/partial/final assistant message
- error/cancel state
- trace/job metadata

### 2. event는 보조 채널

event는 UX용이다.

- progress 표시
- chunk 렌더링
- 완료 알림

event를 놓쳐도 복구 가능해야 한다.

### 3. command는 짧게

Tauri command는 가능하면:

- start
- cancel
- status query
- lightweight CRUD

정도로 제한한다.

### 4. 엔진 차이는 adapter로 감싼다

daemon 또는 background worker 내부에서는
엔진별 차이를 adapter로 가둬야 한다.

- Claude adapter
- Gemini adapter
- Codex adapter
- OpenCode adapter
- RT orchestrator adapter

## 현재 문서와의 관계

### `backgroundAgentExecutionPlan.md`

이 문서는 **Phase 1 실행 계획**이다.
즉:

- 이 로드맵의 첫 실구현 단계
- 최종 daemon 전환의 준비 단계

### `threadLocalRunQueuePlan.md`

thread-local queue는 실행 제어 관점의 선행 조건이다.
다만 daemon 단계로 가면 queue도 job registry/daemon scheduler로 승격될 수 있다.

### `contextBudgetScalingPlan.md`

context budget 확대는 background execution 안정화 뒤에 해야 한다.
긴 prompt 실험은 실행 구조 안정화와 분리해서 보면 안 된다.

## 각 단계의 완료 기준

### Phase 1 완료 기준

1. 일반 agent send command가 빠르게 반환
2. background worker에서 실제 실행 수행
3. UI block 현저히 완화
4. event + DB 재조회로 복구 가능

### Phase 2 완료 기준

1. 실행 job이 durable하게 추적됨
2. 앱 재시작 후 running/stale 상태를 판별 가능
3. cancel/retry 진단이 개선됨

### Phase 3 완료 기준

1. agent 실행이 별도 daemon에서 수행됨
2. 앱이 진행 중에도 부드럽게 동작
3. daemon reconnect/health check 존재
4. 결과 유실 없이 DB 복구 가능

### Phase 4 완료 기준

1. RT가 daemon orchestration job으로 수행됨
2. participant/cancel/progress/brief 흐름이 daemon 내부에서 일관되게 처리됨

## 현재 판단

### 결론

- 최종 방향은 daemon이 맞다.
- 그러나 지금 당장 daemon으로 직행하기보다,
  **Phase 1 background worker → Phase 2 durable job registry → Phase 3 daemon extraction** 순서가 가장 현실적이다.

### 추천 우선순위

1. `backgroundAgentExecutionPlan` 실행
2. durable job registry 설계
3. daemon IPC/protocol 초안
4. RT orchestration 이관

이 순서면
UI 응답성 문제를 먼저 해결하면서,
장기적으로는 `tunapi` 계열의 장점을 더 안전한 방식으로 흡수할 수 있다.
