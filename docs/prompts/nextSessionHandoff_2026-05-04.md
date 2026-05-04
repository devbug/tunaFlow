---
title: 다음 세션 핸드오프 — v0.1.5-beta 후속 + 신규 스킬 활용
created_at: 2026-05-04
prev_session: 2026-05-03~04 (v0.1.5-beta cycle + README reframe + 신규 스킬 3종)
prev_handoff: docs/prompts/nextSessionHandoff_2026-04-24.md
---

# 다음 세션 핸드오프 — 2026-05-04

## 0. 한 줄 요약

v0.1.5-beta 외부 사용자(devbug) #253/#254/#255 hotfix 사이클 완료. README ko/en 리프레임 + 사실 정정. project-scoped 스킬 3 종 (`tunaflow-developer-handoff` / `tunaflow-plan-writing` / `tunaflow-release-cycle`) 신설 — **새 세션에서만 자동 트리거 가능**. 다음 cycle 진입 시점이 새 세션 시작의 기점.

## 1. 첫 메시지 시 할 일

1. **CLAUDE.md** 읽기 — §14 Skill 로딩 규칙 표 확장됨 (project-scoped 3종 + anthropic-claude-api shared/ 매핑 추가)
2. **available_skills 확인** — system-reminder 에 `tunaflow-developer-handoff` / `tunaflow-plan-writing` / `tunaflow-release-cycle` 가 등장하는지. 없으면 `/reload-plugins` (그래도 없으면 세션 완전 재시작)
3. **이번 세션 메모리** 확인 — `MEMORY.md` 의 *Session 2026-05-03~04 v0.1.5-beta* + *Claude Code plugins for tunaFlow*

git pull 은 안 해도 됨 — main 이 이미 origin/main 과 sync (612dc97).

## 2. 현재 상태 (2026-05-04 기준)

### Repo
- Branch: `main`, latest: `612dc97 feat(skills): tunaFlow architect 작업 자동화 3개 스킬 추가`
- DB: v49 / Rust: 614 tests / Frontend: 401 tests
- Open PR: 0 / Open issue: 0 (devbug 보고 3건 모두 closed)

### Release
- v0.1.5-beta published 2026-05-03T04:51:52Z
- 자산 3개: macOS aarch64 dmg + app.tar.gz, Windows x64-setup.exe
- v0.1.4-beta 도 published 상태 (replaced by v0.1.5-beta latest)

### Plugins / Skills 등록 상태
- Marketplaces: `anthropics/skills` + `mksglu/context-mode`
- Plugins: `example-skills` + `claude-api` (중복 namespace, 무해) + `context-mode`
- Project-scoped skills 3 종 (`.claude/skills/`)

## 3. 이번 세션 머지 / 변경 인덱스

### v0.1.5-beta 사이클 (4 PR)
- #256 ARCHITECT_TEMPLATE result task auto-inject 차단 (Task 01, issue #254 영역 A)
- #257 branch view chat input 회귀 fix (issue #255)
- #258 docs/agents/*.md sentinel 보존 + migration (Task 02, issue #254 영역 B)
- #259 ARCHITECT_TEMPLATE 본문 prompt 노이즈 정리 (Gemini code review follow-up)

### 머지된 docs / 자산
- `docs/plans/scaffoldUserCustomizationPreservationPlan_2026-05-03.md` (#254)
- `docs/plans/branchChatInputRegressionPlan_2026-05-03.md` (#255)
- `docs/prompts/scaffoldUserCustomizationPreservationDeveloperHandoff_2026-05-03.md`
- `docs/prompts/branchChatInputRegressionDeveloperHandoff_2026-05-03.md`
- `docs/ideas/entrolyAdoptionIdea_2026-05-02.md` + `docs/plans/entrolyAdoptionPlan_2026-05-02.md`

### README ko/en 리프레임 (4a79cc5)
- 상단 5 신규 섹션: What it is / What's notable / How it sits next to existing tools / Non-goals / Who this is for
- 비교표: Cursor / Continue / Cline / aider / crewAI / langgraph
- 사실 정정: OpenCode 제거 / 엔진 4→5 / OS macOS only→Win 추가 / DB v46→v49 / Beta installation Windows 섹션

### 스킬 자산
- `~/.tunaflow/skills/anthropic-claude-api` SKILL.md 20.5KB→33KB refresh + shared/ 4 docs (prompt-caching / tool-use-concepts / agent-design / model-migration)
- Claude Code plugins: `anthropics/skills` marketplace → `example-skills` + `claude-api`
- Project-scoped skills 3 종 (612dc97):
  - `tunaflow-developer-handoff` (160 lines) — 9 섹션 fixed structure
  - `tunaflow-plan-writing` (193 lines) — 6+1 섹션 fixed structure
  - `tunaflow-release-cycle` (252 lines) — 11 단계 release flow

## 4. 신규 스킬 자동 트리거 매핑

다음 세션에서 다음 의도가 보이면 자동 트리거:

| 의도 / phrase | 스킬 | 출력 |
|---|---|---|
| "이슈 분석해서 plan 으로 정리", "plan 작성하자", "이 작업을 어떻게 진행할지 문서화" | `tunaflow-plan-writing` | `docs/plans/<slug>Plan_YYYY-MM-DD.md` |
| "Developer 핸드오프 만들자", "Plan 의 task 를 누군가에게 넘기자", "Developer subagent 에게 dispatch" | `tunaflow-developer-handoff` | `docs/prompts/<slug>DeveloperHandoff_YYYY-MM-DD.md` |
| "릴리즈 하자", "v0.X.Y publish", "이번 fix 들 묶어서 publish" | `tunaflow-release-cycle` | 11 단계 자동 진행 (CHANGELOG → version bump → tag → build watch → publish → issue close) |

스킬 본문에 *왜 이 형식인가* + *언제 쓰는가* + *Plan 과 핸드오프의 관계* + *lessons learned* 모두 명시되어 있음.

## 5. 열린 thread

| 항목 | 상태 | 다음 action |
|---|---|---|
| devbug v0.1.5-beta 검증 | 대기 — 외부 사용자 환경에서 #254 (sentinel migration) + #255 (chat input) 자가 회복 path 작동 여부 | 회귀 보고 시 새 issue 또는 본 issue 재개 |
| `claude-api` plugin 정리 | example-skills 와 namespace 중복 (무해) | 원하면 `/plugin uninstall claude-api@anthropic-agent-skills` |
| `document-skills` plugin | 미설치 (architect 영역 무관) | 필요 시 `/plugin install document-skills@anthropic-agent-skills` |

## 6. 다음 cycle 진입 시 흐름 (예시)

새 외부 issue 가 들어왔다고 가정:

1. issue 내용 분석 → "plan 으로 정리하자" → `tunaflow-plan-writing` 자동 트리거 → `docs/plans/<slug>Plan_YYYY-MM-DD.md` 작성
2. plan 머지 후 → "Developer 핸드오프 만들자" → `tunaflow-developer-handoff` 자동 트리거 → `docs/prompts/<slug>DeveloperHandoff_YYYY-MM-DD.md` 작성
3. PR 머지 / dispatch → 핸드오프의 §6 CI 정책에 따라 admin merge
4. release 시점 → `tunaflow-release-cycle` 자동 트리거 → 11 단계 진행

세 단계 모두 *왜 이 형식인지* 가 스킬 본문에 명시 — 형식만 복붙하지 말고 의도 반영.

## 7. 회피 패턴 (이번 세션에서 학습)

- **PR description 의 "Closes part of #N" 은 GitHub auto-close 파서가 무시**: 부분 해소 PR 은 `Refs #N` 으로, 마지막 PR 만 `Closes #N` 명시
- **3 곳 version bump 누락 검증**: `grep "0.1.X-beta" src-tauri/Cargo.toml src-tauri/tauri.conf.json package.json src-tauri/Cargo.lock` 로 신/구 version 혼재 확인
- **Tauri Lite (macos-latest) 의 "Verify rawq sidecar staged" 단계 transient flake**: download-artifact race — `gh run rerun --failed` 로 1차 대응
- **CLIProxyAPI 류 (OAuth 토큰 캡처 + round-robin + 도구명 위장) 절대 차용 금지**: tunaFlow 의 subprocess + 토큰 미노출 + 사용자 1:1 패턴이 ToS 안전 영역

## 8. P1 / P2 backlog (참고)

CLAUDE.md §11 "다음 우선순위" 그대로 — 이번 세션에서 backlog 변동 없음.

P1 진행 대상 (큰 변동 없음):
- Project-per-window 아키텍처 (`docs/ideas/projectPerWindowIdea.md`)
- KnowledgeLayer trait — 6번째 소스 추가 시
- 온보딩 메타에이전트 (`docs/ideas/onboardingMetaAgentIdea.md`)

P2 후순위 동일.

## 9. 세션 바운더리 신호

- 마지막 사용자 발화: "그럼 핸드오프 만들어서 이어가자"
- 사용자 의도: 새 cycle 진입 전에 세션 정리 + 다음 세션이 신규 스킬 활용할 수 있게 컨텍스트 인계
- 새 세션 진입 trigger: 다음 외부 issue 또는 다음 큰 작업 cycle 시점
