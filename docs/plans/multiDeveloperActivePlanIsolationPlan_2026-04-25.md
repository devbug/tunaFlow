---
title: Multi-Developer 동시 작업 시 active plan 격리 — 한 conv 의 1자리 싸움 차단
status: ready-to-implement (gray-box, Developer 가 옵션 결정부터)
priority: P1 (사용자 가시 — 오늘 Codex 가 다른 Developer 의 readme-memento plan 진행 시도)
created_at: 2026-04-25
related:
  - docs/plans/branchInheritsMainSessionPlan_2026-04-25.md  # 머지됨 (PR #198), session 통합과 별 axis
  - docs/plans/userIntentSsotSurfacingPlan_2026-04-25.md   # 머지됨 (PR #199)
  - src-tauri/src/commands/agents_helpers/send_common/context_loading.rs  # active plan inject
  - src/stores/slices/runtimeSlice.ts  # Developer 호출 경로
canonical: true
owners:
  - architect (본 plan 작성)
  - developer (옵션 결정 + 구현)
---

# 증상 (사용자 보고, 2026-04-25)

> "Codex Developer 를 껐다가 다시 켜서 명령 제대로 줬는데 그래도 Codex 가 중간에 Claude Developer 의 일을 한다 ... 이런 경우가 종종 있던데"

구체 케이스:
- **Coder Claude (Sonnet 4.6)** ← 사용자: "readme-memento plan 시작" → tunaFlow DB 의 conv `plans` 가 readme-memento 를 status='active' 로 잠금
- **Codex (gpt-5.x)** ← 사용자: "Role Adapter Phase 1 plan 시작" → 같은 conv 의 ContextPack 빌드 시 active plan section 에 readme-memento inject → Codex 가 사용자 message 무시 + readme-memento task 들 진행 시도

reset (껐다 켜기) 으로도 안 풀림 — DB 의 active plan 이 그대로라 새 Codex 세션도 같은 ContextPack 받음.

# Root cause

**한 conversation = active plan 1자리** 라는 tunaFlow 데이터 모델 가정 vs **multi-Developer 동시 작업** 시 한 자리에 multiple plan 욕심 충돌.

추가로:
- **Codex (gpt-5.x)** 의 instruction following 약점 — system context (active plan) 와 user message 충돌 시 system 우선
- **Coder Claude (Sonnet 4.6)** 는 user message 우선 — 같은 ContextPack 받아도 정확히 진행
- 즉 같은 ContextPack 입력에서도 모델별 행동 다름. ContextPack 자체에 plan 정합성 보장이 안 들어있는 게 근본 원인

# 옵션 (Developer 가 선택 / 조합 결정)

## 옵션 A — Developer 호출 시 자동 sub-conversation 격리 (격리 가장 강함)

- 사용자가 Developer A 에게 plan-X 시작 → tunaFlow 가 자동으로 sub-conv (parent=원래 conv) 생성 + plan-X 를 그 sub-conv 의 active 로
- Developer B 는 별 sub-conv 사용
- **Pros**: ContextPack 완전 격리, 두 번 손 안 감, 모델별 차이 영향 X
- **Cons**: 사용자 UI 흐름 변경, sub-conv 누적, 기존 워크플로우 (Plan→Dev→Review) 와 통합 검토 필요

## 옵션 B — ContextPack 의 active plan section 에 sender Developer ID + plan title 명시

- ContextPack 빌드 시 "이 send 의 sender Developer = D2, 의도된 plan = Y" 명시 inline
- Developer 가 자기 plan 식별 가능 (LLM 신뢰)
- **Pros**: 변경 표면 작음 (ContextPack section 한 줄 추가)
- **Cons**: LLM 신뢰. Codex 가 또 무시할 가능성 (instruction following 약점). robust 하지 않음

## 옵션 C — per-Developer plan 매핑 (DB 모델 변경)

- `plans` 테이블에 `(conversation_id, developer_id, status)` 복합 unique 또는
- 새 `plan_developer_assignments` 테이블 → 한 conv 안 multiple Developer 가 각자 active plan
- ContextPack 빌드 시 sender Developer 의 active plan 만 inject
- **Pros**: 데이터 모델이 multi-Developer 시나리오 1급 시민
- **Cons**: DB 마이그레이션 큼, 기존 plan API / UI 영향 큼

## 옵션 D — 사용자 message 의 plan title 자동 parsing → 강제 active 전환

- 사용자가 "Plan: X 시작" 같은 명시 메시지 보내면 tunaFlow 가 parse → DB 의 plan-X 를 active 로 전환
- **Pros**: 사용자 message 우선시. 자연스러움
- **Cons**: parser 정확도 의존. 잘못 parse 시 의도 안 한 plan 활성화 위험

# 권장 — A + B 조합

- **A** (자동 sub-conv 격리) — robust 한 격리. 두 번 손 안 가는 보장
- **B** (ContextPack sender 명시) — A 가 어떤 이유로 안 통하는 케이스 (사용자가 의도적으로 같은 conv 사용) 의 보조 layer

D 는 옵션. C 는 데이터 모델 큰 변경이라 후순위.

# Invariants

- **[INV-1]** 한 conv 안에서 multi-Developer 동시 작업 시도 → 자동으로 sub-conv 격리 (A) 또는 ContextPack 에 sender 명시 (B). 둘 중 하나라도 충족되면 OK
- **[INV-2]** Developer A 의 plan 작업이 Developer B 의 ContextPack 에 active plan 으로 inject 되지 않음
- **[INV-3]** 사용자가 명시적으로 "이 두 Developer 는 같은 conv" 모드 선택 가능 (override). 이 경우 B 만 활성
- **[INV-4]** 모델별 instruction following 차이 (Codex vs Claude) 가 invariant 충족에 영향 없음. 즉 ContextPack 자체가 정합성 보장

# 검증

## 수동 Smoke

1. **재현**: 같은 conv 에서 Coder Claude 에 plan-A, Codex 에 plan-B 동시 시작 → Codex 가 plan-A 진행 안 함 (자기 plan-B 인식)
2. **Override**: 사용자 옵션으로 "같은 conv 모드" 강제 → ContextPack 에 sender + plan title 명시되어 Codex 도 plan-B 진행
3. **기존 single-Developer 흐름**: 회귀 없음 — 한 Developer 만 사용 시 기존 active plan 동작 그대로

## 자동

- ContextPack 빌더 unit test (sender Developer ID + plan title inject 검증)
- sub-conv 격리 통합 test (자동 conv 생성 + parent 관계)

# Developer 핸드오프 프롬프트

```
[작업] Multi-Developer 동시 작업 시 active plan 격리 (Plan multiDeveloperActivePlanIsolation, P1)

[SSOT] docs/plans/multiDeveloperActivePlanIsolationPlan_2026-04-25.md

[배경 3줄]
- 한 conv = active plan 1자리 가정 vs multi-Developer 동시 작업 시 충돌
- Codex (gpt-5.x) 가 ContextPack 의 active plan 우선시 → 다른 Developer 의 plan 진행
- 사용자가 "두 번 손 안 가는 근본 fix" 요청

[수정 범위 — Step 1 audit 후 옵션 결정]

1) Audit (Developer 가 결정):
   - 옵션 A (자동 sub-conv 격리) / B (sender 명시) / C (DB 매핑) / D (parser) 중 어떤 조합
   - tunaFlow 의 기존 conv lifecycle / Plan→Dev→Review 워크플로우와 정합 검토
   - 결과: docs/reference/multiDeveloperIsolationDecision_2026-04-2X.md

2) 권장: A + B 조합
   - Layer A (자동 sub-conv): runtimeSlice.ts 의 Developer 호출 entry 에서
     기존 conv 의 sender 다양성 감지 → 자동 sub-conv 생성 + plan 매핑
   - Layer B (sender 명시): context_loading.rs 의 active plan section 빌드 시
     "sender Developer ID + plan title" 명시 inline

3) Override 옵션:
   - 사용자가 "같은 conv 강제" 선택 가능 (Settings 또는 conv 별 toggle)
   - 이 경우 Layer A skip, Layer B 만 활성

4) 기존 single-Developer 흐름 회귀 0:
   - 한 conv 에 한 Developer 만 사용 시 동작 그대로
   - sub-conv 자동 생성은 multi-Developer 감지 시점에만

[검증]
- npx tsc --noEmit / cargo check / cargo test --lib
- 수동 smoke (plan §검증):
  1. 재현 시나리오 — Codex/Claude 같은 conv → 격리 동작 확인
  2. Override 시나리오
  3. 기존 single-Developer regression

[커밋 분리]
- docs(ref): multi-Developer isolation decision (Step 1)
- feat(conv): auto sub-conv on multi-Developer detection (Layer A)
- feat(contextpack): sender Developer ID + plan title in active plan section (Layer B)
- feat(settings): same-conv override toggle

trailer: Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

[PR 제목]
feat(conv): multi-Developer active plan isolation (auto sub-conv + contextpack sender)

[셀프 이슈]
"bug: Codex Developer takes another Developer's active plan from ContextPack (multi-Developer collision)"
이슈 본문에 오늘 사용자 보고 + 모델별 차이 (Codex vs Claude) + 재발 패턴 명시
```

# 셀프 이슈 본문 초안

```markdown
## Summary

When two Developer subagents (e.g., Coder Claude + Codex) work in the same conversation simultaneously, the second Developer's ContextPack injects the first Developer's active plan, causing the second Developer to attempt the wrong work.

## Reproduction

1. In one conversation, dispatch Coder Claude with plan A → tunaFlow sets `plans.status='active'` for plan A on this conv
2. Dispatch Codex with plan B (different) in the same conv
3. Codex receives ContextPack with plan A in the active plan section
4. Codex (instruction-following weakness vs Claude) prioritizes ContextPack and attempts plan A's tasks

User restart of Codex doesn't help — DB state unchanged.

## Affected models

- Codex (gpt-5.x): ContextPack-priority — broken
- Coder Claude (Sonnet 4.6): user-message-priority — works correctly even with same ContextPack
- Difference confirmed in user observation 2026-04-25

## Fix

Per `docs/plans/multiDeveloperActivePlanIsolationPlan_2026-04-25.md`:

- Layer A: auto sub-conv isolation when multi-Developer detected
- Layer B: sender Developer ID + plan title in ContextPack active plan section

A + B combination targets robust isolation regardless of model.
```

# 후속 / Sibling

- `branchCancelSemanticsPlan_2026-04-25` — 사용자가 같이 보고한 brand cancel 이슈. 별 axis 지만 동시 작성
- 본 plan 의 옵션 D (parser 기반 자동 plan 전환) 는 별 plan 후보 (P3, future)
