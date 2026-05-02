---
title: Entroly 도입 — token compression / multi-resolution context (3 Phase 통합 계획서)
status: ready
phase: planning
priority: P1 (사용자 환경 anchor 2 turns trigger 의 architectural 해결)
created_at: 2026-05-02
canonical: true
related:
  - docs/ideas/entrolyAdoptionIdea_2026-05-02.md  # 본 plan 의 idea SSOT
  - docs/plans/claudeTransportFlipHardeningPlan_2026-04-29.md  # T11/T12 의 architectural 격상 대상
  - docs/ideas/bkitReferenceAdoptionIdea_2026-04-29.md  # Idea A1/A2 의 정량 구현
  - src-tauri/src/commands/agents_helpers/send_common/persistence.rs  # T11/T12 분기 (entroly 가 대체 또는 보강)
  - src-tauri/src/commands/agents_helpers/send_common/prompt_assembly.rs
external_reference:
  repo: https://github.com/juyterman1000/entroly
  license: Apache-2.0  # tunaFlow 호환 ✅
  current_version: 0.10.0
  attribution_required: file header 코멘트 + NOTICE 한 줄
---

# Entroly 도입 계획서

## 0. Context

`entrolyAdoptionIdea_2026-05-02.md` 의 5 영역 (E1~E5) 을 **3 Phase 단계적 roll-out** 으로 구체화. v0.1.4-beta publish 후 첫 cycle ~ v0.2.0 까지의 통합 plan.

### 0.1 도입 동기 (사용자 fact 기반)

- 2026-04-30 사용자 환경에서 **anchor 2 turns content paid API trigger** 발견 → T9~T12 누적 fix (binary drop 정책)
- 사용자 architectural insight: "어차피 DB 에 history 있으니 검색해서 가져옴"
- T11/T12 의 binary drop = *모두 keep 또는 모두 drop* — agent 가 정보 필요 시 round-trip 추가 (tool-request)
- Entroly 의 multi-resolution (L0~L3) = *graceful degradation* + 수학적 (1-1/e) approximation guarantee

### 0.2 Entroly 핵심 fact (검증 필요 영역 §6 명시)

| 항목 | 값 |
|---|---|
| License | Apache-2.0 (tunaFlow 호환) |
| Tech | Rust core (entroly-core 0.10.0) + WASM + Python (PyO3) |
| 주장 효과 | 70~95% token savings, <10ms latency, 100% accuracy retention (n=100) |
| 핵심 모듈 | `conversation_pruner.rs` — Multi-Resolution Causal DAG Pruning, MCKP solver, KKT dual bisection O(120N) |
| 매칭 모듈 | 25 모듈 중 약 18개가 tunaFlow 영역과 직접/간접 매칭 |
| 통합 path | (a) Proxy sidecar (E2, fast) (b) Rust crate direct (E1, refactor) |

## 1. Invariants

| ID | 내용 |
|---|---|
| **INV-EA-1** 🔴 | macOS / Windows / Linux 모든 OS 동일 동작 — entroly_core Rust 라 cross-platform 안전 (검증 후 최종) |
| **INV-EA-2** | Lite mode 호환 — entroly 도입 후 사용자 mode = Lite 선택 시 기존 동작 유지 (entroly bug 시 graceful fallback) |
| **INV-EA-3** | sdk-url path 미영향 (cli mode 한정 도입 첫 단계) |
| **INV-EA-4** | 다른 엔진 (codex/gemini/ollama/lmstudio) 영향 0 첫 단계 — claude path 우선 |
| **INV-EA-5** | Anthropic API 응답 (rate_limit_event, stream-json result event 등) 정상 forward — proxy 모드 시 검증 |
| **INV-EA-6** | accuracy retention — entroly 자체 검증 (n=100) 외 tunaFlow 환경 별도 sample 검증 (50~100 send) |
| **INV-EA-7** | 사용자 prompt 가 entroly 외부로 leak 안 됨 (federation 비활성 default, opt-in only) |
| **INV-EA-8** | tunaFlow 의 기존 `[memory_policy]` log 형식 유지 (사용자 backend log 가독성) |

## 2. Goals / Non-goals

### Goals

- (G1) **사용자 환경 anchor 2 turns trigger 의 architectural 해결** — T11/T12 binary drop 을 4-resolution graceful 로 대체
- (G2) **token cost 70~95% 절감** — 외부 사용자 cost 부담 ↓ → adoption rate ↑
- (G3) **사용자 insight 의 정량 구현** — "DB 에 history 있으니 검색해서 가져옴" → on-demand fetch + multi-resolution
- (G4) **응답 quality 보존** — history 0 잃지 않음 (L3 fingerprint 도 retrieval key)
- (G5) **단계적 roll-out** — Phase 1 (proxy, fast verify) → Phase 2 (direct integration) → Phase 3 (RL/dedup)
- (G6) **PoC 우선** — Phase 1 의 verify 결과로 Phase 2 진행 결정

### Non-goals

- ❌ Anthropic billing 정책 변경 시도 (불가능)
- ❌ federation 의무 활성화 (opt-in only, INV-EA-7)
- ❌ 다른 엔진 (codex/gemini/ollama/lmstudio) 첫 단계 도입 (claude 우선, 검증 후 확대)
- ❌ tunaFlow 의 기존 ContextPack 정책 (Lite/Standard/Full 분기 자체) 변경 — entroly 가 *추가 layer* 또는 *대체 path*
- ❌ Tauri 2.x 의 다른 plugin / dependency 변경

## 3. Phase 분해

### Phase 1 — Entroly Proxy 모드 PoC (E2, P0 fast track)

**Target**: 사용자 환경에서 entroly proxy 가 *정상 동작* 확인. tunaFlow 코드 변경 최소.

**Time**: 1~2일 (PoC + 검증)

**Tasks**:

#### EA-1.1 — entroly proxy sidecar binary 빌드/번들

- `~/privateProject/_research/_util/entroly` 의 빌드 절차 확인 (`pip install entroly` 또는 wasm + npm)
- `src-tauri/binaries/entroly-{triple}` 형식으로 sidecar 등록 (rawq 패턴 동일)
- `tauri.conf.json` 의 `externalBin` 에 추가
- `scripts/build-entroly.sh` 신규 (build-rawq.sh 패턴)

**Verification**:
- `npm run tauri dev` 시 sidecar 자동 spawn 확인
- entroly proxy port (9377) listening 확인 (`lsof -i:9377`)
- macOS / Windows / Linux 빌드 성공

**위험**:
- entroly 의 build 절차가 Rust + WASM 복합이라 sidecar 빌드 복잡도 ↑
- daemon mode 자원 부담 (~10ms latency, RAM)

#### EA-1.2 — engine별 base_url redirect 분기

- `agents/claude.rs` 의 `Command::new("claude")` 호출 직전에 env var 추가:
  ```rust
  cmd.env("ANTHROPIC_BASE_URL", "http://localhost:9377");
  ```
- 사용자 settings 에 `entroly_proxy_enabled` 토글 (기본 false — 안전)
- 활성화 시만 redirect, 비활성 시 기존 path

**Verification**:
- entroly_proxy_enabled = true 시 backend log 에 `[entroly] proxy redirect: ...` 표시
- 비활성 시 기존 cli 직접 호출 동작

**위험**:
- claude 의 stream-json 응답이 entroly 통과 후 깨지는지 (rate_limit_event / result.is_error 등 specific payload)
- localhost proxy 차단 환경 (firewall) → fallback 필요

#### EA-1.3 — PoC 검증 시나리오

- 사용자 환경 seCall main (Auto 모드) 에서 entroly_proxy_enabled = true 후 send
- 기대: paid API trigger 회피 + 정상 응답
- 비교 fact:
  - 비활성 시 prompt_chars + 응답 quality
  - 활성 시 prompt_chars (기대 ~30% 감소) + 응답 quality (entroly 의 100% accuracy 검증)
- backend log 의 `[entroly]` 흔적 확인

**Verification metrics**:
- token cost / send: 사용자 측정
- 응답 quality: 50 sample send 후 사용자 평가 (정상 / 부분 손상 / 손상)
- entroly daemon stability: 1시간 연속 실행 후 OOM / crash 없음

**Phase 1 Exit 조건**:
- ✅ proxy mode 정상 동작 (비활성 시 회귀 0, 활성 시 cost 절감 확인)
- ✅ Anthropic stream-json 호환 (rate_limit_event, result event 등)
- ✅ 사용자 환경 PoC 통과

Exit 통과 시 → Phase 2 진행. 실패 시 → Phase 1 디버깅 또는 E1 (direct integration) 으로 fallback.

### Phase 2 — Direct Integration (E1 + E4, v0.1.6-beta 또는 v0.2.0)

**Target**: tunaFlow 의 ContextPack assemble 을 entroly_core::conversation_pruner 로 *직접 호출*. T11/T12 binary drop 분기 대체.

**Time**: 1~2주 (refactor + 검증)

**Tasks**:

#### EA-2.1 — entroly-core Cargo dependency 추가

- `src-tauri/Cargo.toml`:
  ```toml
  entroly-core = { git = "https://github.com/juyterman1000/entroly", branch = "main" }
  ```
- 또는 vendor 방식 (`vendor/entroly-core` 자동 clone, rawq 패턴 동일)
- `extension-module` feature off (Tauri Rust binary 라 PyO3 link 부담 회피)
- `cargo check` + 모든 OS 빌드 검증

**위험**:
- entroly-core 가 PyO3 + libpython link 시도 시 Tauri 빌드 실패. feature off 로 회피.
- crates.io 미등록 가능성 → git dependency 또는 vendor

#### EA-2.2 — `prompt_assembly.rs::assemble_prompt` refactor

- ContextData 의 모든 layer (plan / artifacts / findings / retrieval / compressed_memory / current_messages / parent_messages) 를 entroly_core::conversation_pruner::Block 형식으로 변환
- entroly 의 `prune(blocks, budget, utilization)` 호출
- 결과 (L0~L3 mix) 를 prompt 으로 inject
- T11/T12 의 binary drop 분기 *제거* (entroly 가 대체)
- `[memory_policy]` log 형식 유지 — entroly 결과를 기존 형식으로 mapping

**Change scope**: ~200~400 LoC refactor + 100 LoC adapter

**위험**:
- DAG coherence — tunaFlow 의 plan/artifact reference 가 entroly dependency model 과 align 필요
- 기존 ContextPack mode (Lite/Standard/Full) 와의 분기 통합

#### EA-2.3 — Response distillation (E4)

- `claude.rs::stream_run` 의 `on_chunk` 콜백 안에서 distillation 적용
- entroly 의 lite/full/ultra 3 levels — 사용자 settings 토글
- code blocks 미터치 (entroly 안전 정책)
- 기본 OFF (사용자 명시 ON 시만)

**Change scope**: ~100 LoC + settings UI 토글

#### EA-2.4 — A/B 검증 (Phase 1 vs Phase 2)

- 같은 prompt 으로 Phase 1 (proxy) vs Phase 2 (direct) 응답 비교
- 100 sample 정확도 측정
- prompt_chars 비교 (Phase 2 가 더 정밀할 가정)
- latency 비교

**Phase 2 Exit 조건**:
- ✅ accuracy retention 100% 검증 (n=100, tunaFlow 환경)
- ✅ Phase 1 보다 prompt_chars 더 작음 또는 응답 quality 더 좋음
- ✅ 모든 OS 빌드 성공
- ✅ DAG coherence 검증 (plan reference 깨지지 않음)

### Phase 3 — Advanced (E3 + E5, v0.2.0+)

**Target**: PRISM RL learning loop + semantic dedup. 별 product 영역.

**Time**: 1~2개월 (별 plan 가치)

**Tasks**:

#### EA-3.1 — PRISM RL integration (E3)

- entroly_core::prism::Learning 모듈 + tunaFlow trace 데이터 결합
- *실제 응답 quality* (사용자 만족 / agent rework / verdict 결과) 를 reward signal
- ContextPack mode 의 layer 선택을 RL 으로 최적화
- "Day 1 70% → Day 30 85% → Day 90 90%" 패턴 (entroly README)

**별 plan 가치**: `prismRLLearningLoopPlan_<date>.md`

#### EA-3.2 — Federation opt-in UI (E3 보조)

- Settings → Privacy → "Federation 참여" 토글
- 활성화 시 entroly 의 anonymous + noise-protected 패턴
- *사용자 prompt / 코드는 leak X* — optimization weights 만 (audit)
- INV-EA-7 의무 — 기본 OFF

#### EA-3.3 — Semantic dedup (E5)

- entroly_core::dedup + semantic_dedup + lsh 활용
- ContextPack assemble 시 chunk-level dedup
- bkit Idea A2 의 SHA-256 fingerprint dedup 격상 (의미적 정밀도 ↑)

#### EA-3.4 — `utilization` indicator (보너스)

- entroly_core::utilization::TokenBudget 활용
- RuntimeStatusBar 의 context budget indicator 정량 구현 (bkit Idea B2)

## 4. Cross-cutting risks

| 위험 | 대응 |
|---|---|
| entroly-core 의 Tauri 빌드 link 가능성 (PyO3 + libpython) | Phase 1 의 EA-1.1 시 검증. `extension-module` feature off. 실패 시 proxy 모드 (E2) 로 fallback |
| Anthropic API specific payload 호환 (stream-json, rate_limit_event) | Phase 1 EA-1.2 의 검증. 실패 시 entroly proxy 가 그 영역 통과 못 함 → E1 직접 통합 path 만 유효 |
| accuracy retention 100% 의 tunaFlow 환경 검증 | Phase 1/2 모두 50~100 sample 검증 의무 — entroly 자체 검증 (n=100) 외 |
| 사용자 prompt leak (federation 활성 시) | 기본 OFF, opt-in 시도 audit, INV-EA-7 |
| entroly daemon 자원 부담 (~10ms latency, RAM) | Phase 1 의 1시간 연속 검증. 실제 부담 측정 |
| federation 의 swarm dreaming 패턴 — tunaFlow 의 single-user 가정과 architecture 일치 검토 | Phase 3 진행 전 별도 design review |
| entroly API 안정성 (0.10.0, breaking change 가능) | git dependency 의 commit hash pin (`rev = "abc123"`) — 검증된 시점 잠금 |
| 다른 엔진 (codex/gemini) 영향 | Phase 1 cli 한정. 모든 엔진 적용은 별도 검증 후 |

## 5. Rollback

각 Phase 별 분리 commit + PR 단위 revert 가능.

- **Phase 1 rollback**: `entroly_proxy_enabled` 토글 OFF (settings) + sidecar 미spawn (1줄)
- **Phase 2 rollback**: entroly-core dependency 제거 + persistence.rs T11/T12 분기 복귀
- **Phase 3 rollback**: PRISM state 비활성화 (settings)

## 6. uncertainty / 검증 필요 (추측 X)

본 plan 의 가정 중 entroly README 의 주장으로 *fact 미검증* 영역:

| 항목 | 검증 방법 | 검증 시점 |
|---|---|---|
| entroly-core Tauri 환경 link | `cargo add entroly-core` 후 cargo check (test branch) | Phase 1 EA-1.1 |
| entroly proxy 의 Anthropic stream-json 호환 | claude `-p --output-format stream-json` 통과 시 result event / rate_limit_event 정상 forward 여부 | Phase 1 EA-1.2 |
| 70~95% token savings | tunaFlow 환경 측정 (entroly 자체 측정과 다를 수 있음) | Phase 1 EA-1.3 |
| 100% accuracy retention (n=100) | tunaFlow 환경 50~100 sample 별도 검증 (claude/codex/gemini 응답 비교) | Phase 1/2 검증 단계 |
| <10ms latency | 사용자 환경 측정 | Phase 1 EA-1.3 |
| federation 의 privacy 보장 | entroly 의 noise-protected 설계 audit | Phase 3 진행 전 |
| L3 SimHash fingerprint 의 retrieval key 동작 | 같은 conversation 에 재인용 시 entroly 가 자동 expand 하는지 | Phase 2 검증 |
| `prism.rs` 의 RL state 가 tunaFlow trace 와 호환 | API surface 일치 검증 | Phase 3 시작 시 |

## 7. Phase 우선순위 + 적용 시점

| Phase | 우선 | 시점 | 변경 영역 |
|---|---|---|---|
| **Phase 1** (E2 proxy PoC) | **P0 fast track** | v0.1.4-beta publish 후 첫 cycle | sidecar + env var 분기 (~50-100 LoC) |
| Phase 2 (E1 direct + E4 distill) | P2 | v0.1.6-beta 또는 v0.2.0 | refactor 200~400 LoC + adapter 100 LoC |
| Phase 3 (E3 RL + E5 dedup) | P3 | v0.2.0+ | 별 plan, 별 product 가능 |

**Phase 1 의 결과** 가 Phase 2/3 진행 결정의 기준. PoC 성공 시 Phase 2 plan 작성 + 진행. 실패 시 plan 자체 폐기 또는 다른 path 검토.

## 8. baseline + 검증 메트릭

### 8.1 현 시점 baseline (T12 적용 후, main `61c81fe`)

- claude cli mode + fresh session prompt:
  - prompt_chars: ~15K (T12 drop 후 platform + agent-role + skills + user_prompt)
  - layers inject: 4종
  - drop layers: 7종 (compressed_memory + plan + plan_doc + artifacts + findings + retrieval + cross_session + current_messages + parent_messages)
- 응답 quality: history 0 (T12 drop 결과)

### 8.2 Phase 1 목표

- prompt_chars: ~10K (entroly compress 후) 또는 ~25K (Standard 정상화 + entroly graceful)
- 응답 quality: history 보존 (L0~L3 mix)
- agent tool-request 횟수: T12 보다 적음 (entroly 가 보존)
- token cost / send: 70~95% 절감 (entroly 주장 vs 실측)
- accuracy retention: 100% (n=50~100)

### 8.3 Phase 2 목표

- Phase 1 + DAG coherence (plan reference 깨지지 않음)
- prompt_chars: 더 정밀 (Phase 1 보다 작음)
- entroly_core 의 multi-resolution 기능 활용 (L0~L3 적절 mix)

## 9. Cross-link

- `entrolyAdoptionIdea_2026-05-02.md` — 본 plan 의 idea SSOT (E1~E5 spec)
- `claudeTransportFlipHardeningPlan_2026-04-29.md` T11/T12 — Phase 2 가 그 architectural 격상
- `bkitReferenceAdoptionIdea_2026-04-29.md` Idea A1/A2 — entroly 의 정량 구현으로 통합 가능
- `threadlensSessionManagementIdea_2026-04-30.md` — axis 다름, complementary

## 10. 다음 step

본 plan 머지 후:

1. **사용자 결정 — Phase 1 진행 시점** — v0.1.4-beta release publish 완료 후 즉시 또는 다음 cycle
2. **Developer 핸드오프 작성** (Phase 1 한정 첫 단계) — 별 docs (`entrolyProxyPocDeveloperHandoff_<date>.md`)
3. **Phase 1 sidecar binary 빌드 절차 검증** — entroly 자체 빌드 절차 따라 PoC build
4. **PoC 성공 시 Phase 2 plan** 별도 작성

본 plan 은 *전체 도입 전략* SSOT — Phase 1/2/3 진행 결정 시 cross-link.

## 11. 본 cycle position

- 현재 (2026-05-02): v0.1.4-beta cycle 마무리 + dev mode notification crash hotfix (PR #251) + macOS Edit menu 회복 (PR #252) 완료
- 본 plan 은 **publish 후 첫 cycle 의 Phase 1 PoC** 영역
- v0.1.5-beta 의 핵심 가치 후보 (사용자 환경 anchor 2 turns trigger 의 architectural 해결)
