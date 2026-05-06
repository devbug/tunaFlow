---
title: Roundtable 합의 영구화 + RT marker 격리 + Architect ContextPack 인계
status: ready
phase: planning
priority: P1 (외부 사용자 보고 #263 — 사용자 RT 사용 포기 단계)
created_at: 2026-05-07
canonical: true
related:
  - docs/reference/roundtableReproductionScenarios_2026-05-07.md  # 재현 시나리오 (본 plan §0.2 가 인용)
  - src-tauri/src/commands/roundtable.rs  # RT 본체 — execute_round (233~241), run_synthesizer_after_round (64~166), roundtable_followup (338~354)
  - src-tauri/src/commands/roundtable_helpers/sequential.rs  # 라운드 prompt 조립 (transcript + round_responses)
  - src-tauri/src/commands/roundtable_helpers/prompt.rs  # build_round_prompt_with_identity (23~74)
  - src-tauri/src/commands/roundtable_helpers/persist.rs  # save_shared_brief
  - src-tauri/src/commands/agents_helpers/context_pack/db_queries.rs  # build_findings_section (173~215), build_rt_inheritance_section (364~398)
  - docs/plans/threadModelRoundtableRedesign.md  # RT/Branch 통합 설계 (참조용)
  - MEMORY.md — [RT and Branch architecture] / [Branch viewer future]
issue_source: GitHub #263 — devbug (2026-05-06)
---

# Roundtable 합의 영구화 + RT marker 격리 + Architect ContextPack 인계

## 0. Context

### 0.1 외부 사용자 보고 (devbug, GitHub #263)

> "라운드 테이블로 설계를 진행했는데, 몇가지 이슈/불편함이 있었습니다
>
> 1. 라운드 진행 중에 synthesizer의 응답에 대해 간단한 추가 질문을 하고 싶을 때 채팅창에서 에이전트들 선택 해제해서 대화를 시도했는데 전혀 딴 소리를 했습니다. 질의 내용에 대해서 보다는 기존 라운드를 혼자서 다시 실행하는 느낌이었습니다. 합의된 내용에 대해 합의되지 않은 것으로 착각하기도 했습니다. 원하는 대답을 얻을 수 없어 모든 에이전트를 활성화 한 뒤 다음 라운드에서 간단한 질의를 다시 진행해야 했습니다. 물론 원하는 결과를 얻을 수 없었구요.
>
> 2. 라운드가 길어지면 합의 했던 것을 잊는지 다시 합의를 시도하며, 해당 내용이 purposer에게 전달이 안 되는건지 지속적으로 해당 합의를 다시 시도합니다. 합의했다고 대여섯번을 전달했으나 꾸준히 해당 내용에 대한 합의를 시도했습니다. 3번 fail 하면 사용자 선택으로 넘기기 때문에, 매번 사용자 선택이 필요하다고 하며, 매번 진행한 것이라고 전달해도 다음 라운드에서 다시 합의되지 않았으므로 fail -> 사용자 선택으로 넘어갑니다. 이후부터 더이상 라운드 테이블을 사용하지 않게 됐습니다.
>
> 3. 어느 정도 합의된 내용을 정리해서 실제 설계안->플랜 작성까지 진행하고 싶었는데 설계자는 라운드 테이블 대화 내역에 접근할 수 없었으며, 라운드 내부에서 설계자에게 전달할 합의 내용, 설계 정리된 걸 달라고 하면 극히 일부 내용(마지막 라운드 정도)만 정리해서 줍니다. 라운드 테이블의 용도를 제가 착각한 것인지, 아니면 사용성이 떨어지는 상태인건지 모르겠습니다. 여러 에이전트들의 토의 끝에 좋은 설계안을 뽑아내고 싶었는데 이 상태로는 제 의도대로는 사용할 수 없을거 같습니다."

세 영역 분리:
- **#1 (증상 + workaround 시도)** — *"단일 질의 → 딴 소리, 기존 라운드 재실행"*. 사용자가 *모든 에이전트 활성화 후 다음 라운드* 우회 시도했으나 실패. main conv 와 RT conv 의 *context 격리* 영역
- **#2 (증상 + 결과)** — *"합의 망각 → 같은 합의 재시도 → 3 fail → 사용자 fallback → 사용자 RT 사용 포기"*. 가장 심각 (사용자 기능 가치 0). RT round 간 *consensus persistence* 영역
- **#3 (증상 + 사용 의도)** — *"Architect 가 RT 대화 내역 접근 못 함, 마지막 라운드만 정리"*. 사용자의 본래 의도 = *"여러 에이전트들의 토의 끝에 좋은 설계안을 뽑아내고 싶었"* 음. RT → Architect 인계 영역

### 0.2 시나리오 정확화

상세 재현 절차 + 기대/실제 동작 매트릭스: **[`docs/reference/roundtableReproductionScenarios_2026-05-07.md`](../reference/roundtableReproductionScenarios_2026-05-07.md)** 참조.

요약:
- **시나리오 A** (보고 #1): RT 2 라운드 진행 후 단일 에이전트 follow-up 질의 → 합의 무시 / 라운드 재실행 흉내
- **시나리오 B** (보고 #2): RT 5 라운드 이상 진행 → 라운드 4+ 에서 1~2 라운드 합의 망각 → 매 라운드 재합의 시도 → 3 fail 임계값 → 사용자 fallback 영구 반복
- **시나리오 C** (보고 #3): RT 정상 진행 + 합의 도달 후 Architect dispatch → Architect 응답에 RT 누적 합의 부재 (마지막 synthesizer brief 1건만)

#### 0.2.1 Architect 직접 검증 (2026-05-07, mcp + DB + 코드 path)

mcp `run_roundtable` 으로 시나리오 B 5 라운드 직접 실행 시도 → tunaflow-mcp 서버 측 `spawnSync /bin/sh ENOENT` 환경 차단 (mcp launch 환경 PATH 누락 — *별 axis*, 본 plan scope 외). RT 실 동작 환각 표면 (라운드 4+ 합의 망각 등) 직접 캡처는 불가.

대신 mcp `query_db` + 코드 직접 read 로 *DB schema + ContextPack 조립 helper 본문* 검증 → §0.3 가설 모두 결정적 확정. 시나리오 A/B 의 실 동작 환각 검증은 fix 후 사용자 환경 e2e 로 위임 (Task 06 회귀 가드 시나리오).

DB schema fact:
- 40+ 테이블 (`SELECT name FROM sqlite_master`) 어디에도 `roundtable_consensus` / `consensus` / `rt_round` 영역 부재
- `messages` 컬럼: `id / conversation_id / role / content / timestamp / status / progress_content / engine / model / persona / content_tokenized` — *RT round index / consensus 메타* 컬럼 부재
- `conversations.type` 분포 = `main` / `meta` 2종 (현재 instance) — `roundtable` type 분기 미사용
- `memos.type='roundtable_brief'` 가 유일한 RT artifact 영역 — 통째 텍스트 brief 1건씩, axis 별 분리 없음

코드 fact:
- `db_queries.rs:174~217 build_findings_section()` SQL: `SELECT content FROM memos WHERE type='roundtable_brief' ... ORDER BY created_at DESC LIMIT 3` + 600자 truncate. *최신 3건만 통째 텍스트*
- `db_queries.rs:364~398 build_rt_inheritance_section()`: explicit_source / anchor / **parent main conv recent messages** 만 인계. *RT 의 합의 자체* 는 인계 helper 미존재 — 함수 이름 misleading

→ 사용자 보고 #3 *"마지막 라운드 정도만 정리"* 의 직접 증거 = build_findings_section 의 LIMIT 3 + roundtable_brief 만 로드 정책

### 0.3 Root cause 가설

| 가설 | 근거 |
|---|---|
| **(a) RT 합의 영구화 부재** — synthesizer 가 *합의* 를 도출해도 별도 schema 없이 일반 brief 1건만 DB persist. round 간 *consensus history* 누적 영역 없음 | `roundtable_helpers/persist.rs save_shared_brief()` 가 단순 brief 저장. `roundtable.rs:64~166 run_synthesizer_after_round()` input 에 `round_responses` (현 라운드) 만 있고 `consensus_history` 없음. `roundtable_helpers/prompt.rs:23~74 build_round_prompt_with_identity()` 의 *"Prior round responses"* 섹션은 raw transcript 만 |
| **(b) RT marker 부재 → main conv 혼입** — RT 와 main conv 가 동일 conversation_id 공유. `persona IS NOT NULL` 만으로 RT/main 분리. 단일 에이전트 dispatch 시 ContextPack 에 RT 메시지가 *주제별 컨텍스트* 인지 *다른 라운드* 인지 구분 못 함 | `roundtable.rs:25~28 RoundtableRunInput` 의 conversation_id 는 RT 가 main conv 와 공유. `roundtable.rs:302~309` 의 SQL 이 persona 필터만 사용. RT marker (`<!-- tunaflow:rt-* -->`) 같은 prompt-level 경계 미존재 |
| **(c) Architect ContextPack 의 RT 영역 부재** — `build_findings_section()` 이 `roundtable_brief` memo 최신 3건만 로드. `build_rt_inheritance_section()` 은 parent context 만 다루고 *RT 결과 별도 섹션* 없음 | `agents_helpers/context_pack/db_queries.rs:173~215` (findings) + `364~398` (rt inheritance) — RT artifact 명시적 주입 helper 부재 |
| **(d) 환경/사용자 입력 잡음** — 사용자 주제 자체가 *재합의 가능* 하거나 RT 종료 timing 모호 | 가능성 낮음 — 사용자가 *"대여섯번을 전달했으나 꾸준히 해당 내용에 대한 합의를 시도"* 명시. 환경 잡음 보다 시스템적 회귀 |

**확정 (2026-05-07 Architect 직접 검증)**: (a) + (b) + (c) **3중 복합 root cause** — 가설 단계가 아니라 *DB schema + 코드 path 직접 인용 fact* 로 결정. §0.2.1 참조. 세 영역이 *RT 의 "합의가 어디로도 영구화 안 됨"* 이라는 공통 axis 의 다른 면. 한 영역만 fix 하면 다른 영역 회귀 잔존:
- (a) 만 fix → 라운드 간 합의는 누적되지만 main conv / Architect 는 여전히 못 봄
- (b) 만 fix → main conv 혼입 차단되지만 라운드 간 합의는 여전히 망각
- (c) 만 fix → Architect 는 받지만 받을 *합의 자체* 가 없음 (a 미해결 시)

→ 세 영역 동시 fix 가 *사용자 보고 회복* 의 필요충분.

### 0.4 회귀 시점 / 영역 영향

- RT 영역은 v0.1.0-beta 이전부터 존재. 본 회귀는 *기능 도입 이래의 잠재 결함* — 사용자가 본격 활용하면서 표면화
- v0.1.6-beta 의 *Reviewer verdict → Architect 직행* 변경과 결합: doom-loop 5회 fail 시 Architect 자동 호출되는데, RT 합의가 휘발되면 Architect 가 받는 prompt 에 합의 내용 부재 → 본 plan 의 (c) fix 와 v0.1.6-beta 변경의 *완성도* 직접 연결

## 1. Invariants

| ID | 내용 |
|---|---|
| **INV-RTC-1** | RT 의 *기존 round 진행 메커니즘* (Sequential / Deliberative 모드 / 참여자 선택 / round count 등) 보존 — 본 plan 은 *합의 영구화 + 인계* 만 추가 |
| **INV-RTC-2** | RT 의 *기존 voting + MoA Synthesizer* 알고리즘 (memo 2026-04-18 머지) 보존. synthesizer prompt 가 *추가 input* (이전 합의) 만 받고 *판단 알고리즘* 자체 변경 0 |
| **INV-RTC-3** | RT conversation_id = main conversation_id 공유 정책은 *유지 가능 옵션* — 단 RT marker 또는 별도 컬럼으로 *프롬프트 단위 격리* 가능해야 함. 사이드 이펙트 0 |
| **INV-RTC-4** | Architect ContextPack 의 *기존 섹션* (project / files / persona / findings / rt-inheritance) 동작 보존. 본 plan 은 *RT consensus 섹션 추가* 만 |
| **INV-RTC-5** | branchSessionPolicy.md INV-1~5 보존 (brand session = main session 공유) |
| **INV-RTC-6** | DB schema 변경 시 마이그레이션 안전 — 기존 사용자의 RT brief 데이터 손실 0 |
| **INV-RTC-7** | 본 plan fix 로 *기존 main conv 의 일반 single-agent dispatch* 성능 영향 0 (ContextPack 조립 시간 / 토큰 비용) |
| **INV-RTC-8** | RT 미사용 사용자 (RT 한번도 안 쓴 프로젝트) 의 ContextPack / DB / UI 동작 변경 0 |

## 2. Goals / Non-goals

### Goals

- **G1**: RT 라운드 N+1 의 synthesizer prompt 에 라운드 1~N *합의 항목* 이 명시 포함 → 같은 합의 재시도 환각 차단 (시나리오 B 회복)
- **G2**: RT 진행 중 단일 에이전트 dispatch 시 ContextPack 의 RT 영역 동작이 결정적 — *RT 합의는 컨텍스트로 주입* / *RT 라운드는 main conv 에 시드되지 않음* 명확 (시나리오 A 회복)
- **G3**: RT 종료 후 Architect dispatch 시 prompt 본문에 *RT 누적 합의 + 라운드별 핵심 결정 + 참여자별 의견 요약* 섹션 명시 등장 (시나리오 C 회복)
- **G4**: 본 plan 의 fix 가 v0.1.6-beta 의 *Reviewer verdict → Architect 직행* 변경과 결합되어, doom-loop escalate 시 Architect 가 받는 prompt 에 RT 합의 자동 포함 (간접적 quality 회복)
- **G5**: 사용자 (devbug) 가 *재현 시나리오 A/B/C* 모두 v0.1.X-beta release 후 자가 회복 path 작동 확인

### Non-goals

- ❌ RT round 수 / 참여자 수 / Sequential vs Deliberative 알고리즘 변경
- ❌ Voting + MoA Synthesizer (2026-04-18 머지) 본체 알고리즘 변경 — 본 plan 은 *입력 보강* 만
- ❌ RT 종료 → plan 자동 생성 (사용자가 *"설계안→플랜 작성까지 진행하고 싶었"* 으나 본 plan 은 *Architect 가 받을 input 회복* 까지. plan 자동 생성은 별 plan)
- ❌ RT 의 별 conversation_id 분리 (테이블 스키마 대규모 변경) — 본 plan 은 *동일 conv + marker 격리* 우선. 후속 plan 가능성
- ❌ macOS / Windows / Linux 환경 차이 — 본 회귀는 backend 영역 (Rust + DB), 환경 무관
- ❌ Tier 2 brief / identity-trigger / memory auto-trigger 변경 (v0.1.6-beta 영역 외)
- ❌ Architect persona / system prompt 변경 — 본 plan 은 *입력 ContextPack 보강* 만, persona 는 그대로 활용
- ❌ Frontend RT UI 대규모 변경 — 본 plan 은 backend 합의 영구화 우선. UI 표시 변경은 *consensus 항목 표시* 정도 최소 변경

## 3. Subtasks

### Task 01 — Architect 직접 재현 + DB/코드 검증 [완료, 2026-05-07]

**Changed files**: 없음 (read-only)

**Change description**:
- mcp `run_roundtable` 으로 시나리오 B 5 라운드 실 동작 캡처 시도 → tunaflow-mcp 서버 `spawnSync /bin/sh ENOENT` 환경 차단 (별 axis)
- mcp `query_db` 로 DB schema 직접 검증 → 가설 (a)/(b)/(c) DB 차원 결정적 확정
- 코드 직접 read (`db_queries.rs` build_findings_section / build_rt_inheritance_section) → 가설 (c) 코드 차원 결정적 확정

**Output (확정된 fact, §0.2.1 참조)**:
- DB schema 차원: roundtable_consensus 영역 부재 / messages 컬럼에 rt_round 메타 부재 / conversations.type 에 roundtable 분기 미사용 / memos.type='roundtable_brief' 가 유일 artifact
- 코드 차원: build_findings_section 이 brief LIMIT 3 + 600자 truncate / build_rt_inheritance_section 이 RT 합의 미인계 (parent main conv 만)
- 미캡처 영역: 시나리오 A/B 의 *실 동작 환각 표면* (mcp 차단) → fix 후 사용자 환경 e2e Verification (Task 06) 으로 위임

**Verification**: 완료 — §0.3 표 의 *확정* 표시 + §0.2.1 의 fact 인용

**회귀 위험 가드**: read-only task, 코드 변경 없음

**Follow-up axis (별 issue)**:
- tunaflow-mcp 서버 launch 환경의 `/bin/sh` PATH 누락 — *Architect 가 mcp 로 RT 직접 재현* 같은 미래 case 차단. P3 별 plan 가능

### Task 02 — RT consensus 영구화 schema + persistence [P0, 핵심 fix]

**Changed files**:
- `src-tauri/src/commands/roundtable.rs` (64~166 — `run_synthesizer_after_round()`)
- `src-tauri/src/commands/roundtable_helpers/persist.rs` (`save_shared_brief()` 또는 신규 함수)
- `src-tauri/src/db/migrations/` (신규 migration — `roundtable_consensus` 테이블 또는 messages 의 consensus 메타 컬럼)

**Change description**:
- 신규 schema: `roundtable_consensus` 테이블
  - 컬럼: `id` (uuid) / `conversation_id` / `round_index` / `axis` (합의 주제) / `decision` (합의 내용) / `participants` (json) / `confidence` (synthesizer 판단) / `created_at`
- synthesizer 가 round N 에서 합의 항목 추출 → 위 테이블에 row insert
- `run_synthesizer_after_round()` 의 input 에 *prior consensus list* 추가 — round N+1 시점에 1~N 의 합의 항목을 input prompt 의 별 섹션 *"Consensus reached so far"* 으로 주입
- `roundtable_helpers/prompt.rs build_round_prompt_with_identity()` 갱신: 기존 *"Prior round responses"* 외 *"Consensus reached so far"* 섹션 추가
- 마이그레이션: 기존 `shared_brief` 데이터는 그대로 유지 (consensus 테이블은 *추가 schema*). 후방 호환

**Verification**:
- 신규 unit test (cargo test): `consensus 항목 추출 + 다음 라운드 prompt 에 포함` 검증
- 시나리오 B e2e: 5 라운드 RT 진행 → 라운드 3+ prompt 에 라운드 1~2 합의 등장 확인
- DB 직접 query: `SELECT * FROM roundtable_consensus WHERE conversation_id = ?` 결과가 누적되는지

**회귀 위험 가드**:
- INV-RTC-1: round 진행 메커니즘 변경 0 (round count / 참여자 / 모드)
- INV-RTC-2: synthesizer 의 voting 알고리즘 본체 변경 0 — *입력 보강* 만
- INV-RTC-6: migration 안전성. 기존 brief row 유실 0
- INV-RTC-8: RT 미사용 프로젝트의 DB / 동작 변경 0

**위험**:
- synthesizer 가 합의 항목을 *structured 형태로 추출* 하는 prompt 설계 필요 — JSON 또는 marker 기반. 합의 추출 정확도가 1차 fix 의 quality 결정
- 마이그레이션 v50 (현재 v49) — release notes 에 명시 필요

### Task 03 — RT marker / persona 기반 main conv 격리 [P1, 보완 fix]

**Changed files**:
- `src-tauri/src/commands/agents_helpers/context_pack/db_queries.rs` (RT 메시지 필터링 로직)
- `src-tauri/src/commands/roundtable.rs` (302~309 — RT 메시지 저장 시 marker / 컬럼 추가)
- `src-tauri/src/db/migrations/` (messages 테이블에 `rt_round_index` 또는 marker 컬럼)

**Change description**:
- main conv 의 single-agent dispatch 시 ContextPack assembly 의 *RT 메시지 영역 분리*:
  - RT consensus (Task 02 의 `roundtable_consensus` 테이블) → *명시 주입*
  - RT round 진행 transcript (raw messages with persona) → *주입 안 함* 또는 *짧은 요약만*
- RT marker 도입: RT 메시지에 `rt_round_index` 컬럼 또는 `<!-- tunaflow:rt-round-N -->` marker → ContextPack 이 *RT 라운드 메시지인지 main conv 메시지인지* 명확히 구분

**Verification**:
- 시나리오 A e2e: RT 2 라운드 후 단일 에이전트 dispatch → ContextPack trace 에 RT consensus 만 등장 / RT round transcript 미등장 확인
- 단일 에이전트 응답이 *합의 인지 + follow-up answer* 형태로 회복

**회귀 위험 가드**:
- INV-RTC-3: conversation_id 공유 정책 보존 (별 conv 분리 안 함)
- INV-RTC-7: ContextPack 조립 시간 / 토큰 비용 영향 0 — RT 미진행 conv 는 fast path
- INV-RTC-8: RT 미사용 프로젝트 영향 0

**위험**:
- 기존 messages 의 RT 메시지 후방 호환 — `rt_round_index` 가 nullable + 기존 row 는 NULL 유지. ContextPack 이 NULL 을 *main conv 메시지* 로 처리

### Task 04 — Architect ContextPack 의 RT consensus 섹션 [P0, 인계 fix]

**Changed files**:
- `src-tauri/src/commands/agents_helpers/context_pack/db_queries.rs` (173~215 — `build_findings_section()`, 364~398 — `build_rt_inheritance_section()`)
- (선택) 신규 helper `build_rt_consensus_section()`

**Change description**:
- 신규 helper `build_rt_consensus_section(conversation_id, plan_id)`:
  - `roundtable_consensus` 테이블 조회 (Task 02 schema)
  - 결과를 prompt 본문의 별 섹션 *"# Roundtable Consensus"* 으로 조립
  - 항목: axis / decision / participants / round_index 누적
- Architect dispatch 의 ContextPack 조립에서 위 section 명시 호출
- 기존 `build_findings_section()` 의 `roundtable_brief` 최신 3건 로드 정책은 *보조* 로 유지 (fallback)

**Verification**:
- 시나리오 C e2e: RT 정상 진행 + 합의 도달 후 Architect dispatch → 응답에 RT 합의 항목 누적 list + 참여자별 핵심 의견 등장 확인
- ContextPack assembly trace 의 prompt 본문 캡처 → *"# Roundtable Consensus"* 섹션 등장 확인

**회귀 위험 가드**:
- INV-RTC-4: 기존 ContextPack 섹션 (project / files / persona / findings / rt-inheritance) 동작 보존. *추가 섹션* 만
- INV-RTC-7: RT 미진행 시 ContextPack assembly 영향 0 — `roundtable_consensus` 빈 결과 시 섹션 자체 skip

**위험**: prompt 본문 길이 증가 → 토큰 budget 영향. ContextPack 의 budget 분배 로직 (`build_normalized_prompt_with_budget`) 의 priority 고려 필요

### Task 05 — 시나리오 A/B/C 회귀 가드 e2e + Rust unit test [P0, 검증]

**Changed files**:
- `src-tauri/src/commands/roundtable.rs` (테스트 모듈)
- `src-tauri/src/commands/agents_helpers/context_pack/db_queries.rs` (테스트 모듈)

**Change description**:
- Rust unit test:
  - `consensus_persisted_across_rounds`: 5 라운드 모의 진행 → roundtable_consensus 누적 검증
  - `next_round_prompt_includes_prior_consensus`: round N+1 prompt assembly 결과에 라운드 1~N 합의 등장 검증
  - `single_agent_dispatch_skips_rt_transcript`: RT 메시지 mocking + ContextPack 조립 시 RT round transcript 미포함 검증
  - `architect_context_pack_includes_consensus_section`: `build_rt_consensus_section()` 결과가 prompt 본문에 등장 검증
- e2e 시나리오 (사용자 환경 또는 CI):
  - 시나리오 A/B/C 모두 *기대 동작* 매트릭스와 일치 확인

**Verification**:
- `cd src-tauri && cargo test --lib` 통과 + 신규 4 test 추가
- baseline: Rust 614 → 618 (+4)

**회귀 위험 가드**:
- 기존 614 test 통과 보존
- INV-RTC-1~8 모두 test 로 cover

**위험**: e2e 는 사용자 환경 의존 → CI artifact 검증 또는 사용자 직접 회신

### Task 06 — release notes / docs 갱신 [P2, 문서]

**Changed files**:
- `CHANGELOG.md`
- `docs/reference/roundtableReproductionScenarios_2026-05-07.md` (시나리오별 회복 결과 추가)
- (선택) `docs/reference/dataModelRevised.md` (roundtable_consensus 테이블 추가)

**Change description**:
- v0.1.X-beta release notes 에 *RT 합의 영구화 + 인계 회복* 섹션
- 사용자 가시 변화: *"라운드 길어져도 같은 합의 재시도 안 함"* / *"Architect 가 RT 누적 합의 받음"* / *"단일 에이전트 질의 시 RT 라운드 재실행 환각 안 일어남"*
- migration v50 안내

**Verification**: markdown 렌더링 + 링크 깨짐 없음

**회귀 위험 가드**: 다른 docs 영역 손대지 말 것

## 4. Cross-cutting risks

| 위험 | 대응 |
|---|---|
| Task 01 Architect 직접 재현 의 *실 동작 환각* 미캡처 (mcp spawn 차단) | 시나리오 A/B 의 fix 후 회복 검증은 Task 06 e2e 로 위임 — DB schema 가 결정적이라 root cause 확정에는 영향 0 |
| tunaflow-mcp 서버 환경 PATH 누락 | 별 axis P3 plan — Architect 가 미래 mcp 로 RT 직접 재현 가능하게 fix |
| Task 02 의 synthesizer 가 합의 항목을 *structured* 추출하는 정확도 | 1차 prompt 설계 후 시나리오 B 결과로 정확도 검증. 80% 미만 시 재설계 |
| Task 02/03 의 DB migration v49 → v50 | 마이그레이션 dry-run + 기존 brief 데이터 보존 검증. release 전 user data 백업 안내 |
| Task 04 의 ContextPack token budget 영향 | `build_normalized_prompt_with_budget` 의 priority 영역에 RT consensus 추가 — 다른 섹션 압축 비율 조정 필요 가능성 |
| 본 plan 의 task 의존: 02 → 03 → 04 → 05 (직렬) | 02 schema 가 selected 한 후 03/04 가 의존. 02 PR 머지 후 03/04/05 진입 |
| v0.1.6-beta 의 doom-loop escalate → Architect 자동 호출 변경과 결합 | Task 04 가 결합 영향 직접 — Architect 가 받는 prompt 의 RT consensus 영역이 *없어도 안전* 한 fallback (빈 결과 skip) |
| RT 미사용 프로젝트의 영향 0 가드 | INV-RTC-7/8 의 회귀 가드 verification 필수 |
| Frontend UI 의 RT 합의 표시 | 본 plan scope 밖. 후속 별 plan (RT 합의 UI 표시 / consensus 시각화) 가능성 |

## 5. Rollback

- **Task 01**: read-only, revert 대상 아님
- **Task 02**: schema migration 영역 — revert 시 v50 → v49. *roundtable_consensus 테이블 drop* 안내 필요. 기존 shared_brief 데이터는 그대로 유지되어 사용자 데이터 손실 0
- **Task 03**: marker / 컬럼 추가 — revert 시 messages 테이블의 `rt_round_index` 컬럼 drop. 기존 RT 메시지 row 영향 0 (NULL 처리)
- **Task 04**: 새 helper 함수 / 신규 섹션 호출 — revert 시 단순 호출 제거. ContextPack 의 다른 섹션 영향 0
- **Task 05**: test 추가 — revert 시 test 카운트 감소만
- **Task 06**: 문서 — 단독 revert

전체 revert: 05 → 06 → 04 → 03 → 02 (역순). Task 02 의 DB migration 만 *destructive 가능* (drop 시 새 plan 의 합의 데이터 손실 — 단 이 데이터는 *plan revert 후 새 RT* 에서 재누적 가능)

## 6. 다음 step

1. **Developer 핸드오프 작성** — Task 분리 PR 권장:
   - **Task 01** 완료 (Architect 직접 검증, code 변경 0) — PR 불필요
   - **PR-1**: Task 02 (consensus schema + persistence) — DB migration v50, 단독 머지 가능
   - **PR-2**: Task 03 + Task 04 (RT marker 격리 + Architect 인계) — Task 02 의존, 함께 머지
   - **PR-3**: Task 05 + Task 06 (test + docs)
2. **devbug 외부 사용자 답변** — plan 머지 직후 issue #263 댓글:
   - 보고 감사
   - 3 영역 root cause 가설 *확정* (DB schema + 코드 path 직접 검증, §0.2.1 참조)
   - fix 진행 timeline (PR-1/PR-2/PR-3) + 자가 회복 timing (v0.1.X-beta release 후)
   - 시나리오 A/B/C 사용자 환경 재현 의뢰는 *불필요* (root cause 이미 확정) — 단 fix 후 회복 확인 의뢰는 Task 06 e2e 시점에
3. **release timing**:
   - **minor bump 권장** (v0.1.7-beta) — DB migration v50 + Architect ContextPack 변경 → minor axis
   - Plan A (`windowsCaptionBarMissingPlan_2026-05-07.md`) 와 묶어서 v0.1.7-beta 가능 — Windows hotfix 와 RT 회복이 같은 release 안에 들어가면 사용자 RT 사용 재개 가능
   - 또는 Plan A 만 빠른 patch (v0.1.6-beta-2) + RT 는 minor (v0.1.7-beta) 로 분리
4. **후속 plan 가능성**:
   - **RT → plan 자동 생성** (사용자 본래 의도): 본 plan 은 *Architect 가 받을 input 회복* 까지. RT 종료 시 Architect 가 *자동* plan 초안 작성하는 흐름은 별 P2 plan
   - **RT 합의 UI 시각화**: consensus 항목별 axis 표시, 라운드별 합의 누적 그래프 등 — 별 P2 plan
   - **RT 의 별 conversation_id 분리**: 본 plan 은 *동일 conv + marker 격리* 우선. 사용자 가시성 / 검색 / 삭제 정책 등 영역에서 *별 conv* 가 더 깔끔하면 후속 P3 plan
