---
title: Developer 핸드오프 — scaffold 사용자 customize 보존 + result task 자동 inject 차단
plan: docs/plans/scaffoldUserCustomizationPreservationPlan_2026-05-03.md
issue: GitHub #254 (devbug, 2026-05-02)
created_at: 2026-05-03
---

# Developer 핸드오프 — scaffold 사용자 customize 보존 + result task 차단

## 0. 한 줄 요약

외부 사용자(devbug)가 docs/agents/architect.md 에 "result.md 작성 task 만들지 말 것" 추가했지만 tunaFlow 재시작 시 scaffold 가 덮어쓰기. 동시에 ARCHITECT_TEMPLATE 가 *마지막 task = result.md 작성* 자동 inject 시켜 PR #211/#212 정책과 모순. **두 영역(A: template inject, B: scaffold 보존) 분리 fix**.

## 1. 작업 개요 — 2 task 분리 PR (Task 03 은 선택)

**Plan SSOT**: `docs/plans/scaffoldUserCustomizationPreservationPlan_2026-05-03.md`. §3 Subtasks 의 Changed files / Verification / 회귀 위험 가드를 그대로 따를 것.

| Task | 영역 | 파일 | 핵심 변경 | 우선 |
|---|---|---|---|---|
| 01 | A — template inject 차단 | `src-tauri/src/commands/project_tools.rs` (ARCHITECT_TEMPLATE) 또는 plan-generation prompt | "Do NOT include result.md as a subtask" 명시 추가 | P1 |
| 02 | B — scaffold 보존 | `src-tauri/src/commands/projects.rs` (`refresh_agent_docs` 또는 비슷) + ARCHITECT/DEVELOPER/REVIEWER_TEMPLATE 본문 (sentinel inline) | sentinel 마커(`<!-- BEGIN user-customize --> ~ <!-- END user-customize -->`) detect → 안 영역 보존, 밖 영역 갱신 + migration 백업(`*.md.pre-sentinel`) | P1 |
| 03 | 사용자 가이드 | `INSTALL.md` 또는 `docs/how-to/agent-customize.md`(신규) | sentinel 사용법 + 백업 위치 + 추천 customize 영역 | P2 (선택) |

**진행 순서**: Task 01 → Task 02. 두 task 영역이 분리되어 있어 PR 도 분리 권장 (Task 01: template fix / Task 02: scaffold preservation). Task 02 는 migration 영향이 있으므로 **단독 PR + 본문에 백업 정책 명시**.

## 2. DO — 반드시 지킬 것

1. **Plan §3 의 Verification 명령을 task 마다 실제로 실행** 하고 결과를 chat 으로 보고.
2. **Task 01 → 02 순서**. Task 01 단독으로도 *새 plan 의 result task 자동 inject* 는 차단되므로 Task 02 가 막히면 Task 01 만 먼저 PR 가능.
3. **Task 01 진단 우선** (Plan §3 Task 01 의 진단 단계):
   - `project_tools.rs` 의 ARCHITECT_TEMPLATE 본문 read
   - "result" / "결과" / "마지막 task" keyword 검색 → 정확한 inject 위치 식별
   - plan-generation prompt 가 `plans.rs` 에 있다면 거기도 read
4. **Task 02 의 sentinel 마커 inline 추가** — 본문 갱신과 sentinel 빈 영역 추가는 같은 PR 에서. 사용자가 첫 sentinel 영역 채울 수 있도록 default 상태에서 빈 채로 노출.
5. **Migration 안전 가드**:
   - 기존 architect.md 가 sentinel 미보유 → 첫 scaffold 시 `architect.md.pre-sentinel` 로 백업 후 새 template 적용
   - 백업 생성 fail 시 scaffold 갱신 자체 abort + console error (사용자 데이터 보존 우선)
   - backend log 에 `[scaffold] preserved user-customize section in {file}` 또는 `[scaffold] migrated {file} → {file}.pre-sentinel + new template` 표시
6. **feature 브랜치 분리**: `fix/architect-template-result-task-block` (Task 01), `feat/agent-docs-sentinel-preservation` (Task 02).
7. **Commit 단위 task 별 분리**: `fix(architect-template): block result.md auto-inject (Task 01)` / `feat(scaffold): preserve user-customize sentinel section (Task 02)`.
8. **PR description 에 Plan 링크 + Issue #254 링크 + 각 task Verification 결과** 첨부.

## 3. DO NOT — 사이드 이펙트 차단

다음은 Plan §2 Non-goals 또는 회귀 위험 영역. **절대 수정 금지**.

- ❌ `syncResultReport` 동작 자체 (PR #211 의 truncation/self-include guard 적용 완료).
- ❌ REVIEWER_TEMPLATE 의 "Never read result.md" 정책 (PR #212 머지됨).
- ❌ scaffold 의 *§1 Project Overview* manual edit detect 정책 (`projects.rs:380` 인근 기존 line).
- ❌ DEVELOPER_TEMPLATE / META_TEMPLATE 의 result/result.md 관련 영역 외 본문.
- ❌ 다른 plan-generation 분기 (예: developer plan, CLAUDE.md scaffold, sessionHistory.md).
- ❌ DB 스키마, migration table, settings store.
- ❌ 새 dependency 추가.
- ❌ scaffold 의 다른 영역(CLAUDE.md, sessionHistory.md, agentSessionHistory.md) 정책 변경 — 본 PR 영역 한정.

## 4. 변경 후 검증 (전체)

각 task 의 개별 Verification 외에 **PR 머지 직전 모두 통과 확인**:

```bash
# Rust
cd src-tauri && cargo check --message-format=short
cd src-tauri && cargo test --lib

# Frontend (영향 없을 가능성 높지만 확인)
npx tsc --noEmit
npx vitest run

# Task 01 회귀 grep — result task 자동 inject keyword 가 명시적 차단 문구와 함께 있는지
rg -n "result\.md|결과 문서" src-tauri/src/commands/project_tools.rs
rg -n "Do NOT include result|result task 자동" src-tauri/src/commands/project_tools.rs

# Task 02 회귀 grep — sentinel 마커가 template 에 inline, scaffold 함수가 detect 하는지
rg -n "BEGIN user-customize|END user-customize" src-tauri/src/commands/

# §1 Project Overview manual edit detect 가 살아있는지 (기존 동작 유지 확인)
rg -n "Project Overview|manual_edit|user_modified" src-tauri/src/commands/projects.rs
```

테스트 카운트 baseline 기록 후 작업 후 동일 또는 +N (새 unit test 만큼). **감소 시 회귀** — 즉시 원인 파악.

## 5. e2e 수동 검증 (Task 02 머지 직전 필수)

1. **fresh project 생성** → docs/agents/{architect,developer,reviewer}.md scaffold 확인
2. architect.md 의 sentinel 영역 안에 "test customize line" 추가 후 저장
3. tunaFlow 재시작 → scaffold 트리거
4. architect.md 다시 열기 → "test customize line" 보존 확인 ✅
5. **Migration 검증**: sentinel 미보유 architect.md (예: 기존 v0.1.4-beta 사용자 환경 simulate) 만든 후 scaffold → `architect.md.pre-sentinel` 백업 생성 + 새 template 적용 확인 ✅
6. **Task 01 검증**: 새 plan 생성 → 마지막 task 에 "result.md 작성" inject 안 되는지 확인 ✅
7. **회귀 시나리오**: 기존 plan(마지막 task = result.md) 보유 project → 그 plan 본문은 수정되지 않는지 확인 (사용자 영역 보존)

migration 동작 OK + sentinel 보존 OK + result task inject 차단 OK 면 ok. 실패 시 즉시 보고.

## 6. CI 정책

- PR 직후 admin merge 즉시 가능 (CI watch 불필요). 자체 검증 §4 통과한 상태로 self-merge.
- Task 02 는 migration 동작이라 머지 후 다음 release 에 포함되어야 외부 사용자 자가 회복 path 회복. release note 에 *백업 파일 위치 + sentinel 사용법* 한 줄 명시 권장.
- merge 후 main 에서 회귀 발생 시 즉시 revert PR 생성.

## 7. 보고 포맷

작업 완료 시 chat 에:
- task 별 변경 라인 수
- 각 Verification 결과 (PASS/FAIL + 핵심 출력)
- e2e 수동 검증 결과 (Task 02 머지 직전 필수)
- PR URL (각 task 별)
- 회귀 위험 가드 위반 없음 확인 (`projects.rs:380` 인근 §1 정책 diff 0, REVIEWER_TEMPLATE 본문 diff 0 등)

## 8. 막히면

- ARCHITECT_TEMPLATE 의 result task inject 위치가 명확하지 않으면 chat 에서 Architect 에게 보고 — code 수정 전. plan-generation prompt 가 LLM 동적 생성이라면 Task 01 의 fix 위치는 *prompt 자체* 가 아닌 *post-processing 단계* 로 옮길 수 있음.
- sentinel migration 백업 정책에 대한 의문은 plan §4 Cross-cutting risks 표 1번 참조 후 escalate.
- Task 02 가 다른 scaffold 영역 (CLAUDE.md 등) 까지 영향 줘야 한다는 신호가 보이면 **그 영역은 별 plan** 으로 escalate. 본 PR 영역 한정 유지.
- migration 백업 생성 실패 (디스크 권한 등) 시 abort + console error. **fallback 으로 사용자 파일 덮어쓰기 절대 금지**.

## 9. 사용자 답변 정책 (참고)

devbug 에게 답변 (Architect 영역, Developer 직접 답변 X):
- Plan 머지 후 Architect 가 issue #254 에 진행 상황 댓글
- Task 02 머지 후 자동 회복 안내 (다음 release 에서 백업 + sentinel 패턴 자동 적용)
- 임시 workaround: 현재 release 에서는 docs/agents/architect.md 수동 customize 가 재시작 시 덮어쓰기 — 본 PR 적용된 next release 까지 대기 권장
