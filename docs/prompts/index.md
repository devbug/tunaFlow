# Prompts

> 갱신: 2026-04-22 (docs/reorg-phase-a 작업)
> 대부분의 one-time 실행 프롬프트는 `docs/archive/prompts/` 로 이동.

## 📂 구조

- `docs/prompts/` — 재사용 가능한 템플릿/마스터 핸드오프
- `docs/archive/prompts/by-date/YYYY-MM-DD/` — 세션 날짜별 one-time 프롬프트
- `docs/archive/prompts/one-time/` — 플랜별 one-time 실행 프롬프트 (완료된 plan 대응)

## 🔁 재사용 템플릿

- [handoffMaster](./handoffMaster.md): **tunaFlow는 Tauri 2 + React + Rust + SQLite 기반의 3패널 멀티에이전트 오케스트레이션 IDE다.**

## 🟢 활성 핸드오프

- [windowsCaptionBarMissingDeveloperHandoff_2026-05-07](./windowsCaptionBarMissingDeveloperHandoff_2026-05-07.md) — **P0 hotfix 핸드오프 (devbug GitHub #264)**. Plan: `windowsCaptionBarMissingPlan_2026-05-07`. Windows 빌드 native titleBar / 닫기·최소화·최대화 control 부재 회복. tauri.conf.json platform-conditional override 분리 (옵션 i: tauri.macos.conf.json / 옵션 ii: 폴백). 3 task / 1 PR 묶음. v0.1.6-beta-2 patch 또는 v0.1.7-beta minor.
- [roundtableConsensusPersistenceDeveloperHandoff_2026-05-07](./roundtableConsensusPersistenceDeveloperHandoff_2026-05-07.md) — **P1 핸드오프 (devbug GitHub #263)**. Plan: `roundtableConsensusPersistencePlan_2026-05-07`. RT 환각 3 영역 복합 회복: consensus 영구화 (PR-1 v50 schema) + RT marker 격리 + Architect ContextPack 인계 (PR-2) + test+docs (PR-3). 6 task → 3 PR 직렬 의존. Task 01 (Architect 직접 검증) 완료, PR 불필요. Root cause **확정** (DB+코드 path 직접 인용, Plan §0.2.1).
- [reviewerVerdictDirectArchitectDeveloperHandoff_2026-05-04](./reviewerVerdictDirectArchitectDeveloperHandoff_2026-05-04.md) — **MERGED v0.1.6-beta**. Plan: `reviewerVerdictDirectArchitectPlan_2026-05-04`. Reviewer verdict (pass/fail/conditional) 라우팅을 Meta inbox 우회 → Architect 직행 + askMeta UX 폐지 (c-2 scope, Meta role 부분 축소). 7 task → 3 PR 분리. PR #260/#261/#262 + Gemini follow-up + docs SSOT.
- [nextSessionHandoff_2026-05-04](./nextSessionHandoff_2026-05-04.md) — **세션 핸드오프** (v0.1.5-beta 사이클 후속). devbug #253/#254/#255 hotfix 완료, README ko/en 리프레임, project-scoped 스킬 3종 (`tunaflow-developer-handoff` / `tunaflow-plan-writing` / `tunaflow-release-cycle`) 신설. **새 세션에서만 스킬 자동 트리거 가능** — 다음 cycle 진입 시점이 새 세션 시작 기점.
- [scaffoldUserCustomizationPreservationDeveloperHandoff_2026-05-03](./scaffoldUserCustomizationPreservationDeveloperHandoff_2026-05-03.md) — **MERGED #254 fix (P1)**. Plan: `scaffoldUserCustomizationPreservationPlan_2026-05-03`. 영역 A (ARCHITECT_TEMPLATE result task 자동 inject 차단, PR #256) + 영역 B (docs/agents/*.md sentinel 마커 기반 사용자 customize 보존 + migration 백업, PR #258). v0.1.5-beta 머지 완료.
- [branchChatInputRegressionDeveloperHandoff_2026-05-03](./branchChatInputRegressionDeveloperHandoff_2026-05-03.md) — **MERGED #255 fix (P1)** (PR #257). Plan: `branchChatInputRegressionPlan_2026-05-03`. plan A 진행 중 plan B 머지 → plan A revision 후 dev branch 의 chat input 사라짐 회귀. v0.1.5-beta 머지 완료.
- [cliModeSessionFreshnessDeveloperHandoff_2026-04-30](./cliModeSessionFreshnessDeveloperHandoff_2026-04-30.md) — **T9 single-task 핸드오프 (P0 release blocker)**. Plan: `claudeTransportFlipHardeningPlan_2026-04-29` §4 Task 09. cli mode 의 session_freshness 적용 (적용 제외 정책 제거 + session key 등록 + promote_pending_to_delivered) → double history 차단 → paid API trigger 회피. **사용자가 Lite 모드로 강제 떨어지지 않도록**. T1~T8 머지 (PR #238~#242) 후속 architectural fix.
- [claudeTransportFlipHardeningDeveloperHandoff_2026-04-29](./claudeTransportFlipHardeningDeveloperHandoff_2026-04-29.md) — **메인 Developer 핸드오프** (T1~T8 완료). Plan: `claudeTransportFlipHardeningPlan_2026-04-29`. v0.1.4-beta transport flip 후속 8 task batch (P0 Phase 1: T1~T4 자동 회복 핵심 / P1 Phase 2: T5~T8 migration+UI+docs). 모두 머지됨 (PR #238~#242). T9 는 별 핸드오프.
- [windowsBetaHardeningArchitectHandoff_2026-04-29](./windowsBetaHardeningArchitectHandoff_2026-04-29.md) — Plan: `windowsBetaHardeningPlan_2026-04-26`. **Windows 환경 architect 세션용** (사용자 본인 머신). 오늘 작업: A v0.1.4-beta Windows 자산 빌드 + C DB path stale fix(option A) + B startup race 진단 + D watchdog kill compat. INV-1~4, PR + CI watch 필수.

## ✅ 완료된 Developer 핸드오프 (recent)

- [communityFollowupBatchDeveloperHandoff_2026-04-29](./communityFollowupBatchDeveloperHandoff_2026-04-29.md) — **MERGED 5 PR + F1** (2026-04-29). batmania52 #1/#3/#4/#5/#6/#7 + Plan B follow-up F1. PR #215~#220 + #222. baseline FE 381 / Rust 564 (559+5 v48 신규).
- [watchdogAndReviewerReadGuardDeveloperHandoff_2026-04-29](./watchdogAndReviewerReadGuardDeveloperHandoff_2026-04-29.md) — Plan: `watchdogAndReviewerReadGuardPlan_2026-04-29`. **MERGED PR #212 / 8aa944c** (2026-04-29). claude.rs watchdog RAII guard + REVIEWER_TEMPLATE `*-result.md` read 금지.
- [resultMdContaminationFixDeveloperHandoff_2026-04-29](./resultMdContaminationFixDeveloperHandoff_2026-04-29.md) — Plan: `resultMdContaminationFixPlan_2026-04-29`. **MERGED PR #211 / bc34b53** (2026-04-29). reviewer ContextPack 의 result.md 자동 첨부 제거 + truncation/self-include 가드 + i18n 정리. FE 381 / Rust 559 통과.

## 📦 Archive — one-time 프롬프트 (23개)

주로 완료된 plan 대응 실행 프롬프트 + 세션 핸드오프 문서.
[docs/archive/prompts/one-time/](../archive/prompts/one-time/)

## 📅 Archive — by-date 프롬프트 (4개 폴더)

- [2026-03-28](../archive/prompts/by-date/2026-03-28/): 6개 문서
- [2026-03-29](../archive/prompts/by-date/2026-03-29/): 24개 문서
- [2026-03-30](../archive/prompts/by-date/2026-03-30/): 65개 문서
- [2026-03-31](../archive/prompts/by-date/2026-03-31/): 4개 문서

