---
title: Developer 핸드오프 — Tier 2 engine source 를 agentProfiles persona_meta 로 통합
plan: docs/plans/tier2MetaAgentProfileSourcePlan_2026-05-20.md
created_at: 2026-05-20
---

# 0. 한 줄 요약

Settings → Agents → "메타 에이전트 자동 분석 (Tier 2)" 영역의 engine 옵션을 하드코딩 (`claude-haiku` / `gemini-flash`) 에서 `agentProfiles` 의 `persona_meta` profile list 로 통합. 메타 profile 0 개 → 영역 disable.

# 1. SSOT
- **Plan**: `docs/plans/tier2MetaAgentProfileSourcePlan_2026-05-20.md` (§3 T1~T5)

# 2. PR 전략 — 단일 PR

브랜치: `fix/tier2-meta-agent-profile-source`

5 commit:
- `feat(meta-analysis): MetaAnalysisEngine type → profile id + migration (T1)`
- `fix(settings): tier2 dropdown source = agentProfiles persona_meta filter (T2)`
- `fix(meta-analysis-trigger): resolve engine from profile id at exec time (T3)`
- `chore(i18n): tier2 meta engine 옵션 키 갱신 ko/en (T4)`
- `test(settings): tier2 source + migration + empty state coverage (T5)`

각 trailer:
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

# 3. 작업 순서

T1 (type/migration) → T2 (dropdown UI) → T3 (resolution at exec) → T4 (i18n) → T5 (test). T1 의 migration 이 T2/T3 의존성.

# 4. DO

1. **MetaAnalysisEngine type 갱신** — `"off" | "auto" | string`(profile id). literal 2 종 제거
2. **agentProfiles filter** — `p.personaId === "persona_meta"`. Settings store 의 `agentProfiles` 사용
3. **메타 profile 0 개 처리** — dropdown 옵션은 off + auto 만, 영역 또는 select disable + 안내 메시지 + Agents 패널 jump 링크
4. **기존 settings 값 migration** — `claude-haiku` / `gemini-flash` literal 저장된 사용자: agentProfiles 에서 매칭 profile 검색 (engine+model 일치) → 있으면 그 id, 없으면 `auto`
5. **engine resolution at exec time** — Tier 2 분석 실행 path 가 profile id 받으면 `agentProfiles.find(p => p.id === id)` 으로 profile.engine/model 추출. 매칭 실패 → graceful off
6. **i18n ko/en 양쪽** — 기존 키 정리 + 신규 키 (`no_profile_hint` / jump link)
7. **AgentsSection 의 다른 영역 (일반 agent / role assignments) 변경 X**

# 5. DO NOT

- ❌ `AgentProfile` schema 변경 (id/label/engine/model/personaId/defaultSkills 유지)
- ❌ `Persona` schema 변경 (`persona_meta` 정의 그대로)
- ❌ Onboarding modal / MetaAgentSelector 변경 — 별 plan `metaAgentModelDiscoveryUnification` 진행 중
- ❌ Tier 2 분석 알고리즘 / Tauri command 본체 변경 — engine resolution layer 만
- ❌ Rust 영역 변경 (frontend + settings JSON 한정)
- ❌ DB / migration / agent / model_discovery 영역 변경
- ❌ 새 dependency 추가
- ❌ role assignments 의 RoleKey 에 "meta" 추가 (현재 architect/developer/reviewers/synthesizer 만)
- ❌ DEFAULT_PERSONAS 의 persona_meta 정의 변경

# 6. Verification

```bash
cd src-tauri && cargo check --message-format=short    # 변경 0
npx tsc --noEmit
npx vitest run                                        # FE 447 + T5 +N
```

회귀 grep:
```bash
git diff src-tauri/                                   # 변경 0
git diff src/lib/roleAssignments.ts                   # 변경 0
git diff src/lib/defaultPersonas.ts                   # 변경 0
rg "claude-haiku|gemini-flash" src/lib/metaAnalysis.ts src/components/tunaflow/settings/AgentsSection.tsx  # 0 매치 (T1+T2 제거)
rg "persona_meta" src/lib/metaAnalysis.ts src/components/tunaflow/settings/AgentsSection.tsx  # 사용 확인
```

# 7. e2e 수동 검증

- Agents 패널에서 `persona_meta` profile 0 개 → Tier 2 영역 disabled + 안내 표시
- `persona_meta` profile 1 개 생성 → Tier 2 dropdown 에 그 profile 표시
- 기존 사용자가 `claude-haiku` 저장된 상태로 v0.1.8-beta-4 update → migration 동작 (메타 profile 있으면 그 id 로, 없으면 auto)
- Tier 2 분석 실행 (auto trigger 또는 manual) → profile.engine + profile.model 로 분석 수행
- 메타 profile 삭제 후 분석 실행 시도 → graceful (off 동작)

GUI 환경 제약 시 vitest mock 으로 대체.

# 8. CI 정책

PR 직후 `gh pr merge --squash --delete-branch --admin` 즉시 머지. CI watch 불필요 (frontend + settings JSON 한정).

# 9. 보고 포맷 (chat)

```
## Tier 2 Meta Agent Profile Source 결과
- PR URL + 머지 commit
- task 별 변경 라인 수 + 핵심 파일
- §6 Verification: cargo check / tsc / vitest 결과
- §7 e2e 결과 (자동 / 사용자 영역)
- migration 동작 (기존 literal → profile id 매칭 / fallback)
- 회귀 가드 grep (src-tauri 0 / role assignments 0 / persona schema 0)
```

# 10. 막히면 (escalate)

- 기존 literal 값 → profile id 매칭 알고리즘 모호 (예: 어떤 profile 이 `claude-haiku` 와 동등?) → first matching `engine === "claude"` 또는 `engine === "claude" && model ~contains "haiku"` 같은 heuristic. 결정 chat 보고
- 메타 profile 0 개일 때 auto 옵션 의미 — disable / 첫 profile 자동 / off 강제. 결정 보고
- Tier 2 분석 실행 path 에서 profile id resolution 위치 모호 (engine 값을 그대로 LLM call 에 던지는 layer 추적 필요) → grep 결과 + 가설 보고
- migration 시 잘못된 fallback 으로 사용자 의도 외 분석 실행 → 명시적으로 `off` fallback 우선 권장

# 11. Worktree 안전 가드

- macOS APFS case-insensitive: Edit 절대 경로 sanity check
- `git rev-parse --abbrev-ref HEAD` commit 직전
- main repo 변경 발견 시 `git checkout HEAD -- <path>`
- git stash drop/pop X (apply 만)

# 12. 주의사항

- autonomous — 사용자 질문 금지 (위 escalate 외)
- 한국어 commit / chat 보고
- 핸드오프 / plan SSOT
- 단계 끝나면 v0.1.8-beta-4 release 묶음/별 결정 Architect 영역
