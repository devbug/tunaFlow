# Plan vs Implementation Comparison

- 작성일: 2026-04-11
- 기준 문서:
  - `docs/plans/index.md`
  - `docs/reference/implementationStatus.md`
  - 현재 코드베이스

---

## 목적

`docs/plans/index.md`의 상태 분류와 실제 구현 상태 사이의 차이를 빠르게 확인하기 위한 비교표다.

---

## 비교표

| 영역 | 플랜 문서 | plans/index 표기 | 현재 구현 상태 | 판단 |
|---|---|---|---|---|
| ContextPack P0/visibility/compression | `contextPackP0Phase1Plan_2026-03-30.md` | 완료 | mode, budget UI, trace visibility, breakdown 구현 | 일치 |
| ContextPack Algorithm Phase 1 | `contextPackAlgorithmPhase1Plan_2026-03-30.md` | 진행 예정 | rawq 다해상도, import folding, markdown lightening, Jaccard folding 구현 | index stale |
| Conversation Retrieval Phase 1 | `conversationRetrievalPhase1Plan_2026-03-30.md` | 진행 예정 | FTS5 retrieval + pair/anchor/brief 재조립 구현 | index stale |
| Retrieval Chunking | `conversationRetrievalChunkingPlan_2026-03-30.md` | 진행 예정 | chunk 단위 retrieval 구현 | index stale |
| Retrieval Ranking Polish | `conversationRetrievalRankingPolishPlan_2026-03-30.md` | 진행 예정 | scoring, dedup, overlap suppression 구현 | index stale |
| Unified Memory Policy | `unifiedMemoryPolicyPhase1Plan_2026-03-30.md` | 진행 예정 | policy 우선순위/skip/inclusion 구현 | index stale |
| Memory Threshold Tuning | `unifiedMemoryPolicyThresholdTuningPlan_2026-03-30.md` | 진행 예정 | retrieval/compressed 임계값 튜닝 구현 | index stale |
| Memory Trace Surface | `memoryPolicyTraceSurfacePlan_2026-03-30.md` | 진행 예정 | active/skipped, auto reason, trace surface 구현 | index stale |
| Section Budget Breakdown | `memorySectionBudgetBreakdownPlan_2026-03-30.md` | 진행 예정 | per-section chars, top consumer 표시 구현 | index stale |
| Top Heavy Section Tuning | `topHeavySectionTuningPlan_2026-03-30.md` | 진행 예정 | heavy section cap 조정 반영 | index stale |
| Mode-specific heuristics | `modeSpecificSectionHeuristicsPlan_2026-03-30.md` | 진행 예정 | Lite/Std/Full 차등 cap 구현 | index stale |
| Auto mode polish | `autoModeHeuristicPolishPlan_2026-03-30.md` | 진행 예정 | auto scoring/profile 선택 구현 | index stale |
| Roundtable completion-order | `roundtableCompletionOrderPlan_2026-03-30.md` | 진행 예정 | Deliberative completion-order 구현 | index stale |
| Roundtable blind verifier | `roundtableBlindVerifierPhasePlan_2026-03-30.md` | 진행 예정 | blind verifier 구현 | index stale |
| RT participant role/blind UI | `roundtableParticipantRoleBlindUiPlan_2026-03-30.md` | 진행 예정 | role/blind 설정 UI 구현 | index stale |
| RT participant surface visibility | `roundtableParticipantSurfaceVisibilityPlan_2026-03-30.md` | 진행 예정 | role/blind badge 표시 구현 | index stale |
| Project-first startup UX | `projectFirstStartupUxPlan_2026-03-30.md` | 진행 예정 | project-first startup 이미 동작 | index stale 또는 잔여 polish만 남음 |
| context-hub search/get UI | `contextHubSearchGetUiPlan_2026-03-30.md` | 부분 완료 | Settings UI + explicit handoff까지 구현 | 부분 완료보다 더 진행됨 |
| Long-term memory roadmap | `longTermMemoryRoadmapPlan_2026-03-30.md` | 부분 완료 | compressed + retrieval + sqlite-vec까지 일부 전진 | 표기 보수적 |
| Workflow Pipeline V2 | `workflowPipelineV2Plan.md` | 부분 완료 | 일부 구현됐지만 전체 자동화는 아직 미완성 | 대체로 일치 |
| Gemini SDK integration | `geminiSdkIntegrationPlan.md` | 진행 예정 | 아직 미구현 | 일치 |
| Tool-call handler | `toolCallHandlerPlan.md` | 진행 예정 | marker/tool-request 기반 유지 중 | 일치 |
| Master Test Plan | `masterTestPlan.md` | 부분 완료 | 테스트는 늘었지만 E2E/coverage/CI는 미완 | 대체로 일치 |

---

## 재분류 권장

### `진행 예정 → 완료` 후보

- `contextPackAlgorithmPhase1Plan_2026-03-30.md`
- `conversationRetrievalPhase1Plan_2026-03-30.md`
- `conversationRetrievalChunkingPlan_2026-03-30.md`
- `conversationRetrievalRankingPolishPlan_2026-03-30.md`
- `unifiedMemoryPolicyPhase1Plan_2026-03-30.md`
- `unifiedMemoryPolicyThresholdTuningPlan_2026-03-30.md`
- `memoryPolicyTraceSurfacePlan_2026-03-30.md`
- `memorySectionBudgetBreakdownPlan_2026-03-30.md`
- `topHeavySectionTuningPlan_2026-03-30.md`
- `modeSpecificSectionHeuristicsPlan_2026-03-30.md`
- `autoModeHeuristicPolishPlan_2026-03-30.md`
- `roundtableCompletionOrderPlan_2026-03-30.md`
- `roundtableBlindVerifierPhasePlan_2026-03-30.md`
- `roundtableParticipantRoleBlindUiPlan_2026-03-30.md`
- `roundtableParticipantSurfaceVisibilityPlan_2026-03-30.md`

### `진행 예정 → 부분 완료 또는 완료 재판정` 후보

- `projectFirstStartupUxPlan_2026-03-30.md`

### `부분 완료 → 상향 검토` 후보

- `contextHubSearchGetUiPlan_2026-03-30.md`
- `longTermMemoryRoadmapPlan_2026-03-30.md`

---

## 핵심 결론

- 현재 `docs/plans/index.md`는 실제 구현을 충분히 반영하지 못하고 있다.
- 특히 2026-03-30 메모리/RT/ContextPack 라인의 많은 문서가 `진행 예정`으로 남아 있지만 실제로는 코드에 반영되어 있다.
- 우선순위는 새 문서 추가보다 `plans/index.md` 재분류다.
