---
title: 영역별 폰트 크기 / 패밀리 사용자 설정 — 외부 요청 follow-up
status: ready
priority: P1 (외부 사용자 요청, v0.1.8-beta-4 묶음 release)
created_at: 2026-05-12
---

# 0. Context

외부 사용자: "채팅 폰트 크기 조정할 수 있게 해달라". Architect 확장 결정 — **영역별 size + family** 설정. v0.1.8-beta-4 의 rawq Windows hotfix (PR #284) 와 같은 cycle 에 묶어 publish.

## 다른 IDE 조사 (settings 패턴 비교)

| IDE | size key | family key | min~max | step | 영역 분리 |
|---|---|---|---:|---:|---|
| **VS Code** | `editor.fontSize` (14), `chat.editor.fontSize`, `terminal.integrated.fontSize`, `markdown.preview.fontSize` 등 | `editor.fontFamily`, `terminal.integrated.fontFamily` 등 | 6 ~ 100 | 1 | editor / chat / terminal / markdown / sidebar 별도 |
| **Cursor** | VS Code fork — 동일 | 동일 | 동일 | 1 | 동일 |
| **JetBrains** | Editor / Console / Tool windows 별 size | Settings → Editor → Font / Console Font | 4 ~ 72 | 1 | editor / console / UI 분리 |
| **Sublime** | `font_size` (단일) | `font_face` (단일) | 8 ~ 72 | 1 | 글로벌만 |
| **Zed** | `buffer_font_size`, `ui_font_size`, `terminal.font_size` | `buffer_font_family`, `ui_font_family` 별도 | 6 ~ 100 | 1 | buffer / UI / terminal 분리 |

**공통 패턴**: 영역 분리 (chat / code block / UI) + size 정수 step 1 + family 는 system fonts string. tunaFlow 는 VS Code / Zed 모델 채택 (chat / code-block / UI 3 영역).

# 1. Invariants

- **INV-CFS-1**: settings 가 미설정인 사용자는 현재와 동일 렌더링 (default = current Tailwind 토큰). 회귀 0.
- **INV-CFS-2**: size 입력은 정수 step 1. min 미만 / max 초과 입력은 UI 단계에서 clamp.
- **INV-CFS-3**: family 는 빈 문자열 또는 system fallback chain. 잘못된 family 입력해도 브라우저가 fallback 으로 graceful 처리.
- **INV-CFS-4**: 3 영역 (chat message body / code block / sidebar UI) 별도 키. 한 영역 변경이 다른 영역에 안 새어나감.
- **INV-CFS-5**: settings 변경은 즉시 반영 (re-render trigger). 앱 재시작 불필요.

# 2. Goals / Non-goals

## Goals
- chat / code-block / sidebar 3 영역의 size + family 사용자 설정
- min/max clamp + step 1
- Settings UI 의 새 섹션 "외관 / Appearance" 하위 "폰트"

## Non-goals (이번 cycle 외)
- 영역 추가 (terminal / plan-document / artifact viewer 등) — 후속 plan
- font weight / line-height / letter-spacing 등 — 후속
- 폰트 preset (small/medium/large) — 후속
- 영역별 theme color — 별 axis

# 3. Subtasks

## T1 — Zustand settings slice 확장 + DB 영속화 (P0)

- `src/stores/slices/settingsSlice.ts` (또는 기존 settings store) 에 신규 필드:
  ```ts
  fontSettings: {
    chatSize: number;        // default 14
    chatFamily: string;      // default '' (Tailwind 토큰 폴백)
    codeSize: number;        // default 13
    codeFamily: string;      // default '' (monospace 토큰 폴백)
    uiSize: number;          // default 13
    uiFamily: string;        // default ''
  }
  ```
- min 10, max 24 (size). 기존 settings persistence (Tauri command 또는 localStorage) 에 동일 path 추가.
- 검증: setter clamp 로직 unit test (10 미만 → 10, 24 초과 → 24, NaN → default).

## T2 — Settings UI 신규 섹션 "Appearance / Fonts" (P0)

- `src/components/tunaflow/settings/AppearanceSection.tsx` 신규
- 3 영역 × 2 control (size NumberInput + family Input/Select) = 6 컨트롤
- size: `<input type="number" min={10} max={24} step={1}>` + 입력 시 clamp
- family: `<input type="text" placeholder="예: 'SF Pro', sans-serif">` (빈 값 = 토큰 폴백)
- "초기화" 버튼 (영역별 또는 전체) — default 값 복귀
- 변경 즉시 setter 호출 (debounce 200ms — 빠른 입력 시 re-render 폭풍 차단)
- i18n: `src/locales/{ko,en}/settings.json` — `appearance.fonts.title`, `appearance.fonts.chat_size`, `appearance.fonts.chat_family` 등 9 키

## T3 — CSS variable injection (P0)

- `src/components/tunaflow/AppShell.tsx` (또는 root provider) 에서 fontSettings 변경 시 `document.documentElement.style.setProperty('--tf-chat-size', `${chatSize}px`)` 등 3 영역 × 2 = 6 CSS variable 주입
- 신규 CSS variable:
  ```css
  :root {
    --tf-chat-size: 14px;
    --tf-chat-family: var(--tf-default-sans);
    --tf-code-size: 13px;
    --tf-code-family: var(--tf-default-mono);
    --tf-ui-size: 13px;
    --tf-ui-family: var(--tf-default-sans);
  }
  ```
- 기존 Tailwind 컴포넌트에서 영역별 className 또는 inline style 로 변수 참조

## T4 — 영역 적용 (P0)

- **chat message body**: `MessageItem.tsx` 의 markdown 본문 래퍼에 `style={{ fontSize: 'var(--tf-chat-size)', fontFamily: 'var(--tf-chat-family)' }}` (또는 동등 className via Tailwind arbitrary value)
- **code block**: `markdownComponents.tsx` (또는 `react-syntax-highlighter` 래퍼) 의 `<pre><code>` 에 `--tf-code-size` / `--tf-code-family` 적용
- **sidebar UI**: `src/components/tunaflow/sidebar/*.tsx` 의 root 또는 `<aside>` 에 `--tf-ui-size` / `--tf-ui-family` 적용
- 다른 영역 (MetaFloatingChat / PlanProposalCard / ReviewVerdictCard / InsightPanel 등) 은 본 plan scope 외 — 영역 추가는 후속 plan

## T5 — 테스트 (P0)

- T1 의 setter clamp unit test (벌써 명시)
- T2 의 settings UI render + 입력 → 상태 갱신 (vitest + Testing Library)
- T3 의 CSS variable 주입 확인 (DOM root style assertion)
- T4 의 chat / code / sidebar 영역에서 CSS variable 적용 (rendered DOM 의 computed style)

# 4. Cross-cutting risks

- **Tailwind 4 JIT 충돌**: arbitrary value (`text-[var(--tf-chat-size)]`) 가 dev 환경에서 안 잡힐 위험. 메모리: `feedback_tw4_cn_token` — JIT 가 cn() 조건부 token 감지 실패 → arbitrary value 사용 권장. 본 plan 은 inline `style={{}}` 우선 (Tailwind 의존 X) 으로 우회.
- **debounce 200ms 와 즉시 반영의 trade-off**: 슬라이더 같은 연속 입력 시 200ms 가 답답할 수도. 일단 200ms 로 시작, 사용자 불만 시 후속 plan 에서 조정.
- **family 빈 값 처리**: 빈 문자열 → CSS variable 에 token (`var(--tf-default-sans)`) 폴백 chain. 잘못 처리하면 system default 까지 떨어져 일관성 깨짐.
- **DB migration**: settings 가 JSON blob 단일 row 면 migration 불필요. 새 nested field 추가만. 별 schema_version bump 안 함 (별도 컬럼 없음).

# 5. Rollback

영역별 commit 분리라 (T1 → T2 → T3 → T4 → T5) 단계별 revert 가능. 모든 변경 frontend + settings 영역, Rust / DB / agent 영역 변경 0.

# 6. 다음 step

1. Developer 핸드오프 작성 — `docs/prompts/customFontSettingsDeveloperHandoff_2026-05-12.md`
2. Developer subagent dispatch (worktree 격리, admin merge 정책)
3. 머지 후 CHANGELOG `[0.1.8-beta-4]` entry 에 본 변경 추가
4. tag `v0.1.8-beta-4` push (사용자 확인 후) → Draft release
