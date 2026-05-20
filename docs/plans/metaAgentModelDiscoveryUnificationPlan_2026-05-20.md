---
title: MetaAgentSelector → engineModels store 통합 (model dropdown 신모델 미표시 회귀)
status: ready
priority: P1 (외부 사용자 가시 회귀)
created_at: 2026-05-20
---

# 0. Context

사용자 보고:
1. ProjectOnboardingModal 의 모델 dropdown 에 신모델 안 나옴 (codex 2 종만)
2. Settings 메타에이전트 엔진의 모델 dropdown 도 같은 증상

## Root cause

| 영역 | source | 동작 |
|---|---|---|
| ProjectOnboardingModal | `MetaAgentSelector` → `detect_available_agents` | `probe_cli` 가 `models: vec![]` 빈 채 반환 → frontend `CLI_DEFAULT_MODELS` (line 51) 하드코딩 fallback |
| Settings 메타에이전트 | (확인 필요 — `MetaAgentSelector` 재사용 or 자체 UI) | 재사용이면 위와 동일 |
| Settings 일반 agent | `AgentsSection` → `engineModels` store → `list_engine_models` (model_discovery.rs) | dynamic discovery (codex cache / gemini npm / claude binary scan) + Rust fallback |

`detect_available_agents::probe_cli` 는 binary 존재 / 버전만 검출, model list 검출 X. `MetaAgentSelector` 는 `engineModels` store 안 씀 → 항상 하드코딩 fallback 표시.

## SSOT 분산 + stale

| 위치 | 내용 |
|---|---|
| `src/components/tunaflow/MetaAgentSelector.tsx:51` | `CLI_DEFAULT_MODELS` (claude 3 / **codex 2** / gemini 2) |
| `src-tauri/src/commands/model_discovery.rs:57~83` | fallback (claude 3 family / codex 5 / gemini 7) |

두 곳이 서로 다른 SSOT — Settings 의 일반 agent dropdown 은 후자 사용 (dynamic 시도 + 더 큰 fallback), MetaAgentSelector 는 전자 (작은 fallback) 만.

# 1. Invariants

- **INV-MM-1**: MetaAgentSelector 의 model dropdown source 는 `engineModels` store (= `list_engine_models` Tauri cmd). 자체 fallback 제거
- **INV-MM-2**: `engineModels` 가 비어있거나 특정 engine 미포함이면 graceful — dropdown 비표시 + "모델 불러오는 중" 또는 안내
- **INV-MM-3**: detect_available_agents 의 `installed/version/endpoint` 검출은 그대로 사용 — model list 만 store 로 대체
- **INV-MM-4**: 다른 engine (ollama / lmstudio HTTP) 의 `models` field 는 detect 결과 그대로 (HTTP `/api/tags` / `/v1/models` 응답 기반)
- **INV-MM-5**: Settings AgentsSection (일반 agent) 의 동작 회귀 0

# 2. Goals / Non-goals

## Goals
- MetaAgentSelector 가 engineModels store 사용 (CLI engine 한정 — claude/codex/gemini)
- CLI_DEFAULT_MODELS 제거 (T1 통합 시 자연 deprecated)
- engineModels 비어있을 때 graceful empty state

## Non-goals
- model_discovery.rs::fallback 의 list 자체 갱신 (claude/codex/gemini 최신 모델 정확한 id 사용자 영역) — 후속 plan
- probe_cli 에 model list 검출 추가 (별 path, 본 plan 비대상)
- Settings AgentsSection 동작 변경

# 3. Subtasks

## T1 — MetaAgentSelector 가 engineModels store 사용 (P0)

**파일**: `src/components/tunaflow/MetaAgentSelector.tsx`

- `useChatStore((s) => s.engineModels)` + `useChatStore((s) => s.fetchEngineModels)` import
- 첫 mount 시 `fetchEngineModels()` 호출 (또는 `useEffect` 으로 미초기화 시만)
- model dropdown source: CLI engine (`claude` / `codex` / `gemini`) 은 `engineModels.filter(m => m.engine === det.engine)` 의 id list. HTTP engine (`ollama` / `lmstudio`) 은 기존 `det.models` 그대로 (HTTP probe 결과)
- 기본 model 선택 로직 (line 86 의 `next[d.engine] = list[0]`) 도 새 source 사용 — `engineModels.find(m => m.engine === d.engine && m.recommended)?.id ?? engineModels.find(m => m.engine === d.engine)?.id`

## T2 — CLI_DEFAULT_MODELS 제거 (P0)

**파일**: `src/components/tunaflow/MetaAgentSelector.tsx:51`

- T1 이후 자연 deprecated 라 단순 삭제
- 주석 `// Default model candidates for CLI engines (no live enumeration).` 도 제거

## T3 — Empty state 처리 (P1)

**파일**: 동일

- engineModels 가 비어있거나 (loading 중) 특정 engine 미포함 시 dropdown 에 placeholder 표시 ("모델 로딩 중..." / "모델 없음 — 설치 확인 필요")
- i18n 추가 가능 — `dialog.json` 또는 `settings.json` 의 적절한 namespace 에 2 키

## T4 — Settings 메타에이전트 영역 확인 + fix (P1)

**확인 항목**: Settings 의 메타에이전트 model dropdown 이 `MetaAgentSelector` 재사용인지, 별 UI 인지

- 재사용이면 T1 자동 fix
- 별 UI 면 같은 store 사용하도록 통일 (또는 새 task 분리)

## T5 — 검증 + 회귀 가드

- `engineModels` store 가 fetch 안 됐을 때 onboarding modal 진입 → loading 표시 후 dropdown 채워짐
- CLI engine 각각 (claude/codex/gemini) dropdown 에 model_discovery 결과 (또는 그 fallback) 표시
- HTTP engine (ollama/lmstudio) dropdown 동작 그대로

# 4. Cross-cutting risks

- engineModels 가 onboarding modal mount 시점에 비어있을 가능성 (앱 첫 실행). T1 의 `fetchEngineModels` 호출이 promise — UI 가 일시 빈 dropdown 표시 후 채워짐
- detect_available_agents 의 `models` 가 ollama/lmstudio 에 대해서는 HTTP probe 응답이라 정확. CLI engine 만 분기 처리

# 5. Rollback

T1~T4 별 commit 분리 — 각 revert 가능. CLI_DEFAULT_MODELS 제거는 T1 의존이라 같이 revert.

# 6. 다음 step

1. Developer 핸드오프 작성 — `docs/prompts/metaAgentModelDiscoveryUnificationDeveloperHandoff_2026-05-20.md`
2. Developer subagent dispatch (worktree 격리, admin merge)
3. 머지 후 release 묶음/별 결정 — v0.1.8-beta-4 build 진행 중이라 (a) 머지 후 또 한 번 tag 재발행 (b) v0.1.8-beta-5 별 hotfix release
