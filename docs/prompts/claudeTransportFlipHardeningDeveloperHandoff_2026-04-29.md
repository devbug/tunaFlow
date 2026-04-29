---
title: Developer 핸드오프 — claude transport flip hardening (8 task, v0.1.5-beta release blocker)
plan: docs/plans/claudeTransportFlipHardeningPlan_2026-04-29.md
created_at: 2026-04-29
---

# Developer 핸드오프 — claude transport flip hardening

## 0. 한 줄 요약

v0.1.4-beta transport flip (`-p --resume`) 이후 발견된 stale resume_token + ContextPack revival + rate_limit 가시화를 8 task batch 로 처리. **v0.1.5-beta release blocker**.

## 1. SSOT

- **Plan 본문 (반드시 §3 Goals + §4 Subtasks 순서대로 따를 것)**: `docs/plans/claudeTransportFlipHardeningPlan_2026-04-29.md`
- 관련 plan (read-first 권장):
  - `docs/plans/claudeResumeSessionTransitionPlan_2026-04-29.md` (v0.1.4-beta transport flip SSOT)
  - `docs/ideas/agentApiQuotaErrorUxIdea_2026-04-29.md` (Layer 1+2 의 claude 한정 구체화)
  - `docs/plans/claudeRateLimitVisibilityPlan_2026-04-29.md` (superseded — 진단 history 보존 가치만)

## 2. 가이드라인 (절대 깨지 마세요)

### 사이드 이펙트 방지
- 각 task 의 §"회귀 위험 가드" 작업 전후 확인. `git diff --name-only` 로 변경 영역 외 파일 0
- claude.rs 변경은 cli mode 분기 안에서만 — sdk-session path 호출 시 영향 0 검증 (Windows 사용자 회귀 차단)
- macOS / Windows / Linux 동일 동작 — cfg 분기 없는 cross-platform fix
- 다른 엔진 (codex/gemini/ollama/lmstudio) 절대 변경 금지

### 기능 완료 후 테스트
- 각 task 의 §Verification 명령 실제 실행 + chat 보고
- baseline (main `cc5a79a` 또는 본 PR base 시점): FE 381 / Rust 564+. 작업 후 동일 또는 +N. 감소 시 회귀.
- UI 변경 (Task 04, 06) 은 dev 모드 manual smoke + 스크린샷 1장
- migration v49 (Task 05) 는 idempotent 검증 (두 번 실행) + 테스트 fixture 7일 미만/이상 분리

### 자체 리뷰 (PR 전)
- task 별 commit 후 `git show HEAD --stat` self-review
- DO NOT 위반 0 확인
- plan §"Change description" 과 라인 단위 대조
- 의심 시 chat escalate

### 서브에이전트 spawn 가이드
- task 별 spawn 또는 logical 묶음 spawn (각 PR 단위):
  - Task 01 + 02 + 03 묶음 (claude.rs 영역, P0 핵심) → general-purpose subagent 1
  - Task 04 (frontend UI 가시화) → general-purpose subagent 2
  - Task 05 (DB migration) → general-purpose subagent 3
  - Task 06 (UI 메뉴) → general-purpose subagent 4
  - Task 07 (친화 에러) → general-purpose subagent 5 (Task 02 와 같은 영역이라 묶을 수도 있음, Developer 판단)
  - Task 08 (docs) → 직접 또는 subagent 1
- 모두 병렬 가능 (영역 분리). 단 Task 02/03 은 같은 PR 권장 (dependency)

## 3. 작업 순서 권장 (병렬 가능 영역 표시)

| 순서 | Task | 의존 | 우선 |
|---|---|---|---|
| **1** | T1 (rate_limit_event parser) | 없음 | P0 |
| **1 (병렬)** | T5 (DB migration v49) | 없음 | P1 |
| **2** | T2+T3 (stale detect + auto fallback + ContextPack revival) | T1 | **P0 핵심** |
| 3 | T4 (UI 가시화) | T2+T3 의 emit event | P0 |
| 4 (병렬) | T6 (메뉴 노출) | 없음 | P1 |
| 4 (병렬) | T7 (친화 에러) | T2 의 분류 (병합 가능) | P1 |
| 5 | T8 (docs) | T1~T7 머지 후 | P1 |

T2+T3 가 핵심 — 사용자 액션 0 자동 회복의 결정적 영역. 이 task 가 main 진입 후 외부 사용자 onboarding 좌절 차단 효과 즉시.

## 4. DO — 반드시 지킬 것

1. **Plan §4 의 §Verification 모든 명령 실행 + 결과 chat 보고**
2. **Task 별 commit 단위 분리** (`fix(claude): rate_limit_event parser (T1)` / `fix(claude): stale resume_token auto fallback (T2)` / etc.)
3. **PR 단위 task 묶음** — Task 01+02+03 합본 PR 권장 (claude.rs 영역, axis 동일). Task 04 별 PR (frontend). Task 05 별 PR (migration). Task 06+07 합본 또는 분리. Task 08 docs 별 PR
4. **PR description**: Plan SSOT 링크 + 각 task 의 Verification 결과 + DO NOT 위반 0 + baseline 카운트 비교
5. **자동 fallback 후 ContextPack revival 회귀 검증 (T3)** — multi-turn 대화 simulation 으로 history 반영 확인 의무

## 5. DO NOT — 사이드 이펙트 차단

- ❌ 다른 엔진 파일 (`agents/codex.rs`, `agents/gemini.rs`, `agents/ollama.rs`, `agents/lmstudio.rs`) 변경
- ❌ `claude_sdk_session.rs` 변경 (sdk-session path, 본 plan scope 외)
- ❌ `agents.rs:resolve_claude_mode()` 변경 (transport flip default 자체)
- ❌ ContextPack 의 다른 정책 (mode auto / Lite / Full 분기 자체) 변경 — Task 03 은 *fresh session 분기 활용*만
- ❌ DB schema 의 다른 컬럼 / 다른 테이블 변경 (migration v49 는 conversations.resume_token 만)
- ❌ 사용자 settings.json 또는 다른 영역 변경
- ❌ 새 dependency 추가 (특히 frontend)
- ❌ tauri.conf.json 변경

## 6. Verification (전체)

각 task PR 전 + 머지 직전:

```bash
# Rust
cd src-tauri && cargo check --message-format=short
cd src-tauri && cargo test --lib

# Frontend
npx tsc --noEmit
npx vitest run

# 회귀 grep (변경 범위 검증)
git diff main --name-only | xargs -I{} echo "Changed: {}"
# claude.rs 외 다른 agent 파일 변경 0 확인
git diff main --name-only | grep -E "agents/(codex|gemini|ollama|lmstudio|claude_sdk)" && echo "WARN: out of scope agent file" || echo "OK"

# Manual smoke (Task 02+03)
# 1. DB 의 한 conversation resume_token 을 invalid 값으로 set
# 2. tunaFlow dev 모드 실행, 그 conversation 에서 send
# 3. backend log 에 [session_freshness] 가 "new session" 으로 표시 + 응답 정상
# 4. 다음 send 가 정상 (DB resume_token 갱신 확인)
```

## 7. CI 정책

- 본 plan 의 변경은 **macOS + Windows 양쪽 회귀 위험** (cli mode 자체는 OS 무관, 다만 Windows 사용자가 sdk-session path 인 경우 영향 검증 필요).
- PR + CI watch 권장 (admin merge 회피). macOS + Windows CI 모두 ✓ 후 머지.
- 다만 Task 04/06/08 (frontend UI / docs) 는 cross-platform 회귀 위험 낮으므로 admin merge 가능 (Developer 판단).
- 머지 후 main 회귀 의심 시 즉시 revert PR.

## 8. 보고 포맷 (각 task 또는 PR 완료 시 chat)

```
## Task {ID} 결과 (또는 PR #{N})

- 변경 라인 수 + 핵심 파일 (1~3 줄)
- Verification 결과: PASS/FAIL + 핵심 출력
- baseline 대비 테스트 카운트 (FE/Rust)
- PR URL + 머지 commit hash
- DO NOT / 회귀 가드 위반 0 확인 (1줄)
- 다음 task 진행 여부 또는 escalate 사유
```

## 9. 막히면 (escalate)

- T2 (stale detect) keyword 가 false positive 로 정상 인증 실패 retry 트리거 → 즉시 chat 보고. retry 조건 strict 화 (`--resume <id>` 동반 + 정확한 message)
- T3 (ContextPack revival) 의 retry 시점 ContextPack 재assemble 비용이 사용자 가시 latency (>3s) → 옵션 A (retry same prompt, ContextPack revival 다음 send 부터) 로 후퇴 가능. 사용자 결정
- migration v49 (T5) 가 messages 테이블의 timestamp 컬럼 schema 와 mismatch → schema 확인 후 SQL 정확화. 강제로 다른 컬럼 사용 금지
- 어느 task 든 회귀 가드 위반 의심 → 즉시 작업 중단 + chat 보고. 임의 fix 금지

## 10. 본 batch 외 영역 (Developer 가 다른 plan 진행 중일 수 있음)

본 plan 작업 중 다음 영역의 변경분이 main 에 동시 들어올 수 있음 (rebase 필요):
- Windows architect 의 windowsTitlebarUnification (PR #228 후속)
- Windows architect 의 windowsCiPipeline (W-CI-1)
- 다른 사용자 보고 follow-up

영역 충돌 발생 시 (특히 settings store 또는 RuntimeStatusBar 의 다른 변경) chat escalate 후 rebase 결정.

## 11. 오늘 작업 종료 시 정리 (day-end)

- 머지된 PR 목록 + 머지 commit hash
- 각 Phase (Phase 1 Task 01~04, Phase 2 Task 05~08) 완료 여부
- 미완료 task 의 next step 한 줄
- baseline 카운트 변동 (FE / Rust)
- chat 으로 mac architect 에게 day-end 보고 — v0.1.5-beta release publish 준비 가능 여부 한 줄 결론
