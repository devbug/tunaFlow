---
title: Windows 의존성 부트스트랩 플랜 — context-hub / code-review-graph 인식 + 배포 패키지 포함
created_at: 2026-04-29
calling_role: architect (Windows 머신)
target_role: developer → reviewer (Codex, optional)
related_plans:
  - docs/plans/windowsBetaHardeningPlan_2026-04-26.md
  - docs/plans/windowsBuildPlan_2026-04-24.md
  - docs/plans/cicdReleasePlan.md
status: complete (T1~T5 merged, PR #221/#223/#225/#227/#229 — 2026-04-29)
---

# Windows 의존성 부트스트랩 플랜

## 0. 요약 (1 단락)

`context-hub` (`@aisuite/chub` npm) 와 `code-review-graph` (pip) 두 사이드카가
mac 환경에는 미리 설치돼 있어 Settings → Runtime 에 `ready` 로 표기되지만,
Windows 환경(이 머신 포함)에는 미설치 상태라 두 항목 모두 `unavailable` 로 보인다.
README 의 *"Auto-installed on first run"* 표기와 달리 backend 코드에는 자동 설치 로직이
**전혀 없다** (`auto_install`/`install_if_missing`/`npm install -g`/`pip install` grep 0건).
즉 mac 측 정상 동작은 *사용자 / architect 가 수동 설치한 결과* 이며 Windows 측에서는
그 manual setup 이 누락된 채 silent unavailable 로 빠진다. 이 플랜은
(1) 두 의존성을 Windows 측에서도 정상 인식되게 하고,
(2) 배포 패키지(NSIS installer) 첫 실행 단계에서 *user consent 후* 설치를 시도하며,
(3) 호환성 문제 시 안내 → 재시도 가능한 회복 경로를 제공한다.

## 1. Invariants

| ID | 내용 |
|---|---|
| **INV-1** 🔴 | **macOS tunaFlow 에 사이드 이펙트 0**. Windows 측 변경은 `#[cfg(target_os = "windows")]` 격리, macOS 무관 새 파일 추가, 또는 macOS CI 빌드 통과 검증 후에만. |
| **INV-2** | **PR + CI watch 필수**. macOS + Windows 양쪽 CI ✓ 후 머지. `gh pr merge --admin` 금지. |
| **INV-3** | macOS-specific 경로/스크립트(`bootstrap/env.rs` macOS PATH 보강, `scripts/build-rawq.sh` 등) 변경 X. |
| **INV-4** | **단일 axis per commit**. T1~T7 각 task 마다 별 commit + 별 PR. |
| **INV-DEP-A** (신규) | **자동 설치는 user consent 후에만**. silent global install 금지. 첫 실행 시 다이얼로그 → 사용자가 "설치" 선택 시에만 진행. |
| **INV-DEP-B** (신규) | **설치 실패 시 graceful degradation**. 의존성 미설치는 unavailable 상태로 두고 앱 진입 차단 금지. context-hub 미설치 = 검색 비활성, code-review-graph 미설치 = CRG 섹션 skip. 다른 기능 정상 동작. |
| **INV-DEP-C** (신규) | **README 표기와 실제 동작 일치**. "Auto-installed on first run" 이 silent install 을 의미하지 않음을 명확히 (consent UX 포함하도록 README 수정 또는 실제 silent 자동 설치 + opt-out 토글). 둘 중 한 쪽으로 통일. |

## 2. 현황 매트릭스

### 2.1 의존성 인벤토리 (Windows 머신, 2026-04-29 기준)

| 의존성 | 설치 위치 (mac/win) | 자동? | UI 영향 | Status |
|---|---|---|---|---|
| Node.js + npm | (toolchain) | 사용자 사전 | base | ✅ 설치됨 |
| Python 3 + pip | (toolchain) | 사용자 사전 | base | ✅ 설치됨 |
| claude CLI | `~/.local/bin/claude.exe` | 사용자 수동 | engine 미인식 | ✅ 설치됨 |
| codex CLI | `%APPDATA%\npm\codex.cmd` | 사용자 수동 | engine 미인식 | ✅ 설치됨 |
| gemini CLI | `%APPDATA%\npm\gemini.cmd` | 사용자 수동 | engine 미인식 | ✅ 설치됨 |
| **rawq sidecar** | `src-tauri/binaries/rawq-*.exe` | 빌드 시 (`scripts/build-rawq.{sh,ps1}`) | rawq footer | ✅ 빌드 (PR 후 NSIS 번들) |
| rawq daemon spawn | `bootstrap/services.rs` | 자동 (앱 시작 시) | — | ✅ 자동 |
| rawq snowflake 임베딩 | `%LOCALAPPDATA%\rawq\models\` | 자동 (rawq daemon 다운로드) | — | ✅ 자동 |
| **bge-m3 ONNX 모델** | `init_global_embedder_async` | 자동 (huggingface 다운로드) | secall RAG | ⚠ 첫 실행 시 ~2GB |
| **vendor skills** | `~/.tunaflow/skills/` | `scripts/publish-skills.sh` 수동 | Settings → Skills | ⚠ 수동 publish 필요 |
| **chub** (`@aisuite/chub`) | `%APPDATA%\npm\chub.cmd` | **없음** (코드 grep 0건) | context-hub 카드 | 🟢 본 PR 로 설치 + 부트스트랩 |
| **code-review-graph** | `<python>/Scripts/code-review-graph.exe` | **없음** | ContextPack CRG 섹션 | 🟢 본 PR 로 설치 + 부트스트랩 |
| ollama / lmstudio | (옵션, 사용자 사전) | — | 옵션 엔진 | (본 PR 범위 외) |

### 2.2 백엔드 detection 코드 검토

- **`src-tauri/src/agents/context_hub.rs:resolve_bin()`** — `HOME` env var 기반 후보 + `/usr/local/bin` 등 unix 절대 경로 + 마지막 PATH fallback (`Command::new("chub").arg("--help")`).
  - Windows native process 는 `HOME` 이 보통 미설정 (대신 `USERPROFILE`). 첫 1단계 candidate Vec 이 통째로 skip.
  - PATH fallback 은 정상 동작 — Windows 에서 `Command::new("chub")` 가 `chub.cmd` shim 을 발견. 그러나 Rust 1.77+ 의 `BatBadBat` (CVE-2024-24576) 보안 패치 이후 인자 sanitization 이 추가됨 — `--help` 정도의 단순 호출은 무관, 그러나 `chub search "query with spaces"` 같은 실 호출에서 escape 회귀 위험 있음. 별도 회귀 점검 필요.
- **`src-tauri/src/agents/crg.rs:resolve_bin()`** — `HOME/.local/bin/code-review-graph`, `/opt/homebrew/...` 등 unix 경로만. Windows PATH fallback 유무 미확인 (T2 에서 점검).

### 2.3 README 와 실제 동작 불일치

- README.{md,ko.md} : *"context-hub …  Auto-installed on first run"*
- 실제 코드 : detect → silent unavailable. 사용자 안내 없음.
- INSTALL.md §128 표 : "앱 내 안내 표시" — 안내 UI 도 미구현.
- 결론: 표기·문서·코드 셋 다 정합성 깨짐. **INV-DEP-C** 로 통일 방향 결정 필요.

## 3. 설계 선택 — bundle vs first-run vs 안내만

각 의존성을 다음 중 하나로 분류:

| 모드 | 의미 | 적합 의존성 |
|---|---|---|
| **A. bundle** | NSIS installer 자체에 포함, 별도 설치 불필요 | rawq sidecar (이미 적용), vendor skills (작음), 향후 chub binary 형태 가능 시 |
| **B. first-run with consent** | 앱 첫 실행 시 다이얼로그 → 사용자 동의 후 백그라운드 install | **chub** (npm i -g), **code-review-graph** (pip install) |
| **C. 안내만** | 미설치 감지 → UI 안내 + 사용자 가이드 링크. 자동 설치 없음 | claude/codex/gemini/ollama 같은 *사용자 정체성에 묶이는* CLI |
| **D. 자동 다운로드** | 앱이 직접 fetch (코드 내장) | bge-m3 모델 (이미 적용) |

**권장 분류**:

| 의존성 | 권장 모드 | 이유 |
|---|---|---|
| chub | **B** (first-run consent) | npm 글로벌 — Node 환경 의존, 글로벌 install 은 사용자 환경에 영향이라 silent 금지 |
| code-review-graph | **B** (first-run consent) | pip 글로벌 — 큰 의존성 트리 (tree-sitter 등), Python venv 우선 권유 안내 포함 |
| vendor skills | **A** (bundle) | 작음, 정적, idempotent. NSIS 설치 시 `%USERPROFILE%\.tunaflow\skills\` 에 풀어두면 됨 |
| bge-m3 | **D** (현행 유지) | 2GB → bundle 비현실. 첫 indexing/search 시 progress UI |

## 4. Phase 분해 (P0 → P3)

### Phase 1 — Backend 인식 정상화 (P0, 본 PR 의 즉시 차단 사유 해소)

#### T1 — `context_hub::resolve_bin()` Windows 호환 검증 + 보강
- **파일**: `src-tauri/src/agents/context_hub.rs`
- **현황**: PATH fallback 으로 chub.cmd 인식 가능 *should be*. dev 빌드에서 실제 동작 확인.
- **변경**:
  - `Windows` cfg 분기 추가: `USERPROFILE\\AppData\\Roaming\\npm\\chub.cmd` 후보를 candidates 에 push (PATH fallback 보다 명시적이라 빠름 + 안정).
  - `HOME` 분기는 그대로 유지 (Linux/macOS 호환).
- **테스트**: 단위 테스트 — Windows env 모의(`std::env::set_var("USERPROFILE", ...)` + temp dir) 에서 candidate path 가 결과에 포함되는지.
- **INV**: cfg 격리, macOS 영향 0.

#### T2 — `crg::resolve_bin()` Windows 호환 추가
- **파일**: `src-tauri/src/agents/crg.rs`
- **현황**: unix 경로 candidate + which 호출. Windows PATH fallback 부재 가능성.
- **변경**:
  - cfg(windows) 분기: `<python>/Scripts/code-review-graph.exe` 후보 (USERPROFILE 또는 sys.executable 추론). 또는 PATH fallback 으로 `Command::new("code-review-graph").arg("--version")` 추가.
  - 가장 단순한 안: PATH fallback (`Command::new("code-review-graph")`). cfg 분기 없이 cross-platform.
- **테스트**: T1 과 동일 패턴.
- **INV**: PATH fallback 이면 macOS 도 동일 코드 실행 — but 이미 unix candidate 가 먼저 hit 하므로 동작 변경 없음.

#### T3 — README/INSTALL.md 의 자동 설치 문구 정정
- **파일**: `README.md`, `README.ko.md`, `INSTALL.md` (특히 §128 "Lite 트랙 — 추가 기능 자동 설치" 표 — "앱 내 안내 표시" 도 미구현이므로 동일 정정 대상)
- **변경**: *"Auto-installed on first run"* → *"prompted to install on first run"* (consent UX 명시). [Q-1 결정: consent UX 채택]
- **INV**: docs only, 코드 회귀 0.

### Phase 2 — First-run consent UI + auto-install (P1)

#### T4 — installer 후보 detection + dialog
- **파일**: `src-tauri/src/commands/dependency_install.rs` (신규), `src/components/tunaflow/FirstRunDependencyDialog.tsx` (신규)
- **로직**:
  1. 앱 시작 시 `setting("first_run_dependency_check_done")` 플래그 검사. 미수행이면 다이얼로그 표시.
     - **모달 직렬 보장 [Q-4]**: dependency dialog → onboarding 분석 모달 순서. dependency dialog dismiss 후에만 onboarding 모달이 뜨도록 store 의 모달 큐에 우선순위 명시.
     - **디버그 토글**: `first_run_dependency_check_done=true` 를 미리 set 하면 dialog 무시 — startup race (§B) 진단 시 사용.
  2. 검사 항목: chub, code-review-graph. 각각 `available: bool, installer_command: String, requires: String` 반환.
  3. 다이얼로그: 항목별 체크박스 (기본 ON) + "건너뛰기" / "설치". 선택 시 `install_dependency(name)` invoke.
     - **venv 안내 [Q-3]**: 다이얼로그에 1줄 — *"venv 가 활성화되어 있으면 그 안에 설치합니다. 시스템 전역 설치를 피하려면 venv 활성 후 진행하세요"*. silent venv 생성 금지.
  4. install 명령 (timeout 명시 [R-5]):
     - chub: `npm install -g @aisuite/chub` (`Command::new("npm")`) — **timeout 60s**
     - code-review-graph: pip 호출 [Q-3 — venv 자동 활용]
       - `VIRTUAL_ENV` env var 가 set 되어 있으면 그 안의 `<venv>/Scripts/pip.exe` (Windows) 또는 `<venv>/bin/pip` (Unix) 사용 → venv 안에 설치
       - 미설정이면 system `pip install code-review-graph` (global) — **timeout 120s**
  5. 결과 status 이벤트 `dependency:install_result` emit. 실패/timeout 시 안내 + 수동 설치 명령 표시 (graceful degradation).
- **INV-DEP-A** 충족: user consent 후에만 실행. silent venv 생성도 금지.
- **INV-DEP-B** 충족: 다이얼로그 닫아도 앱 진행 가능. timeout/실패 시 dialog 안 hang.

#### T5 — Settings → Runtime 에 *수동 설치 트리거* 버튼 추가
- **파일**: `src/components/tunaflow/settings/RuntimeSection.tsx` 의 `ContextHubPanel`, 그리고 CRG 섹션이 있다면 그곳에 동일 버튼.
- **변경**: `unavailable` 상태일 때 "Install via npm/pip" 버튼 표시 → T4 의 `install_dependency` invoke. 이미 설치된 사용자에겐 안 보임.
- **INV**: macOS UI 도 동일하게 보이지만 macOS 에선 이미 설치된 경우가 보통이라 버튼 자체가 숨겨짐 → 영향 0.

### Phase 3 — Bundled assets (본 plan 외 axis로 격하 [Q-2])

#### T6 — vendor skills 를 NSIS installer 에 번들 *(P3, 별 plan 후속)*
- **격하 사유 [Q-2]**: 현재 mac 측 `publish-skills.sh` 수동 publish 가 정상 동작 중이고 사용자 보고 0건. T1~T5 의 즉시 가치(chub/crg unavailable 해소)가 우선. macOS 의 publish-skills.sh 와 first-run unpack 사이의 race 위험 회피.
- **본 plan 범위 외**. Windows 첫 install 시 skills 가 비어있으면 first-run dialog 또는 README 안내(T3)로 사용자에게 `publish-skills.sh` 또는 동등 절차 안내. 자동 unpack 은 별 plan 으로 이관.

#### T7 — Windows installer 후 reboot/relaunch 가이드 *(P3, 별 plan 후속)*
- T6 와 같은 axis(installer 정비)라 함께 후속 plan 으로 이관.

### Phase 4 — 추후 개선 (P3, 본 plan 외 axis)

- T6/T7 (위 격하)
- chub 정적 binary 번들 (npm 의존 제거) — chub 가 단일 binary release 를 제공하면 mode A 로 격상 가능. 현재 npm-only 라 Phase 2 의 mode B 유지.
- code-review-graph 의 PyInstaller 단일 실행 파일 번들 — Python 의존 제거 가능. 단 사이즈 크고 Python ABI 호환성 위험. 본 plan 범위 외.

## 5. 작업 분해 — developer 인계용

| Task | 파일 | 검증 명령 | 예상 LOC |
|---|---|---|---|
| Task | 파일 | 검증 명령 | 예상 LOC | 우선순위 |
|---|---|---|---|---|
| **T1** | `src-tauri/src/agents/context_hub.rs` (+test) | `cargo test --lib agents::context_hub` + 수동 `chub search "복합 query"` 회귀 [R-1] | +30 / -0 | P0 |
| **T2** | `src-tauri/src/agents/crg.rs` (+test) | `cargo test --lib agents::crg` | +20 / -0 | P0 |
| **T3** | `README.md`, `README.ko.md`, `INSTALL.md` (§128 표 포함) | docs only | +5 / -3 | P0 |
| **T4** | `src-tauri/src/commands/dependency_install.rs` (신규), `src/components/.../FirstRunDependencyDialog.tsx` (신규) | `cargo test`, `vitest run` | +180 / -0 | P1 |
| **T5** | `src/components/tunaflow/settings/RuntimeSection.tsx` | `vitest run` | +40 / -0 | P1 |
| ~~T6~~ | ~~vendor skills bundle~~ | ~~install + first run~~ | — | **P3 (별 plan 후속)** |
| ~~T7~~ | ~~installer post 가이드~~ | ~~install smoke~~ | — | **P3 (별 plan 후속)** |

본 plan 범위 = **T1~T5**. T6/T7 은 [Q-2] 결정으로 제외.

각 Task → **별 commit + 별 PR + macOS+Windows CI ✓ 후 머지** (INV-2/4).

## 6. 회귀 가드 / 검증 시나리오

### 6.1 macOS 회귀 가드 (INV-1)
- T1/T2: macOS 환경에서 `cargo test --lib agents::{context_hub,crg}` baseline 카운트 동일.
- T3: docs only, code 무관.
- T4/T5: macOS 에서도 dialog/button 코드 컴파일/렌더 OK. 단 macOS 사용자에겐 *이미 설치돼 있음* 으로 invisible (UX 영향 0).
- T6: macOS 빌드 시 resources 포함 여부는 conf 설정에 따름. macOS 측 publish-skills.sh 동작 동일.

### 6.2 Windows 검증 (T1~T5 누적 후)
| ID | 시나리오 | 기대 결과 |
|---|---|---|
| W-1 | clean Windows VM 에 chub/crg 미설치 상태로 NSIS installer 설치 | 첫 실행 시 dialog → "설치" 선택 → chub + crg 설치 → ready |
| W-2 | 같은 VM 에 chub 만 미리 설치된 상태로 dialog | crg 만 표시 (chub 항목 자동 hide) |
| W-3 | dialog "건너뛰기" → 앱 정상 진입, Settings → Runtime 의 두 카드 unavailable, 수동 설치 버튼 노출 |
| W-4 | npm install -g 권한 부족 (Roaming 쓰기 거부) → 실패 메시지 + 수동 명령 표시 |
| W-5 | 인터넷 차단 → npm/pip timeout (60s/120s) 후 graceful 실패 메시지 |
| W-6 | 두 의존성 설치 후 dev 모드 재시작 → backend resolve_bin 즉시 인식, status `ready` |
| W-7 | venv 활성 상태(`VIRTUAL_ENV` set)로 dialog → crg 가 venv 안에 설치, system pip 미사용 [Q-3] |
| W-8 | dependency dialog dismiss 후 onboarding 분석 모달이 그제서야 표시 [Q-4 직렬 보장] |
| W-9 | 디버그 토글: `first_run_dependency_check_done=true` 미리 set → dialog 스킵 (startup race §B 진단용) |

### 6.3 회귀 카운트 baseline
- **Windows baseline (PR #213 머지 직전)**: FE 381 / Rust 557 passed + 1 failed (= 558 실행, conventions_sync path-sep 회귀). PR #213 머지 후 558 passed / 0 failed.
- **macOS baseline (PR #211/#212/cc3e14e 머지 직후)**: Rust 559 passed. 1 의 차이는 `cfg(unix)`-gated 테스트로 추정 — 본 plan T1~T5 작업 후에도 두 환경의 차이는 동일하게 유지되어야 함. *macOS 559 / Windows 558* 을 같은 baseline 으로 본다.
- T1~T5 머지 후 양 환경 모두 +N (테스트 추가) 만 허용, 감소 금지.
- **측정 시점 명시 [mac architect 보강]**: PR #213 머지 후 첫 측정값 기준. 디벨로퍼는 본 plan 작업 시작 직전 `cargo test --lib` / `vitest run` 을 한 번 더 돌려 환경별 정확한 baseline 을 PR description 에 기록한 후 비교.

## 7. 리뷰어(Codex) review 포인트

- **R-1** chub.cmd 인자 escape 회귀 (Rust 1.77+ CVE-2024-24576 영향) — `chub search "복합 query"` 같은 실 호출이 Windows 에서 정상 작동하는지.
- **R-2** Python 환경 가정 — 사용자가 `python3` 가 아닌 `python` 으로만 PATH 에 있을 때 `pip install` 호출 분기.
- **R-3** consent dialog 의 i18n — ko/en 양쪽 문구.
- **R-4** Settings install 버튼이 macOS 에서도 *동일 코드*로 렌더되지만 detection 결과 `available:true` 라 hidden 인지 (INV-1 안전성).
- **R-5** `dependency:install_result` 이벤트가 background 작업이라 hang 가능성 — timeout (예: npm 60s, pip 120s) 적용 여부.
- **R-6** README 표기 변경 (T3) 이 ko/en 양쪽 동일 의미 유지.

## 8. 결정 사항 (mac architect review 후 확정, 2026-04-29)

| Q | 결정 |
|---|---|
| **Q-1** | **consent UX 정정**. global npm/pip 은 OS-wide 부작용이라 silent 금지. README 문구를 *"prompted to install on first run"* 으로 정정 + INV-DEP-A 와 일치. (T3 반영) |
| **Q-2** | **T6 P3 격하**. 현재 mac 측 `publish-skills.sh` 정상 동작, 사용자 보고 0건. T1~T5 의 즉시 가치 우선. publish-skills 와 first-run unpack 사이 race 위험 회피. (§4 Phase 3 / §5 표 반영) |
| **Q-3** | **활성 venv 자동 활용 + global pip fallback + 1줄 안내**. `VIRTUAL_ENV` env 검사로 venv 우선, 없으면 global. silent venv 생성 금지. dialog 안내 1줄 추가. (T4 반영) |
| **Q-4** | **axis 다름 + 직렬 보장 필요**. dependency dialog 와 startup race 는 다른 axis. 다만 *모달 직렬 보장*: dependency dialog → onboarding 모달 순서. 디버그 토글(`first_run_dependency_check_done` 미리 set)로 dialog 스킵 가능 — startup race 진단 시 사용. (T4 + W-8/W-9 반영) |

### 8.1 mac architect 추가 보강 (반영 완료)

| ID | 보강 | 반영 위치 |
|---|---|---|
| B-1 | T1 verification 에 `chub search "복합 query"` 실 호출 회귀 점검 명시 (CVE-2024-24576) | §5 표 T1 검증 명령 |
| B-2 | T4 install 명령에 timeout (npm 60s / pip 120s) spec 명시 | §4 T4 본문 |
| B-3 | T3 정정 대상에 INSTALL.md §128 "앱 내 안내 표시" 표기 포함 | §4 T3 본문 |
| B-4 | baseline 카운트의 측정 시점 (PR #213 머지 후) + macOS 559 / Windows 558 차이가 `cfg(unix)`-gated 임을 명시 | §6.3 |
| B-5 | T6 P3 격하 후 §4 Phase 3 / §5 표 갱신 | 완료 |

## 9. 진행 메모 (architect → developer)

- 본 plan 작성 직전, Windows architect 가 **수동으로** `npm install -g @aisuite/chub` (chub 0.1.4) 와 `pip install code-review-graph` (crg 2.3.2) 를 설치 완료. 따라서 T1/T2 검증은 이 머신에서 **즉시** 가능.
- T1~T2 만 머지해도 본 머신의 unavailable 표시는 ready 로 변경됨 (재시작 후). T4~T5 는 다른 Windows 사용자를 위한 일반 사용자 가치.
- 핸드오프 `windowsBetaHardeningArchitectHandoff_2026-04-29.md` 의 트랙 §B (startup race) / §C (DB path stale) / §D (watchdog compat) 와 axis 분리 — 본 plan 의 PR 은 별도로 머지.
- 머지 순서 권장: **T1 → T2 → T3 → T4 → T5**. T6/T7 은 본 plan 외 별 plan 후속 (Q-2). 각 PR 사이 baseline 회귀 카운트 확인.
- mac architect review (2026-04-29) APPROVE 완료, Q-1~4 결정 + B-1~5 보강 모두 본 plan 반영. 디벨로퍼 세션은 본 갱신본 기준으로 진행.

## 10. 완료 (2026-04-29)

본 plan 의 Phase 1 (T1~T3) + Phase 2 (T4~T5) 모두 머지 완료. T6/T7 은 [Q-2] 결정에 따라 P3 격하 후 별 plan 후속.

### 머지된 PR

| Task | PR | 머지 commit | 핵심 |
|---|---|---|---|
| T1 | #221 | `01a77c3` | `context_hub::resolve_bin()` Windows `%APPDATA%\npm\chub.cmd` candidates + cfg(windows) 격리 + 단위 테스트 3건 |
| T2 | #223 | `37718f3` | `crg::resolve_bin()` Windows PATH fallback (`which` 미존재 보강) |
| T3 | #225 | `66b3fa4` | README/INSTALL.md consent UX 문구 정정 (§128 표 포함) |
| T4 | #227 | `76a2426` | first-run consent dialog + npm/pip auto-install (timeout / venv 자동 활용 / 직렬 보장) |
| T5 | #229 | `95fcfa1` | Settings → Runtime "npm 으로 설치" 버튼 (manual trigger) |

### 같은 사이클 부수 작업 (별 axis)

| 항목 | PR | 머지 commit | 비고 |
|---|---|---|---|
| R-W-7 grep audit hotfix | #226 | `3a3c213` | `commands::files::tests` path-separator (escalate-1~4 + 동일 패턴 3건) test-only fix |
| windowsCiPipelinePlan + Q-WCI 결정 | #224 | `29face39` | docs (별 plan SSOT) |

### Baseline 비교 (회귀 0)

| | 시작 (PR #213 직후) | 종료 (95fcfa1 + #226) | Δ |
|---|---|---|---|
| Frontend | 381 passed | 388 passed | +7 (T4 5 / T5 2) |
| Rust | 558 passed | 579 passed / 0 failed | +21 (T1 +3 / T4 +6 / 외부 PR 들 +12) |
| Failures | 0 | 0 | — |

### INV 검증

- INV-1 (macOS 사이드 이펙트 0): `bootstrap/env.rs`, `scripts/build-rawq.sh` 등 macOS-specific 파일 미변경 grep 확인. T1/T2 cfg(target_os="windows") 격리, T4 dialog 는 `available:true` detect 시 invisible.
- INV-3: macOS 영역 미변경.
- INV-4: 단일 axis per commit — 모든 PR 1 axis.
- INV-DEP-A/B/C: consent UX, graceful degradation, doc/code parity 모두 충족.

### R-W-1 (CVE-2024-24576) 검증 결과

- `chub --cli-version` → 0.1.4
- `chub search "복합 query"` (한국어 + 공백) → 20 results, exit 0. bash level escape 정상.
- backend Rust `Command::new` 측 회귀 점검 = T5 머지 후 Settings → context-hub 검색 박스 실 호출로 통합 검증 권장 (별 axis).

### 후속 / 별 plan

- T6/T7 (skills bundle / installer post 가이드) — 별 plan 후속 axis.
- 사용자 검증 a~d (first-run dialog flow, manual install 버튼, venv 자동 활용 등) — dev 모드에서 사용자 직접 검증 권장.
- CHANGELOG v0.1.4-beta entry 보강 + release publish — mac architect 영역.
