---
title: Developer 핸드오프 — MetaAgentSelector model dropdown → engineModels store 통합
plan: docs/plans/metaAgentModelDiscoveryUnificationPlan_2026-05-20.md
created_at: 2026-05-20
---

# 0. 한 줄 요약

ProjectOnboardingModal / Settings 메타에이전트의 model dropdown 이 하드코딩 `CLI_DEFAULT_MODELS` (codex 2 / gemini 2) 만 표시되던 회귀. `MetaAgentSelector` 를 `engineModels` store (= `list_engine_models` Tauri cmd, dynamic discovery) 로 통합.

# 1. SSOT
- **Plan**: `docs/plans/metaAgentModelDiscoveryUnificationPlan_2026-05-20.md` (§3 T1~T5)

# 2. PR 전략 — 단일 PR

브랜치: `fix/meta-agent-model-discovery-unification`

5 commit:
- `fix(meta-agent): use engineModels store for CLI model dropdown (T1)`
- `refactor(meta-agent): remove CLI_DEFAULT_MODELS hardcoded list (T2)`
- `feat(meta-agent): empty state for loading / no models (T3)`
- `chore(settings): verify meta-agent UI uses unified store (T4)`
- `test(meta-agent): dropdown source + fallback coverage (T5)`

각 trailer:
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

# 3. 작업 순서

T1 (store 사용) → T2 (하드코딩 제거) → T3 (empty state) → T4 (Settings 메타에이전트 확인) → T5 (test)

# 4. DO — 반드시 지킬 것

1. **engineModels store fetch 자동화** — MetaAgentSelector mount 시 미초기화면 `fetchEngineModels()` 호출
2. **CLI engine 한정** — `claude` / `codex` / `gemini` 만 store 사용. `ollama` / `lmstudio` 는 기존 `det.models` (HTTP probe 응답) 그대로
3. **기본 모델 선택 보존** — `engineModels.find(m => m.engine === eng && m.recommended)?.id ?? engineModels.find(m => m.engine === eng)?.id` 패턴 (AgentsSection 와 동일)
4. **i18n 추가 (T3)** — `dialog.json` 또는 적절한 namespace 에 ko/en 양쪽 "model_loading" / "model_empty" 2 키
5. **Settings 메타에이전트 UI 확인 (T4)** — `MetaAgentSelector` 재사용인지 확인 후 영역에 따라 fix 또는 별 task. 별 UI 면 핸드오프에 결과 명시
6. **AgentsSection (일반 agent) 회귀 0** (INV-MM-5) — 다른 영역 변경 X

# 5. DO NOT — 사이드 이펙트 차단

- ❌ `detect_available_agents` / `probe_cli` (Rust) 변경 X — 본 plan scope 외. CLI engine 의 `models` field 빈 채로 두기로 결정 (frontend 가 store 로 대체)
- ❌ `model_discovery.rs::fallback` list 갱신 X (Non-goals) — 별 plan
- ❌ `AgentsSection` (일반 agent) 변경 X
- ❌ 새 Tauri command 추가 X (`list_engine_models` 재사용)
- ❌ store schema 변경 X
- ❌ 새 dependency 추가 X
- ❌ release scope 외 변경

# 6. Verification

```bash
cd src-tauri && cargo check --message-format=short    # 변경 0 (frontend only)
npx tsc --noEmit
npx vitest run                                        # FE 447 baseline + T5 신규 +N
```

회귀 grep:
```bash
git diff src-tauri/                                   # 변경 0
git diff src/components/tunaflow/settings/AgentsSection.tsx   # 변경 0
git diff src/stores/                                  # 변경 0 (store schema 동일)
rg "CLI_DEFAULT_MODELS" src/                          # 0 매치 (T2 제거 확인)
rg "engineModels" src/components/tunaflow/MetaAgentSelector.tsx  # 사용 확인
```

# 7. e2e 수동 검증

- Onboarding modal 진입 → CLI engine 선택 → model dropdown 에 dynamic discovery 결과 (claude/codex/gemini) 표시 (이전 2~3 종 → 신모델 포함)
- Settings 메타에이전트 영역 → 동일 동작
- engineModels 미초기화 상태 진입 → "모델 로딩 중" 표시 후 채워짐
- ollama/lmstudio HTTP engine → 기존 동작 그대로 (HTTP probe `models` 표시)

GUI 환경 제약 시 vitest mock 으로 대체.

# 8. CI 정책

PR 직후 `gh pr merge --squash --delete-branch --admin` 즉시 머지. CI watch 불필요 (frontend 한정, cross-platform 회귀 위험 0). 자체 검증 §6 통과 후 self-merge.

# 9. 보고 포맷 (chat)

```
## MetaAgent Model Discovery Unification 결과
- PR URL + 머지 commit
- task 별 변경 라인 수 + 핵심 파일
- §6 Verification: cargo check / tsc / vitest 결과
- §7 e2e 결과 (자동 / 사용자 영역)
- 회귀 가드 grep (src-tauri 0 / AgentsSection 0 / CLI_DEFAULT_MODELS 0 매치)
- T4 결과 (Settings 메타에이전트 = MetaAgentSelector 재사용 / 별 UI / 별 fix)
```

# 10. 막히면 (escalate)

- engineModels 가 fetch 실패 (Tauri cmd 에러) → empty state + error 표시. retry 버튼 가능
- Settings 메타에이전트가 `MetaAgentSelector` 와 다른 컴포넌트 + 다른 source → 별 task 로 분리, 핸드오프에 결과 명시 + 본 PR 은 onboarding modal 만 fix
- T3 empty state UI 가 기존 dropdown 컴포넌트 (radix select 등) 와 호환 안 되면 → placeholder 만 표시 + 안내 toast

# 11. Worktree 안전 가드

- macOS APFS case-insensitive: Edit 절대 경로 sanity check
- `git rev-parse --abbrev-ref HEAD` commit 직전
- main repo 변경 발견 시 `git checkout HEAD -- <path>`
- git stash drop/pop X (apply 만)

# 12. 주의사항

- autonomous — 사용자 질문 금지 (위 escalate 외)
- 한국어 commit / chat 보고
- 핸드오프 / plan SSOT
- 단계 끝나면 v0.1.8-beta-4 release 묶음/별 release 결정은 Architect 영역
