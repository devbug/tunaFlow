# Code Agent Orchestra — Addy Osmani 아티클 참고

> Status: idea
> Created: 2026-04-10
> 출처: https://addyosmani.com/blog/code-agent-orchestra/
> 요약: 멀티 에이전트 코딩 오케스트레이션의 패턴, 스케일링, 품질 게이트 종합

---

## 1. tunaFlow가 이미 구현한 것

| 글의 패턴 | tunaFlow 구현 | 비고 |
|----------|-------------|------|
| Plan Approval Gate | ApprovalGate (3-way) | 글보다 정교 (승인/검토요청/보류) |
| Dedicated Reviewer | Review RT (2-agent, 별도 Branch) | blind verifier + structured verdict |
| AGENTS.md / Compound Learning | CLAUDE.md + PLATFORM_TIER0 + Persona | 자동 주입, 수동 관리 혼합 |
| Subagents | Branch + RT 기반 에이전트 분리 | 파일 소유권은 미적용 |
| Loop Guardrails | Doom Loop 감지 (3회 에스컬레이션) | plan_events 기반 |
| Context isolation | ContextPack per branch/RT | 4-engine parity |
| Spec as leverage | Plan 문서 + Task 파일 기반 | subtask 상세 |
| Multi-model routing | ENGINE_CONFIGS (5개 엔진) | 엔진별 프로파일 |
| Quality gates | test runner + review verdict + rework | 다층적 |
| Token budgeting | ContextPack 60K + auto mode | Lite/Standard/Full |
| Worktree lifecycle | Branch git_branch 연결 | linkGitBranch |

**tunaFlow가 글보다 더 잘하는 것**:
- **ContextPack**: AGENTS.md 수동 관리 vs auto mode + budget 동적 배분 + 4-engine parity
- **Memory**: 글에 없음 vs compressed memory + vector + FTS5 + cross-session
- **Human-in-the-loop**: plan approval만 vs Plan 승인 + Review 승인 + Rework + Doom Loop 다층 게이트
- **Anti-pattern 방지**: AGENTS.md 기술 vs PLATFORM_TIER0 항상 주입 + Failure Learning DB

---

## 2. tunaFlow에 없는 것 — 참고 가치 있는 패턴

### 2.1 [P2] Reflection Loop — 작업 후 구조화된 반성

글의 패턴:
```
매 작업 완료 후 에이전트가 REFLECTION.md 작성:
  - 무엇이 놀라웠는가
  - AGENTS.md에 추가할 패턴 1개
  - 프롬프트 개선 1개
→ Lead가 검토 후 승인된 것만 병합
```

tunaFlow 현재:
- Failure Learning(DB v27): **실패** 패턴 자동 저장
- **성공한 작업에서의 학습은 없음**

적용:
```
Review pass 후 Developer에게 추가 요청:
  "이 작업에서 발견한 패턴/주의사항 1개를 간단히 작성해주세요"
→ type="reflection" Artifact로 자동 저장
→ 사용자가 검토 후 승인 → Artifacts 순환 구조에 합류
```

이전 설계와 연결: `artifactsTabDesignReviewIdea.md`의 패턴 성장 + `mexContextScaffoldIdea.md`의 GROW 단계

**규모**: Developer 프롬프트에 ~3줄 추가 + Artifact 타입 "reflection" 추가

### 2.2 [P2] Hierarchical Subagents — subtask 병렬 Branch 실행

글의 패턴:
```
Parent → 2 feature leads → 각 lead가 2-3 specialists
→ 3단계 깊이 분해
→ Parent는 clean context 유지
```

tunaFlow 현재:
- 2단계까지만 (Main chat → Branch/RT)
- Architect가 Plan → Developer 1명이 전체 순차 구현
- `parallel_group`(DB v24) 존재하지만 **병렬 Branch 실행 미구현**

적용:
```
Plan의 parallel_group이 같은 subtask들을
→ 별도 Implementation Branch에서 동시 실행
→ 각 Branch가 독립 Developer 에이전트
→ 전부 완료 후 통합 Review RT
```

**규모**: 워크플로우 오케스트레이션 확장. 아키텍처 변경 중간 규모. 후순위.

### 2.3 [P1] Kill + Reassign — Fresh Session 재시작

글의 패턴:
```
3회 같은 에러에 막히면 → 에이전트 kill → 새 에이전트에 재할당
→ 컨텍스트 오염 방지 (잘못된 방향으로 빠진 컨텍스트를 버림)
```

tunaFlow 현재:
- Doom Loop 감지 → 에스컬레이션은 있지만
- **fresh session으로 재시작하는 옵션 없음** (항상 기존 Branch에서 이어감)

적용:
```
Rework UI에:
  "이어서 수정" (기존 Branch, 컨텍스트 유지)
  "처음부터 다시" (새 Branch, fresh start)  ← 추가
→ 3회 실패 시 "처음부터 다시"를 권장
```

이미 문서화됨: `ciExecutionLoopIdea.md` §5.3 (Optio의 Resume vs Fresh Session)

**규모**: ~50줄 FE (Rework UI에 선택지 추가 + 새 Branch 생성 로직)

### 2.4 [P1] WIP Limits — 동시 에이전트 수 제한

글의 핵심 인용:
> "Don't exceed agents you can meaningfully review. 3-5 agent sweet spot."

tunaFlow 현재: **WIP 제한 없음**. 동시에 Plan 10개 실행 가능.

적용: 메타 에이전트 Tier 1(`projectMetaAgentIdea.md`) 알림에 추가:

```rust
if active_plan_count > 5 {
    alerts.push(Alert {
        level: "warning",
        message: format!("동시 진행 Plan {}개 — 리뷰 병목 주의", active_plan_count),
        action_hint: Some("WIP 줄이기 권장"),
    });
}
```

**규모**: ~5줄 Rust (기존 `check_alerts()` 함수에 조건 추가)

### 2.5 [참고] Peer-to-Peer Messaging

글의 패턴:
```
Agent Teams에서 teammate끼리 직접 메시지 교환
→ Lead를 거치지 않아 병목 제거
```

tunaFlow 현재:
- 에이전트 간 직접 통신 없음
- RT에서 이전 라운드 응답이 ContextPack으로 간접 전달

**판단**: 현재 RT Sequential/Deliberative가 이미 간접적 peer messaging 역할. 직접 messaging 도입은 아키텍처 변경이 크므로 **보류**. agentscope의 MsgHub 패턴(`referenceRepoReviewV2Idea.md` §4)이 참고 자료.

---

## 3. 글에서 확인된 tunaFlow 설계 원칙의 타당성

### "The bottleneck is no longer generation. It's verification."

tunaFlow의 Human 승인 포인트가 정확히 이 문제를 해결:
```
Plan 승인 → (사전 검증)
Review RT → (자동 검증)  
Verdict 판단 → (Human 최종 검증)
Doom Loop → (실패 반복 시 Human 에스컬레이션)
```

### "LLM-generated AGENTS.md offers no benefit, can reduce success ~3%"

tunaFlow의 CLAUDE.md는 **사용자가 직접 작성/관리**. 에이전트가 자동 생성하지 않음. ETH Zurich 연구 결과와 일치하는 설계.

### "Weak spec → multiplies errors across parallel agents"

tunaFlow의 Plan 문서 + Task 파일이 spec 역할. 워크플로우에서 **Plan 승인 없이 구현 불가** — 이것이 spec 품질을 강제하는 메커니즘.

### "Specialization > Generalization (token efficiency)"

tunaFlow의 Persona 시스템 + Engine 분리가 이 원칙 반영. Architect ≠ Developer ≠ Reviewer, 각각 다른 프롬프트와 도구 권한.

---

## 4. 글에서 언급된 도구와 tunaFlow 관계

| 도구 | 유형 | tunaFlow과의 관계 |
|------|------|-----------------|
| **Conductor** | 로컬 오케스트레이터 | tunaFlow와 가장 유사한 포지션 |
| **Agent Teams** | Claude Code 실험적 기능 | tunaFlow RT와 유사 (parallel execution + coordination) |
| **Ralph Loop** | Stateless 반복 에이전트 | tunaFlow 워크플로우와 다른 접근 (stateful vs stateless) |
| **Gastown/Beads** | 구조화된 결정 기록 | tunaFlow Artifacts + plan_events와 유사 |
| **Vibe Kanban** | 태스크 보드 | tunaFlow Plan 탭과 유사 |

**tunaFlow의 차별점**: 이 도구들이 **별도 도구**인 반면, tunaFlow는 **하나의 통합 앱**에서 Plan, Branch, RT, Review, Artifacts, Trace를 모두 관리.

---

## 5. 구현 우선순위

| 항목 | 우선순위 | 시점 | 규모 |
|------|---------|------|------|
| **WIP Limits 경고** | P1 | 메타 에이전트 Tier 1 | ~5줄 |
| **Kill + Reassign (Fresh Session)** | P1 | Rework UI 확장 | ~50줄 FE |
| **Reflection Loop** | P2 | Developer 프롬프트 + Artifact | ~10줄 |
| **subtask 병렬 Branch** | P2 | 워크플로우 확장 | 중간 규모 |
| **Peer-to-Peer Messaging** | 보류 | 아키텍처 변경 | 대규모 |

---

## 참고

- 원문: https://addyosmani.com/blog/code-agent-orchestra/
- ETH Zurich 연구 (AGENTS.md 효과): Gloaguen et al.
- tunaFlow 관련 문서:
  - CI 피드백 루프 (Fresh Session): `docs/ideas/ciExecutionLoopIdea.md` §5.3
  - 메타 에이전트 (WIP 경고): `docs/ideas/projectMetaAgentIdea.md`
  - Artifacts 순환 (Reflection): `docs/ideas/artifactsTabDesignReviewIdea.md`
  - mex 패턴 성장 (GROW): `docs/ideas/mexContextScaffoldIdea.md`
  - agentscope MsgHub (Peer messaging): `docs/ideas/referenceRepoReviewV2Idea.md` §4
  - Optio Resume/Fresh: `docs/ideas/ciExecutionLoopIdea.md` §5.3
