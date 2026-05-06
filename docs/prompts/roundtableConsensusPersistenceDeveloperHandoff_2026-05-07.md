---
title: Developer 핸드오프 — Roundtable 합의 영구화 + RT marker 격리 + Architect 인계
plan: docs/plans/roundtableConsensusPersistencePlan_2026-05-07.md
issue: GitHub #263
created_at: 2026-05-07
---

# Developer 핸드오프 — Roundtable 합의 영구화 + RT marker 격리 + Architect 인계

## 0. 한 줄 요약

외부 사용자(devbug)가 보고한 GitHub #263 — RT 환각/오동작 3 영역 (라운드 간 합의 망각 / main conv 단일 dispatch 시 합의 무시 / Architect 가 RT 대화 내역 접근 못 함). Root cause **3중 복합 확정** (Architect 가 mcp+DB+코드 path 직접 검증, Plan §0.2.1 참조): RT consensus DB schema 부재 + RT marker 부재 → main conv 혼입 + `build_findings_section` LIMIT 3 brief + `build_rt_inheritance_section` 이 RT 합의 미인계. 사용자 *"RT 사용 포기"* 단계 도달, 기능 가치 0.

## 1. 작업 개요 — task 표

Plan B (`roundtableConsensusPersistencePlan_2026-05-07.md`) 의 6 task 를 **3 PR 분리**. Task 01 (Architect 직접 검증) 은 이미 완료, PR 불필요. Task 02 가 schema foundation 이라 PR-1 단독 머지 후 PR-2/3 진입 (직렬 의존).

| Task | 파일 | 핵심 변경 | PR | 우선 |
|---|---|---|---|---|
| ~~01~~ | ~~없음~~ | ~~Architect 직접 검증 완료 (Plan §0.2.1)~~ | ~~없음~~ | ~~완료~~ |
| **PR-1** | | | | |
| 02 | `src-tauri/src/commands/roundtable.rs` (64~166), `roundtable_helpers/persist.rs`, `src-tauri/src/db/migrations/` (v50 신규), `roundtable_helpers/prompt.rs` (23~74) | 신규 `roundtable_consensus` 테이블 + synthesizer 가 합의 항목 추출 후 row insert + `run_synthesizer_after_round()` 의 input 에 *"Consensus reached so far"* 섹션 추가 + `build_round_prompt_with_identity()` 갱신 | PR-1 | P0 |
| **PR-2** | | | | |
| 03 | `roundtable.rs` (302~309), `agents_helpers/context_pack/db_queries.rs`, `src-tauri/src/db/migrations/` (messages 컬럼 추가) | `messages` 테이블에 `rt_round_index` (nullable) 또는 marker 컬럼 추가 + RT 메시지 저장 시 라운드 index 기록 + ContextPack 의 RT 메시지 필터링 | PR-2 | P1 |
| 04 | `agents_helpers/context_pack/db_queries.rs` (173~215, 364~398) — `build_findings_section` 보조 fallback / `build_rt_inheritance_section` 보강 / 신규 `build_rt_consensus_section()` | 신규 helper 가 `roundtable_consensus` 테이블 조회 → prompt 본문에 *"# Roundtable Consensus"* 섹션 조립 (axis / decision / participants / round_index 누적). Architect dispatch ContextPack 에서 명시 호출 | PR-2 | P0 |
| **PR-3** | | | | |
| 05 | `src-tauri/src/commands/roundtable.rs` (테스트 모듈), `agents_helpers/context_pack/db_queries.rs` (테스트 모듈) | Rust unit test 4개 신규: `consensus_persisted_across_rounds` / `next_round_prompt_includes_prior_consensus` / `single_agent_dispatch_skips_rt_transcript` / `architect_context_pack_includes_consensus_section` | PR-3 | P0 |
| 06 | `CHANGELOG.md`, `docs/reference/roundtableReproductionScenarios_2026-05-07.md` (회복 결과), `docs/reference/dataModelRevised.md` (roundtable_consensus 추가) | release notes / 시나리오 회복 결과 / DB schema docs | PR-3 | P2 |

진행 순서: **PR-1 → PR-2 → PR-3 직렬**. PR-1 의 schema 가 PR-2 의 helper 의존, PR-2 의 변경이 PR-3 의 test 의존. 한 PR 막히면 후속 PR 보류.

## 2. DO — 반드시 지킬 것

1. **Plan §3 각 task Verification 실 실행 + chat 보고**:
   - PR-1 Task 02: `cargo test --lib` 신규 unit test (consensus persistence) 통과 + DB query (`SELECT * FROM roundtable_consensus`) 누적 검증
   - PR-2 Task 03/04: 시나리오 A/C e2e (사용자 환경 또는 mcp 환경 PATH fix 후 가능)
   - PR-3 Task 05: vitest / cargo test 신규 4 unit test 통과
2. **PR 진행 순서**: PR-1 (foundation) → PR-2 (helper 의존) → PR-3 (test 의존). PR-1 머지 전 PR-2/3 push 금지. PR-1 PR-2 머지 후 PR-3 진입
3. **회귀 위험 가드 grep 사전 baseline**:
   - 작업 전: `rg "roundtable_brief|build_findings_section|build_rt_inheritance_section" src-tauri/` baseline
   - 작업 후: 위 함수의 *기존 동작* 보존 (보조 fallback) + 신규 helper 호출만 추가
   - DB migration 검증: `sqlite3 .tunaflow/data.db "PRAGMA user_version"` 작업 전 (49) → 작업 후 (50)
4. **feature 브랜치**:
   - PR-1: `feat/rt-consensus-persistence-263`
   - PR-2: `feat/rt-marker-architect-handoff-263`
   - PR-3: `test/rt-consensus-coverage-263`
5. **Commit 단위 task 별 분리** (한 PR 안에서도 독립 commit):
   - PR-1: `feat(rt): roundtable_consensus schema + persistence (Task 02 / #263)` → `feat(rt): synthesizer prompt에 prior consensus 섹션 주입 (Task 02 / #263)` → `db(migration): v50 roundtable_consensus`
   - PR-2: `feat(rt): rt_round_index 컬럼 + main conv 격리 (Task 03 / #263)` → `feat(context-pack): build_rt_consensus_section 신규 + Architect dispatch 인계 (Task 04 / #263)`
   - PR-3: `test(rt): consensus persistence + Architect 인계 unit test 4종 (Task 05 / #263)` → `docs(rt): release notes + 시나리오 회복 결과 + dataModel 갱신 (Task 06 / #263)`
6. **PR description**: plan 링크 (`docs/plans/roundtableConsensusPersistencePlan_2026-05-07.md`) + issue 링크 + 시나리오 SSOT 링크 (`docs/reference/roundtableReproductionScenarios_2026-05-07.md`) + 각 task §4/§5 Verification 결과 + 회귀 grep baseline → after.
   - PR-1: `Refs #263` (부분 해소)
   - PR-2: `Refs #263` (부분 해소)
   - PR-3: `Closes #263` (마지막 PR — *Closes part of* 같은 한정어 GitHub auto-close 파서가 무시하므로 본 키워드는 PR-3 에만)

## 3. DO NOT — 사이드 이펙트 차단

- ❌ **RT 의 round 진행 메커니즘 (Sequential / Deliberative / 참여자 / round count) 변경 금지** — INV-RTC-1. Plan §2 Non-goals. 본 plan 은 *합의 영구화 + 인계* 만 추가, round 본체 알고리즘 보존
- ❌ **Voting + MoA Synthesizer 본체 알고리즘 (2026-04-18 머지) 변경 금지** — INV-RTC-2. synthesizer 의 *입력 보강* 만 — 합의 추출 prompt 영역만 추가, voting 알고리즘 자체 손대지 말 것
- ❌ **`build_findings_section()` 의 기존 동작 (roundtable_brief LIMIT 3 + 600자 truncate) 제거 금지** — Plan §3 Task 04. *보조 fallback* 으로 유지. 신규 `build_rt_consensus_section` 가 *추가 섹션* 으로만 동작
- ❌ **conversation_id 분리 (별 conv 생성) 금지** — INV-RTC-3. Plan §2 Non-goals. RT/main 동일 conv 정책 유지, *프롬프트 단위 격리* (marker 또는 컬럼) 만
- ❌ **Tier 2 brief / identity-trigger / memory auto-trigger / Rust `meta_agent/` 모듈 변경 금지** — Plan §2 Non-goals. v0.1.6-beta 영역 외 영향 0
- ❌ **Architect persona / system prompt 본체 변경 금지** — Plan §2 Non-goals. ContextPack *입력* 만 보강, persona 그대로
- ❌ **RT 미사용 프로젝트의 ContextPack / DB / UI 동작 변경 금지** — INV-RTC-7/8. `roundtable_consensus` 빈 결과 시 신규 섹션 자체 skip (성능 영향 0)
- ❌ **branchSessionPolicy.md INV-1~5 (brand session = main session 공유) 손대지 말 것** — INV-RTC-5. RT 의 marker 정책이 brand session 정책 영역에 영향 가서는 안 됨
- ❌ **migration v50 destructive 변경 금지** — INV-RTC-6. 기존 사용자의 `roundtable_brief` memo 데이터 보존. 신규 schema *추가* 만, 기존 row drop 금지
- ❌ **Architect doom-loop escalate 경로 (v0.1.6-beta `dispatchArchitectRedesign`) 변경 금지** — Plan §0.4. 본 plan 의 Task 04 가 *간접적으로* 결합되지만 doom-loop trigger 자체 변경 0
- ❌ **Frontend RT UI 대규모 변경 금지** — Plan §2 Non-goals. consensus 표시 / 시각화 / RoundtableView 본체 변경은 별 plan
- ❌ **README.md / CLAUDE.md 변경 금지** — Task 06 의 CHANGELOG / dataModel / 시나리오 docs 외 cross-cutting 문서 차단
- ❌ **새 dependency 추가 금지** — 기존 rusqlite + axum + tokio 만 활용

## 4. 변경 후 검증 (전체)

각 PR 머지 직전 통과 명령:

```bash
cd src-tauri && cargo check --message-format=short
cd src-tauri && cargo test --lib
npx tsc --noEmit
npx vitest run
```

테스트 카운트 baseline (2026-05-07 v0.1.6-beta 머지 후):
- Rust: **614 tests** baseline. 본 plan 후 **+4 → 618** (PR-3 의 신규 unit test 4개)
- Frontend: **422 tests** baseline. 본 plan 은 backend 영역, frontend 변경 0 → 422 유지

PR 별 회귀 grep:

**PR-1 머지 직전**:
```bash
# 신규 schema + helper 등장
rg "roundtable_consensus" src-tauri/src/  # 정의 + 호출 등장
rg "Consensus reached so far" src-tauri/src/  # synthesizer prompt 영역
# migration v50 등장
sqlite3 .tunaflow/data.db "PRAGMA user_version"  # 50
# 기존 동작 보존
rg "save_shared_brief" src-tauri/src/  # 기존 호출 그대로
git diff src-tauri/src/commands/agents/  # 빈 출력 (PR-1 영역 아님)
git diff src/  # 빈 출력 (frontend 미변경)
```

**PR-2 머지 직전**:
```bash
rg "rt_round_index" src-tauri/src/  # 컬럼 정의 + 사용
rg "build_rt_consensus_section" src-tauri/src/  # 신규 helper + Architect dispatch 호출
git diff src-tauri/src/commands/agents/voting/  # 빈 출력 (Voting + MoA Synthesizer 영역)
git diff src/  # 빈 출력 (frontend 미변경)
git diff src-tauri/src/commands/meta_agent/  # 빈 출력 (Tier 2 영역)
```

**PR-3 머지 직전**:
```bash
rg "consensus_persisted_across_rounds|next_round_prompt_includes_prior_consensus|single_agent_dispatch_skips_rt_transcript|architect_context_pack_includes_consensus_section" src-tauri/src/  # 4 unit test 등장
git diff src-tauri/src/commands/roundtable.rs | grep -v "^+#\[cfg(test)\]"  # 본체 코드 변경 0 (test 영역만)
git diff CHANGELOG.md docs/reference/  # PR-3 영역만
```

DB migration 안전성:
- migration v50 dry-run: 기존 사용자 DB 백업 (`cp .tunaflow/data.db .tunaflow/data.db.pre-v50`) → migration 적용 → `roundtable_brief` memo row count 비교 (작업 전 == 작업 후)
- rollback 시뮬레이션: `roundtable_consensus` table drop → `roundtable_brief` memo 영향 0 확인

## 5. e2e 수동 검증

각 PR 머지 직전 실행. 회귀 시나리오 + 회귀 가드 분리. 실 동작 환각 검증은 시나리오 SSOT (`docs/reference/roundtableReproductionScenarios_2026-05-07.md`) 1:1 옮겨감.

### PR-1 (consensus schema + persistence)

**회귀 시나리오** (보고 #2 fix 의도):
- ✅ 5 라운드 RT 진행 → DB query: `SELECT axis, decision, round_index FROM roundtable_consensus WHERE conversation_id = ? ORDER BY round_index` 결과가 라운드별 합의 누적
- ✅ 라운드 N+1 의 prompt assembly trace → *"Consensus reached so far"* 섹션에 라운드 1~N 합의 항목 명시 등장
- ✅ 같은 합의 재시도 환각 회복 — synthesizer 가 이미 합의된 axis 를 *"already agreed"* 인지

**회귀 가드** (정상 path 깨지지 않음):
- ✅ RT 미사용 프로젝트의 ContextPack / DB 동작 변경 0 (`roundtable_consensus` 빈 테이블)
- ✅ Voting + MoA Synthesizer 의 voting 결과 (참여자별 의견 비교) 알고리즘 변경 0
- ✅ 기존 `roundtable_brief` memo 동작 보존 (PR-2/3 의 fallback path)
- ✅ migration v50 후 기존 사용자 DB 의 `memos.type='roundtable_brief'` row count 보존

### PR-2 (RT marker + Architect 인계)

**회귀 시나리오** (보고 #1, #3 fix 의도):
- ✅ 시나리오 A: RT 2 라운드 후 main conv 단일 에이전트 dispatch → ContextPack trace 에 RT consensus 만 등장 / RT round transcript 미등장 → 단일 에이전트 응답이 *합의 인지 + follow-up answer* 형태
- ✅ 시나리오 C: RT 정상 진행 + 합의 도달 후 Architect dispatch → 응답에 *"# Roundtable Consensus"* 섹션의 라운드별 합의 + 참여자 의견 등장

**회귀 가드**:
- ✅ INV-RTC-3: conversation_id 공유 정책 보존 (별 conv 분리 안 함)
- ✅ INV-RTC-7: ContextPack 조립 시간 / 토큰 비용 영향 0 — RT 미진행 conv 는 fast path
- ✅ `build_findings_section` 의 기존 LIMIT 3 fallback 동작 보존
- ✅ Architect 가 받는 ContextPack 의 다른 섹션 (project / files / persona / artifacts) 변경 0

### PR-3 (test + docs)

**회귀 시나리오**:
- ✅ Rust unit test 4 신규 통과 (Plan §3 Task 05 명시)
- ✅ release notes 의 사용자 가시 변화 4 항목 등장 (Plan §6 Task 06)

**회귀 가드**:
- ✅ 기존 614 Rust test 통과 보존
- ✅ Frontend 422 vitest 통과 보존
- ✅ 다른 reference docs / README / CLAUDE.md 변경 0

GUI 환경 제약: Architect 직접 e2e 불가능한 시나리오 (실 동작 환각 캡처 — mcp `spawnSync /bin/sh ENOENT` 차단) 는 unit test 시뮬레이션 + *"v0.1.X-beta 외부 사용자 (devbug) 환경 검증으로 최종 확인"* 위임.

## 6. CI 정책

- 각 PR 직후 admin merge 즉시 가능 (CI watch 불필요)
- 자체 검증 §4 + e2e §5 통과한 상태로 self-merge
- merge 후 main 에서 회귀 발생 시 즉시 revert PR 생성

migration / DB / release 영향:
- **PR-1 의 migration v50 은 다음 release 에 포함되어야 사용자 자가 회복 path 회복** — 즉 PR-1/2/3 모두 같은 release cycle 안에 묶음 머지 권장. 부분 머지 시 *schema 만 있고 helper 호출 없음* 또는 *helper 만 있고 schema 없음* 같은 정합성 깨짐
- release timing 권장: **v0.1.7-beta minor bump** (DB migration v50 + Architect ContextPack 변경 + 사용자 가시 변화 4항목 → minor axis). Plan A (Windows hotfix) 와 묶을지 사용자 결정 영역
- release notes 강조 항목 (Plan §6 Task 06):
  - *"라운드 길어져도 같은 합의 재시도 안 함 — 합의 영구화 회복 (devbug #263)"*
  - *"Architect 가 RT 누적 합의 받음 — 마지막 라운드만 정리 회귀 회복"*
  - *"단일 에이전트 질의 시 RT 라운드 재실행 환각 차단 — RT marker 격리"*
  - *"DB migration v50 — 기존 데이터 보존, 자동 마이그레이션"*

## 7. 보고 포맷

작업 완료 시 chat 으로 다음 형식 회신:

```
## PR-1 (consensus schema v50 + persistence, Task 02)
- 변경 라인: +N / -M (roundtable.rs, persist.rs, prompt.rs, migrations/)
- §4 Verification:
  - cargo check: PASS
  - cargo test --lib: 614 → 614 (PR-3 의 신규 test 는 거기서 +4)
  - tsc --noEmit: PASS
  - vitest run: 422 → 422
  - migration v50 dry-run: 기존 roundtable_brief row count 보존 (N → N)
  - PRAGMA user_version: 49 → 50
- §5 e2e 수동:
  - 회귀 시나리오: ✅ 5 라운드 RT 후 roundtable_consensus 누적 / 라운드 N+1 prompt 의 prior consensus 섹션 등장
  - 회귀 가드: ✅ RT 미사용 프로젝트 영향 0 / Voting + MoA 알고리즘 보존 / roundtable_brief memo 보존
- 회귀 grep: rg roundtable_consensus src-tauri/ → 정의+호출 / git diff src/ → 빈 출력
- PR URL: https://github.com/hang-in/tunaFlow/pull/<n>

## PR-2 (RT marker + Architect 인계, Task 03+04)
[같은 형식]

## PR-3 (test + docs, Task 05+06)
[같은 형식]

## DO NOT 영역 침범 없음 확인
- INV-RTC-1 (round 본체 알고리즘 보존): roundtable.rs 의 execute_round 본체 diff 0
- INV-RTC-2 (Voting + MoA 보존): voting/ 모듈 diff 0
- INV-RTC-5 (branchSessionPolicy INV-1~5 보존): branchSession 영역 diff 0
- INV-RTC-7/8 (RT 미사용 영향 0): 빈 결과 시 fast path 검증
- src-tauri/src/commands/meta_agent/ diff 0
- src/ (frontend) diff 0
- README.md / CLAUDE.md diff 0
```

## 8. 막히면

- **synthesizer 가 합의 항목을 structured 추출하는 prompt 정확도 80% 미만** → PR-1 보류, prompt 재설계 (1차: marker 기반 / 2차: JSON 형식). 80% 미만 정확도면 같은 합의 재시도 환각이 fix 후에도 잔존
- **migration v50 의 기존 사용자 데이터 손실 위험** → 즉시 PR-1 보류 + Architect 보고. dry-run 에서 row count mismatch 면 INV-RTC-6 위반, destructive 영역
- **Tier 2 brief / identity-trigger / Rust meta_agent 영역 (DO NOT) 까지 root cause 진단 도달** → frontend / RT 영역 hotfix 보류 + Architect escalate (별 plan)
- **DB migration 영향 task 가 다른 v50 migration 과 충돌** → 별 PR + 영향 0 우선 (현재 main HEAD 의 user_version 확인)
- **분기 조건 광범위 변경 위험** (예: ContextPack assembly 의 모든 섹션 priority 재조정) → "조건 좁히기" 권장. `roundtable_consensus` 빈 결과 시 신규 섹션 skip 만 하고 기존 priority 영역 손대지 말 것
- **mcp `spawnSync /bin/sh ENOENT` 환경 fix 가 본 plan scope 안인 것처럼 보일 때** → DO NOT. 별 axis (P3 plan), 본 plan 은 *RT 합의 영구화* 한정
- **PR-2 의 ContextPack token budget 영향** (RT consensus 섹션 추가 → 다른 섹션 압축) → `build_normalized_prompt_with_budget` 의 priority 분배 영향 측정 → 5% 이상 다른 섹션 잘림 시 priority 재조정 (별 PR 분리 가능)
- **진단 단계가 1시간 timeout** → chat 보고 + Architect escalate. 무리한 우회 금지

## 9. 사용자 답변 정책 (외부 issue #263)

devbug 외부 사용자 답변 주체 / timing:

1. **Plan 머지 직후** (이미 완료, 2026-05-07): Architect 가 issue #263 댓글
   - 보고 감사 + *"RT 사용 포기"* 단계 도달 사과
   - 3 영역 root cause **확정** (DB schema + 코드 path 직접 검증, Plan §0.2.1 인용)
   - fix 진행 timeline: PR-1/2/3 분리 + v0.1.X-beta release 시점
   - 시나리오 SSOT 문서 링크 (`docs/reference/roundtableReproductionScenarios_2026-05-07.md`)
2. **PR-1/2/3 각 머지 직후**: Architect 가 issue #263 진행 댓글 (3건)
   - PR URL + 머지 commit sha + 영역 한 줄
3. **release publish 직후**: Architect 가 issue #263 회복 안내 댓글 + close
   - release URL
   - 회복 안내: *"v0.1.X-beta 자산 재설치 + RT 다시 시도 부탁. 5 라운드 이상 진행해도 같은 합의 재시도 환각 안 일어남 / Architect 에게 'RT 합의 정리해줘' 요청 시 누적 합의 등장 / 단일 에이전트 질의 시 RT 라운드 재실행 환각 차단 — 모두 시나리오 A/B/C 의 기대 동작 매트릭스 일치"*
   - DB migration v50 자동 진행 안내 + 기존 데이터 보존 명시

한국어 본문, 코드 / 경로 / commit sha / PR URL 원문. devbug 외부 보고 batmania52 패턴 (당일 plan + 빠른 회복 + 한국어 + 시나리오 회복 시점 명확). 사용자가 *"RT 사용 포기"* 단계라 회복 안내가 *"다시 시도해보세요"* 톤으로 follow-up 동기 부여.
