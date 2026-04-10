# PTY 인터랙티브 모드 — CLI 에이전트의 풀 기능 활용

> Status: idea (검토 중)
> Created: 2026-04-10
> 관련: CLI-first 아키텍처, ContextPack Tiering, RT 스트리밍

---

## 현재 구조의 한계

```
현재: claude -p "prompt" --output-format stream-json
  → 단일 턴, 프로세스 생성→응답→종료
  → 매 턴마다 새 프로세스 + ContextPack 전체 재전송
  → CLI의 풀 기능(MCP, multi-step 파일 편집, git, 테스트) 사용 불가
  → -p 모드는 "질문→답변" 패턴만 지원
```

## 제안: PTY 인터랙티브 모드

```
제안: PTY(pseudo-terminal)로 가상 터미널 생성
  → Claude Code 인터랙티브 모드 실행
  → stdin/stdout 스트림을 tunaFlow가 중간에서 가로챔
  → 중간 과정(thinking, tool use, 파일 편집)은 터미널 패널에 그대로 표시
  → 완료 감지 후 결과만 tunaFlow 메시지 영역에 렌더링
```

### 기술 스택

- **Rust**: `portable-pty` 크레이트로 PTY 생성 + 프로세스 관리
- **React**: `xterm.js`로 ANSI 코드 포함 터미널 출력 그대로 렌더링
- **완료 감지**: "Worked for Xs" 패턴 또는 프롬프트 `❯` 감지

---

## ContextPack 주입 방식

### 문제

`-p` 모드에서는 ContextPack을 프롬프트 앞에 합쳐서 stdin으로 전달. 인터랙티브 모드에서는 Claude가 이미 자기 세션 상태를 가지고 있음.

### 해결: 프로젝트 설정 파일 동적 갱신

```
각 CLI 에이전트가 이미 자동으로 읽는 파일:
  Claude → CLAUDE.md
  Codex  → AGENTS.md
  Gemini → GEMINI.md

tunaFlow가 ContextPack의 핵심 정보를 이 파일에 동적 갱신:
  → 인터랙티브 에이전트가 자동으로 읽음
  → -p 모드에서도 동일 경로 사용 가능
  → stdin 주입 불필요 → 토큰 낭비 제거

예: .tunaflow/context.md 또는 CLAUDE.md 내 ## tunaFlow Context 섹션
```

이 방식은 Tiering 아이디어의 "Tier 0를 파일로"와 자연스럽게 연결됨.

---

## 장점: `-p`를 넘어서는 가치

### 1. CLI 풀 기능 활용

```
-p 모드:          질문 → 답변 (텍스트만)
인터랙티브 모드:   지시 → 파일 편집 + git + 테스트 + MCP 도구 사용
                  → 한 번의 지시로 multi-step 작업 가능
```

### 2. $20 플랜 사용자의 턴 수 절감

```
-p 모드:
  사용자 "이 버그 고쳐줘" → claude -p → 결과 (1턴)
  사용자 "테스트도 돌려봐" → claude -p → 결과 (2턴)
  사용자 "커밋해줘" → claude -p → 결과 (3턴)

인터랙티브 모드:
  사용자 "이 버그 고치고 테스트 돌리고 커밋해줘"
  → Claude Code가 내부적으로 multi-step 처리 (1턴)
  → rate limit 기준 1회 소비로 3배 작업량
```

### 3. 작업 과정 가시성

```
현재: ToolStepsView로 __STEP__ 프로토콜 파싱 (불완전)
PTY:  실제 터미널 출력 그대로 → 사용자가 "에이전트가 지금 뭘 하는지" 실시간 확인
```

---

## RT와의 관계

```
메인 채팅: PTY 인터랙티브 (풀 기능, 상주)
RT:        -p 모드 유지 (독립 세션, 토론 특화)
           → PTY 3개 동시는 불필요
           → stream_participant()로 이미 스트리밍 구현됨

PTY 리소스:
  Claude Code 인터랙티브 1개 ≈ Node.js 프로세스 ~100-200MB RAM
  바이브코딩 환경에서 VSCode + 터미널 여러 개 이미 실행 중
  → PTY 1-2개 추가는 부담 아님
  (실제 부하는 측정 필요)
```

---

## SDK vs PTY

```
SDK (@anthropic-ai/claude-code):
  + 프로그래매틱 제어 (allowedTools, cwd)
  + 구조화된 응답
  - 공식 문서 빈약
  - 내부적으로 -p와 비슷한 single-turn일 수 있음 (확인 필요)
  - API 과금 문제 (구독 CLI와 다른 과금 모델일 가능성)

PTY (인터랙티브):
  + 구독 모델 그대로 유지
  + CLI 풀 기능 확실히 사용 가능
  + ANSI 출력 그대로 → xterm.js로 렌더링
  - 완료 감지 fuzzy (프롬프트 패턴 매칭)
  - ANSI 파싱 복잡도 (xterm.js가 해결)
```

**현재 판단**: PTY가 tunaFlow의 "구독 CLI 오케스트레이터" 포지션에 더 맞음. SDK는 장래 검토.

---

## API 과금 경고 정책

tunaFlow에서 API(SDK) 사용은 가능하지만 권장하지 않음:

```
비용 비교 (Opus 기준):
  구독 $20-200/월:  RT + 워크플로우 자유롭게
  API 과금:         RT 1회 ~$2-5, 워크플로우 1회 ~$5-15
                    → 일상 사용 시 월 $900-1800

멀티에이전트 오케스트레이션은 토큰을 구조적으로 증폭시키므로
API 과금 모델과 본질적으로 맞지 않음.
```

Settings에서 SDK 선택 시 비용 경고 표시 필요.

---

## 미결 사항

- `portable-pty` 크레이트 Tauri 2 호환성 확인
- xterm.js React 래퍼 선정 (xterm-react? 직접 통합?)
- Claude Code 인터랙티브 프롬프트 패턴 정확한 정규식 수집
- ContextPack → CLAUDE.md 동적 갱신의 세부 설계 (어떤 섹션을, 어떤 타이밍에)
- SDK의 실제 동작 확인 (single-turn vs multi-turn, 과금 모델)
- Codex/Gemini/OpenCode도 인터랙티브 모드 지원 여부 확인
- PTY 프로세스 수명 관리 (idle timeout, 앱 종료 시 cleanup)

---

## 사이드이펙트 분석: `-p` 의존 코드 전수 목록

PTY 도입은 `-p`를 **교체**하는 게 아니라 **추가 경로**. 3개 경로(-p, PTY, SDK)를 동시 유지해야 하므로 복잡도가 2-3배로 증가.

### Backend (Rust) — `-p` 모드 전제로 설계된 코드

| 파일 | 영향 영역 | PTY 시 변경 필요 |
|------|----------|----------------|
| `agents/claude.rs` | `run()` + `stream_run()` 전체 | PTY adapter 별도 추가 |
| `agents/codex.rs` | `run()` + `stream_run()` 전체 | 동일 |
| `agents/gemini.rs` | `run()` + `stream_run()` 전체 | 동일 |
| `agents/opencode.rs` | `run()` | 동일 |
| `agents/openai_compat.rs` | `run()` + `stream_run()` (async) | 동일 |
| `commands/agents.rs` | `start_*_stream` command 5개 | PTY command 별도 추가 |
| `commands/roundtable_helpers/executor.rs` | `run_participant` + `stream_participant` | RT는 -p 유지, 분기 필요 |
| `commands/agents_helpers/send_common/` | `prepare_engine_run` / `finalize_engine_run` | PTY 경로의 prepare/finalize 설계 |
| `commands/agents_helpers/send_common/prompt_assembly.rs` | 프롬프트에 ContextPack 합치는 구조 | PTY는 파일 갱신 방식 → 조립 로직 분기 |
| `guardrail.rs` | 프롬프트 크기 제한 | PTY에서는 파일 크기 제한으로 전환 |

### Frontend (React) — 이벤트 모델 의존

| 파일 | 영향 영역 | PTY 시 변경 필요 |
|------|----------|----------------|
| `stores/slices/runtimeSlice.ts` | `sendWithEngine`, `{engine}:chunk/progress` 리스너 | PTY 전용 이벤트 모델 추가 |
| `stores/slices/threadSlice.ts` | `sendThreadMessage`, 동일 리스너 | 동일 |
| `stores/toolStepsStore.ts` | `__STEP__` 프로토콜 파싱 | PTY는 xterm.js에서 직접 표시, 파싱 불필요 |
| `components/message/ToolStepsView.tsx` | 스텝 표시 UI | PTY 모드에서는 터미널 패널이 대체 |
| `components/message/ProgressSurface.tsx` | streaming 상태 표시 | PTY 모드 분기 필요 |
| `components/message/MessageMeta.tsx` | streaming/done 상태 배지 | 완료 감지 방식 변경 |

### 이벤트 모델 변경

```
현재 (-p):
  claude:progress → __STEP__ 파싱 → ToolStepsView
  claude:chunk    → content 누적 → 메시지 렌더링
  agent:completed → DB 리로드 → 최종 상태

PTY:
  pty:output      → xterm.js 터미널에 그대로 표시
  pty:idle         → "Worked for Xs" 또는 프롬프트 감지 → 완료
  → 기존 chunk/progress 이벤트와 완전히 다른 모델
```

### DB/추적

| 테이블 | 영향 |
|--------|------|
| `agent_jobs` | PTY 프로세스 생명주기 추적 방식 변경 (start/exit이 아니라 상주) |
| `trace_log` | 토큰/비용 기록 — PTY에서는 CLI가 usage를 보고하지 않음, 추적 방법 미정 |
| `messages` | status streaming→done 전환 시점이 "Worked for" 감지 기반 |

### 영향 범위 요약

```
파일 30+개, 함수 50+개가 -p 모드 전제로 설계됨

PTY 도입 시:
  - 기존 -p 경로: 유지 (RT, 단순 질의, fallback)
  - PTY 경로: 추가 (메인 채팅, 풀 기능)
  - SDK 경로: 유지 (fallback, 비권장)

  → 3개 경로 동시 유지
  → 이벤트 모델, 상태 관리, ContextPack 주입이 경로마다 다름
```

### 선행 조건: Engine trait 통합

PTY를 깔끔하게 추가하려면, 현재 `RunInput/RunOutput` + `run()`/`stream_run()` 패턴을 **Rust trait으로 정형화**하는 작업이 선행되어야 함:

```rust
// 현재: 각 엔진이 같은 시그니처의 함수를 개별 구현
claude::run(input) / claude::stream_run(input, on_progress, on_chunk, is_cancelled)
codex::run(input) / codex::stream_run(input, on_progress, on_chunk)

// 목표: trait으로 통합
trait AgentEngine {
    fn run(&self, input: RunInput) -> Result<RunOutput, AppError>;
    fn stream_run(&self, input: RunInput, callbacks: StreamCallbacks) -> Result<RunOutput, AppError>;
    fn pty_run(&self, input: RunInput, pty: PtyHandle) -> Result<PtySession, AppError>;  // 새 경로
}
```

이 trait이 있어야 `commands/agents.rs`의 `start_*_stream` 5개를 하나로 통합하고, PTY 경로를 같은 인터페이스로 추가할 수 있음. (RT 토론에서 Codex가 제안한 "CLI adapter와 API adapter를 같은 추상 인터페이스 아래 두기"와 동일)

---

## 우선순위

PTY 통합은 **Tiering 이후**. 현재 `-p` + `stream_run`이 동작하고 있고, Tiering으로 토큰 효율을 먼저 잡는 게 순서. PTY는 "기능 확장"이지 "기존 문제 해결"이 아님.

```
순서:
1. ContextPack Tiering (토큰 효율 — $20 사용자 접근성)
2. Chunk 품질 + sqlite-vec (검색 품질)
3. Engine trait 통합 (PTY 선행 조건)
4. PTY 인터랙티브 (기능 확장 — 해자)
```
