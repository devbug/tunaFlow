---
title: Developer 핸드오프 — 영역별 폰트 크기 / 패밀리 사용자 설정
plan: docs/plans/customFontSettingsPlan_2026-05-12.md
created_at: 2026-05-12
---

# 0. 한 줄 요약

외부 사용자 요청 — 채팅 / 코드 블록 / 사이드바 3 영역의 폰트 size + family 사용자 설정. min 10 / max 24 / step 1. Settings UI 신규 섹션 "Appearance / Fonts". v0.1.8-beta-4 묶음 release.

# 1. SSOT
- **Plan**: `docs/plans/customFontSettingsPlan_2026-05-12.md` (§3 Subtasks T1~T5 라인 단위 SSOT)

# 2. PR 전략 — 단일 PR

5 task 모두 한 PR (`feat/custom-font-settings`). 각 task 별 commit 분리:

| commit | task |
|---|---|
| `feat(settings): fontSettings slice + clamp setter (T1)` | T1 |
| `feat(settings): Appearance / Fonts UI section + i18n (T2)` | T2 |
| `feat(theme): inject font CSS variables on settings change (T3)` | T3 |
| `feat(chat,code,sidebar): apply font CSS variables to 3 regions (T4)` | T4 |
| `test(settings): font settings clamp + UI + injection coverage (T5)` | T5 |

각 trailer:
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

# 3. 작업 순서

T1 → T2 → T3 → T4 → T5 의존 순서. push 전 전체 cargo check + tsc 통과 확인.

# 4. DO — 반드시 지킬 것

1. **defaults 보존** — fontSettings 미설정 사용자는 현재와 동일 렌더링. 회귀 0 (INV-CFS-1)
2. **size clamp 양쪽** — T1 setter + T2 NumberInput 모두 [10, 24] clamp. UI 단에서도 step 1
3. **family 빈 값 fallback chain** — 빈 문자열 → CSS variable 에 token (`var(--tf-default-sans)` / `mono`) 폴백. 잘못된 family 도 브라우저 graceful 처리
4. **debounce 200ms** — 빠른 입력 시 re-render 폭풍 차단 (slider/spinner 연속 입력)
5. **inline style 우선** — Tailwind arbitrary value 보다 `style={{ fontSize: 'var(--tf-chat-size)' }}` 직접 사용 (JIT 토큰 감지 실패 회피, `feedback_tw4_cn_token` 메모리 정책)
6. **3 영역 한정 적용** — chat message body / code block / sidebar 만. 다른 영역 (MetaFloatingChat / PlanProposalCard / Settings 자체 / 등) 변경 X
7. **i18n ko/en 동시 추가** — `appearance.fonts.*` 9 키 모두 양쪽 locale 작성
8. **변경 즉시 반영** — 앱 재시작 불필요 (INV-CFS-5). useEffect 로 CSS variable 동기화

# 5. DO NOT — 사이드 이펙트 차단

- ❌ Rust / DB schema / agent 영역 변경 X (frontend + settings JSON 한정)
- ❌ 새 dependency 추가 X (Tailwind / inline style / 기존 settings persistence 만)
- ❌ 폰트 weight / line-height / letter-spacing / color 추가 X (Non-goals)
- ❌ 영역 확장 (terminal / artifact viewer / 등) X — 후속 plan
- ❌ 폰트 preset (small/medium/large) X
- ❌ 영역 동기화 옵션 ("3 영역 모두 같은 size") X — 후속 UI 개선
- ❌ size 0 또는 음수 허용 X (clamp 통과 시 default 로 회복)
- ❌ family 검증 (font-availability API 호출 등) X — 브라우저 fallback 신뢰
- ❌ CHANGELOG / 매니페스트 직접 수정 X — Architect 가 release tag push 단계에 보강
- ❌ DB migration / schema_version bump X (INV-CFS Non-goals)

# 6. Verification (전체)

각 commit 또는 PR 머지 직전:

```bash
cd src-tauri && cargo check --message-format=short    # 변경 0 확인
npx tsc --noEmit
npx vitest run
```

baseline 카운트 (현재 main `1c2335a`):
- Rust: 변경 0 (frontend only) — 동일 카운트 유지
- Frontend: 신규 test +N (T5 의 clamp + UI + injection)

회귀 grep:
```bash
git diff src-tauri/                                                # 변경 0
git diff src/components/tunaflow/MessageItem.tsx | head            # markdown 본문 래퍼에 fontSize/Family 적용 확인
rg "fontSettings|--tf-chat-size|--tf-code-size|--tf-ui-size" src/  # 정의 + 사용 양쪽
rg "appearance.fonts" src/locales/{ko,en}/settings.json            # 9 키 ko/en 모두 존재
```

# 7. e2e 수동 검증

가능한 한 자동 + 사용자 영역 분리.

**자동 (vitest)**
- T1 setter [10, 24] clamp (10 미만 / 24 초과 / NaN → default)
- T2 NumberInput 입력 → store 갱신
- T3 fontSettings 변경 → `document.documentElement.style` 의 CSS variable 갱신
- T4 chat / code / sidebar 의 rendered DOM 의 computed style 확인 (또는 inline style attribute assertion)

**사용자 영역 (Tauri dev)**
- chat 으로 메시지 송수신 → message body 폰트 변경 즉시 반영
- code block (```) 안 폰트 변경
- sidebar 항목 (conv / plan / artifact) 폰트 변경
- size 24 입력 후 다시 10 → 가독성 확인
- family `'JetBrains Mono', monospace` 입력 시 code block 적용

# 8. CI 정책

PR 직후 admin merge 즉시 가능 (`gh pr merge --squash --delete-branch --admin`). CI watch 불필요 — frontend + settings 한정 변경, cross-platform 회귀 위험 0. 자체 검증 §6 통과 후 self-merge.

머지 후 main 회귀 의심 시 즉시 revert PR.

# 9. 보고 포맷 (chat)

```
## Custom Font Settings 결과
- PR URL + 머지 commit
- task 별 변경 라인 수 + 핵심 파일
- §6 Verification: cargo check PASS / tsc PASS / vitest 신규 +N / 기존 회귀 0
- §7 e2e 자동 PASS / 사용자 영역 list
- 회귀 가드 grep 결과 1줄 (src-tauri/ diff 0, 영역 외 변경 0)
- 9 i18n 키 ko/en 양쪽 추가 확인
```

# 10. 막히면 (escalate)

- Tailwind 4 JIT 가 arbitrary value 안 잡으면 → inline `style={{}}` 으로 fallback (이미 §4-5 권장)
- debounce 200ms 가 답답하면 → 100ms 로 줄이거나 controlled input 으로 즉시 반영, chat 보고
- 영역 적용 시 기존 CSS specificity 충돌 → CSS variable 우선순위 + `!important` 최소 사용, 진단 후 chat 보고
- font-family 빈 값 처리에서 CSS variable chain 깨지면 → token 직접 inline (변수 폴백 안 거치고), chat 보고
- T4 적용 후 `MessageItem` rendering 회귀 → 즉시 revert + 보고
