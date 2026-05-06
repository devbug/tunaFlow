---
title: Windows 빌드의 캡션바 / native control 부재 hotfix
status: ready
phase: planning
priority: P0 (외부 사용자 보고 #264 — Windows UX 차단)
created_at: 2026-05-07
canonical: true
related:
  - src-tauri/tauri.conf.json  # app.windows[0] 의 titleBarStyle / hiddenTitle / decorations
  - src/components/tunaflow/TitleBar.tsx  # custom titleBar 컴포넌트 (macOS 전제)
  - INSTALL.md  # Windows 설치 안내 — 회귀 안내 1줄 추가 가능성
issue_source: GitHub #264 — devbug (2026-05-06)
---

# Windows 빌드의 캡션바 / native control 부재 hotfix

## 0. Context

### 0.1 외부 사용자 보고 (devbug, GitHub #264)

> "Windows 용을 설치하면 창에 캡션바나 닫기 버튼 최소화/최대화 버튼 등이 나타나지 않습니다. 따라서 창을 옮기거나 크기를 바꿀 수도 없습니다. 설정도 그렇고 어디에도 접근이 안 되며 Open Proejct만 가능합니다."

사용자가 *증상* 만 보고. workaround 시도 / root cause 추측은 하지 않음. *"Open Project만 가능합니다"* 는 결정적 단서 — main UI 의 다른 영역 (좌상단 메뉴 / 설정 / 닫기 버튼) 모두 접근 불가하지만 *"Open Project"* (시작 화면 또는 비어있는 main 화면의 Open 버튼) 는 동작. 즉 frontend 자체는 정상 mount, *titleBar 영역에 그려지는 control* 만 누락.

### 0.2 시나리오 정확화

1. Windows x64 환경에서 `tunaFlow_*-beta_x64-setup.exe` 다운로드 후 설치
2. tunaFlow 실행 — 메인 창 mount 성공 (Open Project 버튼 등 main UI 정상)
3. 창 상단 영역 관찰:
   - native titleBar (Windows 기본 캡션바) **부재**
   - 닫기 / 최소화 / 최대화 버튼 **부재**
   - tunaFlow custom `TitleBar` 컴포넌트 (macOS 의 traffic lights 자리에 그려지는 영역) 도 *Windows 에서는 의도된 동작이 아님*
4. 사용자 한정 액션:
   - 창 드래그 (titleBar 영역) → 불가
   - 창 리사이즈 → 불가 (border 영역도 안 잡힘 가능성)
   - 닫기 → Alt+F4 외 차단
   - 설정 / 메뉴 진입 → titleBar 의 메뉴 / 키보드 단축키 (Ctrl+,) 외 차단

### 0.3 Root cause 가설

| 가설 | 근거 |
|---|---|
| **(a)** `tauri.conf.json:22` 의 `"titleBarStyle": "Overlay"` 가 macOS 전용 옵션인데 Windows 에서 *기본 native titleBar 차단* 효과를 일으킴 | Tauri 2 문서: `titleBarStyle` 은 macOS `NSWindowTitleVisibility` 매핑. Windows 에서의 동작 미정의. *"Overlay"* 가 Windows 빌드에서 frame 자체를 hidden 처리할 가능성 |
| **(b)** `"hiddenTitle": true` 가 cross-platform 적용되어 Windows 에서도 titleBar text + control 영역 hidden | tauri docs 의 `hiddenTitle` 은 macOS 만 명시되지만 Windows builder 에서 *frameless* 와 동등 처리 가능성 |
| **(c)** `decorations` 키 부재 — Windows 빌드에선 `decorations: true` 명시 안 하면 default false 로 떨어지는 버전/경로 존재 | Tauri 2 default 는 `decorations: true` 인데, `titleBarStyle`/`hiddenTitle` 조합이 강제 override 가능성 |
| **(d)** custom `TitleBar` 컴포넌트 가 macOS 전제 layout 으로 그려져 Windows 에서 빈 공간만 남음 | tunaFlow 의 frontend 가 traffic lights 자리에 padding 만 비워둔 형태일 경우 — 이 자체는 (a)/(b)/(c) 의 *결과* 일 뿐 root cause 아님 |

**가장 가능성 높음**: (a) + (b) 조합. `titleBarStyle: "Overlay"` 는 macOS 한정 옵션으로 *frontend 가 traffic lights 자리에 그릴 수 있게* 하는 것이고, Windows 에서는 이 옵션이 *titleBar 자체를 hidden* 처리하면서 native control 도 같이 사라지는 부작용. (b) 는 Windows 의 caption text 부재의 직접 원인.

근거: tauri.conf.json 의 `windows` 영역에 platform-conditional 분리가 없고, `decorations` 키도 명시 부재. 같은 설정이 v0.1.5-beta Windows 자산부터 적용된 상태.

### 0.4 회귀 시점

- **v0.1.5-beta** Windows 자산 추가 시점부터 잠재 — devbug 가 v0.1.6-beta 설치 후 처음 보고했으나, v0.1.6-beta cycle 에서 Windows 영역 변경 0 이므로 *v0.1.6-beta 회귀 아님*
- macOS 사용자는 동일 설정으로 *의도된 동작* (overlay traffic lights) 을 받음 → macOS 영역 회귀 0

## 1. Invariants

| ID | 내용 |
|---|---|
| **INV-WCB-1** | macOS 환경에서 기존 traffic lights overlay 동작 보존 — `titleBarStyle: "Overlay"` + `hiddenTitle: true` 의 macOS 효과 변경 0 |
| **INV-WCB-2** | Windows 환경에서 native titleBar + 닫기/최소화/최대화 control + 창 드래그/리사이즈 모두 정상 노출 |
| **INV-WCB-3** | Linux (AppImage / deb / rpm) 빌드 정책 영향 0 — Linux 자산은 본 plan scope 외, 단 회귀도 안 발생 |
| **INV-WCB-4** | tunaFlow 의 custom `TitleBar` 컴포넌트 macOS 동작 보존. Windows 에선 표시되지 않거나 native titleBar 와 중첩 안 됨 |
| **INV-WCB-5** | window state 저장 (window-state plugin) / 시작 시 창 size 복원 정책 보존 |
| **INV-WCB-6** | 기존 사용자 설정 / 키체인 / DB 영향 0 — 단순 build config 변경 |

## 2. Goals / Non-goals

### Goals

- **G1**: Windows 사용자가 v0.1.X-beta 설치 후 native titleBar + 닫기/최소화/최대화 + 창 드래그/리사이즈 모두 정상 사용 가능
- **G2**: macOS 사용자의 traffic lights overlay 경험 변경 0 (회귀 가드)
- **G3**: tauri.conf.json 변경이 platform-conditional 형태로 *명시적* 이어서 후속 세션이 *왜 이렇게 했는지* 추적 가능
- **G4**: hotfix patch release (v0.1.6-beta-2 또는 v0.1.7-beta) 에 포함되어 24~48시간 안에 자가 회복 path 제공

### Non-goals

- ❌ macOS 의 titleBar 동작 변경 (traffic lights overlay 는 의도된 동작)
- ❌ custom `TitleBar` 컴포넌트 (`src/components/tunaflow/TitleBar.tsx`) 의 macOS 동작 / 레이아웃 변경
- ❌ Linux 빌드 영역 변경 (Linux 자산 회귀 0 가드)
- ❌ window-state plugin 정책 변경 / 창 size 복원 정책 변경
- ❌ Windows 전용 신규 UI 추가 (Windows 메뉴바 / Windows 전용 단축키 등) — 본 plan 은 *native titleBar 회복* 한정
- ❌ Tauri 2 → 다른 version 업그레이드
- ❌ DB schema / 사용자 설정 영향 (단순 build config)

## 3. Subtasks

### Task 01 — tauri.conf.json platform-conditional 구조로 분리 [P0, fix 본체]

**Changed files**:
- `src-tauri/tauri.conf.json` (12~25 — `app.windows[0]`)

**Change description**:
- Tauri 2 의 platform-conditional config 메커니즘 활용. 두 옵션:
  - 옵션 (i): `tauri.windows.conf.json` / `tauri.macos.conf.json` 등 **platform-specific override 파일** 분리. base `tauri.conf.json` 에서 `titleBarStyle` / `hiddenTitle` 제거 → macos override 에만 추가
  - 옵션 (ii): base `tauri.conf.json` 에 macOS 동작 유지 + Windows-specific 설정에 `decorations: true` 명시적 추가 — 단 `titleBarStyle` 의 Windows 영향이 conditional 분리로 해소되는지 확인 필요
- 권장: **옵션 (i)** — Tauri 2 의 표준 패턴이고 후속 세션이 의도를 명확히 인식 가능. 비교 검증 후 결정.
- macOS override 에 유지:
  ```json
  { "titleBarStyle": "Overlay", "hiddenTitle": true }
  ```
- Windows / Linux base 에는 위 두 키 부재 + `decorations: true` 명시 (default 와 동일하지만 *명시적 의도* 표현)

**Verification**:
- `cd src-tauri && cargo tauri build --target x86_64-pc-windows-msvc --debug` (CI 또는 로컬 Windows 환경) — Windows 자산 빌드 성공
- 또는 GitHub Actions build.yml 의 Windows 잡 성공 확인
- macOS 동작은 `cargo tauri dev` 로 traffic lights overlay 유지 확인

**회귀 위험 가드**:
- INV-WCB-1: macOS 영역 동작 변경 0. `titleBarStyle: "Overlay"` 가 macOS override 에만 살아있는지 grep
- INV-WCB-3: Linux 영역 변경 0. base config 에 Linux-only 분기 추가하지 말 것
- INV-WCB-5: window-state plugin 설정 영역 (`tauri.conf.json` 의 다른 영역) 손대지 말 것

**위험**:
- platform-specific override 파일 인식이 Tauri 2 build 단계에서 자동인지 / 추가 plugin 필요인지 — 1차로 (i) 시도 후 build 안 잡히면 (ii) 폴백
- (i)/(ii) 모두 실패 시 escalate (Tauri docs 재검토 + custom build script)

### Task 02 — Windows 환경 e2e 수동 검증 [P0, 검증 task]

**Changed files**: 없음 (read-only)

**Change description**:
- Task 01 의 fix 가 Windows 환경에서 실제 동작하는지 검증. devbug 사용자의 보고 시나리오 (§0.2) 1:1 재현
- 검증 환경: Windows 11 x64 (사용자 환경과 동등) / Windows 10 x64 (호환 검증)

**Verification (e2e 시나리오)**:
1. ✅ Windows 빌드 자산 (`tunaFlow_<v>_x64-setup.exe`) 신규 다운로드 + 설치
2. ✅ tunaFlow 실행 → 창 상단에 native titleBar 표시 + 닫기/최소화/최대화 버튼 노출
3. ✅ titleBar 드래그 → 창 이동 정상
4. ✅ 우하단 border 드래그 → 창 리사이즈 정상
5. ✅ 닫기 버튼 클릭 → 정상 종료
6. ✅ 최소화 / 최대화 버튼 → 정상 동작
7. ✅ Open Project 외 다른 UI (사이드바 / 설정 / 메뉴) 접근 가능 — 시나리오 §0.2 의 기존 차단 영역 회복

**회귀 위험 가드**:
- macOS 환경에서 traffic lights overlay 영역 정상 (사용자 환경에서 동시 검증)
- INV-WCB-2 / INV-WCB-4 동시 만족

**위험**:
- e2e 검증은 Windows 머신 필요 — Architect 세션 환경 한계상 사용자 검증 또는 CI artifact 검증으로 위임 가능

### Task 03 — INSTALL.md / 사용자 안내 갱신 [P2, 문서]

**Changed files**:
- `INSTALL.md` (Windows 섹션)

**Change description**:
- v0.1.X-beta 이전 자산 사용자에게 *"이 회귀가 v0.1.X-beta 부터 회복됨"* 안내 한 단락 추가
- 본 fix 의 내용 (titleBarStyle 분리) 은 *내부 변경* 이라 사용자 안내에는 결과만 (creation_at: v0.1.X-beta 부터 정상)

**Verification**: markdown 렌더링 확인, 링크 깨짐 없음

**회귀 위험 가드**: 다른 INSTALL.md 영역 (macOS / Linux / 일반 가이드) 손대지 말 것

## 4. Cross-cutting risks

| 위험 | 대응 |
|---|---|
| Tauri 2 platform-conditional override 파일 동작 미숙지 | Task 01 옵션 (i) 시도 → build 실패 시 (ii) 폴백 → 둘 다 실패 시 escalate (Tauri docs 재검토) |
| Windows 빌드는 CI 만 가능, 로컬 검증 불가능한 경우 | CI build 자산을 직접 다운로드 + 사용자 환경에서 e2e 검증 (Task 02) |
| macOS 영역 동작이 미세하게 깨지는 경우 (traffic lights overlay) | Task 01 PR 직전 macOS dev 빌드 + 사용자 직접 검증 |
| Linux 빌드 회귀 가능성 (deb / rpm / appimage) | base config 에 Linux 분기 추가하지 않음 — 변경 영역 최소화 |
| v0.1.5-beta / v0.1.4-beta 사용자가 이미 영향 — 자가 회복은 v0.1.X-beta 설치 시점부터 | release notes 강조 + Windows 자산 사용자 GitHub release URL 직접 안내 |

## 5. Rollback

- **Task 01**: 단독 revert 가능. tauri.conf.json 의 platform-conditional 구조 → 원래 단일 파일로 합침. macOS 동작 보존, Windows 동작 회귀 (보고 #264 상태 복귀)
- **Task 02**: 검증 task — revert 대상 아님
- **Task 03**: 단독 revert 가능. 문서 1단락만 제거

destructive 한 변경 없음. DB / 사용자 설정 / 키체인 영향 0.

## 6. 다음 step

1. **Developer 핸드오프 작성** — Task 01 (fix 본체) + Task 02 (검증) + Task 03 (문서) 모두 1 PR. axis 동일하고 Windows hotfix 묶음. 별 PR 분리 불필요
2. **devbug 외부 사용자 답변** — plan 머지 직후 issue #264 댓글:
   - 보고 감사
   - root cause 가설 + fix 진행 상황
   - 자가 회복 timing (v0.1.X-beta release 후)
3. **release timing**:
   - **patch suffix 권장** (v0.1.6-beta-2) — 본 fix 가 단일 axis hotfix 라 minor bump 보다 patch 가 적합
   - 또는 RT plan (`roundtableConsensusPersistencePlan_2026-05-07.md`) 과 묶어서 v0.1.7-beta minor 도 가능 — RT plan 의 진행 속도에 따라 결정
   - Windows 자산은 release blocker 라 빠른 release 권장 (24~48시간)
4. **후속 plan 가능성**:
   - Tauri 2 platform-conditional config 패턴이 *다른 영역* 에도 필요한지 audit (예: Linux 전용 설정, Windows 전용 메뉴바 등) — 별 P3 plan 으로 분기 가능. 본 plan 은 #264 hotfix 한정
