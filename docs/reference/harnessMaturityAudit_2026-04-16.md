---
title: Harness Engineering 성숙도 감사 — 2026-04-16
status: active
canonical: false   # 주관적 평가 포함. 수치는 내부 참고용
created_at: 2026-04-16
owner: architect
related:
  - docs/plans/betaReleaseReadinessPlan.md
  - docs/reference/knownIssues_2026-04-15.md
  - docs/ideas/rtAlgorithmEnhancementIdeas.md
---

# Harness Engineering 성숙도 감사 (2026-04-16 스냅샷)

## 0. 왜 이 문서인가

"Harness Engineering" = LLM 에이전트가 일할 수 있도록 만드는 **작업 환경 전체의 설계**.
훅 / 트리거 / 피드백 루프 / 관찰성 / 샌드박스 / 평가 / retry/timeout 정책 등.

모델 품질이 아무리 좋아도 하네스가 부실하면 에이전트는 방향을 잃는다.
반대로 하네스가 두꺼우면 약한 모델로도 상당한 작업을 안정적으로 돌릴 수 있다.

이 문서는 tunaFlow 의 현재 하네스 상태를 **축별로 점수화**하고 다음 투자 우선순위를 결정하기 위한 스냅샷이다. 평가 기준은 일부 주관이므로 `canonical: false`.

---

## 1. 축별 실측 — 현재 있는 것

### 1.1 워크플로우 오케스트레이션 ✅ 상급
- `plan_events` 이벤트 테이블: `impl_completed` / `review_passed` / `review_failed` / `rework_requested` / `doom_loop_escalated` / `design_review_suggested` / `architect_redesign_requested`
- Plan → Dev → Review 자동 흐름 (`workflow_orchestration.ts`)
- RT (Roundtable) sequential / deliberative 모드 지원
- Branch 기반 분기·adopt 흐름

### 1.2 피드백 루프 / 에스컬레이션 ✅ 상급
- **Doom loop 감지**: 같은 파일 연속 fail → `design_review_suggested` 자동 기록
- 3회 초과 → `doom_loop_warning`, 5회 초과 → `doom_loop_escalated` (강제 subtask_review)
- 연속 fail finding 의 텍스트 overlap ratio 계산 (50% 넘으면 설계 문제로 분류)
- **Failure learning**: `review_failed` 이벤트 → `failure_lessons` DB 저장 → 다음 rework 시 유사 실패 자동 쿼리 후 Developer 프롬프트에 "Previous Similar Failures" 섹션 주입

### 1.3 Agent-as-Judge ✅ 상급
- Review RT 시작 전 `run_project_tests` 자동 실행
- 결과(stdout/stderr)를 `testOutput` 으로 담아 Reviewer 프롬프트에 `## 테스트 결과` 섹션 주입
- Developer 자기보고가 아닌 **도구 결과 기반 판정**
- 5차원 루브릭 채점 (plan_coverage / code_quality / test_coverage / doc_quality / convention)

### 1.4 Post-completion 자동 훅 ✅ 중상
- `on_run_completed` 커맨드가 매 완료 후 3-stage 실행:
  1. Memory compression (Haiku 사용, Opus 쿼터 출혈 차단됨)
  2. Session link discovery (FTS + rawq embed)
  3. Vector indexing (NULL chunk 자동 복구 — I1 Fix 1 반영)
- Embed semaphore 로 concurrent ONNX 호출 제한

### 1.5 Tool-request 마커 (CLI function calling 우회) ✅ 중
- `<!-- tunaflow:tool-request -->` 마커로 에이전트가 도구 호출 요청
- `extractToolRequests` → `executeToolRequests` → follow-up 자동 재송신
- CLI subprocess 환경에 function calling 프로토콜이 없어서 개발한 우회로
- 정석 아니지만 제약 하에서 합리적. PoC 이후 찐빠 없었음

### 1.6 Context Assembly (ContextPack) ✅ 중상
- `build_normalized_prompt_with_budget()` 단일 경로 (4-engine parity)
- 다축 주입: agent_role / persona / plan / findings / artifacts / retrieval / compressed-memory / cross-session / rawq / CRG
- Lite / Standard / Full auto mode (메시지 수 기반 휴리스틱)
- 동적 예산 배분 (총 토큰 cap → 섹션별 분배)

### 1.7 Observability ✅ 중상
- `trace_log` 테이블에 모든 agent.stream / roundtable.* / agent.send span 기록
- OTel 호환 컬럼 (trace_id, span_id, parent_span_id, operation, duration_ms, status, context_mode, context_length)
- `insert_trace_log` err 분기도 커버 (오늘 추가)
- Frontend TracePanel 에서 aggregate + sparkline 표시
- 관련 문제: 집계 수치 혼재 (agent.stream vs roundtable.participant span 섞임) — I14

### 1.8 자동 복구 / 백필 ✅ 중상
- 앱 시작 15초 후 `spawn_startup_backfill` → NULL embedding 보유 conversation 자동 재인덱싱
- 문서 chunk 도 자동 백필 (NULL 감지 시 wipe + reindex)
- fs watcher 로 rawq 자동 재인덱스

### 1.9 Cancel / Retry ⚠️ 중
- `CancelRegistry` 로 실행 중 취소 가능
- 300ms poll 기반 cancel flag 체크 (project_onboarding, agent stream)
- **부족**: dynamic timeout 없음. retry backoff 없음. 에이전트 무응답 시 그냥 기다림 (agent-timeout 10분 하드 kill 만 있음)

### 1.10 Insight 자동 수집 ✅ 중
- Plan done → findings resolved 자동 연결
- `tool-request:insight` 핸들러
- 근데 insight 분석 자체는 수동 트리거 상당수

### 1.11 Cross-agent orchestration ✅ 상급
- RT sequential/deliberative
- Plan handoff (Architect → Developer → Reviewer 에이전트 분리)
- Blind verifier 설정 필드 (`blind: true`) 존재 (실제 강제 로직은 Phase 2)

---

## 2. 부족한 축

### 2.1 Sandbox 격리 ❌ 하
- CLI 에이전트가 host OS 에 직접 접근
- `--full-auto` / `--dangerously-skip-permissions` 켜지면 CLI 자체 approval 무력화
- `guardrail.rs` 는 **프롬프트 크기 제한**이지 샌드박스 아님 (Gemini 가 오해했던 지점)
- 로컬 인디 AOC 라서 합리적 포지셔닝이긴 하나, 위험 CLI 플래그 감지 + 경고 배너는 있어야 함 (I5)

### 2.2 Regression Evaluation Harness ❌ 하
- 5차원 루브릭은 **판정용**이지 평가 세트 아님
- 정해진 task set 을 엔진 조합별로 돌려 품질 변화를 추적하는 regression suite 없음
- 프롬프트 변경 / 모델 업그레이드 / ContextPack 튜닝의 영향을 정량 측정할 수단 부재

### 2.3 Pre-commit / lint 자동 훅 ❌ 하
- CI (self-hosted Linux runner) 에서만 체크
- 로컬 커밋 전에 `cargo check` / `tsc --noEmit` / `vitest run --changed` 자동 실행 없음
- `.git/hooks/pre-commit` 없음
- 에이전트가 로컬에서 잘못된 코드 만들어도 push 전엔 모름 → CI 실패로만 발견

### 2.4 Dynamic permission / retry backoff ❌ 하
- tool permission 이 정적. 세션 단위 bypass 없음 (CLI 자체 approval 의존)
- Retry policy 없음. 실패 = 실패, 자동 재시도 없음
- 네트워크/API 플레이키 상황에서 사용자 개입 필요

### 2.5 Cross-project fence ⚠️ 중하
- 단일 DB 사용 (분리 플랜 있음 — `perProjectDatabaseSplitPlan.md`)
- retrieval 은 project_key 필터로 격리 시도 중 (오늘 수정 C로 자기 대화방 제외 강화됨)
- 하지만 파일 Read 권한은 프로세스 cwd 기반이라 원칙적 격리 아님

### 2.6 Adaptive context window ⚠️ 중
- Lite/Standard/Full auto mode 휴리스틱은 있지만 **엔진별 token limit 실시간 감지** 없음
- 요청이 context limit 에 근접해도 경고만. 자동 요약/점진적 truncation 은 부분적

---

## 3. 축별 점수 (주관)

| 축 | 점수 | 근거 |
|---|---|---|
| Workflow orchestration | 9/10 | plan-dev-review + RT + branch + event table 완비 |
| Feedback loop | 9/10 | doom loop, failure learning, rework targeting |
| Cross-agent orchestration | 9/10 | RT, handoff, role persona |
| Context assembly | 7.5/10 | ContextPack 구조적, budget 일부 수동 |
| Observability | 7/10 | trace_log 탄탄, UI 초기, 일부 집계 혼재 |
| Post-completion hooks | 7/10 | 3-stage 파이프라인, Haiku 분리 |
| Failure handling | 7/10 | err trace 추가, silent drop 제거 중 |
| Agent-as-Judge | 8/10 | test output 자동 주입 + 5차원 루브릭 |
| Tool use harness | 6/10 | 마커 기반, 표준 아님, CLI 제약 하 합리적 |
| Cancel/retry/timeout | 4/10 | cancel 만 정상, retry/dynamic timeout 없음 |
| Evaluation harness | 3/10 | 루브릭만, regression suite 없음 |
| Sandbox/isolation | 2/10 | CLI 의존, 없음 |
| Cross-project fence | 4/10 | 단일 DB, 필터 기반 격리 |
| Adaptive context | 5/10 | auto mode 있으나 제한적 |

**가중 평균 ≈ 6.3 / 10**

---

## 4. 포지셔닝 (상용 대비)

| 영역 | tunaFlow | OpenHands/Devin 류 | Cursor Background 류 |
|---|---|---|---|
| 워크플로우 루프 | 🟢 강점 | 비슷하거나 약함 | 없음 (단발) |
| Failure learning | 🟢 강점 | 부분 | 없음 |
| 이종 에이전트 RT | 🟢 강점 | 없음 | 없음 |
| Sandbox 격리 | 🔴 약점 | 🟢 강점 (컨테이너) | 🟢 강점 (cloud) |
| Regression eval | 🔴 약점 | 부분 | 있음 |
| Dynamic retry | 🔴 약점 | 🟢 강점 | 🟢 강점 |
| Cost / 배포 모델 | 🟢 강점 (로컬·구독) | 서버 과금 | 서버 과금 |

**요약**: tunaFlow 는 **"워크플로우 루프 + 멀티 에이전트 + 로컬 구독 기반"** 에서 상용 대비 경쟁력 있음. 반면 **"샌드박스 / 평가 하네스 / 재시도 정책"** 은 격차. 이 격차는 **포지셔닝상 의도된 것도 있고(로컬 인디 도구) 투자 부족인 것도 있음**. 구분하여 접근.

---

## 5. 다음 투자 로드맵 (ROI 순)

### 5.1 즉시 (베타 전, 1~2일)
1. **Pre-commit hook 자동 생성** — CLAUDE.md에 정의된 명령(cargo check / tsc --noEmit) 을 `.git/hooks/pre-commit` 으로 스탬프. install.sh 또는 첫 실행 훅에 편입
2. **Dynamic timeout + 1회 재시도** — 300s 초과 시 자동 1회 retry, 그 뒤 user prompt. agent stream / project_onboarding 두 경로
3. **위험 CLI 플래그 경고 배너** — `--full-auto` / `--dangerously-skip-permissions` 감지 시 UI 경고 (I5)

### 5.2 단기 (베타 직후, 3~5일)
4. **Trace aggregate 정상화** — agent.stream 만 집계, roundtable.* 는 분리 표시 (I14)
5. **Regression eval suite (최소판)** — 5개 정도의 정해진 task (plan 생성 / dev 완료 / review pass / branch adopt / RT) + 메트릭(성공률/tokens/latency) 수집 기반 테이블
6. **Retrieval 로그 preview 개선** — hit_id 의 matching snippet 표시 (I6)

### 5.3 중기 (베타 1~2 피드백 후, 1주 이상)
7. **Per-project DB 분리** — `perProjectDatabaseSplitPlan.md` 진행. cross-project fence 자연스럽게 해결
8. **Conventions Sync Phase 2** — ContextPack 에서 정적 콘텐츠 제거 → 토큰 대폭 절약
9. **Sandbox layer (v1)** — 임시 workspace 디렉토리 + diff-only 머지. 베타 2.x 시점

### 5.4 장기 (Post v0.2)
10. **Meta-agent initial setup** — `metaAgentInitialSetupPlan_2026-04-16.md` 진행 (agent profile / skill / workflow 자동 추천)
11. **Adaptive stopping (RT)** — rtAlgorithmEnhancementIdeas P3. 수렴 감지 시 자동 종료
12. **Voting + MoA Synthesizer** — rtAlgorithmEnhancementIdeas P1. 구조화 투표 집계 + structured reducer

---

## 6. 체크리스트 (향후 감사용)

다음 감사 시 이 항목들을 다시 평가:

- [ ] Pre-commit hook 설치 / 작동?
- [ ] Dynamic timeout + retry 적용?
- [ ] 위험 CLI 플래그 경고 배너?
- [ ] Regression eval suite 존재?
- [ ] Trace aggregate 정상?
- [ ] Per-project DB 분리?
- [ ] Conventions Sync default-on?
- [ ] Sandbox layer v1?
- [ ] Meta-agent initial setup?
- [ ] Adaptive stopping?
- [ ] Voting / Synthesizer?

각 항목 체크 시 점수 재계산해서 성숙도 추이 관찰.

---

## 7. 관련 문서

- `docs/plans/betaReleaseReadinessPlan.md` — 베타 배포 체크리스트
- `docs/plans/betaRtUpgradeSprintPlan_2026-04-15.md` — RT 고도화 sprint (S1~S4)
- `docs/plans/perProjectDatabaseSplitPlan.md` — DB 분리 (베타 후)
- `docs/plans/conventionsContextSyncPlan.md` — ContextPack 정적 컨텐츠 분리
- `docs/plans/metaAgentInitialSetupPlan_2026-04-16.md` — 메타에이전트 초기 구성
- `docs/ideas/rtAlgorithmEnhancementIdeas.md` — RT 알고리즘 강화 (P0~P3)
- `docs/reference/knownIssues_2026-04-15.md` — 현 이슈 체크리스트 (I1~I10 + I11/12/14)
- `docs/reference/geminiCriticReview_2026-04-15.md` — 외부 LLM 리뷰 분석
