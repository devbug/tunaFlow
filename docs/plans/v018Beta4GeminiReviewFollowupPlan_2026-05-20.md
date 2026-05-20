---
title: v0.1.8-beta-4 Gemini review follow-up — 4 항목 묶음
status: ready
priority: P0 (release blocker, tag 재발행 전)
created_at: 2026-05-20
---

# 0. Context

PR #284 (devbug rawq Windows hotfix) + PR #285 (font settings) Gemini code review 결과 4 항목 발견. v0.1.8-beta-4 build 진행 중이지만 PR #284 의 🔴 High 항목이 외부 사용자 영향 큰 회귀 (Windows daemon hang 시나리오 잔존). publish 전 fix 권장. 빌드 자산 publish 안 됐으니 tag 재발행 안전.

# 1. Invariants

- **INV-GR-1**: PR #284 의 fix 영역 (`search_with_options`) 회귀 0 — drain-thread + timeout 동작 보존
- **INV-GR-2**: PR #285 의 fix 영역 (3 영역 CSS variable + Settings UI) 회귀 0
- **INV-GR-3**: 본 follow-up 변경 외 다른 영역 손대지 X — release scope 일정 (v0.1.8-beta-4) 안 묶음
- **INV-GR-4**: tsc strict + vitest baseline 회귀 0 (현재 main `c30004c`: FE 447 / Rust unchanged)

# 2. Goals / Non-goals

## Goals
- Gemini review 4 항목 fix (rawq.rs 2건 + AppearanceSection.tsx 2건)

## Non-goals
- 다른 영역 (MetaFloatingChat / Settings 자체 / 등) 변경
- 새 영역의 font settings 적용 확장 (terminal / artifact viewer 등)
- DB schema / migration

# 3. Subtasks

## T1 — `run_index_status` 에 drain-thread 패턴 적용 (🔴 High)

**파일**: `src-tauri/src/agents/rawq.rs:360`

**문제**: `run_index_status` 함수가 `wait_with_output()` 직접 호출 → Windows daemon stdout/stderr 핸들 상속 시 EOF 무한 대기. `index_status` / `is_indexed` 핵심 로직이라 외부 사용자 hang 잔존.

**Fix**: `search_with_options` 와 동일 패턴:
- `Stdio::piped()` + `spawn_drain_thread` 로 stdout/stderr drain
- timeout 적용
- exit_status 확인

기존 `search_with_options` 의 helper (drain thread spawn + collect) 가 재사용 가능하면 import. 분리되어 있으면 동등 inline 또는 helper 추출.

## T2 — drain wait 에 stderr_buf 도 체크 (🟡 Medium)

**파일**: `src-tauri/src/agents/rawq.rs:724` (또는 `spawn_drain_thread` 호출 직후 stabilize 루프)

**문제**: 현재 drain wait 가 `stdout_buf.len()` 변화만 monitor. exit_status fail 시 에러 메시지가 `stderr` 로 출력되는데, stdout 빈 채 즉시 "안정화" 판정 → `stderr_bytes` 가 buffer 에 다 안 들어와도 loop 빠져나감.

**Fix**: stabilize 루프의 break 조건에 `stderr_buf.len()` 변화 없음도 함께 검증:
```rust
let stdout_stable = current_stdout == prev_stdout;
let stderr_stable = current_stderr == prev_stderr;
if stdout_stable && stderr_stable { break; }
```

## T3 — AppearanceSection 의 debounce timer cleanup (🟡 Medium)

**파일**: `src/components/tunaflow/settings/AppearanceSection.tsx:29`

**문제**: SettingsPanel 닫혀 컴포넌트 unmount 후에도 잔존 debounce timer 가 `update` 호출 → React `setState on unmounted component` warning + 잠재적 race.

**Fix**: `useRef` + `useEffect` cleanup:
```tsx
const debounceRef = useRef<number | null>(null);
useEffect(() => {
  return () => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
  };
}, []);
```

기존 `setTimeout` 호출도 `debounceRef.current = window.setTimeout(...)` 로 store. 다음 keystroke 시 이전 timer cleartTimeout.

## T4 — clamp UX — 입력 중 튕김 방지 (🟡 Medium)

**파일**: `src/components/tunaflow/settings/AppearanceSection.tsx:46`

**문제**: 사용자가 `15` 입력하려고 `1` 친 순간 → store 의 `clampFontSize` 가 즉시 10 으로 튕김. 빠른 입력 시 UX 마찰.

**Fix 옵션 (둘 중 택일)**:
- **A**: `onBlur` 또는 debounce 시점에만 clamp. 입력 중 raw value 보존 — local state 로 표시, debounce flush 시 clamp 적용 store update
- **B**: debounce 시간을 늘림 (200ms → 800ms). 사용자가 `15` 다 친 후 flush

**권장 A** — clean UX, 더 명시적. local controlled state + onBlur/debounce flush:
```tsx
const [draftSize, setDraftSize] = useState(String(fontSettings.chatSize));
const flushSize = (raw: string) => {
  const n = parseInt(raw, 10);
  update({ chatSize: clampFontSize(isNaN(n) ? defaultSize : n) });
};
// onChange: setDraftSize(e.target.value) — clamp X
// onBlur or debounced effect: flushSize(draftSize)
```

## T5 — 신규 unit test (선택, T1/T2 영역만)

**파일**: `src-tauri/src/agents/rawq.rs` (또는 동등 test module)

- T1 의 `run_index_status` drain 패턴 적용 후 mock daemon 으로 hang 시나리오 재현 test (가능한 경우)
- T2 의 stderr_buf 체크 fail-case test

선택 — manual smoke 도 가능. e2e 우선.

# 4. Cross-cutting risks

- T1 의 `spawn_drain_thread` 재사용 시 helper 의 visibility / module scope 확인. 같은 file 안 private 면 그대로 호출 가능, 다른 module 이면 `pub(crate)` 또는 직접 inline drain
- T2 의 stderr_buf monitoring 이 너무 일찍 break 안 되도록 — fail case fixture 로 검증
- T3 의 cleanup 이 첫 mount 시점에 호출되어 timer 초기화 깨뜨리면 안 됨 — `useEffect` deps `[]` 보장
- T4 의 local state 가 store 와 desync 가능성 — store 가 외부 source (다른 컴포넌트) 에서 변경 시 local state reset 필요 (`useEffect` 으로 `fontSettings.chatSize` 변화 감지)

# 5. Rollback

T1~T4 단계별 commit 분리. 각 commit revert 가능. 모든 변경이 영역 좁아 safe.

# 6. 다음 step

1. Developer 핸드오프 작성 — `docs/prompts/v018Beta4GeminiReviewFollowupDeveloperHandoff_2026-05-20.md`
2. Developer subagent dispatch (worktree 격리, admin merge)
3. 머지 후 CHANGELOG `[0.1.8-beta-4]` entry 보강 (Gemini review fix 명시)
4. 진행 중 build run cancel (`gh run cancel <id>`)
5. tag `v0.1.8-beta-4` delete (local + remote) + 재발행 (latest main HEAD)
6. 새 build 자동 트리거 → Draft release
