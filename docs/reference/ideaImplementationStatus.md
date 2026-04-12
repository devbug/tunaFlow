---
title: 아이디어 문서 구현 현황
updated_at: 2026-04-13
canonical: true
---

# 아이디어 문서 구현 현황

> 최종 갱신: 2026-04-13 (s27 기준 전수 조사)
> 대상: `docs/ideas/` 53개 파일
> 기준: 코드베이스(`src/`, `src-tauri/src/`) 실제 구현 여부

## 범례
- ✅ 완료 — 핵심 기능이 코드에 존재
- 🔶 부분 — 기반 구현만, 고도화 미완
- ❌ 미구현 — 코드에 없음
- 📄 참고 — 구현 대상이 아닌 레퍼런스/분석 문서

---

## 실행 환경 & PTY

| 파일 | 상태 | 비고 |
|---|---|---|
| `ptyFullIntegrationPlan.md` | ✅ | `commands/pty/` 5모듈 구현 (session/parser_claude/parser_agents/context/mod) |
| `ptySessionPolicy.md` | ✅ | per-conv spawn lock, write queue FIFO, write_queue sender 구현 |
| `ptyInteractiveIdea.md` | 🔶 | PTY 기반 구조 완성, xterm.js UI 고도화 미완 |
| `terminalInChatIdea.md` | 🔶 | 채팅 내 터미널 패널 기본 구현, 인터랙티브 입력 미완 |

---

## UI / 디자인

| 파일 | 상태 | 비고 |
|---|---|---|
| `designSystemIdea.md` | 🔶 | Phase 1 완료 (CSS 토큰 `--prose-*`, `--duration-*`), Phase 2(라이트모드 토글) 미완 |
| `chatReadabilityImprovementIdea.md` | ✅ | Phase 1~2 완료 (s7) |
| `insightTabDesign.md` | 🔶 | `InsightPanel` + `insight/` 4모듈 기본 구현, Phase H~J 미완 |
| `artifactsTabDesignReviewIdea.md` | 🔶 | artifacts 테이블 + UI 기본 구현, 생명주기 관리 미완 |
| `customTitlebarContextMenuIdea.md` | ❌ | Tauri 기본 타이틀바 사용 중 |

---

## 워크플로우 & Plan

| 파일 | 상태 | 비고 |
|---|---|---|
| `insightWorkflowIdea.md` | 🔶 | `insightOrchestration.ts` + `insight_extract.rs` 구현, Phase H~J(tool-request:insight 자동 루프) 미완 |
| `workflowGraphEnhancementIdea.md` | ❌ | graph_expand, graph_coverage_check 미구현 |
| `codeReviewGraphIntegrationIdea.md` | ❌ | crg.rs 에이전트 래퍼, callers-of/tests-for 쿼리 미구현 |
| `codeReviewRefactoringIdea.md` | ❌ | 리뷰 시스템 기본 구현만 있음 |
| `reworkSubtaskTargetingIdea.md` | ❌ | failedSubtaskIds 필드 + 타겟 재실행 미구현 |
| `artifactAndFailureLearningIdea.md` | 🔶 | `failure_lessons` 테이블 + FTS 구현, 학습 피드백 루프 미완 |
| `ciExecutionLoopIdea.md` | ❌ | CI 자동 수정 루프 미구현 |
| `ciMultiOsPlan.md` | 🔶 | GitHub Actions 기본 설정, 멀티 OS 매트릭스 미완 |

---

## ContextPack / 검색 / 지식 관리

| 파일 | 상태 | 비고 |
|---|---|---|
| `contextPackTieringIdea.md` | 🔶 | Tier 0~1 완료 (s18), Tier 2 tool-request pull 인프라 부분 동작 |
| `knowledgeLayerArchitectureIdea.md` | 🔶 | 5개 소스(rawq/fts5/memory/cross-session/docs) 각각 구현, `KnowledgeSource` trait 추상화 미완 (하드코딩 유지) |
| `projectDocumentRagIdea.md` | 🔶 | 문서 청킹 + 인덱싱 + 그래프 RAG 기반 구현, 검색 품질 고도화 미완 |
| `vectorDbAndRetrievalAlgorithmsIdea.md` | 🔶 | `conversation_chunks` + `vec_chunks` (sqlite-vec) 구현, 알고리즘 고도화 미완 |
| `embeddingLatencyOptimizationIdea.md` | ✅ | bge-m3 증분 임베딩, idle daemon, 레이턴시 문제 해소 |
| `rawqGraphEvolutionStrategyIdea.md` | 📄 | KnowledgeLayer 보류 결정 포함 — 5소스 하드코딩으로 충분 |
| `seCallVectorStorageIdea.md` | 📄 | 벡터 스토리지 레퍼런스 |
| `openHarnessLightRagReferenceIdea.md` | 📄 | LightRAG 레퍼런스 |
| `mexContextScaffoldIdea.md` | ❌ | 아이디어 단계 |
| `modernSqliteFeaturesIdea.md` | 🔶 | FTS5 + JSON + WAL 사용 중, STRICT/GENERATED 컬럼 등 미사용 |

---

## 에이전트 / 페르소나 / 메타

| 파일 | 상태 | 비고 |
|---|---|---|
| `architectEnhancementIdea.md` | 🔶 | Architect 에이전트 프롬프트 고도화됨, plan 품질 기준 추가 미완 |
| `rtAlgorithmEnhancementIdeas.md` | 🔶 | sequential/deliberative RT 구현, RT 전용 페르소나 행동 지침 미완 |
| `onboardingMetaAgentIdea.md` | 🔶 | `MetaFloatingChat` + `metaConversation.ts` 구현, 온보딩 플로우 미완 |
| `projectMetaAgentIdea.md` | ❌ | ProjectDashboard, 자동 Alert 구조 미구현 |
| `clawSoulsPersonaSpecIdea.md` | 📄 | 페르소나 스펙 레퍼런스 |
| `hermesAgentPatternsIdea.md` | 📄 | 에이전트 패턴 레퍼런스 |
| `smallModelStressTesterIdea.md` | ❌ | 소형 모델 스트레스 테스터 미구현 |
| `speedyClaudeToolOptimizationIdea.md` | 🔶 | 일부 최적화 적용, 전체 구현 미완 |

---

## 아키텍처

| 파일 | 상태 | 비고 |
|---|---|---|
| `projectPerWindowIdea.md` | ❌ | 드롭다운 방식 유지 중, VS Code 패턴 미구현 |
| `sdkAsInterfaceLayerIdea.md` | 🔶 | CLI 기본 유지, SDK fallback 검토 단계 |
| `sdkIntegrationIdea.md` | 🔶 | 평가 단계, 구현 미시작 |
| `mobileArchitectureIdea.md` | ❌ | 데스크톱 전용 |
| `removeGlobalProfileStateIdea.md` | ❌ | selectedProfileId 전역 상태 여전히 사용 중 |
| `guardrailImprovementIdeas.md` | 🔶 | `guardrail.rs` 컨텍스트 버짓 구현, 고도화 미완 |

---

## Trace / 모니터링

| 파일 | 상태 | 비고 |
|---|---|---|
| `traceEnhancementAbtopIdea.md` | 🔶 | `trace_log` 테이블 + RuntimeStatusBar 구현, OTel 중첩 스팬/Git 상태 미완 |

---

## 레퍼런스 / 분석 문서 (구현 대상 아님)

| 파일 | 비고 |
|---|---|
| `abtopAnalysisForTunaFlow.md` | Abtop 사례 분석 |
| `agentSkillsReferenceIdea.md` | Skills 시스템 레퍼런스 |
| `externalReferenceCatalog_2026-04-11.md` | 외부 자료 모음 |
| `claudeCodePatternsForTunaFlow.md` | Claude Code 베스트 프랙티스 |
| `clawTeamAnalysis.md` | Claw Team 팀 분석 |
| `codeAgentOrchestraReferenceIdea.md` | 오케스트라 패턴 레퍼런스 |
| `larksuiteCliArchitectureReferenceIdea.md` | Larksuite CLI 사례 |
| `referenceRepoReviewV2Idea.md` | 레퍼런스 레포 리뷰 |
| `blog-contextpack-draft.md` | 블로그 초안 |
| `techPostSeriesIdea.md` | 기술 포스트 계획 |

---

## 통계 요약

| 상태 | 개수 |
|---|---|
| ✅ 완료 | 5 |
| 🔶 부분 구현 | 20 |
| ❌ 미구현 | 13 |
| 📄 참고/문서 | 15 |
| **합계** | **53** |

---

## 착수 가능한 다음 단계 (난이도 기준)

| 항목 | 관련 파일 | 난이도 |
|---|---|---|
| RT 전용 페르소나 행동 지침 | `rtAlgorithmEnhancementIdeas.md` | 낮음 |
| 디자인 시스템 Phase 2 완성 | `designSystemIdea.md` | 낮음 |
| Rework 서브태스크 타겟팅 | `reworkSubtaskTargetingIdea.md` | 중간 |
| Insight Phase H~J (tool-request 자동 루프) | `insightWorkflowIdea.md` | 중간 |
| KnowledgeLayer trait 도입 | `knowledgeLayerArchitectureIdea.md` | 중간 |
| 코드리뷰 그래프(crg) 통합 | `codeReviewGraphIntegrationIdea.md` | 높음 |
| Project-per-window | `projectPerWindowIdea.md` | 높음 |
