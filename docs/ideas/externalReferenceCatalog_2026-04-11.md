# External Reference Catalog

> Status: reference-like catalog
> Created: 2026-04-11
> 목적: tunaFlow에서 검토했던 외부 레퍼런스 레포/문서를 한 곳에서 찾기 위한 카탈로그

---

## 1. 직접 레포 분석 문서

| 대상 | 성격 | 출처 | 분석 기준 시점 | 문서 |
|---|---|---|---|---|
| `addyosmani/agent-skills` | skill system / agent operating rules | `https://github.com/addyosmani/agent-skills` | 2026-04-11 clone 기준 | [agentSkillsReferenceIdea.md](/Users/d9ng/privateProject/tunaFlow/docs/ideas/agentSkillsReferenceIdea.md) |
| `larksuite/cli` | CLI action layering / shared rules / async contract | `https://github.com/larksuite/cli` | 2026-04-06 검토 기준 | [larksuiteCliArchitectureReferenceIdea.md](/Users/d9ng/privateProject/tunaFlow/docs/ideas/larksuiteCliArchitectureReferenceIdea.md) |
| `_research/_util/abtop` | runtime observability / diagnostics | 로컬 분석: `/Users/d9ng/privateProject/_research/_util/abtop` | 2026-04-01 로컬 코드 기준 | [abtopAnalysisForTunaFlow.md](/Users/d9ng/privateProject/tunaFlow/docs/ideas/abtopAnalysisForTunaFlow.md) |
| `NousResearch/hermes-agent` | memory / toolset / iteration budget patterns | `https://github.com/NousResearch/hermes-agent` | 2026-04-03 로컬 분석 기준 | [hermesAgentPatternsIdea.md](/Users/d9ng/privateProject/tunaFlow/docs/ideas/hermesAgentPatternsIdea.md) |
| `HKUDS/ClawTeam` | multi-agent orchestration reference + anti-patterns | `https://github.com/HKUDS/ClawTeam` | 2026-04-01 검토 기준 | [clawTeamAnalysis.md](/Users/d9ng/privateProject/tunaFlow/docs/ideas/clawTeamAnalysis.md) |
| `clawsouls/clawsouls` | persona / role spec 레퍼런스 | `https://github.com/clawsouls/clawsouls` | 문서 작성 시점 기준 | [clawSoulsPersonaSpecIdea.md](/Users/d9ng/privateProject/tunaFlow/docs/ideas/clawSoulsPersonaSpecIdea.md) |

---

## 2. 복수 레포를 묶어서 검토한 문서

| 문서 | 대상 | 출처 | 분석 기준 시점 |
|---|---|---|---|
| [referenceRepoReviewV2Idea.md](/Users/d9ng/privateProject/tunaFlow/docs/ideas/referenceRepoReviewV2Idea.md) | code-review-graph, claw-code, agentscope 등 | 복수 레포 재검토 | 2026-04-04 |
| [externalToolAnalysisAndRefactoringDirection.md](/Users/d9ng/privateProject/tunaFlow/docs/reference/externalToolAnalysisAndRefactoringDirection.md) | entroly, claw-compactor, opendev | 복수 레포 재검토 | 문서 작성 시점 기준 |
| [vectorDbAndRetrievalAlgorithmsIdea.md](/Users/d9ng/privateProject/tunaFlow/docs/ideas/vectorDbAndRetrievalAlgorithmsIdea.md) | sqlite-vec, qdrant, retrieval 알고리즘 | 복수 논문/블로그/레포 | 2026-04-01 |
| [rtAlgorithmEnhancementIdeas.md](/Users/d9ng/privateProject/tunaFlow/docs/ideas/rtAlgorithmEnhancementIdeas.md) | MoA, MAD 비판, Self-Refine, Agent-as-a-Judge 등 | 복수 논문/프레임워크 | 2026-04-01 |

---

## 3. 블로그/아티클 중심 레퍼런스

| 대상 | 출처 | 분석 기준 시점 | 문서 |
|---|---|---|---|
| Addy Osmani — Code Agent Orchestra | `https://addyosmani.com/blog/code-agent-orchestra/` | 2026-04-10 | [codeAgentOrchestraReferenceIdea.md](/Users/d9ng/privateProject/tunaFlow/docs/ideas/codeAgentOrchestraReferenceIdea.md) |
| Open Harness / Light RAG 방향 | 문서 내부 source 참고 | 문서 작성 시점 기준 | [openHarnessLightRagReferenceIdea.md](/Users/d9ng/privateProject/tunaFlow/docs/ideas/openHarnessLightRagReferenceIdea.md) |
| CI execution loop / Optio 참고 | `https://github.com/jonwiggins/optio` | 문서 작성 시점 기준 | [ciExecutionLoopIdea.md](/Users/d9ng/privateProject/tunaFlow/docs/ideas/ciExecutionLoopIdea.md) |

---

## 4. tunaFlow에 특히 영향이 큰 레퍼런스

우선순위 기준으로 다시 보면:

1. [hermesAgentPatternsIdea.md](/Users/d9ng/privateProject/tunaFlow/docs/ideas/hermesAgentPatternsIdea.md)
2. [referenceRepoReviewV2Idea.md](/Users/d9ng/privateProject/tunaFlow/docs/ideas/referenceRepoReviewV2Idea.md)
3. [abtopAnalysisForTunaFlow.md](/Users/d9ng/privateProject/tunaFlow/docs/ideas/abtopAnalysisForTunaFlow.md)
4. [larksuiteCliArchitectureReferenceIdea.md](/Users/d9ng/privateProject/tunaFlow/docs/ideas/larksuiteCliArchitectureReferenceIdea.md)
5. [agentSkillsReferenceIdea.md](/Users/d9ng/privateProject/tunaFlow/docs/ideas/agentSkillsReferenceIdea.md)

이 다섯 개가 현재 tunaFlow의:

- workflow orchestration
- runtime diagnostics
- skill/runtime rule
- tool/action layering

에 가장 직접적으로 연결된다.

---

## 5. 사용 원칙

- 이 카탈로그는 “외부 레퍼런스를 찾는入口”이다.
- 실제 판단은 각 문서에서 해야 한다.
- repo-level analysis와 paper/blog-level analysis를 혼동하지 않는다.

---

## 결론

외부 레퍼런스는 이미 여러 문서에 흩어져 있다.

이 카탈로그는 그중:

- 직접 레포 분석
- 복수 레포 비교
- 블로그/논문형 참고

를 한 번에 찾기 위한 인덱스다.
