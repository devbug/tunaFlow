---
title: Project Onboarding "건너뛰기" UI Lock + Codex/Gemini 메타 분석 실패 — 수정 plan
status: draft (ready-to-implement, tunaFlow dev 세션 종료 후 진행)
priority: P1 (커뮤니티 제보 기반 재현 확인)
created_at: 2026-04-25
reporter_credit: 커뮤니티 제보 (공개 첫날 Issue #176 스레드 후속 댓글)
related:
  - docs/posts/ (workflow 설계)
  - docs/plans/manualVerificationGatePlan_2026-04-24.md (유사 async cancel 패턴)
  - src/components/tunaflow/ProjectOnboardingModal.tsx
  - src-tauri/src/commands/project_onboarding.rs
canonical: true
owners:
  - architect (본 문서 작성)
  - developer (구현 — dev 종료 후)
---

# 요약

커뮤니티 제보자 (M2 16GB Air, 유료 Claude/Codex/Gemini 계정 보유) 가 밝혀낸 재현 조건:

1. **Claude 메타 선택** → 분석 성공 → 정상 복귀
2. **Codex/Gemini 메타 선택** → AI 정리 단계에서 **분석 실패**
3. 실패 상태에서 **"건너뛰기"** 클릭 → 팝업 닫히지만 **메인창 비활성 고정** (앱 프로세스는 살아있음)
4. **"닫기"** 클릭 → 정상 복귀

근본 원인 2개:

- **UI 레이어 버그**: `handleSkip()` 이 `invoke("cancel_project_onboarding")` 을 호출하지 않아 rust `analyze_project_for_onboarding` async task 가 orphaned
- **별건**: Codex/Gemini 메타 분석 자체가 실패하는 원인 (프롬프트/파싱 편향 의심, 더 깊은 조사 필요)

부가 발견:

- **UX 설계 결함**: error state 에서 "건너뛰기" 와 "닫기" 의 실질적 사용자 의도는 동일 (`이 error 상황 탈출`) 인데 내부 동작만 다름 → 혼란 유발
- **Rust layer 심층 risk**: `call_agent` 내부 cancel flag poll 이 누락됐을 가능성 → global flag `store(true)` 해도 long-running await 중이면 즉시 응답 안 함

# 현재 코드 상태 (사실 확인, 2026-04-25)

## (A) UI — `src/components/tunaflow/ProjectOnboardingModal.tsx`

3개 핸들러:

| Handler | 위치 | cancel 호출 | 트리거 |
|---|---|---|---|
| `handleSkipFromSelector` | line 143 | ❌ (분석 시작 전이라 OK) | agent_select 단계의 skip |
| `handleCancel` | line 149 | ✅ `invoke("cancel_project_onboarding")` | 명시적 "취소"/"닫기" |
| `handleSkip` | line 156 | **❌ 누락 — 이것이 primary 버그** | error 후 "건너뛰기" 확정 (skip_confirm overlay) |

Error state UI (line 263-277):

```tsx
{error ? (
  <>
    <button onClick={() => setModalState("skip_confirm")}>건너뛰기</button>  // → handleSkip() ❌
    <button onClick={handleCancel}>닫기</button>                              // ✅
  </>
) : (
  <button onClick={() => setModalState("cancel_confirm")}>취소</button>
)}
```

두 버튼의 사용자 의도는 "에러 상황 탈출" 로 동일한데 내부 경로가 달라 결과 분기.

## (B) Rust — `src-tauri/src/commands/project_onboarding.rs`

`analyze_project_for_onboarding` (line 608-678):

- `Arc<AtomicBool>` cancel flag + `set_cancel_flag` / `clear_cancel_flag` global guard
- 각 step 진입 시 `is_cancelled(&cancel)` 체크 (line 628, 639, 647, 661)
- **Step 3 의 `call_agent(...)` await (line 651-657) 는 cancel 체크 없이 완료 대기**
- `call_agent` 내부가 cancel flag 를 주기적으로 poll 하는지 더 확인 필요
- 실패 시 `app.emit("project:onboarding:error", ...)` 로 UI 에 알림 → UI error state 진입

`cancel_project_onboarding` (line 681-687):

- global flag 에 `store(true)` — `is_cancelled` 가 true 반환
- `call_agent` 가 flag 를 poll 하지 않으면 await 는 계속 진행

## (C) Codex/Gemini 분석 실패 원인 (추정)

확정하지 못한 후보:

1. `parse_output` 이 `[CLAUDE_MD_START]` 같은 섹션 마커를 기대하는데 Codex/Gemini 가 마커를 빠뜨림
2. `build_prompt` 가 Claude 중심 톤 → Codex/Gemini 가 다른 포맷으로 응답
3. Codex app-server 통신 불안정 (s36~s37 에 도입된 새 경로)
4. Gemini CLI streaming 파싱이 특정 응답 포맷에 민감

조사 필요 파일:
- `src-tauri/src/commands/project_onboarding.rs` 의 `call_agent`, `build_prompt`, `parse_output`
- 각 engine 별 `_run_claude`, `_run_codex`, `_run_gemini` 함수 (있다면)

# 설계

## (1) UI quick fix

**파일**: `src/components/tunaflow/ProjectOnboardingModal.tsx`

```tsx
// line 156-160 교체
const handleSkip = () => {
  invoke("cancel_project_onboarding").catch(() => {});  // ← 추가
  cleanupRef.current.forEach((u) => u());
  setModalState("done");
  clearOnboardingProject();
};
```

## (2) UX 개선 — error state 버튼 통합

**파일**: 동일

error state 에서 "건너뛰기" 버튼 제거. "닫기" 하나로 통합. 실질적으로 **같은 의도** 이므로.

```tsx
// line 263-277 교체 (before)
{error ? (
  <>
    <button onClick={() => setModalState("skip_confirm")}>{t("onboarding.skip_button")}</button>
    <button onClick={handleCancel}>{t("onboarding.close_button")}</button>
  </>
) : (
  <button onClick={() => setModalState("cancel_confirm")}>{t("onboarding.cancel_button")}</button>
)}

// after
{error ? (
  <button onClick={handleCancel} className="ml-auto ...">
    {t("onboarding.close_button")}
  </button>
) : (
  <button onClick={() => setModalState("cancel_confirm")} className="ml-auto ...">
    {t("onboarding.cancel_button")}
  </button>
)}
```

연관 제거:
- `modalState === "skip_confirm"` 상태 전환 경로 (더 이상 필요 없음)
- `SkipConfirmOverlay` 컴포넌트 (있다면)

다만 `handleSkip` 함수 자체는 남겨둠 — `handleSkipFromSelector` 와 별개로 다른 경로에서 쓰일 수 있으니 즉시 삭제 금지. 단 현재 사용처가 사라지면 다음 PR 에서 정리.

## (3) Rust layer — `call_agent` cancel poll

**파일**: `src-tauri/src/commands/project_onboarding.rs`

`call_agent` 시그니처를 이미 `&cancel: &Arc<AtomicBool>` 받도록 돼 있음. 내부 구현에서 cancel flag 를 주기적으로 확인하도록:

- subprocess/streaming 경로라면 `tokio::select!` 로 flag watcher 와 response reader 경쟁
- HTTP 호출이면 `reqwest::Client` 에 timeout + cancel-aware wrapper

실제 구현은 코드 확인 후 세부 설계 필요. **quick fix 는 UI 수정만으로도 충분**. Rust 수정은 근본 해결이라 별도 subtask 로 진행 가능.

## (4) Codex/Gemini 분석 실패 — 별건 plan 으로 분리

이 fix 와 묶지 않음. 원인 확정에 시간 걸리고 (프롬프트 튜닝 / 파서 수정 / 엔진별 분기) 수정 범위도 다름. 이번 PR 은 **error 상태 진입 후 탈출 경로 보장** 에 집중.

별건 이슈 등록 대상:
- "Codex/Gemini 메타 분석이 실패하는 원인 조사"
- 재현 방법: 빈 프로젝트 or 복잡한 프로젝트에서 각 엔진 메타 선택

## (5) 파이프라인 전수 감사 (체크리스트)

유사 패턴 (long-running async + UI dismiss + cancel 누락) 의심 위치:

- [ ] `ManualVerificationGate` (B-19 / 2026-04-24 머지) 의 cancel 경로
- [ ] `startReviewRT` 진입 중 에러 발생 시 UI 복귀
- [ ] Branch adopt 실패 경로
- [ ] Plan 생성 중 LLM 응답 실패 시 rollback
- [ ] rawq index build 중 취소 (rawq sidecar 는 별 프로세스라 자체 종료 로직 있음)
- [ ] 기타 `invoke()` 호출 후 UI 가 먼저 unmount 되는 모든 경로

각 항목별 체크:
1. long-running async 진입 전 cancel flag / token 셋업돼 있는가
2. UI dismiss 경로가 rust 쪽 cancel command 를 호출하는가
3. rust 쪽 async task 가 cancel 을 주기적으로 poll 하는가

**산출물**: 이 plan 과 별도의 `docs/reference/asyncCancelPipelineAudit_2026-04-25.md` — audit 결과 문서. PR 과 같이 머지.

## (6) 테스트

- 수동 smoke (PR 필수):
  1. Codex 메타 선택 → 분석 실패 유도 (빈 프로젝트) → "닫기" → 메인창 복구 확인
  2. Gemini 메타 선택 → 같은 시나리오 → "닫기" → 메인창 복구 확인
  3. Claude 메타 선택 → 정상 분석 → preview 진입 → apply → 복구
- 자동 테스트는 제한적 (React testing library + mock tauri `invoke`). 최소한 `handleSkip` 이 `cancel_project_onboarding` 을 호출하는지 unit test.

# Invariants

- **[INV-1]** error state 에서 사용자가 어떤 버튼을 누르든 `cancel_project_onboarding` 이 호출된다. "닫기" 단일 버튼이라 자연히 성립. 검증: 코드 리뷰.
- **[INV-2]** UI 가 dismiss 된 이후 rust `analyze_project_for_onboarding` task 는 즉시 종료하거나 idempotent 하게 완료 (side effect 없음) 된다. 검증: `is_cancelled(&cancel)` 체크 포인트 감사.
- **[INV-3]** 다른 long-running async 경로 (B-19 gate 등) 에도 같은 원칙 적용 확인. 검증: audit 문서 5 항목.
- **[INV-4]** `handleSkip` 함수 자체는 남겨두되, 현재 PR 에서 호출처가 사라짐. 다음 PR 에서 unused 되면 제거.

# Rationale

## 왜 skip 과 close 를 통합하나

현재 UX 에서 "건너뛰기" 와 "닫기" 는 라벨만 다를 뿐 사용자가 구분할 이유가 없다. 둘 다 "이 에러 상황에서 탈출" 이다. 버튼 두 개가 내부 구현만 다르게 동작하는 건 사용자 혼란 + 버그 온상.

단순화가 수정 범위도 줄인다 — `handleSkip` cancel 호출 추가 대신 진입 경로를 통째로 제거하는 게 깔끔.

## 왜 Rust 수정은 subtask 로 분리하나

UI 수정만으로도 primary 증상 (메인창 lock) 은 해결된다. Rust cancel poll 은 근본 해결이지만 subprocess / HTTP / streaming 각 경로별 변경이라 변경 표면이 크다. 이번 PR 은 **"error 탈출 UX 보장"** 이 목표. Rust 근본 해결은 별도 PR 이 깔끔.

## 왜 Codex/Gemini 분석 실패를 별건으로 두나

원인 확정이 오래 걸림 (프롬프트 튜닝 / 파서 / 엔진별 응답 포맷 분석). 이번 PR 은 "실패하면 탈출 가능" 이 목표지 "실패 자체를 없앰" 은 아님. 분리가 스코프 명확.

# Developer 핸드오프 프롬프트 (tunaFlow dev 종료 후 사용)

```
[작업] Project Onboarding "건너뛰기" UI lock 수정 + error state 버튼 UX 통합 + 파이프라인 전수 감사 (커뮤니티 제보)

[SSOT] docs/plans/onboardingCancelLeakFixPlan_2026-04-25.md 를 먼저 읽고, §설계 (1) ~ (5) 순서대로 처리.

[배경 3줄]
- Codex/Gemini 메타 분석 실패 후 "건너뛰기" 누르면 메인창 비활성 고정 (커뮤니티 제보)
- handleSkip 이 invoke("cancel_project_onboarding") 을 호출 안 해서 rust task orphaned
- 근본 원인이자 UX 결함이자 파이프라인 전반에 유사 패턴 가능성

[수정 범위]

1) 수정: src/components/tunaflow/ProjectOnboardingModal.tsx
   - line 156: handleSkip 에 invoke("cancel_project_onboarding").catch(()=>{}) 한 줄 추가
   - line 263-277: error state 의 "건너뛰기" 버튼 제거, "닫기" 단일 버튼으로 통합
   - modalState === "skip_confirm" 분기가 다른 곳에서 참조되는지 grep → 미사용이면 state machine 타입에서 제거
   - t() 번역 키 skip_button / skip_confirm_* 이 다른 곳에서 안 쓰이면 정리 (i18n 파일)

2) 조사 및 수정 (optional, subtask 분리 가능):
   src-tauri/src/commands/project_onboarding.rs 의 call_agent 내부가 cancel flag 를
   주기적으로 poll 하는지 확인. 안 하면 tokio::select! 또는 주기 체크 추가.

3) 신규: docs/reference/asyncCancelPipelineAudit_2026-04-25.md
   - 5 항목 체크리스트 감사 결과 문서
   - ManualVerificationGate / startReviewRT / Branch adopt / Plan 생성 / rawq index 각각의
     cancel 경로 상태 확인
   - 결함 있는 곳은 별도 plan 으로 승격

4) 별건 이슈 신규 등록 (본 PR 와 별개):
   "Codex/Gemini 메타 분석 실패 원인 조사"

[검증]
- cd src-tauri && cargo check --all-targets: 0 에러
- npx tsc --noEmit: 0 에러
- npx vitest run: 신규 테스트 + 기존 pass
- 수동 smoke (plan §(6)):
    1. Codex 메타 + 빈 프로젝트 → 분석 실패 → "닫기" → 메인창 복구 확인
    2. Gemini 메타 + 빈 프로젝트 → 동일 시나리오 확인
    3. Claude 메타 + 정상 프로젝트 → preview → apply → 복구 확인

[커밋 분리]
- fix(onboarding): call cancel_project_onboarding from handleSkip (primary bug)
- refactor(onboarding): merge skip/close buttons in error state (UX consolidation)
- docs(ref): async cancel pipeline audit (5-point checklist)

trailer: Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

[PR 제목]
fix(onboarding): recover main window after failed meta analysis (skip/close unified)

[주의]
- git stash drop/clear 금지
- handleSkip 함수 자체는 이번 PR 에서 제거하지 말 것 (호출처만 없어짐). 다음 PR 에서 미사용 확정 후 제거
- UX 개선 시 translation key skip_button 제거는 i18n 전체 locale 파일 (en/ko) 모두 확인
- Codex/Gemini 근본 수정은 별 PR — 이번은 "실패해도 탈출 가능" 이 목표
```

# 셀프 이슈 본문 초안 (dev 종료 후 `gh issue create` 용)

```
## Summary

After a community report on the public-beta launch day, identified:

1. **Primary**: Codex/Gemini meta analysis fails → user hits "건너뛰기" (Skip) → main window becomes unresponsive. Root cause: `handleSkip` in `ProjectOnboardingModal.tsx:156` dismisses the modal without calling `cancel_project_onboarding`, leaving the Rust `analyze_project_for_onboarding` task orphaned.

2. **UX gap**: In the error state, "Skip" and "Close" buttons have identical user intent ("escape this error") but different internal behavior. Conceptually redundant; Skip's separate code path is where the bug lives.

3. **Sibling issue** (separate): Codex/Gemini meta analysis itself fails in a way Claude doesn't. Investigation needed (likely prompt/parser bias toward Claude output formats). Out of scope for this fix.

## Reproduction (from community reporter, M2 16GB Air)

1. New project → meta-agent selector → choose **Codex or Gemini**
2. AI analysis phase shows "분석 실패" (Analysis failed)
3. Click "건너뛰기" (Skip) → modal closes
4. Main window is inactive. App process alive but unresponsive.
5. App restart recovers the state.

Claude meta selection works fine (analysis succeeds → preview state).

## Root cause

- `src/components/tunaflow/ProjectOnboardingModal.tsx:156` — `handleSkip` does not call `invoke("cancel_project_onboarding")`, unlike `handleCancel` (line 149)
- `src-tauri/src/commands/project_onboarding.rs:608` — the Rust task is tied to a global `Arc<AtomicBool>` cancel flag set via `cancel_project_onboarding` (line 681). Without that call from the UI, the task keeps running after the modal dismisses
- Rust `call_agent` (line 651) may additionally need internal cancel-flag polling (it's `.await`ed without intermediate checks)

## Proposed fix

Tracked in `docs/plans/onboardingCancelLeakFixPlan_2026-04-25.md`:

1. **UI quick fix**: Add `invoke("cancel_project_onboarding")` call to `handleSkip`
2. **UX consolidation**: Merge error-state Skip/Close into a single Close button (same user intent)
3. **Rust hardening** (subtask): Ensure `call_agent` internals poll the cancel flag periodically
4. **Audit** (subtask): Document async-cancel pipeline across the app, identify similar patterns (ManualVerificationGate, Review RT, Branch adopt, etc.)

Codex/Gemini analysis failure root cause is a sibling issue (to be filed separately).

## Acknowledgments

Community reporter on the 2026-04-24 public beta launch. Debug-path narrowed down by their follow-up comment confirming engine-dependent failure (Claude works, Codex/Gemini fail).
```

# 관련 기록

- 2026-04-24 공개 첫날 batch: Issue #175 / #178 / #180 / #176 / #185 로 이어지는 핸드오프 패턴. 이 plan 도 동일 패턴 (plan 문서 + 핸드오프 + 이슈 본문).
- 유사 async cancel 패턴 감사는 별도 `docs/reference/asyncCancelPipelineAudit_2026-04-25.md` 로 분리.
