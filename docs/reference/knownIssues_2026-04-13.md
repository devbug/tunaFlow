# Known Issues — 2026-04-13

## P0: PTY 엔터 미전송 (CLI 초기화 전 전송)

**발견**: s34, 짧은 질문에 스피너가 오래 돌고 터미널에 엔터가 들어가지 않음
**영향**: PTY 모드 (claude/codex/gemini 엔진), 특히 세션 시작 직후 첫 메시지
**상태**: 수정 완료 (`src/stores/slices/ptyMessageSender.ts`)

### 원인

`sendMessageViaPty`의 pre-write 체크:

```js
// 수정 전 (버그)
if (screen && !/❯/.test(screen)) { /* ❯ 대기 */ }
```

`screen`이 빈 문자열(`""`)이면 falsy → if 블록 스킵 → Claude CLI가 아직 `❯` 프롬프트를 출력하기 전인데 bracket paste + `\r`을 즉시 전송 → CLI가 입력 무시.

### 수정

```js
// 수정 후
if (!/❯/.test(screen)) { /* screen 비어있어도 ❯ 대기 */ }
```

- `screen`이 비어있으면(초기화 중) → `❯` 대기
- `screen`에 내용은 있지만 `❯` 없으면 → `\r` 웨이크업 후 `❯` 대기
- `❯` 있으면 → 즉시 전송 (기존과 동일)

부가: `resolved` 플래그로 타임아웃·이벤트 핸들러 중복 실행 race condition 제거.

---

## P0: xterm 터미널 직접 입력 시 엔터 미동작

**발견**: s34, 터미널 패널(xterm.js)에서 직접 타이핑 시 Enter 미동작
**영향**: TerminalPanel의 직접 키보드 입력 (xterm.js)
**상태**: 수정 완료 (`src/components/tunaflow/TerminalPanel.tsx`)

### 원인

Tauri macOS WebKit 환경에서 xterm.js 캔버스가 클릭 후에도 키보드 포커스를 자동으로 가져가지 않음. `onData` 콜백이 포커스 없이는 동작 불가.

### 수정

- `term.open()` 직후 `term.focus()` 추가 (터미널 초기 표시 시 자동 포커스)
- 컨테이너 `onMouseDown` → `term.focus()` 추가 (다른 영역 클릭 후 복귀 시 포커스 복구)

---

## P1: PTY 응답 UI 미반영 (JSONL 빠른 완료 감지 실패)

**발견**: s34, 짧은 질문에 PTY 터미널에는 Claude 응답이 표시됐으나 채팅 UI에 미반영
**영향**: 짧은 응답 시간의 메시지 (Claude가 3초 이내 완료)
**상태**: 미수정 — P1

### 원인

`trackedJsonl`이 null인 신규 세션에서 JSONL 파일 감지를 스냅샷 diff로 처리:

```js
// attempt % 15 === 0 → 200ms 간격 × 15 = 3초마다 체크
if (!trackedJsonl && snapshotBefore && attempt >= 10 && attempt % 15 === 0) {
  // 새 JSONL 파일 감지
}
```

짧은 질문에 Claude가 3초 이내 응답을 완료하면:
1. 파일 감지 시점에 이미 `totalLines = N` (완료 상태)
2. `baselineLines = Math.max(0, N - 2)` 로 설정
3. 이후 poll에서 `totalLines == baselineLines + 2` → `isComplete=true` 여야 하지만
4. 응답이 이미 완료된 상태에서 baseline이 너무 높게 잡혀 content를 찾지 못하거나
5. poll 간격 중에 응답이 완료되어 `isComplete` 판정 타이밍을 놓침

### 재현 조건

- 신규 PTY 세션 (trackedJsonl = null)
- 짧은 질문 → Claude 응답 시간 < 3초

### 임시 대응

터미널 패널에서 응답 확인 후 `/clear` 명령으로 세션 초기화하면 다음 메시지부터 정상 동작.

### 수정 방향

- JSONL 감지 주기를 첫 30초는 1초(attempt % 5)로 단축
- 또는 스냅샷 diff 대신 `pty:output` 이벤트에서 JSONL 경로 힌트 추출
