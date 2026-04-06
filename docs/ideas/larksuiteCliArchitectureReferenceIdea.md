# larksuite/cli 아키텍처 레퍼런스 검토

- 작성: 2026-04-06
- 대상 레포: `https://github.com/larksuite/cli`
- 목적: `tunaFlow AOC`의 인터페이스/능력 계층 설계에 참고할 가치가 있는지 평가
- 결론: **전체 아키텍처 레퍼런스로는 부적합, 일부 패턴은 참고 가치 높음**

---

## 전제

`larksuite/cli`는 본질적으로 **agent-native CLI**다.

- 핵심 단위: `command`, `shortcut`, `raw api`
- 주 사용자: 사람 + 에이전트
- 구조 목적: API 작업을 더 짧고 안전하게 수행

반면 `tunaFlow`는:

- `tunaPi` + `tunaDish` 기반의 **Agent Orchestration Client**
- 핵심 단위: `conversation`, `branch`, `roundtable`, `artifact`, `evaluation`, `memory`
- 주 목적: 에이전트 협업 실행과 인간 주도 개발

즉 둘은 모두 agent-friendly이지만, 제품의 중심축은 다르다.

---

## 코드에서 확인한 사실

### 1. 3계층 커맨드 구조는 실제 구현이다

`lark-cli`는 README와 root command에서 명시적으로 3계층을 노출한다.

- `Shortcuts`
- `API Commands`
- `Raw API`

근거:

- `README.md`의 `Three-Layer Command System`
- `cmd/root.go`

### 2. skill 구조는 강하게 분리되어 있다

실제 `skills/` 디렉토리에 20개 skill이 존재한다.

- `lark-shared`
- `lark-calendar`
- `lark-im`
- `lark-base`
- ...

근거:

- `skills/` 디렉토리 목록
- `README.md`의 `Agent Skills`

### 3. `lark-shared`는 “진짜 자동 로드”라기보다 문서 규약 기반 공통 의존성이다

각 skill은 `../lark-shared/SKILL.md`를 먼저 읽으라고 요구한다.

즉:

- 런타임 자동 import 시스템이라기보다
- skill 문서가 공통 규칙을 참조하는 구조

근거:

- `skills/lark-task/SKILL.md`
- `skills/lark-shared/SKILL.md`

### 4. `--no-wait`는 단순 비동기 플래그가 아니라 2단계 계약이다

`auth login --no-wait`는:

1. `verification_url`, `device_code`를 즉시 반환
2. 이후 `--device-code`로 polling을 재개

즉 resumable async flow다.

근거:

- `cmd/auth/login.go`

### 5. shortcut 실행 파이프라인은 명시적이다

`runShortcut()` 흐름:

1. identity resolve
2. config resolve
3. scope check
4. runtime context 생성
5. validate
6. dry-run
7. execute

근거:

- `shortcuts/common/runner.go`

---

## tunaFlow에 적용 가능한 것

## 1. “3계층 구조”의 개념

### 판단

**부분 적용 가치 높음**

### 왜 맞는가

`tunaFlow`에도 실제로 계층이 이미 있다.

- 사용자 액션 계층
  - `Start RT`
  - `Approve Plan`
  - `Adopt Branch`
  - `Save Artifact`
  - `Send to Context`
- 내부 실행 계층
  - `start_roundtable_run`
  - `run_eval_agent`
  - `create_branch`
  - `index_conversation_chunks`
- 저수준 디버그/인프라 계층
  - trace/meta/runtime diagnostics
  - raw Tauri command

### 어떻게 적용할까

`larksuite/cli`처럼 CLI로 드러내는 것이 아니라, 다음 같은 내부 설계 원칙으로 차용하는 것이 맞다.

- Layer 1: Human/Agent-facing action
- Layer 2: Product command / workflow command
- Layer 3: Debug / raw infrastructure

### 비추천

- UI 자체를 `shortcut → api → raw`처럼 노출
- 사용자가 내부 command 계층을 직접 다루게 설계

`tunaFlow`는 CLI가 아니라 orchestration UI이므로, 이식 대상은 UX가 아니라 **실행 계층 분리 원칙**이다.

---

## 2. skill 분리 + shared base 패턴

### 판단

**역할 정의에는 부적합, capability 문서화에는 유용**

### 왜 한계가 있나

`larksuite/cli` skill은 대부분 도메인 capability다.

- calendar
- im
- task
- base

반면 `tunaFlow`의 주 역할은 인지 역할이다.

- Opus = verifier
- Gemini = brainstorming
- Codex = implementation
- Claude = casual discussion

즉 이 구조를 그대로 role system에 가져오면 어색하다.

### 참고 가치가 있는 부분

공통 실행 규칙을 shared layer로 분리하는 아이디어는 좋다.

예:

- `agent-shared`
- `memory-shared`
- `artifact-shared`
- `workflow-shared`
- `context-hub-shared`

그리고 각 역할/능력 문서가 이 공통 규칙을 참조하게 만들 수 있다.

### 실무적 결론

- `role architecture` 레퍼런스: **낮음**
- `capability pack / shared execution rule` 레퍼런스: **중간~높음**

---

## 3. `--no-wait` 비블로킹 패턴

### 판단

**일반 채팅에는 부적합, 장기 작업에는 유용**

### 왜 부분적으로만 맞는가

`tunaDish`는 이미:

- stream progress
- chunk event
- completion event
- background post-processing

구조가 있다.

즉 일반 agent response는 이미 이벤트 기반이라 `--no-wait`를 추가로 흉내낼 필요가 거의 없다.

### 실제로 잘 맞는 곳

- 외부 인증
- context-hub bootstrap
- 긴 indexing 작업
- long-running eval/test
- remote orchestration job submit/resume

### 적용 방식

다음 형태가 적절하다.

1. 시작 시 `job_id` 즉시 반환
2. UI는 pending 상태 표시
3. 이후 polling/resume 또는 event attach
4. 재진입 시 job reconnect 가능

즉 가져올 것은 `flag`가 아니라 **2단계 비동기 계약**이다.

---

## 차용할 가치가 있는 패턴

### 1. Risk 레벨 분류 + Scope Pre-check

- read / write / high-risk-write 구분 + `--yes` 확인
- 실행 전 권한 로컬 체크 → 실패 전 힌트
- **적용 시점**: SDK 전환 없이도 CLI subprocess 환경에서 적용 가능. 예: `--permission-mode` 선택을 Risk 레벨 기반으로 자동 결정
- 다른 레퍼런스(claw-code, Optio)에서도 동일 패턴 수렴 확인

### 2. Error Enrichment

- 에러 → 분류 → 추천 액션 → 콘솔 URL
- **현재 상태**: `AppError → { code, message }` 구조화 완료 (세션 13). “추천 액션”까지 확장은 후순위
- Optio error-classifier와 동일 방향

### 3. 공통 실행 규칙 분리 (Skill 의존성 마커)

- `CRITICAL — 이 스킬을 먼저 읽어라` 패턴
- 현재 CLAUDE.md + PLATFORM_TIER0가 이 역할 수행. 스킬 시스템 Phase 2에서 분리 검토
- auth/scope/security에 해당하는 공통 규칙을 shared 문서/규약으로 유지

### 4. declarative execution pipeline

`resolve → validate → dry-run → execute` 같은 명시적 단계는 tunaFlow workflow action에도 잘 맞는다.

### 5. resumable async contract

특정 장기 작업에만 선택적으로 도입 가능

---

## 차용 가치가 낮은 것

| 패턴 | 이유 |
|------|------|
| 3-tier 커맨드 구조 | tunaFlow는 데스크톱 앱. cmdk 커맨드 팔레트로 충분 |
| Device Flow OAuth | CLI agent 자체 인증 위임. 자체 OAuth 불필요 |
| OpenAPI 메타데이터 기반 명령 자동 생성 | 고정된 Tauri command. 동적 생성 불필요 |
| Lark MCP | Lark 내부 프로토콜. tunaFlow에 해당 없음 |
| Multi-brand 엔드포인트 | feishu/lark 분기. 해당 없음 |
| npm 패키지 배포 | 데스크톱 바이너리 |
| skill = role 대응 | 도메인 skill 구조를 에이전트 인지 역할 구조에 그대로 가져오면 안 맞음 |
| 문서 규약 기반 “auto-load” | 런타임 메커니즘이 아닌 문서 의존성 패턴 |
| API/resource 중심 설계 | tunaFlow는 workflow orchestration 중심 |

---

## tunaFlow 기준 최종 판단

`larksuite/cli`는 tunaFlow의 **코어 아키텍처 레퍼런스**로 쓰기엔 맞지 않는다.

이유:

- `lark-cli`는 agent-native API CLI
- `tunaFlow`는 agent orchestration client

하지만 다음 항목은 참고 가치가 있다.

1. Risk 레벨 분류 + Scope Pre-check (SDK 전환 없이도 적용 가능)
2. Error Enrichment (AppError 구조화 완료, 추천 액션 확장은 후순위)
3. Skill 의존성 마커 + shared base 패턴 (스킬 Phase 2)
4. declarative action pipeline
5. resumable async pattern

---

## 재검토 시 질문

나중에 Opus/Coder와 다시 볼 때는 아래 질문으로 좁히는 게 좋다.

1. `tunaFlow action layer / execution layer / debug layer`를 문서나 코드로 더 분리할 필요가 있는가
2. role 문서와 capability 문서를 분리해야 하는가
3. 장기 작업에 `job handle + resume` 계약을 넣을 대상이 무엇인가
4. workflow action을 `validate / dry-run / execute` 3단계로 표준화할 가치가 있는가

---

## 한 줄 결론

**전체 구조를 베끼는 레퍼런스는 아니다.**
**하지만 tool/action 계층 설계, shared 규약 분리, resumable async contract는 tunaFlow에 실제 적용 검토 가치가 있다.**
