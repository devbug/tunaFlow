---
title: Developer 핸드오프 — Claude SDK 세션 누적 window guard + Reviewer specific squeeze
plan: docs/plans/claudeSdkSessionWindowGuardPlan_2026-05-09.md
created_at: 2026-05-09
---

# Developer 핸드오프 — Claude SDK 세션 누적 window guard + Reviewer specific squeeze

## 0. 한 줄 요약

사용자 본인 환경 보고: Reviewer 단계에서 *"[claude-code error] claude reported error: Prompt is too long"* 회귀 (v0.1.7-beta release 후 표면화). Root cause = `MAX_TOTAL_PROMPT = 60,000` chars (`guardrail.rs:14`) 가 *system 영역 outgoing* 만 가드하고 **claude SDK 세션 누적 history 미가드** — `is_session_continuation=true` 시 SDK 가 history 자체 보유, tunaFlow 가 자르지 못함. fix axis: `accumulated_input_tokens` 임계 (180K default / 900K `[1m]`) 도달 시 **자동 fresh-rotate** + Reviewer specific squeeze 보조.

## 1. 작업 개요 — task 표

Plan (`claudeSdkSessionWindowGuardPlan_2026-05-09.md`) 의 6 task 를 **4 PR 분리**. 외부 issue 없음 (사용자 in-session 보고).

| Task | 파일 | 핵심 변경 | PR | 우선 |
|---|---|---|---|---|
| **PR-1** | | | | |
| 01 | `src-tauri/src/agents/claude_sdk_session.rs` (838 + dispatch 본체), `src-tauri/src/agents/claude.rs` | `accumulated_input_tokens` 임계 도달 시 fresh-rotate trigger (`is_session_continuation=false` 강제). claudeTransportFlipHardeningPlan T9-a/T11 fresh-session 패턴 재사용. 임계: `SDK_WINDOW_GUARD_TOKENS_DEFAULT: u64 = 180_000` / `SDK_WINDOW_GUARD_TOKENS_1M: u64 = 900_000` | PR-1 | P0 |
| 04 | 신규 또는 inline (`src-tauri/src/agents/claude_window_guard.rs` 또는 `claude_sdk_session.rs`), `model_discovery.rs` 재사용 | `is_1m_variant(model_id) -> bool` + `current_window_guard_threshold(model_id) -> u64` helper. `-1m` suffix + known variant list | PR-1 | P1 |
| **PR-2** | | | | |
| 02 | `src-tauri/src/agents/claude_sdk_session.rs` (event emit), `src/lib/sdkSessionStore.ts` 또는 `src/stores/notificationStore.ts` (listener), `src/locales/{ko,en}/runtime.json` 또는 `dialog.json` (i18n) | Tauri event `tunaflow:sdk-session-window-rotated` 발행 + frontend listener → sonner toast (`info` 레벨, 5초 dismiss) | PR-2 | P0 |
| **PR-3** | | | | |
| 03 | `src-tauri/src/commands/agents_helpers/send_common/context_loading.rs` (line 586 LIMIT + reviewer 분기), `prompt_assembly.rs` (plan_doc cap 분기) | reviewer role 분기에서 `load_recent_messages_excluding_rt` LIMIT 20→10 + `plan_document` cap 6,000→3,000. 다른 role 영향 0 | PR-3 | P1 |
| **PR-4** | | | | |
| 05 | `src-tauri/src/agents/__tests__/...`, `src-tauri/src/commands/agents_helpers/send_common/__tests__/...` | 신규 ~10 unit test (window guard 임계 / fresh-rotate / Reviewer squeeze / `[1m]` 분기 / 통합 e2e mocking) | PR-4 | P0 |
| 06 | `CHANGELOG.md`, `docs/reference/sessionHistory.md`, (선택) `docs/reference/claudeSdkSessionWindowGuard.md` 신규 | v0.1.8-beta 신규 섹션 + sessionHistory s 항목 + (선택) reference 신규 | PR-4 | P2 |

진행 순서: **PR-1 → PR-2 → PR-3 → PR-4**. PR-1 의 fresh-rotate 본체 + helper 가 PR-2 의 event 의존, PR-3 은 독립 axis (병렬 머지 가능하나 권장 순서 유지), PR-4 의 test 가 PR-1/2/3 의존. PR-1 단독 머지로도 root cause 차단 가능 (toast / squeeze 없이 silent 작동).

## 2. DO — 반드시 지킬 것

1. **Plan §3 각 task Verification 실 실행 + chat 보고**:
   - PR-1 Task 01/04: `cargo test --lib` 신규 unit test 통과 (window_guard / `[1m]` variant detection)
   - PR-2 Task 02: `npx vitest run` listener test 통과 + 수동 toast 표시 검증
   - PR-3 Task 03: `cargo test --lib` reviewer squeeze unit test 통과 + 다른 role 영향 0 검증
   - PR-4 Task 05: 통합 e2e (mocking) 통과 — 사용자 시나리오 1:1 재현
2. **PR 진행 순서**: PR-1 (foundation) → PR-2 (PR-1 event 의존) → PR-3 (독립 axis) → PR-4 (전체 의존). PR 들이 같은 release cycle (v0.1.8-beta) 안에 묶음 머지 권장 — 부분 머지 시 *임계 도달은 하는데 toast 없음* / *squeeze 없이 trigger 빈도 ↑* 같은 정합성 흠
3. **claudeTransportFlipHardeningPlan_2026-04-29 의 T9-a/T11 fresh-session 정책 SSOT 인용** — Task 01 의 fresh-rotate trigger 가 같은 패턴 (`is_session_continuation=false` 강제 + 새 SDK 세션) 재사용. plan §3 Task 01 본문에 명시
4. **회귀 위험 가드 grep 사전 baseline**:
   - 작업 전: `rg "accumulated_input_tokens|MAX_TOTAL_PROMPT|is_session_continuation" src-tauri/src/` baseline
   - 작업 후: 본 plan 영역 외 grep 결과 동일 (다른 caller 영향 0)
   - DB schema 영향 0 검증: `git diff src-tauri/src/db/migrations.rs` 빈 출력
5. **feature 브랜치**:
   - PR-1: `feat/claude-sdk-window-guard`
   - PR-2: `feat/sdk-rotate-toast-notification`
   - PR-3: `feat/reviewer-context-squeeze`
   - PR-4: `test/sdk-window-guard-coverage`
6. **Commit 단위 task 별 분리**:
   - PR-1: `feat(claude-sdk): accumulated_input_tokens 임계 도달 시 자동 fresh-rotate (Task 01)` → `feat(claude-sdk): [1m] variant detection + 임계 helper (Task 04)`
   - PR-2: `feat(notification): SDK session window rotated toast (Task 02)`
   - PR-3: `feat(send-common): reviewer role plan_doc + recent messages squeeze (Task 03)`
   - PR-4: `test(claude-sdk): window guard + Reviewer squeeze + [1m] 분기 통합 (Task 05)` → `docs(release): v0.1.8-beta release notes (Task 06)`
7. **PR description**: plan 링크 (`docs/plans/claudeSdkSessionWindowGuardPlan_2026-05-09.md`) + 각 task §4/§5 Verification 결과 + 회귀 grep baseline → after. 외부 issue 없으므로 `Closes` 키워드 사용 안 함

## 3. DO NOT — 사이드 이펙트 차단

- ❌ **Plan A (#264 Windows 캡션바) 영역 손대지 말 것** — Windows 10 호환 한계로 본 cycle 외, 별 axis. `tauri.conf.json` / `bootstrap/window.rs:18~23` / `TitleBar.tsx` / `WindowControls.tsx` / `platform.ts` 변경 0
- ❌ **`MAX_TOTAL_PROMPT = 60,000` 자체 변경 금지** — INV-CSW (Plan §2 Non-goals). system 영역 outgoing cap 정책 보존. 본 plan 은 *cumulative SDK window* 영역 신규 가드만 추가
- ❌ **RT consensus / RT marker / Architect ContextPack 인계 (v0.1.7-beta) 변경 금지** — Plan B INV-RTC-1~8 보존 (INV-CSW-3). `roundtable_consensus` schema / `rt_round_index` / `build_rt_consensus_section` / `load_recent_messages_excluding_rt` 본체 변경 0 (단 LIMIT 인자 reviewer 분기 squeeze 는 OK)
- ❌ **Tier 2 brief / identity-trigger / memory auto-trigger / Rust `meta_agent/` 모듈 변경 금지** — v0.1.6-beta 영역 외
- ❌ **DB schema 변경 / migration 추가 금지** — `accumulated_input_tokens` 는 in-memory tracking, DB persist 영역 별 P3 plan
- ❌ **branchSessionPolicy.md INV-1~5 영역 손대지 말 것** — INV-CSW-4. brand session = main session 공유 정책 보존
- ❌ **`accumulated_input_tokens` tracking 본체 (`claude_sdk_session.rs:838`) 변경 금지** — INV-CSW-1. *임계 도달 시 행동* 만 추가, tracking 자체 영향 0
- ❌ **Reviewer 외 role (Architect / Developer / Persona / single-agent) 의 ContextPack cap 변경 금지** — INV-CSW-6. squeeze 는 reviewer 분기에만 적용. `resolve_agent_role` 결과 정확히 매칭 시
- ❌ **`[1m]` variant 사용자의 cap 영역 영향 금지** — INV-CSW-5. 1M 모드 사용자는 900K 임계로 *거의 trigger 안 됨* + 200K 한계 무관
- ❌ **Frontend UI 신규 컴포넌트 추가 금지** — INV-CSW-7. toast 알림은 기존 sonner 인프라 재사용. 신규 modal / banner / dialog 추가 0
- ❌ **새 dependency 추가 금지** — Tauri event / Zustand toast / Anthropic SDK 만 활용. `tauri-plugin-os` / `tauri-plugin-window-decoration` 같은 plugin 도입 영역 외 (Plan A 영역, 본 cycle 보류)
- ❌ **Architect persona / system prompt 본체 변경 금지** — Plan §2 Non-goals
- ❌ **README.md / CLAUDE.md / 다른 cross-cutting docs 변경 금지** — Task 06 의 CHANGELOG / sessionHistory / (선택) reference docs 외

## 4. 변경 후 검증 (전체)

각 PR 머지 직전 통과 명령:

```bash
cd src-tauri && cargo check --message-format=short
cd src-tauri && cargo test --lib
npx tsc --noEmit
npx vitest run
```

테스트 카운트 baseline (2026-05-09 v0.1.7-beta 머지 후):
- Rust: **635 tests** baseline. 본 plan 후 **+10 → 645** (PR-1/3/4 의 신규 unit test 누적)
- Frontend: **422 tests** baseline. PR-2 의 listener test 추가 → **+1~2 → ~424** (toast listener 영역)

PR 별 회귀 grep:

**PR-1 머지 직전**:
```bash
# 신규 helper + 임계 + fresh-rotate 등장
rg "SDK_WINDOW_GUARD_TOKENS_DEFAULT|SDK_WINDOW_GUARD_TOKENS_1M|is_1m_variant|current_window_guard_threshold" src-tauri/src/
# accumulated_input_tokens tracking 본체 변경 0
git diff src-tauri/src/agents/claude_sdk_session.rs | grep -E "^\-.*accumulated_input_tokens"  # 0건 (삭제 줄 없음)
# Plan A 영역 미변경
git diff src-tauri/tauri.conf.json src-tauri/src/bootstrap/window.rs src/components/tunaflow/TitleBar.tsx src/components/tunaflow/WindowControls.tsx src/lib/platform.ts  # 빈 출력
# RT 영역 미변경
git diff src-tauri/src/commands/roundtable.rs src-tauri/src/commands/roundtable_helpers/  # 빈 출력 (PR-1 영역 아님)
```

**PR-2 머지 직전**:
```bash
# Tauri event 등장
rg "tunaflow:sdk-session-window-rotated" src-tauri/src/ src/  # 양쪽 정의 + listener
# 기존 sonner / notification 인프라 재사용 검증
git diff src/components/  # 신규 .tsx 파일 추가 0 (listener 만 store 영역)
# Plan A / RT 영역 미변경
git diff src-tauri/src/commands/roundtable.rs  # 빈 출력
```

**PR-3 머지 직전**:
```bash
# reviewer 분기 등장
rg "resolve_agent_role.*reviewer\|reviewer.*plan_doc.*3000\|reviewer.*LIMIT.*10" src-tauri/src/
# 다른 role 영향 0
git diff src-tauri/src/commands/agents_helpers/send_common/context_loading.rs | grep -E "Architect|Developer|Persona"  # squeeze 분기 외 변경 없음
# RT marker / consensus 영역 보존
git diff src-tauri/src/commands/agents_helpers/context_pack/db_queries.rs  # 빈 출력 (PR-3 영역 아님)
```

**PR-4 머지 직전**:
```bash
# 신규 test 등장
rg "sdk_window_guard_triggers_fresh_rotate_at_threshold|reviewer_role_uses_squeezed_plan_doc_cap|is_1m_variant_detects_known_variants" src-tauri/src/
# 본체 코드 변경 0 (test 영역만)
git diff src-tauri/src/agents/claude_sdk_session.rs | grep -v "^+#\[cfg(test)\]"  # PR-1 영역 외 변경 0
# 다른 docs 미변경
git diff README.md CLAUDE.md docs/plans/  # 빈 출력 (Task 06 의 CHANGELOG / sessionHistory / 선택 reference 외)
```

## 5. e2e 수동 검증

각 PR 머지 직전 실행. 회귀 시나리오 + 회귀 가드 분리.

### PR-1 (fresh-rotate 본체 + `[1m]` 분기)

**회귀 시나리오** (사용자 보고 fix 의도):
- ✅ 긴 dev turn 누적 (mocking 또는 실 사용 — `accumulated_input_tokens` 가 180K 직전) → Reviewer 호출 → fresh-rotate 자동 발생 + 정상 응답 (`Prompt is too long` 회귀 0)
- ✅ fresh-rotate 후 다음 turn 의 ContextPack 에 plan_document / findings / RT consensus 모두 재등장 (사용자 컨텍스트 회복, INV-CSW-2)

**회귀 가드**:
- ✅ `accumulated_input_tokens` < 180K 시 fresh-rotate 미발생 (정상 path 보존)
- ✅ `[1m]` variant 사용자 (claude-opus-4-7-1m) 동일 시나리오 진입 시 fresh-rotate 미발생 (cap 900K, INV-CSW-5)
- ✅ Architect / Developer / single-agent dispatch 의 정상 동작 보존 (Reviewer 외 role 영향 0, INV-CSW-6)

### PR-2 (toast 알림)

**회귀 시나리오**:
- ✅ fresh-rotate 발생 시 frontend toast 표시 (info 레벨, 5초 dismiss)
- ✅ toast 메시지: ko 환경 *"세션 컨텍스트 한계 도달..."* / en 환경 영문 fallback
- ✅ toast 클릭 / dismiss 시 정상 동작

**회귀 가드**:
- ✅ 기존 sonner toast 영역 (다른 알림 / error / success) 정상 동작
- ✅ Tauri event listener 가 conv-specific 검증 (다른 conv 의 fresh-rotate 가 현재 conv toast 영역 영향 0)

### PR-3 (Reviewer squeeze)

**회귀 시나리오**:
- ✅ Reviewer 호출 시 plan_document cap 3K + recent messages LIMIT 10 적용 (ContextPack assembly trace 캡처)
- ✅ Squeeze 적용 후 trigger threshold 가 5~10K chars 늦춰짐 (PR-1 의 fresh-rotate 빈도 감소)

**회귀 가드**:
- ✅ Architect / Developer / Persona / single-agent 의 plan_document cap 6K + LIMIT 20 보존 (다른 role 영역 0)
- ✅ Reviewer verdict 의 rubric / findings 정확도 유지 (squeeze 가 verdict 결정에 영향 미미)

### PR-4 (test + docs)

**회귀 시나리오**:
- ✅ 신규 ~10 unit test 모두 통과
- ✅ release notes 의 사용자 가시 변화 3 항목 (fresh-rotate toast / Reviewer 안정화 / `[1m]` 분기) 등장

**회귀 가드**:
- ✅ 기존 635 Rust test 통과 보존 → 645
- ✅ Frontend 422 vitest 통과 보존 → ~424
- ✅ 다른 reference docs / README / CLAUDE.md 변경 0

GUI 환경 제약: Architect 직접 e2e 불가능한 시나리오 (실 dev turn 누적 200K 환경 재현) 는 unit test mocking + *"v0.1.8-beta release 후 사용자 자가 회복 검증"* 위임 명시.

## 6. CI 정책

- 각 PR 직후 admin merge 즉시 가능 (CI watch 불필요)
- 자체 검증 §4 + e2e §5 통과한 상태로 self-merge
- merge 후 main 회귀 시 즉시 revert PR 생성

migration / DB 영향 0 — 본 plan 은 backend 로직 + frontend listener + 신규 unit test 영역. release notes 외 사용자 데이터 영역 손대지 않음.

release timing:
- **v0.1.8-beta minor bump 권장** — 사용자 환경 차단 회복 + Reviewer 안정화 → minor axis. 24~72시간 내 publish 목표
- 4 PR 모두 같은 release cycle 안에 묶음 머지 권장 — 부분 머지 시 *fresh-rotate silent / squeeze 없음* 정합성 흠
- release notes 강조 항목 (Plan §6 Task 06):
  - *"Reviewer 단계 'Prompt is too long' 회귀 자동 회복 — 세션 누적 한계 도달 시 자동 fresh-rotate + toast 알림"*
  - *"`[1m]` variant 사용자 (1M context 모드) 영향 0"*
  - *"Reviewer specific squeeze — plan_document + recent messages 영역 압축으로 trigger 빈도 감소"*

## 7. 보고 포맷

작업 완료 시 chat 으로 다음 형식 회신:

```
## PR-1 (fresh-rotate 본체 + [1m] 분기, Task 01+04)
- 변경 라인: +N / -M (claude_sdk_session.rs, claude.rs, claude_window_guard.rs, model_discovery.rs)
- §4 Verification:
  - cargo check: PASS
  - cargo test --lib: 635 → 64N (+신규 window guard / [1m] variant test)
  - tsc --noEmit: PASS
  - vitest run: 422 → 422
- §5 e2e 수동:
  - 회귀 시나리오: ✅ 180K 임계 도달 시 fresh-rotate / fresh 후 ContextPack 재주입 / [1m] 모드 영향 0
  - 회귀 가드: ✅ < 180K 정상 path / Architect/Developer/single-agent 영향 0
- 회귀 grep: rg SDK_WINDOW_GUARD_TOKENS src-tauri/ → 정의+호출, Plan A 영역 diff 0
- PR URL: https://github.com/hang-in/tunaFlow/pull/<n>

## PR-2 (toast 알림, Task 02)
[같은 형식]

## PR-3 (Reviewer squeeze, Task 03)
[같은 형식]

## PR-4 (test + docs, Task 05+06)
[같은 형식]

## DO NOT 영역 침범 없음 확인
- INV-CSW-1 (accumulated_input_tokens tracking 본체): diff 0
- INV-CSW-3 (RT 영역): roundtable.rs / db_queries.rs / migrations.rs diff 0
- INV-CSW-4 (branchSessionPolicy): branchSession 영역 diff 0
- INV-CSW-5 ([1m] variant 영역 0): Helper 분기 정확도 검증
- INV-CSW-6 (Reviewer 외 role 영역 0): Architect/Developer 분기 diff 0
- Plan A 영역 (tauri.conf.json / bootstrap/window.rs / TitleBar.tsx / WindowControls.tsx / platform.ts): diff 0
- DB / migration / settings store: diff 0
- README.md / CLAUDE.md: diff 0
```

## 8. 막히면

- **fresh-rotate 후 in-flight tool call / artifact context 손실 발견** → claudeTransportFlipHardeningPlan_2026-04-29 의 T9-a graceful 회복 path 패턴 인용. 새 세션 첫 turn 의 ContextPack 이 plan_doc + findings + RT consensus 재주입 동작 검증 (INV-CSW-2). 회복 안 되면 escalate
- **`[1m]` variant detection 의 모델명 미매칭** → Task 04 의 helper 가 `model_id.ends_with("-1m")` + known list 둘 다 cover. 신규 variant 발견 시 known list 갱신 별 PR (Architect 결정)
- **Reviewer squeeze 후 verdict 정확도 저하 보고** → squeeze 는 *trigger threshold 늦춤 보조 영역* 만, 1순위 fix 는 PR-1 의 fresh-rotate. squeeze 자체 revert 시 Task 01 단독 동작 가능
- **Tauri event 채널 conv-specific 격리 어려움** → 1차로 *글로벌 이벤트* 발행 후 frontend listener 가 *현재 active conv* 와 매칭 검증. 매칭 어려우면 PR-2 보류 + Architect escalate
- **migration / DB schema 변경 필요로 진단 도달** → DO NOT 영역, 본 PR scope 외. Architect 에게 escalate (별 plan: `accumulated_input_tokens` 영구 저장 영역)
- **Plan A (#264) 영역까지 root cause 진단 도달** → 본 plan scope 외. Plan A 는 Windows 10 호환 한계로 별 cycle 보류 상태. 손대지 말 것
- **분기 조건 광범위 변경 위험** (예: 모든 role 의 ContextPack cap 재조정) → "조건 좁히기" 권장. reviewer role 매칭 (`resolve_agent_role` 결과 == "reviewer") 만으로 분기 좁힘 (INV-CSW-6)
- **진단 단계가 1시간 timeout** → chat 보고 + Architect escalate. 무리한 우회 금지

## 9. 사용자 답변 정책 (in-session 보고)

외부 GitHub issue 없음 — 사용자 본인 환경 in-session 보고. devbug ping 안 함 (memory `feedback_devbug_no_response` 패턴):

1. **Plan 머지 직후** (이미 완료, 2026-05-09): Architect 가 본 세션에서 진단 + plan + 핸드오프 작성 진행 중
2. **각 PR 머지 직후**: Architect 가 chat 으로 PR URL + 머지 commit sha + 회복 영역 안내 (사용자가 본 세션 또는 다음 세션 진입 시 인지)
3. **release publish 직후**: Architect 가 chat 으로 release URL + 자가 회복 안내:
   - *"v0.1.8-beta 자산 재설치 + 본인 환경에서 Reviewer 진입 시 'Prompt is too long' 회귀 0 / fresh-rotate 발생 시 toast 알림 표시 / `[1m]` variant 사용 시 영향 0 확인 부탁드립니다"*
   - DB migration 영향 0 (in-memory tracking) — 별 백업 / 마이그레이션 액션 불필요
4. **devbug 외부 사용자 영역 ping 안 함** — memory `feedback_devbug_no_response` 결정 (2026-05-09). 새 회귀 보고 시점에만 응답
5. **Plan A (#264 Windows 캡션바) 별 안내 없음** — 본 cycle 외, Windows 10 호환 한계로 보류 상태. issue #264 그대로 open 유지

한국어 본문, 코드 / 경로 / commit sha / PR URL / release URL 원문. 사용자가 *RT 사용 + Reviewer 단계까지 진입* 한 사용 패턴 자체가 *시스템 활용 적극적* 신호라 fresh-rotate UX 마찰 (toast 알림) 이 *불편* 보다 *투명성 ↑* 으로 인지될 가능성 높음.
