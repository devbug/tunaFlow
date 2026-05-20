---
title: Settings Tier 2 engine source — agentProfiles 의 persona_meta 통합
status: ready
priority: P1 (외부 사용자 가시 회귀, v0.1.8-beta-5 묶음 또는 v0.1.8-beta-4 follow-up)
created_at: 2026-05-20
---

# 0. Context

사용자 보고: Settings → Agents → "메타 에이전트 자동 분석 (Tier 2)" 영역의 engine select 에 옵션이 2개만 (`Claude Haiku` / `Gemini Flash 2.5`). 의도 — **사용자가 Settings 에서 설정한 메타에이전트 profile (`personaId === "persona_meta"`) 자체** 를 옵션으로.

## Root cause

`src/components/tunaflow/settings/AgentsSection.tsx:374~377` 에 하드코딩:
```ts
{ value: "claude-haiku",  label: "Claude Haiku" }
{ value: "gemini-flash",  label: "Gemini Flash 2.5" }
```

`MetaAnalysisEngine` type (`src/lib/metaAnalysis.ts`) 도 이 2 종 literal 만 인정. `agentProfiles` (사용자가 정의한 메타 profile) 와 무관.

## 의도

- 사용자가 Agents 패널에서 메타 persona (`persona_meta`) 의 profile 을 생성/편집
- Tier 2 dropdown 은 그 profile list 가 source — 사용자가 본인 메타 agent 그대로 Tier 2 분석에 사용
- 메타 profile 0 개 → Tier 2 영역 disable (안내 메시지 + Agents 패널 jump 링크)

# 1. Invariants

- **INV-T2M-1**: Tier 2 dropdown 옵션 = `off` / `auto` + `agentProfiles.filter(p => p.personaId === "persona_meta")` 의 각 profile
- **INV-T2M-2**: 메타 profile 0 개 → dropdown disable + "메타 에이전트 추가" 안내. auto/off 도 의미 없음 (분석 실행 불가) — 영역 전체 disable 또는 off-only
- **INV-T2M-3**: 기존 `claude-haiku` / `gemini-flash` 값 사용자 settings 는 migration — 0.1.8-beta-3 까지 두 값 사용했을 가능성, 새 시스템에서 first matching meta profile 또는 `auto` 로 fallback
- **INV-T2M-4**: AgentProfile.engine / model 이 그대로 Tier 2 분석 실행 시 사용됨 (예: profile.engine="claude", profile.model="claude-haiku-4-5" → tier2 분석 호출)
- **INV-T2M-5**: tier2 분석 실행 path (Tauri command) 가 새 source format 인식

# 2. Goals / Non-goals

## Goals
- Tier 2 dropdown 의 옵션 source = `agentProfiles` 의 메타 persona 필터
- 메타 profile 0 개 처리 (disable + 안내)
- 기존 settings 값 graceful migration
- `MetaAnalysisEngine` type 갱신 (literal → `"off" | "auto" | string`(profile id))

## Non-goals
- AgentsSection 의 일반 agent / role assignments 영역 변경
- Onboarding modal 의 메타 agent 선택 변경 (별 plan `metaAgentModelDiscoveryUnification` 진행 중)
- Tier 2 분석 알고리즘 / Tauri command 의 동작 자체 변경 (engine resolution 부분만)

# 3. Subtasks

## T1 — MetaAnalysisEngine type / metaAnalysis.ts schema 갱신 (P0)

**파일**: `src/lib/metaAnalysis.ts`

- `MetaAnalysisEngine = "off" | "auto" | (profile id string)` 로 변경
- `DEFAULT_CONFIG.engine` 기본값 `"off"` (또는 `"auto"`)
- `loadMetaConfig` migration:
  - 저장된 값이 `claude-haiku` / `gemini-flash` 면 → `agentProfiles` 에서 매칭되는 메타 profile 검색 → 있으면 그 id, 없으면 `auto`
- save / load 동작 그대로

## T2 — AgentsSection Tier 2 dropdown source 변경 (P0)

**파일**: `src/components/tunaflow/settings/AgentsSection.tsx`

- `ENGINE_OPTIONS` 정의 변경:
  ```ts
  const metaProfiles = agentProfiles.filter(p => p.personaId === "persona_meta");
  const engineOptions = [
    { value: "off", label: t(...), hint: t(...) },
    { value: "auto", label: t(...), hint: t(...) },
    ...metaProfiles.map(p => ({
      value: p.id,
      label: p.label,
      hint: `${p.engine}${p.model ? " · " + p.model : ""}`,
    })),
  ];
  ```
- 기존 `claude-haiku` / `gemini-flash` literal 옵션 제거
- 메타 profile 0 개 → engineOptions 가 `off + auto` 만. UI 안내 ("메타 페르소나 profile 을 Agents 패널에서 추가하세요")
- 또는 `metaProfiles.length === 0` 일 때 영역 전체 disable + Agents 패널 jump 링크

## T3 — Tier 2 분석 실행 path 의 engine resolution (P1)

**파일**: tier2 분석을 실행하는 코드 — `src/lib/metaAnalysisTrigger.ts` 또는 Tauri cmd 호출 layer

- 현재 engine 값이 `claude-haiku` / `gemini-flash` 같은 literal 이면 → 그것 그대로 engine + model 추출
- 새 시스템: engine 값이 profile id 면 → `agentProfiles.find(p => p.id === id)` 으로 profile 찾아서 `profile.engine` / `profile.model` 사용
- 매칭 실패 (profile 삭제 등) → graceful 로 `off` 동작

## T4 — i18n 갱신 (P1)

**파일**: `src/locales/{ko,en}/settings.json`

- 기존 `agents.meta.engine_option.claude_haiku_hint` / `gemini_flash_hint` 키 제거 (또는 deprecated)
- 신규: `agents.meta.no_profile_hint` ("메타 페르소나 profile 을 Agents 패널에서 추가하세요") + jump link 텍스트
- `auto_label` / `auto_hint` 는 의미 갱신 ("첫 메타 profile 자동 선택")

## T5 — Test (P1)

**파일**: `src/components/tunaflow/settings/AgentsSection.test.tsx` 또는 동등

- 메타 profile 0 개 → dropdown disabled
- 메타 profile N 개 → dropdown 에 N+2 옵션
- 기존 `claude-haiku` 값 migration → auto fallback (메타 profile 없을 때)
- 기존 `gemini-flash` 값 migration → 메타 profile 있으면 첫 profile, 없으면 auto

# 4. Cross-cutting risks

- **사용자 settings migration**: 기존 v0.1.8-beta-3 사용자가 `claude-haiku` 또는 `gemini-flash` 로 저장된 상태. 새 시스템에서 그 값이 더 이상 유효하지 않음. fallback 로직 (auto / 첫 메타 profile) 명확
- **persona_meta 정의**: `DEFAULT_PERSONAS` 의 `persona_meta` 가 builtin. 사용자가 Agents 패널에서 그 persona 로 profile 을 만들지 않으면 메타 profile 0 개. UI 가 명확히 안내
- **Tier 2 분석 path 의 engine resolution**: T3 에서 profile id resolution 누락 시 분석 실행 fail. 검증 필수

# 5. Rollback

T1~T5 별 commit 분리. 각 revert 가능. metaAnalysis schema 변경은 T1 의 migration 로 보호.

# 6. 다음 step

1. Developer 핸드오프 작성 — `docs/prompts/tier2MetaAgentProfileSourceDeveloperHandoff_2026-05-20.md`
2. Developer subagent dispatch (worktree 격리, admin merge)
3. 머지 후 v0.1.8-beta-4 release 묶음 결정
