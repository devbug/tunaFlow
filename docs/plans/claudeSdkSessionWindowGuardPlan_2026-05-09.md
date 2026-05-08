---
title: Claude SDK 세션 누적 window guard + Reviewer specific squeeze
status: ready
phase: planning
priority: P0 (사용자 본인 환경 회귀 보고 — Reviewer 단계 진행 차단)
created_at: 2026-05-09
canonical: true
related:
  - src-tauri/src/guardrail.rs  # MAX_TOTAL_PROMPT (line 14)
  - src-tauri/src/agents/claude_sdk_session.rs  # build_user_message (812) + accumulated_input_tokens (838)
  - src-tauri/src/commands/agents_helpers/send_common/prompt_assembly.rs  # system + user concat (710~715)
  - src-tauri/src/commands/agents_helpers/send_common/context_loading.rs  # plan_document cap + load_recent_messages_excluding_rt LIMIT
  - src-tauri/src/commands/context_queries.rs  # load_recent_messages_excluding_rt
  - docs/plans/claudeTransportFlipHardeningPlan_2026-04-29.md  # T9-a/T11 의 fresh-session 정책 SSOT
issue_source: 사용자 본인 환경 보고 (2026-05-09, in-session)
---

# Claude SDK 세션 누적 window guard + Reviewer specific squeeze

## 0. Context

### 0.1 사용자 보고 (in-session, 2026-05-09)

> "[claude-code error] claude reported error: Prompt is too long 리뷰어에서 지금 이런 에러가 계속 나는데 왜 그럴까?"
>
> "사용량 많이 남았는데 왜 리미트가 걸리지?(현재세션)"

사용자가 *quota 충분* + *Reviewer 에서 반복 발생* 두 fact 같이 보고. 즉 Anthropic monthly quota 영역이 아닌 *single-request input size limit* 영역. v0.1.7-beta release 후 표면화된 회귀로 추정.

### 0.2 시나리오 정확화

1. 사용자가 plan 진행 → DEV 단계 정상 → **Reviewer 진입 시점에 차단**
2. claude API 응답 = `claude reported error: Prompt is too long`
3. 한 번 발생 후 재시도해도 같은 결과 (accumulated history 가 남아있어 누적 더 증가)
4. 다른 conv / 새 plan 의 Reviewer 호출은 정상 (해당 conv 의 세션 history 만 영향)

### 0.3 Root cause 가설 v1 — Architect 직접 검증 결과 (2026-05-09)

서브에이전트 진단 (read-only, code path 직접 인용) 결과:

| 가설 | 매칭률 | 근거 |
|---|---|---|
| **(α)** review branch 의 implementation transcript 폭발 | 15% | `current_messages` 는 `load_recent_messages_excluding_rt(conn, conv, 20)` 로 LIMIT 20 + `rt_round_index IS NULL` 격리 (PR #266 v51). 단일 turn 단위만 가드, *cumulative SDK history* 와 무관 |
| **(β)** v0.1.7-beta 의 `rt-consensus` 섹션 budget 초과 | 10% | `MAX_FINDINGS_SECTION = 3,000` chars cap + decision 600자 truncate 강제 (`db_queries.rs:418`). 5+ 라운드 누적도 cap 안 |
| **(γ)** total budget misalign — outgoing-only 가드 | **70%** | `MAX_TOTAL_PROMPT = 60,000` chars (`guardrail.rs:14`) 는 *system 영역만* 의 cap. 실제 over-the-wire = `system + "---" + user + claude SDK 세션 누적 history`. SDK 세션이 `is_session_continuation=true` 시 history 자체 보유 → tunaFlow 가 자르지 못함. Reviewer 가 같은 conv 내 dev turn 누적 + plan_document 6K + verdict 반복 → 200K token 한계 hit |

**확정 root cause**: (γ) 결정. Plan B 의 SDK 세션 누적 history 는 tunaFlow `MAX_TOTAL_PROMPT` 의 가드 영역 *밖*. `accumulated_input_tokens` 는 이미 `claude_sdk_session.rs:838` 에서 tracking 중인데 **임계 도달 시 행동 (fresh-rotate) 미정의**. 즉 인프라 마련됐으나 정책 미배선.

Reviewer 가 빈번한 surface 인 이유:
1. 같은 conv 의 dev turn 누적이 main session continuation 으로 SDK 세션 안에 잔존
2. plan_document 까지 풀 attach (max 6,000 chars)
3. Reviewer verdict + finding 반복 시 SDK 세션 history 단조 증가

(γ) 가 근본이지만 Reviewer specific squeeze 가 *trigger threshold 늦춤* 보조 효과.

### 0.4 v0.1.7-beta 영향

- v0.1.7-beta 의 `rt-consensus` 섹션 추가는 본 회귀의 *직접 원인 아님* — 600자/항목 cap + 3K total cap. 단 누적 turn 수가 주범인 (γ) 영역에 *추가 1~2K* 를 보태므로 trigger threshold 를 약간 낮춤
- 본 plan 은 *v0.1.6-beta 부터 잠재* 한 (γ) 회귀 — v0.1.7-beta 는 표면화 가속 영역만 기여

## 1. Invariants

| ID | 내용 |
|---|---|
| **INV-CSW-1** | `accumulated_input_tokens` tracking 정확도 보존 — `claude_sdk_session.rs:838` 의 누적 로직 변경 0, *임계 도달 시 행동* 만 추가 |
| **INV-CSW-2** | fresh-rotate 후 ContextPack 재주입 동작 보존 — plan_document / findings / artifacts / RT consensus 등이 새 SDK 세션의 첫 turn 에 정상 등장 (사용자 컨텍스트 회복 가능) |
| **INV-CSW-3** | RT consensus 영구화 (v0.1.7-beta) + RT marker 격리 + Architect 인계 영역 영향 0 (Plan B INV-RTC-1~8 그대로) |
| **INV-CSW-4** | branchSessionPolicy.md INV-1~5 (brand session = main session 공유 정책) 보존 |
| **INV-CSW-5** | `[1m]` variant 사용자 (claude-opus-4-7-1m 등) 의 cap 은 *900K tokens 등가* — 200K 한계 영역 사용자에만 임계 180K 적용. 1M 모드 사용자 영향 0 |
| **INV-CSW-6** | Reviewer 외 role (Architect / Developer / Persona / single-agent dispatch) 의 ContextPack 동작 변경 0 — Reviewer specific squeeze 분기는 role 정확히 매칭될 때만 |
| **INV-CSW-7** | Frontend UI 변경 0 (toast 알림 채널은 backend → frontend 신호만 추가, 기존 toast 인프라 재사용) |
| **INV-CSW-8** | RT 미사용 / Reviewer 미사용 conv 의 fast path 보존 — 빈 결과 시 신규 임계 체크 자체 skip |

## 2. Goals / Non-goals

### Goals

- **G1**: Reviewer 단계 *"Prompt is too long"* 회귀 0 — 사용자 환경 재현 시나리오 (긴 dev turn 누적 + Reviewer 진입) 통과
- **G2**: SDK 누적 임계 (default 모드 180K tokens / `[1m]` 모드 900K tokens) 도달 시 자동 fresh-rotate (`is_session_continuation=false` 강제) + 사용자 toast 알림 (silent 진행 X, 사용자 컨텍스트 손실 인지)
- **G3**: Reviewer specific squeeze (plan_doc 6K → 3K, `load_recent_messages_excluding_rt` LIMIT 20 → 10) 가 trigger threshold 늦춤 보조 — 1+2 동시 적용 시 사용자 체감 ↑
- **G4**: `[1m]` variant 사용자 영향 0 — 모델 detection 후 cap 분기 정확 (INV-CSW-5)
- **G5**: hotfix release (v0.1.8-beta minor) 24~72시간 안에 사용자 자가 회복 path 도입

### Non-goals

- ❌ **Plan A (#264 Windows 캡션바) 영역** — Windows 10 호환 한계로 본 cycle 외, 별 axis (사용자 결정 2026-05-09)
- ❌ **`MAX_TOTAL_PROMPT = 60,000` 자체 변경** — system 영역 outgoing cap 정책 보존. 본 plan 은 *cumulative SDK window* 영역 신규 가드만 추가
- ❌ **RT consensus / RT marker / Architect ContextPack 인계 (v0.1.7-beta) 변경** — Plan B 영역 그대로
- ❌ **Tier 2 brief / identity-trigger / memory auto-trigger** — v0.1.6-beta 영역 외
- ❌ **DB schema 변경 / migration** — backend 로직 영역 한정
- ❌ **Frontend UI 대규모 변경** — toast 알림은 기존 인프라 재사용, 신규 컴포넌트 추가 0
- ❌ **devbug 외부 사용자 ping** (memory `feedback_devbug_no_response`)
- ❌ **Architect persona / system prompt 본체 변경**
- ❌ **새 dependency 추가** — 기존 Tauri event / Zustand toast / Anthropic SDK 만 활용

## 3. Subtasks

### Task 01 — `accumulated_input_tokens` 임계 + 자동 fresh-rotate [P0, fix 본체]

**Changed files**:
- `src-tauri/src/agents/claude_sdk_session.rs` (line 838 주변 + dispatch 본체)
- `src-tauri/src/agents/claude.rs` (fresh-rotate 트리거 path, claudeTransportFlipHardeningPlan_2026-04-29 의 T9-a/T11 fresh-session 정책 재사용)

**Change description**:
- `accumulated_input_tokens` 가 임계 (default 모드 180K tokens / `[1m]` 모드 900K tokens) 도달 시 다음 dispatch 진입 직전에 *fresh-rotate trigger* 신호 발행
- fresh-rotate 의 행동: `is_session_continuation=false` 강제 + 새 SDK 세션 (T9-a / T11 의 fresh-session 정책 패턴 재사용)
- 임계 도달 후 *해당 turn 의 dispatch 자체* 는 fresh 모드로 진행 (회귀 차단), accumulated_input_tokens reset
- 임계값 정의: `const SDK_WINDOW_GUARD_TOKENS_DEFAULT: u64 = 180_000;` / `const SDK_WINDOW_GUARD_TOKENS_1M: u64 = 900_000;` (안전마진 90%)
- model variant 분기는 Task 04 의 helper 사용

**Verification**:
- `cd src-tauri && cargo test --lib` — 신규 unit test:
  - `sdk_window_guard_triggers_fresh_rotate_at_threshold` — accumulated_tokens >= 180K 시 fresh-rotate flag set
  - `sdk_window_guard_no_op_below_threshold` — < 180K 시 변경 0
  - `sdk_window_guard_resets_after_rotate` — fresh-rotate 후 accumulated_tokens reset
- e2e: 긴 dev turn 누적 (mocking) → Reviewer 호출 → fresh-rotate 동작 + 응답 정상

**회귀 위험 가드**:
- INV-CSW-1: `accumulated_input_tokens` tracking 로직 자체 변경 0
- INV-CSW-2: fresh-rotate 후 다음 turn 의 ContextPack 조립이 정상 (plan_doc / findings / RT consensus 모두 재등장)
- INV-CSW-3: RT 영역 영향 0 (RT 미사용 conv 도 동일 임계 적용)
- INV-CSW-4: branchSessionPolicy 영역 변경 0

**위험**:
- fresh-rotate 시 SDK 세션의 in-flight tool call / artifact context 손실 가능성 — claudeTransportFlipHardeningPlan T9 의 *graceful 회복 path* 패턴 인용
- 임계 도달 직전 turn 이 *마지막 정상 응답* 이고 이후 turn 부터 fresh — 명시적 boundary 가 디버깅 용이

### Task 02 — 사용자 toast 알림 (fresh-rotate 발생 시) [P0, UX]

**Changed files**:
- `src-tauri/src/agents/claude_sdk_session.rs` (Tauri event emit 영역)
- `src/lib/sdkSessionStore.ts` 또는 `src/stores/notificationStore.ts` (event listener)
- `src/locales/{ko,en}/runtime.json` 또는 `dialog.json` (toast 메시지 i18n)

**Change description**:
- fresh-rotate trigger 시 backend 가 Tauri event `tunaflow:sdk-session-window-rotated` 발행 (payload: 이전 accumulated_tokens / 시점)
- frontend 의 기존 toast 인프라 (sonner) 가 listener 수신 → toast 표시: *"세션 컨텍스트 한계 도달. 새 세션으로 자동 전환됨 (이전 컨텍스트는 ContextPack 으로 재주입됨)."*
- 사용자가 *왜 갑자기 fresh* 인지 인지 가능 (silent 진행 X)
- toast 디자인: `info` 레벨 (오류 아님), 5초 자동 dismiss

**Verification**:
- `npx vitest run` — 신규 frontend test:
  - listener 가 event 수신 시 toast 호출 검증
- e2e: 임계 도달 시 toast 표시 + 5초 후 dismiss

**회귀 위험 가드**:
- INV-CSW-7: 기존 toast 인프라 (sonner) 재사용, 신규 컴포넌트 0
- INV-CSW-8: RT 미사용 conv 도 동일 toast 영역 영향 가능 — listener 가 conv-specific 인지 검증

**위험**:
- toast 메시지 i18n 누락 시 fallback 영문 — release notes 에 명시

### Task 03 — Reviewer specific squeeze [P1, 보조 fix]

**Changed files**:
- `src-tauri/src/commands/agents_helpers/send_common/context_loading.rs` (line 586 LIMIT 인자 + reviewer role 분기)
- `src-tauri/src/commands/agents_helpers/send_common/prompt_assembly.rs` (plan_document cap 분기)

**Change description**:
- Reviewer role detection (`resolve_agent_role` 결과 == "reviewer") 시 squeeze 적용:
  - `load_recent_messages_excluding_rt` LIMIT 인자 20 → **10** (Reviewer 만)
  - `plan_document` cap 6,000 → **3,000** chars (Reviewer 만)
- 다른 role (Architect / Developer / Persona / single-agent) 은 기존 cap 보존
- Squeeze 적용 trigger threshold 가 약 5K~10K chars 늦춰짐 → Task 01 의 fresh-rotate 빈도 감소

**Verification**:
- `cd src-tauri && cargo test --lib` — 신규 unit test:
  - `reviewer_role_uses_squeezed_plan_doc_cap` — reviewer 분기에서 plan_doc cap = 3K
  - `reviewer_role_uses_squeezed_recent_messages_limit` — reviewer 분기에서 LIMIT = 10
  - `non_reviewer_roles_keep_original_caps` — Architect / Developer / Persona 영역 변경 0

**회귀 위험 가드**:
- INV-CSW-6: Reviewer 외 role 의 ContextPack 동작 변경 0
- 분기 조건 정확도 — `resolve_agent_role` 의 reviewer 매칭이 review_branch_id 기반 (`context_loading.rs:1592`) 이므로 false positive 위험 0

**위험**:
- Reviewer 가 받는 plan_document 가 잘려서 일부 task 정보 누락 가능 — 단 verdict 결정에 필수 영역 (rubric / findings) 은 별 섹션이라 영향 미미

### Task 04 — `[1m]` variant detection + cap 분기 helper [P1, 분기 인프라]

**Changed files**:
- `src-tauri/src/agents/claude_sdk_session.rs` 또는 신규 `src-tauri/src/agents/claude_window_guard.rs` (helper)
- `src-tauri/src/commands/model_discovery.rs` (model variant detection 재사용)

**Change description**:
- 신규 helper `is_1m_variant(model_id: &str) -> bool` — `claude-opus-4-7-1m` / `claude-haiku-4-5-1m` 등 `-1m` suffix 또는 known variant 매칭
- `current_window_guard_threshold(model_id) -> u64` — `is_1m_variant` true 시 900_000, false 시 180_000 반환
- Task 01 의 fresh-rotate trigger 가 위 helper 호출

**Verification**:
- `cd src-tauri && cargo test --lib` — 신규 unit test:
  - `is_1m_variant_detects_known_variants`
  - `current_window_guard_threshold_returns_correct_value_per_variant`

**회귀 위험 가드**:
- INV-CSW-5: `[1m]` 사용자 영향 0 — 900K 임계는 200K 단일 turn limit 와 무관 (1M 모델은 단일 turn 자체가 1M 까지 받음)

**위험**:
- 미래 신규 1M variant 추가 시 helper 갱신 필요 — *known variant list* 가 hardcoded 라 추가 PR

### Task 05 — Test 보강 + 통합 e2e [P0, 검증]

**Changed files**:
- `src-tauri/src/agents/__tests__/claude_sdk_session_window_guard.rs` (신규 또는 inline test)
- `src-tauri/src/commands/agents_helpers/send_common/__tests__/reviewer_squeeze.rs` (신규 또는 inline)

**Change description**:
- 통합 e2e (mocking):
  - 사용자 시나리오 재현: dev turn 누적 (200K tokens 직전) + Reviewer 호출 → fresh-rotate 자동 + 정상 응답 + toast 발행
  - Reviewer squeeze 적용 시 trigger threshold 가 약 10K 챗 늦춰지는지 검증
  - `[1m]` variant 사용자가 동일 시나리오 진입해도 fresh-rotate 미발생 (cap 900K)

**Verification**:
- `cd src-tauri && cargo test --lib` 통과 + 신규 ~10 unit test 추가
- baseline: Rust 635 → 645 (+10)

**회귀 위험 가드**:
- 기존 635 test 통과 보존
- INV-CSW-8: RT 미사용 / Reviewer 미사용 conv 영역 영향 0 검증

### Task 06 — release notes / docs / changelog [P2, 문서]

**Changed files**:
- `CHANGELOG.md` (v0.1.8-beta 신규 섹션)
- `docs/reference/sessionHistory.md` (s 항목)
- (선택) `docs/reference/claudeSdkSessionWindowGuard.md` 신규 reference (architectural decision SSOT)

**Change description**:
- v0.1.8-beta release notes: 사용자 가시 변화 (fresh-rotate toast / Reviewer 안정화 / [1m] 분기)
- claudeTransportFlipHardeningPlan_2026-04-29 의 T9 fresh-session 정책과 본 plan 의 cumulative window guard 의 관계 명시 (architectural continuity)

**Verification**: markdown 렌더링 확인, 링크 깨짐 없음

**회귀 위험 가드**: 다른 docs 영역 손대지 말 것

## 4. Cross-cutting risks

| 위험 | 대응 |
|---|---|
| fresh-rotate 후 in-flight tool call / artifact context 손실 | claudeTransportFlipHardeningPlan T9-a 의 graceful 회복 패턴 인용. 새 세션 첫 turn 에서 ContextPack 이 plan_doc + findings + RT consensus 재주입 (INV-CSW-2) |
| toast 알림 i18n 누락 시 fallback | 영문 fallback. release notes 에 ko/en 둘 다 갱신 명시 |
| Reviewer squeeze 의 plan_document 잘림이 verdict 정확도 영향 | rubric / findings 섹션은 별 영역이라 영향 미미. squeeze 가 trigger threshold 늦춤 보조 역할만 |
| `[1m]` variant detection 의 모델명 hardcoded — 신규 variant 추가 시 누락 | helper 가 `model_id.ends_with("-1m") OR known_list.contains` 패턴이라 future variant 도 cover. 신규 추가 시 known_list 갱신 별 PR |
| Task 01 임계 180K 가 Anthropic API 의 200K 한계 변경 시 stale | release notes 에 *"임계는 90% 안전마진 기준"* 명시. Anthropic 변경 추적은 별 plan 영역 |
| migration 영향 0 — DB schema 변경 없음 | INV-CSW (NA), 단 `accumulated_input_tokens` tracking 자체는 in-memory 라 영구 저장 영향 0 |
| Plan A (#264 Windows) 와의 release timing 충돌 | Plan A 는 별 cycle (보류). 본 plan v0.1.8-beta minor 단독 진행 |

## 5. Rollback

- **Task 01**: 단독 revert 가능. 임계 + fresh-rotate 트리거 로직 제거 → 기존 회귀 (Reviewer "Prompt is too long") 그대로 복귀. accumulated_input_tokens tracking 본체는 영향 0
- **Task 02**: toast 알림 제거 → fresh-rotate 자체는 silent 진행 (UX 마찰 ↑). Task 01 단독 머지 시 임시 운영 가능
- **Task 03**: Reviewer squeeze revert → plan_doc 6K + LIMIT 20 복귀. trigger threshold 빨라지나 Task 01 의 fresh-rotate 가 안전망
- **Task 04**: `[1m]` 분기 revert → 단일 cap (180K) 적용 → 1M 사용자가 *불필요한* fresh-rotate 받음 (UX 마찰만, 회귀 0)
- **Task 05**: test 추가 revert → test 카운트 감소만
- **Task 06**: 문서 단독 revert

전체 revert 시퀀스: 06 → 05 → 03 → 04 → 02 → 01 (역순). destructive 영역 0 (DB / migration / 사용자 데이터 영향 없음).

## 6. 다음 step

1. **Developer 핸드오프 작성** — PR 분리 권장:
   - **PR-1**: Task 01 + Task 04 (fresh-rotate 본체 + `[1m]` 분기 helper) — 근본 fix, 단독 머지 가능
   - **PR-2**: Task 02 (toast 알림) — frontend / event 영역, PR-1 의존
   - **PR-3**: Task 03 (Reviewer squeeze) — 보조 fix, 독립 axis
   - **PR-4**: Task 05 + Task 06 (test + docs)
2. **release timing**: **v0.1.8-beta minor 권장** — Reviewer 안정화 + fresh-rotate 정책 신설 → minor axis. 24~72시간 내 publish 목표 (사용자 본인 환경 차단이라 빠른 release)
3. **사용자 답변**: in-session 보고라 issue 댓글 영역 0. release publish 후 본 세션 또는 다음 세션 안내
4. **후속 plan 가능성**:
   - **Plan A (#264 Windows 캡션바)** — 본 cycle 후 Windows 10 호환 영역 별 plan 진행 여부 결정. 사용자 결정 영역
   - **Tier 2 brief / Reviewer 외 role 의 SDK window guard 적용** — 본 plan 은 Reviewer 가 가장 빈번한 surface 라 우선. Architect / Developer 영역에도 같은 회귀 발생 시 별 plan
   - **`accumulated_input_tokens` 영구 저장** — 현재 in-memory tracking. 세션 재시작 시 reset 되어 *cold start 시 첫 dispatch 부터 누적* 인지. 영구 저장 시 재시작 후에도 정확한 cap 적용 가능 — 별 P3 plan
