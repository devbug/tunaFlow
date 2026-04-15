---
name: Reviewer 워크플로우 + 컨텍스트 보강 아이디어
status: idea
created_at: 2026-04-15
canonical: false
related: [docs/plans/conventionsContextSyncPlan.md, docs/plans/threadModelRoundtableRedesign.md]
---

# 배경

dev → review 워크플로우의 reviewer 단계를 사용자 통제 + 토큰 효율 + 검증 품질 셋 다 개선하기 위한 아이디어 모음. 디버깅 중에 떠올랐고 잊지 않으려 일단 정리.

# 1. Quick vs Deep RT 분기 (사용자 명시 모드 선택)

## 현재 동작 (자동 추론)
`DevProgressView`에서 reviewer 다중선택:
- 1명 선택 → chat-mode 단일 리뷰
- 2명+ 선택 → RT (deliberative, 2-3 라운드)

## 제안 (명시 분기)
사용자가 작업 사이즈/중요도에 따라 모드를 명시 선택:
- **Quick Review**: 단일 reviewer (선택된 첫 번째). 빠르고 저렴, ~1회 호출.
- **Deep RT Review**: 선택된 모든 reviewer로 RT (최소 2명, 2-3 라운드). 정밀, ~6-9 호출.

## UI 윤곽
```
[ ] Reviewer 1
[ ] Reviewer 2
[ ] Reviewer 3

Mode: ( ) Quick (단일)  ( ) Deep RT (다명 합의)
Rounds (Deep RT): [2] [3]
```

- Deep RT 버튼은 selected ≥ 2일 때만 활성
- 자동 추천 (확장): subtask 수 ≥ 5 또는 changed_files ≥ 10 시 "Deep 추천" hint

## 구현 윤곽
- `DevProgressView.tsx`: `selectedRounds` 옆에 `reviewMode2` state 추가
- 기존 `isRT = selectedReviewerIds.size >= 2` → `isRT = reviewMode2 === "deep"`로 교체
- 작업 ~30분

# 2. Reviewer-specific ContextPack lean profile

## 현재 문제
review branch도 Full mode ContextPack 받아 5-10k 토큰 낭비. 동적 layer 대부분이 reviewer에겐 노이즈.

## Reviewer가 진짜 필요한 것 (필수)
- agent_role_doc (Reviewer 지침)
- persona_fragment (Reviewer 페르소나)
- plan + plan_document
- 이전 findings (재검토 시)
- artifacts (impl result.md)
- impl branch 채팅 (dev가 뭘 했는지)

## 노이즈 (생략 가능)
- compressed_memory — review branch는 첫 turn → 어차피 빈
- retrieval (vector) — 다른 conv 무관한 turn 끌어옴
- cross-session — reviewer가 다른 대화 끌어올 일 없음

## 처리 옵션
- **A. 단기 fix**: `startReview` 진입 시 `context_mode_override = "standard"` 설정 → retrieval/cross/compressed 자동 생략. 1줄.
- **B. 구조적 fix**: conventions sync (별도 plan) 완료되면 자동 해결 — agent_role/persona/plan/findings가 conventions로 빠지므로 ContextPack은 동적만 남음.
- **C. 신규 mode 도입**: `Review` mode 추가, ContextPack assemble에서 review-specific layer만 select. 가장 명확하지만 복잡.

**추천**: B (conventions sync) + A (안전망) 동시. C는 Phase 2 측정 후 결정.

# 3. Reviewer 보강 — 더 필요한 것들

검증 품질 향상을 위해 ContextPack에 추가하면 좋을 것들:

| Layer | 효과 | 구현 비용 |
|---|---|---|
| **diff summary** (changed files 의미적 요약) | reviewer가 코드 다 안 읽어도 변경 핵심 파악 | 작음 (git diff + LLM 1회 요약) |
| **plan.expectedOutcome** (acceptance criteria) | pass/fail 기준 명확화 | 1줄 (컬럼 이미 있음) |
| **lint/typecheck output** (자동 실행) | 정적 결함 자동 reporting → reviewer는 의미 검증에 집중 | 중간 (testRunner 확장) |
| **동일 파일 과거 review findings** | 반복 결함 패턴 감지 | 작음 (DB 조회) |
| **CRG impacted callers** (현재 263chars 일부 → 더 자세히) | 변경의 ripple 영향 | 중간 |
| **commit message / plan description의 "왜"** | 변경 의도 명확화 — 의도와 다른 구현 잡아냄 | 작음 |

## Cost-effective 우선순위
1. **diff summary** — 가장 큰 효과, 비용 작음
2. **plan.expectedOutcome** — 컬럼 이미 있음
3. **lint/typecheck** — testRunner 확장
4. **동일 파일 과거 findings** — DB 조회만
5. CRG 확장은 후순위 (일부 이미 작동)

# 의존성 / 순서

1. **conventions sync (별도 plan, 진행 중)** 먼저 — 정적 layer 분리 → review branch ContextPack 자연스럽게 lean
2. 위 끝나면 → A 안전망 추가 (1줄)
3. 그 다음 → Reviewer 보강 layer (1, 2부터)
4. UI: Quick/Deep 분기 추가 (B/C 결정과는 독립적)
5. 측정 후 → C (신규 Review mode) 또는 4 (UI) 우선순위 결정

# 미해결 질문

- diff summary는 "내장 LLM 호출"인데 비용 vs 효과 측정 필요 (cheap haiku로 요약?)
- lint/typecheck 자동 실행 — 어떤 도구를 어떤 시점에? (review 시작 직전이면 dev가 lint 안 돌렸을 수도)
- 같은 파일 과거 findings — DB에서 어떻게 query? plan_events + reviewer_emit history 필요
- Quick/Deep 분기에서 사용자 default는? 일반 사용자 입장에선 빠른 게 좋아 Quick 기본?
- Deep RT인데 reviewer 1명만 선택했을 때 — 명확히 disable, 아니면 자동 Quick으로 fallback?
