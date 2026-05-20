---
title: Developer 핸드오프 — v0.1.8-beta-4 Gemini review follow-up (4 항목)
plan: docs/plans/v018Beta4GeminiReviewFollowupPlan_2026-05-20.md
created_at: 2026-05-20
---

# 0. 한 줄 요약

Gemini 가 PR #284 / #285 review 에서 짚은 4 항목 (rawq.rs 2건 + AppearanceSection.tsx 2건) 묶음 fix. v0.1.8-beta-4 tag 재발행 전 머지 필수.

# 1. SSOT
- **Plan**: `docs/plans/v018Beta4GeminiReviewFollowupPlan_2026-05-20.md` (§3 T1~T4 라인 단위)
- Gemini review 출처 (참고):
  - PR #284: https://github.com/hang-in/tunaFlow/pull/284
  - PR #285: https://github.com/hang-in/tunaFlow/pull/285

# 2. PR 전략 — 단일 PR

브랜치: `fix/v018-beta-4-gemini-review-followup`

4 task + (선택) T5 별 commit 분리:
- `fix(rawq): drain-thread pattern on run_index_status (T1, gemini high)`
- `fix(rawq): stabilize loop checks stderr_buf too (T2, gemini medium)`
- `fix(settings): debounce timer cleanup on unmount (T3, gemini medium)`
- `fix(settings): keep raw draft, clamp on blur/flush (T4, gemini medium)`
- (선택) `test(rawq): hang scenario + stderr fail-case coverage (T5)`

각 trailer:
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

# 3. 작업 순서

T1 → T2 → T3 → T4 → (T5). T1·T2 는 같은 파일 (`rawq.rs`) 이라 의존성 cleaner. T3·T4 는 같은 파일 (`AppearanceSection.tsx`).

# 4. DO

1. **PR #284 의 fix 영역 (`search_with_options`) 회귀 0** — drain-thread + timeout 동작 보존 (INV-GR-1)
2. **PR #285 의 fix 영역 (3 영역 CSS variable + Settings UI) 회귀 0** (INV-GR-2)
3. **다른 영역 변경 X** — release scope 안 묶음 (INV-GR-3)
4. **T1 의 drain helper 재사용** — `search_with_options` 의 helper 가 같은 file 안에 있으면 그대로 import. visibility 문제면 `pub(crate)` 또는 inline 동등
5. **T4 의 local state ↔ store sync** — store 의 `fontSettings.chatSize` 가 외부에서 변경되면 local draft 도 동기화 (`useEffect` deps 에 store value)
6. **i18n / locales 변경 X** — UI 텍스트 추가/수정 없음
7. **PR description 에 Gemini review 4 항목 인용** — high/medium 우선순위 명시 + 각 항목 fix 위치

# 5. DO NOT

- ❌ release 묶음 scope 외 변경 (다른 PR / 다른 영역 / refactor)
- ❌ 새 dependency 추가
- ❌ DB / migration / agent 영역 변경
- ❌ font settings 의 새 영역 추가 (terminal / artifact viewer 등)
- ❌ debounce 시간 임의 변경 (T4 옵션 A 채택 시 debounce 보존, 옵션 B 채택 시만 800ms)
- ❌ Gemini suggestion 외 영역 손대기 (예: clamp 범위 변경, store schema 변경)

# 6. Verification

```bash
cd src-tauri && cargo check --message-format=short
cd src-tauri && cargo test --lib                   # baseline 회귀 0 (rawq 영역 +N if T5)
npx tsc --noEmit
npx vitest run                                     # FE 447 baseline 유지 또는 +n
```

회귀 grep:
```bash
git diff src-tauri/src/agents/rawq.rs              # T1+T2 영역만 (search_with_options 외)
git diff src/components/tunaflow/settings/AppearanceSection.tsx  # T3+T4 영역만
git diff src-tauri/ -- ':!src-tauri/src/agents/rawq.rs'  # 변경 0
git diff src/ -- ':!src/components/tunaflow/settings/AppearanceSection.tsx'  # 변경 0
```

# 7. e2e 수동 검증 (가능한 한)

- **T1**: rawq daemon hang 시나리오 재현 → `index_status` 호출 시 timeout 또는 정상 응답 (Windows 환경 우선, macOS smoke)
- **T2**: rawq subprocess fail case → stderr 본문이 에러 메시지에 포함 (capture)
- **T3**: Settings panel 열고 size 입력 후 panel 닫기 → React warning 없음 (devtools 콘솔)
- **T4**: chat size input 에 `15` 입력 → 입력 중 `1` 단계에서 안 튕김. blur 또는 debounce flush 후 15 로 clamp

# 8. CI 정책

PR 직후 `gh pr merge --squash --delete-branch --admin` 즉시 머지. CI watch 불필요 (rawq + frontend, cross-platform 회귀 위험 영역이지만 검증 cycle full set PASS 통과 후 self-merge).

다만 머지 후 tag 재발행 예정이라 CI 의 build 영역 (Windows runner) 효과는 새 build 가 알려줌. self-trust 정책.

# 9. 보고 포맷 (chat)

```
## Gemini Review Follow-up 결과
- PR URL + 머지 commit
- task 별 변경 라인 수 + 핵심 파일
- §6 Verification 결과 (cargo check / cargo test / tsc / vitest)
- §7 e2e 결과 (자동 / 사용자 영역 분리)
- 회귀 가드 grep 결과 1줄 (영역 외 변경 0)
- T1 drain helper 재사용 여부 (inline / import / pub(crate))
- T4 옵션 결정 (A: onBlur clamp / B: debounce 800ms)
```

# 10. 막히면 (escalate)

- T1 의 `spawn_drain_thread` 가 visibility 문제로 import 불가 → `pub(crate)` 추가 또는 inline. 결정 chat 보고
- T2 의 stderr_buf 도 stable 안 되는 edge case (long-running stderr fill) → timeout 우선 또는 max iteration cap
- T3 의 cleanup 이 첫 mount cycle 깨뜨리면 → `useEffect` dependency 검토 후 보고
- T4 의 local state ↔ store sync 가 외부 변경 시 desync → `useEffect` 로 동기화. 그래도 안 되면 controlled vs uncontrolled trade-off chat 보고
- 검증 cycle 회귀 → 즉시 중단 + chat 보고

# 11. Worktree 안전 가드

- macOS APFS case-insensitive: Edit 절대 경로가 worktree 안인지 sanity check
- `git rev-parse --abbrev-ref HEAD` commit 직전
- main repo 변경 발견 시 즉시 `git checkout HEAD -- <path>`
- git stash drop/pop 금지 (apply 만)

# 12. 주의사항

- autonomous — 사용자 질문 금지 (위 escalate 외)
- 한국어 commit / chat 보고
- 핸드오프 / plan SSOT — 외부 추가 컨텍스트 불필요
- 단계 끝나면 Architect 가 CHANGELOG entry 보강 + build cancel + tag 재발행 진행
