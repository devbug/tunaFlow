---
title: 모바일 페어링 LAN 노출 토글
status: ready
phase: planning
priority: P2 (보안 강화 — devbug 외부 보고)
created_at: 2026-05-07
canonical: true
related:
  - src-tauri/src/http_api/mod.rs  # bind 주소 분기
  - src-tauri/src/bootstrap/services.rs  # start_server 호출 + setting read
  - src/components/tunaflow/settings/RuntimeSection.tsx  # 토글 UI
  - src/locales/{ko,en}/settings.json  # i18n
issue_source: GitHub #270 — devbug (2026-05-07)
---

# 모바일 페어링 LAN 노출 토글

## 0. Context

### 0.1 외부 사용자 보고 (devbug, GitHub #270)

HTTP API 가 `0.0.0.0:19840` 으로 무조건 바인드 → 공공 Wi-Fi / 사내 IDS / 보안 정책 환경에서 attack surface 노출. 모바일 페어링 미사용자도 동일 영향.

devbug 명시 권장: **기본값 OFF**, 토글로 사용자 능동 ON.

## 1. Invariants

| ID | 내용 |
|---|---|
| **INV-MP-1** | OFF 기본값 — 신규 + 기존 사용자 모두. 첫 startup 시 setting 키 부재면 OFF. |
| **INV-MP-2** | 기존 모바일 페어링 사용자 회귀 안내 — 첫 startup 1회 toast (*"모바일 페어링 비활성, Settings → Runtime 에서 ON 가능"*). 사용자가 토글 변경 후엔 다시 안 보임. |
| **INV-MP-3** | 토글 변경 시 즉시 효과 없음 — 다음 startup 부터 적용. UI 에 *"재시작 후 적용"* 명시. backend hot-rebind 별 PR 영역. |
| **INV-MP-4** | macOS / Linux 영향 0 — bind 분기는 cross-platform 안전 (default OFF = `127.0.0.1`). 모바일 페어링 사용자가 macOS/Linux 에 있으면 동일 동작 (default OFF). |
| **INV-MP-5** | DB / 사용자 데이터 영향 0 — settings.json 의 신규 키 1개 추가. |

## 2. Subtasks

### Task 01 — Backend bind 분기 + setting read [P2 fix 본체]

- 파일: `src-tauri/src/http_api/mod.rs:126` + `src-tauri/src/bootstrap/services.rs:25`
- 변경:
  - `start_server` 시그니처에 `mobile_pairing_enabled: bool` 인자 추가.
  - `bootstrap/services.rs` 가 startup 시 plugin-store 의 settings.json 을 직접 read (간단한 `fs::read_to_string + serde_json`) → `mobile_pairing_enabled` 추출 → `start_server` 에 전달. 키 부재 / 파싱 실패 → default false.
  - bind 주소: enabled ? `[0, 0, 0, 0]` : `[127, 0, 0, 1]`.
- INV-MP-1/4 충족.

### Task 02 — Settings UI 토글 + i18n [P2]

- 파일: `src/components/tunaflow/settings/RuntimeSection.tsx` 의 *Background Execution* 섹션 아래 새 row 또는 신규 *Mobile Pairing* sub-section
- 변경:
  - 토글 + "재시작 후 적용" 안내 + "이 옵션은 같은 Wi-Fi 의 다른 디바이스가 tunaFlow API 에 접근할 수 있도록 합니다" 한 줄 (devbug 권장 문구 그대로)
  - getSetting/setSetting (`mobile_pairing_enabled`, default false)
- i18n: ko/en `settings.json` 의 `runtime.mobile_pairing` namespace 신규
- INV-MP-3 충족.

### Task 03 — 1회 안내 toast (마이그레이션) [P2]

- 파일: `src/components/tunaflow/AppShell.tsx` init 안에 1회 toast
- 변경:
  - `getSetting("mobile_pairing_migration_seen", false)` 검사 → false 면 toast (sonner) + setSetting true
  - 메시지: *"모바일 페어링이 비활성화되었습니다. Settings → Runtime → Mobile Pairing 에서 다시 켤 수 있습니다."*
- INV-MP-2 충족.

## 3. Verification

- `cargo check --lib` + `cargo test --lib` (회귀 가드: HTTP API 기존 테스트 모두 통과)
- `npx tsc --noEmit` + `npx vitest run`
- dev 모드 smoke: 첫 startup → toast 1회 + bind `127.0.0.1:19840` 확인 (`netstat -ano | grep :19840`). 토글 ON + 재시작 → bind `0.0.0.0:19840` 회복 확인.
- macOS dev smoke: 동일 path (mobile pairing 환경 무관, default OFF 적용)

## 4. Rollback

- Task 01: bind 분기 revert → 기존 `0.0.0.0` 복귀
- Task 02/03: UI / toast 영역, 단독 revert 가능

destructive 영역 없음. setting 키 추가 + bind 분기만.

## 5. Cross-cutting risks

| 위험 | 대응 |
|---|---|
| plugin-store 의 settings.json 위치가 OS 별 다름 | tauri::Manager::path() 의 `app_config_dir()` 사용 — Tauri 가 OS 별 정확한 경로 제공 |
| 기존 사용자 페어링 회귀 | INV-MP-2 의 1회 toast 마이그레이션 안내 |
| settings.json 파일 read 실패 (corrupt / 권한) | default false 로 graceful — 안전 측 |
| bind `127.0.0.1` 변경이 IDE/local automation 영향 | localhost 호출은 그대로 동작 (devbug 보고 §"페어링 OFF 상태에서도 IDE 확장·로컬 자동화 등 localhost 호출은 그대로 동작") |

## 6. Follow-up axis (별 PR)

- 토글 hot-rebind (재시작 없이 즉시 효과) — 현 PR 은 *재시작 후 적용* path 만
- LAN 노출 인디케이터 (메뉴바 또는 페어링 화면의 작은 점) — 별 P3
- 페어링된 디바이스 있을 때 OFF 회색 처리 — 별 P3 (페어링 디바이스 등록 인프라가 현재 어떻게 되어있는지 검토 필요)
