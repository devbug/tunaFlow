---
title: Branch cancel semantics — Task A (same-session) 모델에서 cancel 의 정확한 의미 정의 + 구현
status: ready-to-implement (gray-box, Developer 가 audit 단계부터)
priority: P1 (사용자 가시 — brand 에서 cancel 작동 안 함)
created_at: 2026-04-25
related:
  - docs/plans/branchInheritsMainSessionPlan_2026-04-25.md  # 머지됨 PR #198, brand=main session 공유
  - src-tauri/src/agents/claude_sdk_session.rs  # kill_session 등
  - src-tauri/src/commands/agents.rs  # restart_sdk_session
canonical: true
owners:
  - architect (본 plan 작성)
  - developer (audit + 구현)
---

# 증상 (사용자 보고, 2026-04-25)

> "브랜치에서 cancel 이 되지 않아"

PR #198 (`branchInheritsMainSession`) 머지로 brand 가 main session 을 공유하게 됐는데, brand 에서 cancel 동작이 의도대로 안 됨.

# 진단 후보 (Developer audit 필요)

PR #198 가 SESSIONS / RESUME_IDS 키 normalize 했는데 cancel 경로 일부가 그것에 적응 못 했을 가능성. 또는 cancel semantics 자체가 same-session 모델과 충돌.

## (A) Cancel 종류 모호

현재 코드의 "cancel" 의미가 두 가지 섞임:

1. **Stream abort** — 진행 중 응답만 stop, session 유지 (사용자 보통 의도)
2. **Session kill** — process 종료 + RESUME_IDS clear (강력)

`claude_sdk_session.rs:334 kill_session` / `342 kill_session_with_resume` 가 후자. `agents.rs:101 restart_sdk_session` 도 후자. 즉 코드의 "cancel" 이 session kill 위주.

## (B) Same-session 모델에서 brand cancel = main 영향?

PR #198 이후 brand 와 main 이 same SESSIONS / RESUME_IDS 키를 공유 (`session_key_for` normalize). 즉:

- 사용자가 brand 에서 cancel 클릭 → `kill_session_clear_resume("branch:b20")` 호출 → `session_key_for` 가 root main 으로 normalize → **main session 이 kill 됨** (의도와 다름)
- 또는 그 반대 — brand cancel 이 main 영향 없게 brand:* 그대로 사용 → 그러나 SESSIONS 에는 brand:* 키 없음 (normalize 됐으므로) → no-op (cancel 작동 안 함)

→ **현재 후자 추정** (cancel 작동 안 함 = 사용자 증언과 일치).

## (C) FE cancel 버튼 핸들러

audit 결과 (Read only):
- `useSendActions.ts` 에 cancel 키워드 0
- `runtimeSlice.ts` 에 stopRun/cancelRun 0
- 즉 cancel 버튼 핸들러 위치 별 grep 필요. 다른 명명일 가능성

# 옵션 (Developer 결정)

## 옵션 X — Stream abort only (사용자 의도 추정)

- Cancel = 진행 중 stream 만 abort (`tokio::abort_handle` 또는 in-process flag)
- Session 유지 (process / RESUME_IDS 그대로) → 다음 send 자연 이어짐
- brand 에서 cancel 호출해도 main session 영향 없음 (공유 session 의 stream 만 끊김)
- **Pros**: same-session 모델과 정합, 자연스러움
- **Cons**: 구현 — current stream 식별 + abort signal

## 옵션 Y — Session kill (현재 동작)

- Cancel = process 종료 + RESUME_IDS clear
- brand cancel 이 main session 까지 죽임 → 다음 main send 가 fresh start (history 잃음)
- **Pros**: 단순
- **Cons**: 사용자 의도와 어긋남, history 손실

## 옵션 Z — brand-only stream abort (격리)

- brand 에서 cancel = brand 의 stream 만 abort (그러나 same session 이라 어떻게 식별?)
- 가능: 메시지에 sender (main vs brand) 메타 + cancel 시 그 sender 의 stream 만
- **Pros**: 격리 명확
- **Cons**: 구현 복잡 (sender 추적 + per-stream cancel)

# 권장 — 옵션 X

사용자 의도 + Task A same-session 모델 정합성 + 구현 단순. brand 와 main 의 cancel 의미를 통일 (둘 다 stream abort only).

# Invariants

- **[INV-1]** Cancel 호출 시 진행 중 stream 만 abort, session (process / RESUME_IDS) 유지
- **[INV-2]** brand 에서 cancel 호출해도 main session 의 다음 send 가 영향 없음 (history 자연 이어짐)
- **[INV-3]** main 에서 cancel 호출도 같은 의미. 즉 brand / main 모두 cancel = stream abort
- **[INV-4]** Session kill 이 진짜 필요한 케이스 (engine 변경, model 변경 등) 는 별도 명시적 command (`restart_sdk_session` 그대로 유지). UI 의 cancel 버튼은 stream abort 만.

# 검증

## 수동 Smoke

1. **brand cancel**: 메인 → brand 진입 → brand 송신 → 응답 진행 중 cancel 클릭 → stream stop + brand 자체 살아있음 + 다음 send 정상 (history 보존)
2. **main 송신 후 cancel**: same engine 동작 확인
3. **engine 변경 시**: 명시적 restart_sdk_session 호출 시에만 session kill — UI 가 그 분기 구분

## 자동

- stream abort signal 의 unit test
- session 유지 검증 (cancel 후 SESSIONS / RESUME_IDS 그대로)

# Developer 핸드오프 프롬프트

```
[작업] Branch cancel semantics — same-session 모델에서 cancel 의미 재정의 (Plan branchCancelSemantics, P1)

[SSOT] docs/plans/branchCancelSemanticsPlan_2026-04-25.md

[배경 3줄]
- PR #198 (Task A) 로 brand=main session 공유. 그러나 cancel 이 작동 안 함
- 현재 코드의 "cancel" 이 session kill 위주 → same-session 모델과 충돌
- 사용자 의도 = stream abort only (session 유지)

[수정 범위 — Step 1 audit]

1) Audit:
   - FE cancel 버튼 핸들러 위치 (useSendActions.ts / 다른 컴포넌트)
   - BE cancel command 호출 경로
   - 현재 cancel 이 session kill 인지 stream abort 인지 명확히
   - PR #198 이후 brand cancel 의 실제 동작 (no-op / main kill / 기타)
   - 결과: docs/reference/branchCancelAudit_2026-04-2X.md

2) 권장: 옵션 X (stream abort only)
   - tokio cancel token 또는 abort handle 으로 진행 중 stream signal
   - SESSIONS / RESUME_IDS 유지
   - brand / main cancel 의미 통일

3) Engine 변경 시 session kill 은 별도 경로:
   - 기존 restart_sdk_session command 유지
   - UI 가 cancel 버튼과 restart 버튼 구분

4) Cancel command 의 SESSIONS lookup 시 normalize:
   - PR #198 의 session_key_for 그대로 사용
   - brand / main 어디서 호출해도 같은 session 의 stream abort

[검증]
- cargo check / cargo test --lib
- 수동 smoke (plan §검증):
  1. brand cancel → stream stop + 다음 send history 보존
  2. main cancel → 동일
  3. restart_sdk_session 명시적 호출 → session kill (engine 변경 등)

[커밋 분리]
- docs(ref): branch cancel semantics audit
- refactor(session): introduce stream abort token (separate from session kill)
- fix(cancel): rewire UI cancel button to stream abort only
- chore(session): session kill stays as explicit restart_sdk_session

trailer: Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

[PR 제목]
fix(cancel): stream abort semantics for same-session brand cancel (Task A follow-up)

[셀프 이슈]
"bug: cancel doesn't work in branch (Task A same-session model conflict)"
이슈 본문에 PR #198 reference + 옵션 X 채택 사유
```

# 셀프 이슈 본문 초안

```markdown
## Summary

After PR #198 (branchInheritsMainSession), cancel from a branch drawer doesn't take effect. The current cancel implementation is session-kill (process termination + RESUME_IDS clear) which conflicts with the same-session model — calling it from a branch either no-ops (if the branch's conv_id isn't found in SESSIONS due to normalization) or kills the main session (data loss).

## Expected behavior

Cancel = abort the in-flight stream only. Session, process, RESUME_IDS all preserved → next send (main or branch) continues naturally.

## Reproduction

1. Open conversation with active CLI session (Claude meta agent)
2. Open branch drawer, send a message → response streaming
3. Click cancel button → no effect (or main session unintentionally killed)

## Fix

Per `docs/plans/branchCancelSemanticsPlan_2026-04-25.md`:

- Introduce stream abort token (separate from session kill)
- UI cancel button → stream abort only
- Explicit `restart_sdk_session` retained for engine/model change scenarios

## Sibling

`docs/plans/multiDeveloperActivePlanIsolationPlan_2026-04-25.md` — multi-Developer collision, separate axis but reported same day.
```

# 후속 / Sibling

- `multiDeveloperActivePlanIsolationPlan_2026-04-25` — 같이 보고된 이슈. 별 axis
- Cancel 옵션 Z (per-sender abort) 는 future plan 후보 (현재 옵션 X 면 충분)
