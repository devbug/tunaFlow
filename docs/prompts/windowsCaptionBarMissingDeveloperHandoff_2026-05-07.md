---
title: Developer 핸드오프 — Windows 빌드 캡션바 / native control 부재 hotfix
plan: docs/plans/windowsCaptionBarMissingPlan_2026-05-07.md
issue: GitHub #264
created_at: 2026-05-07
---

# Developer 핸드오프 — Windows 빌드 캡션바 / native control 부재 hotfix

## 0. 한 줄 요약

외부 사용자(devbug)가 보고한 GitHub #264 — Windows 빌드 설치 시 native titleBar / 닫기·최소화·최대화 control 모두 부재로 창 이동·리사이즈 불가, Open Project 외 모든 UX 차단. Root cause: `tauri.conf.json:22~23` 의 `titleBarStyle: "Overlay"` + `hiddenTitle: true` 가 macOS 전용 옵션인데 cross-platform 적용되어 Windows native frame 차단. fix axis: platform-conditional override 분리.

## 1. 작업 개요 — task 표

Plan A (`windowsCaptionBarMissingPlan_2026-05-07.md`) 의 3 task 모두 **단일 PR 묶음**. axis 동일 (Windows hotfix), Task 02 (e2e 검증) 와 Task 03 (문서) 은 Task 01 의 결과물 검증 / 안내라 별 PR 분리 불필요.

| Task | 파일 | 핵심 변경 | 우선 |
|---|---|---|---|
| 01 | `src-tauri/tauri.conf.json` (12~25 — `app.windows[0]`) | 옵션 (i): `tauri.macos.conf.json` override 파일 분리 → macOS 전용 `titleBarStyle: "Overlay"` + `hiddenTitle: true` 이동. base 에선 두 키 제거 + `decorations: true` 명시. 옵션 (ii) 폴백: base 유지 + Windows-specific decorations 추가 | P0 |
| 02 | 없음 (검증 task) | Windows 11 / 10 환경에서 e2e 시나리오 7항목 통과 확인 (Plan §3 Task 02) | P0 |
| 03 | `INSTALL.md` (Windows 섹션) | "v0.1.X-beta 부터 native titleBar 회복" 한 단락 추가 | P2 |

진행 순서: Task 01 → 02 → 03 직렬. Task 01 PR push 후 GitHub Actions build 완료 → Windows 자산 직접 다운로드해 Task 02 e2e 검증. Task 03 은 Task 02 통과 후 같은 PR commit 추가.

## 2. DO — 반드시 지킬 것

1. **Plan §3 Task 01 의 Verification 명령** 실제 실행 후 chat 보고:
   - macOS dev 빌드: `cd src-tauri && cargo tauri dev` → traffic lights overlay 정상 표시 확인 (회귀 0 가드)
   - Windows 빌드: GitHub Actions build.yml 이 push 후 자동 트리거 — 완료 자산 (`tunaFlow_*-beta_x64-setup.exe`) 다운로드 확인
2. **Tauri 2 platform-conditional override 우선순위**:
   - 1차: 옵션 (i) `tauri.macos.conf.json` 분리. Tauri 2 의 표준 패턴
   - 2차 폴백: 옵션 (ii) base config 의 windows 영역에 `decorations: true` 명시 + `titleBarStyle` / `hiddenTitle` 의 platform 영향 재검토
   - 둘 다 막히면 escalate (§8)
3. **회귀 위험 가드 grep 사전 baseline**:
   - 작업 전: `rg "titleBarStyle|hiddenTitle|decorations" src-tauri/` 결과 캡처
   - 작업 후: macOS override 또는 Windows-specific 영역에만 변경, 다른 영역 grep 결과 동일
4. **feature 브랜치**: `fix/windows-caption-bar-missing-264` (또는 단축형 `fix/win-caption-264`)
5. **Commit 단위 task 별 분리**:
   - `fix(tauri): platform-conditional titleBar config — macOS overlay 유지 + Windows native frame 회복 (#264) (Task 01)`
   - `test(windows): e2e caption bar verification 시나리오 통과 (Task 02)`
   - `docs(install): v0.1.X-beta Windows native titleBar 회복 안내 (Task 03)`
6. **PR description**: plan 링크 (`docs/plans/windowsCaptionBarMissingPlan_2026-05-07.md`) + issue 링크 + Task 01 macOS 회귀 0 / Windows 회복 e2e 결과 + Task 02 시나리오 7항목 ✅ 결과 + 회귀 grep baseline → after 명시. PR 본문에 `Closes #264` 명시 (단일 PR)

## 3. DO NOT — 사이드 이펙트 차단

- ❌ **macOS 의 traffic lights overlay 동작 변경 금지** — INV-WCB-1. Plan §2 Non-goals. macOS 사용자의 의도된 UX, 회귀 0 가드 필수
- ❌ **`src/components/tunaflow/TitleBar.tsx` 컴포넌트 로직 변경 금지** — Plan §2 Non-goals. macOS 전제 layout 보존. Windows 에서 *표시되지 않거나 native titleBar 와 중첩 안 됨* 만 만족하면 됨 (INV-WCB-4)
- ❌ **Linux 빌드 영역 (deb / rpm / appimage) 변경 금지** — INV-WCB-3. Linux 자산 회귀 0 가드. base config 에 Linux 분기 추가하지 말 것
- ❌ **window-state plugin 설정 영역 (`tauri.conf.json` 의 다른 영역 / plugins / build / bundle) 손대지 말 것** — INV-WCB-5. 창 size 복원 정책 영역
- ❌ **Tauri 2 → 다른 version 업그레이드 금지** — Plan §2 Non-goals. 환경 격변 axis 분리
- ❌ **Windows 전용 신규 UI (메뉴바 / 단축키 / 알림 영역) 추가 금지** — Plan §2 Non-goals. 본 plan 은 *native titleBar 회복* 한정. 추가 UX axis 는 별 plan
- ❌ **DB schema / 사용자 설정 / 키체인 영역 손대지 말 것** — Plan §2 Non-goals (단순 build config 영역)
- ❌ **새 dependency 추가 금지** — Tauri 2 의 기존 platform-conditional 메커니즘만 활용
- ❌ **README.md / CLAUDE.md / 다른 docs 영역 변경 금지** — Task 03 의 INSTALL.md Windows 섹션 외 cross-cutting 문서 수정 차단

## 4. 변경 후 검증 (전체)

PR 머지 직전 통과 명령:

```bash
cd src-tauri && cargo check --message-format=short
cd src-tauri && cargo test --lib
npx tsc --noEmit
npx vitest run
```

테스트 카운트 baseline (2026-05-07 기준, v0.1.6-beta 머지 후):
- Rust: **614 tests** — 본 PR 은 build config 변경, cargo test 결과 614 유지
- Frontend: **422 tests** — frontend 변경 없음, vitest run 422 유지

회귀 grep — *경계 검증*:

```bash
# macOS override 에 titleBarStyle 살아있는지
rg "titleBarStyle|hiddenTitle" src-tauri/tauri.macos.conf.json
# base config 에서 두 키 제거됐는지 (옵션 i) — 0건 또는 platform-conditional 명시
rg "titleBarStyle|hiddenTitle" src-tauri/tauri.conf.json
# Linux 영역 변경 없는지
git diff src-tauri/tauri.linux.conf.json src-tauri/tauri.conf.json | grep -i "linux\|appimage\|deb\|rpm" | head
# TitleBar.tsx 미변경
git diff src/components/tunaflow/TitleBar.tsx  # 빈 출력
# 다른 docs 영역 미변경
git diff README.md CLAUDE.md  # 빈 출력
```

GitHub Actions build.yml:
- Tauri Lite (macos-latest) PASS
- Tauri Lite (windows-latest) PASS
- 기존 build 시간 + alpha (config 변경 영역 작음, 빌드 cache hit 가능)

## 5. e2e 수동 검증

PR 직전 필수 시나리오. Windows 환경 + macOS 환경 모두.

### 회귀 시나리오 (사용자 보고 #264 회복)

Windows 11 또는 Windows 10 x64 환경에서:

1. ✅ `tunaFlow_<v>_x64-setup.exe` 다운로드 + 설치
2. ✅ tunaFlow 실행 → 창 상단에 native titleBar (Windows 기본 캡션바) 표시 + 닫기 / 최소화 / 최대화 버튼 노출
3. ✅ titleBar 영역 드래그 → 창 이동 정상
4. ✅ 우하단 또는 상하/좌우 border 드래그 → 창 리사이즈 정상
5. ✅ 닫기 버튼 클릭 → 정상 종료
6. ✅ 최소화 버튼 → 작업 표시줄로 최소화 / 클릭 시 복원
7. ✅ 최대화 버튼 → 화면 전체 채움 / 다시 클릭 시 복원
8. ✅ Open Project 외 사이드바 / 설정 / 메뉴 / 모든 UI 접근 가능 — devbug 보고의 차단 영역 회복

### 회귀 가드 시나리오 (macOS 정상 path)

macOS 환경에서:

1. ✅ `cargo tauri dev` 또는 `cargo tauri build --target aarch64-apple-darwin`
2. ✅ 좌상단 traffic lights (close / minimize / maximize) 정상 표시 — overlay 위치 보존
3. ✅ titleBar 영역 (traffic lights 포함) 위 한국어 라벨 / 메뉴 / TitleBar 컴포넌트 정상 렌더
4. ✅ 창 드래그 / 리사이즈 macOS 표준 동작
5. ✅ window-state 저장 / 복원 정상 (창 size 가 다음 실행 시 보존)

### Linux 회귀 가드 (자산 빌드 통과만 확인)

GitHub Actions 의 Linux 빌드 잡이 있으면 PASS 확인. 자산 직접 e2e 는 본 PR scope 외 (사용자 환경 의존).

GUI 환경 제약: subagent 환경에서 직접 e2e 불가능한 시나리오는 unit test 시뮬레이션 또는 *"v0.1.X-beta 외부 사용자 검증으로 최종 확인"* 으로 위임 명시.

## 6. CI 정책

- PR 직후 admin merge 즉시 가능 (CI watch 불필요) — *macOS / Windows / Linux 빌드 잡 모두 통과* 한 상태 자체가 검증
- 자체 검증 §4 + e2e §5 통과한 상태로 self-merge
- merge 후 main 에서 회귀 발생 시 즉시 revert PR 생성

release timing:
- 본 PR 머지 → Windows 자산 즉시 회복. devbug 환경에서 자가 회복 path 작동
- **release 분리 권장**: v0.1.6-beta-2 patch suffix (단일 axis hotfix, 빠른 release 24~48시간) 또는 RT plan 과 묶어서 v0.1.7-beta minor — 사용자 결정 영역
- release notes 강조: *"Windows 사용자: native titleBar / 창 control / 드래그·리사이즈 회복 (devbug #264)"*

## 7. 보고 포맷

작업 완료 시 chat 으로 다음 형식 회신:

```
## PR (Windows 캡션바 hotfix #264)
- 변경 라인: +N / -M (tauri.conf.json + tauri.macos.conf.json + INSTALL.md)
- §4 Verification:
  - cargo check: PASS
  - cargo test --lib: 614 → 614 (감소 없음)
  - tsc --noEmit: PASS
  - vitest run: 422 → 422 (감소 없음)
  - GitHub Actions build.yml: macOS / Windows / Linux 모두 PASS
- §5 e2e 수동:
  - 회귀 시나리오 (Windows): ✅ 8 항목 통과 — native titleBar / control / 드래그·리사이즈 회복
  - 회귀 가드 (macOS): ✅ 5 항목 통과 — traffic lights overlay 보존
  - Linux 자산 빌드: ✅ PASS (e2e 는 위임)
- 회귀 grep:
  - rg titleBarStyle src-tauri/ → macOS override 에만 / base 0건 (옵션 i 채택 시)
  - git diff TitleBar.tsx → 빈 출력
  - git diff README.md CLAUDE.md → 빈 출력
- PR URL: https://github.com/hang-in/tunaFlow/pull/<n>

## DO NOT 영역 침범 없음 확인
- INV-WCB-1 (macOS overlay 동작 보존): macOS e2e 5 항목 ✅
- INV-WCB-3 (Linux 자산 회귀 0): build.yml Linux 잡 PASS
- INV-WCB-4 (TitleBar.tsx 변경 0): diff 0
- INV-WCB-5 (window-state 영역 변경 0): grep + diff 0
- src-tauri/Cargo.toml / Cargo.lock / DB / 사용자 설정 영역 diff 0
```

## 8. 막히면

- **Tauri 2 platform-conditional override 파일 (`tauri.macos.conf.json`) 인식 실패** → 1차 옵션 (i) → 2차 옵션 (ii) base + Windows-specific decorations 추가 → 둘 다 실패 시 chat 보고 + Architect escalate. Tauri docs 재검토 영역
- **Windows 환경 e2e 검증 머신 부재** → CI artifact (`tunaFlow_*_x64-setup.exe`) 직접 다운로드 + 사용자 (또는 가용 Windows VM) 환경 e2e 위임. PR description 에 *"Windows e2e 사용자 검증 위임"* 명시
- **macOS 영역에 미세 회귀 발견** (예: traffic lights 이동 / 라벨 깨짐) → 즉시 PR 보류 + Architect 보고. macOS 영역 회귀는 본 plan 의 INV-WCB-1 위반
- **빌드 시간 timeout** (1시간 이상) → chat 보고. 단순 config 변경 영역이라 정상은 ~10-15분
- **분기 조건 광범위 변경 위험** → 옵션 (i) 채택 시 base config 의 변경 라인 최소화 (key 2개 제거 + decorations true 추가만). 다른 키 영역 손대지 말 것
- **Linux 자산 빌드 실패** → 본 PR scope 외 영역에 영향 갔다는 신호. base config 변경이 Linux 영역까지 cascade 하는지 검토 + 영향 시 macOS override 한정으로 변경 좁힘

## 9. 사용자 답변 정책 (외부 issue #264)

devbug 외부 사용자 답변 주체 / timing:

1. **Plan 머지 직후** (이미 완료, 2026-05-07): Architect 가 issue #264 댓글
   - 보고 감사
   - root cause 한 줄 (macOS 전용 옵션 cross-platform 적용)
   - fix 진행 timeline (PR 머지 후 v0.1.X-beta release 시점)
   - 임시 workaround 인정: *"v0.1.6-beta 이전 자산 재설치는 회복 안 됨, v0.1.X-beta 부터 자가 회복"*
2. **PR 머지 직후**: Architect 가 issue #264 추가 댓글
   - PR URL + 머지 commit sha
   - release timing (patch suffix v0.1.6-beta-2 또는 minor v0.1.7-beta — release 결정 따라)
3. **release publish 직후**: Architect 가 issue #264 회복 안내 댓글 + close
   - release URL
   - 자가 회복 안내: *"v0.1.X-beta `x64-setup.exe` 재설치 후 native titleBar / 창 control 정상 표시 확인 부탁"*
   - 회귀 가드 시나리오 (macOS / Linux) 영향 0 안내

한국어 본문, 코드 / 경로 / commit sha / PR URL 원문. devbug 외부 보고 batmania52 패턴 (당일 plan + 빠른 회복 + 한국어).
