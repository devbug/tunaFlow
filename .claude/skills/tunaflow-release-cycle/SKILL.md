---
name: tunaflow-release-cycle
description: tunaFlow의 새 버전을 publish하는 11단계 사이클을 실행한다. CHANGELOG 갱신 → 3곳 version bump → tag → build watch → release notes → publish → external issue 회복 안내 댓글 → issue close 까지 한 흐름. tunaFlow 작업 중 "릴리즈 하자", "v0.X.Y-beta 발행", "다음 patch release", "이번 fix들 묶어서 publish", "issue 회복 안내", "release tag 만들기" 같은 의도가 보이면 반드시 이 스킬을 사용한다. 단계 순서가 어긋나거나 누락되면 자산이 stale 한 release 가 되거나 사용자가 fix 적용 사실을 모르므로 정확히 따른다.
---

# tunaFlow Release Cycle

새 버전을 main → release tag → published → user notification 까지 한 흐름으로 실행한다.

## 왜 이 순서인가

각 단계는 다음 단계의 *전제조건* 이다:
- CHANGELOG / version bump 가 commit 안 되어있으면 tag 가 잘못된 sha 를 가리킴
- Tag push 가 build.yml 트리거 — tag 가 main HEAD 가 아니면 빌드가 옛 코드를 빌드함
- Build draft 상태에서 publish 누르면 release URL 확정 → 그 URL 을 issue 댓글에 첨부 가능
- Issue close 는 마지막 — 댓글 게시 전에 close 하면 사용자 알림이 약해짐 (close + comment 분리)

순서가 어긋나면 *자산은 publish 됐는데 사용자는 모르는* 케이스 또는 *issue 는 close 됐는데 자산이 stale* 한 케이스 발생.

## 언제 쓰는가

- 외부 issue fix 묶음 머지 직후 release
- Architectural fix 누적되어 minor bump 시점 (sentinel preservation 같은 새 동작 추가)
- Hotfix 빌드 자산 교체 (같은 tag 재사용 / 또는 patch suffix bump)
- Beta cycle 중 version 진행 (v0.1.5-beta → v0.1.6-beta)

Stable release (`v1.0.0` 같은) 는 별도 ceremony — beta cycle 만 이 스킬 영역.

## Version 결정

| 변경 영역 | bump |
|---|---|
| 기능 추가 / 새 동작 정책 (예: sentinel migration) | minor (`0.1.4-beta` → `0.1.5-beta`) |
| 단순 hotfix / 회귀 fix | patch suffix (`0.1.5-beta` → `0.1.5-beta-2`) 또는 minor — 변경 영향 크기로 결정 |
| 빌드 자산만 교체 (코드 변경 0) | tag 재생성 (같은 version, 다른 sha) |

minor bump 가 default. patch suffix 는 같은 cycle 내 두 번째 hotfix 일 때만.

## 11 단계 플로우

### Step 1 — CHANGELOG.md 신규 섹션 prepend

`CHANGELOG.md` 의 head 에 새 버전 섹션을 *prepend* (기존 [0.1.X-beta] 위로):

```markdown
## [0.1.Y-beta] - YYYY-MM-DD

🩹 **<한 줄 요약 — 외부 사용자 이름 / 영역>**.

### Fixed

- **<영역 한 줄>** ([PR #N](URL), issue [#M](URL)) — <root cause + fix 한 단락>

### Added

- **<영역 한 줄>** ([PR #N](URL)) — <새 동작 설명>

### Notes

- <누적 정보 / 제한된 영역 변경 / 기타>
```

이모지 (🩹 / 🚨) 는 외부 사용자 hotfix / 긴급 패치 표시용. 일반 minor bump 면 생략.

### Step 2 — 3곳 version bump

세 파일 동시 수정:

```bash
src-tauri/Cargo.toml          # version = "0.1.Y-beta"
src-tauri/tauri.conf.json     # "version": "0.1.Y-beta"
package.json                  # "version": "0.1.Y-beta"
```

세 파일 중 하나 누락하면 빌드된 자산의 metadata 가 mixed — Tauri installer 와 binary 가 다른 version 을 보고함. 동시 수정 필수.

### Step 3 — Cargo.lock auto-sync

`cd src-tauri && cargo check --message-format=short` 실행. Cargo.lock 의 `tuna-flow` 항목이 새 version 으로 자동 업데이트됨. 별도 commit 필요.

### Step 4 — Commit + push

```bash
git add CHANGELOG.md package.json src-tauri/Cargo.lock src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "chore(release): v0.1.Y-beta — <한 줄 요약>

<3~5 줄: 머지된 PR 목록 + 영역 요약>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

이 commit 의 sha 가 tag 가 가리키는 위치. Tag push 전에 main 이 이 sha 로 진행되어야 함.

### Step 5 — Tag 생성 + push

```bash
git tag -a v0.1.Y-beta -m "v0.1.Y-beta — <한 줄 요약>" <step-4-commit-sha>
git push origin v0.1.Y-beta
```

`git push origin v0.1.Y-beta` 가 build.yml workflow 의 `on.push.tags` 트리거. Tag push 직후 GitHub Actions 에서 build run 시작.

### Step 6 — Build watch (background)

```bash
gh run list --workflow=build.yml --limit 1 --json databaseId,status,headBranch,headSha
# 새 run id 확인 (headBranch=v0.1.Y-beta, headSha=step-4-commit)
gh run watch <run-id> --exit-status
```

`gh run watch` 는 background 로 실행 — 완료시 자동 알림. Build 시간 ~10-15분 (macOS arm64 + Windows x64 matrix).

Build 실패 시:
- Tauri Lite (macos-latest) "Verify rawq sidecar staged" 단계 실패 = download-artifact race (transient flake) → `gh run rerun <id> --failed`
- 다른 단계 실패면 단계별 로그 확인 — root cause 진단 필요

### Step 7 — Release draft 확인

Build 성공 후 build.yml 의 tauri-action 이 release 를 draft 상태로 자동 생성:

```bash
gh release view v0.1.Y-beta --json isDraft,assets,publishedAt
```

Draft = `isDraft: true`, `publishedAt: null`. 자산 3개 (macOS dmg + macOS app.tar.gz + Windows x64-setup.exe) 가 uploaded 상태인지 확인. 자산 URL 의 path 가 `untagged-<hash>` 형식이면 draft, publish 후 `v0.1.Y-beta` 로 변경됨.

### Step 8 — Release notes 갱신

build.yml 이 default 본문 (Lite 트랙 안내 + Gatekeeper) 만 작성. 그 위에 CHANGELOG 의 새 버전 섹션을 prepend:

```bash
cat > /tmp/v0.1.Y-beta-notes.md <<'EOF'
🩹 **<요약>** — <영역>

## Fixed
- ...

## Added
- ...

## Notes
- ...

---

## Lite 트랙 (rawq 번들)
[기존 default 본문 유지]
EOF

gh release edit v0.1.Y-beta --notes-file /tmp/v0.1.Y-beta-notes.md --draft=false --prerelease
```

`--draft=false` 가 publish 전환. `--prerelease` 는 beta tag 면 항상 (Latest 릴리즈로 표시되지 않음).

### Step 9 — Publish 확인

```bash
gh release view v0.1.Y-beta --json isDraft,publishedAt,assets --jq '{isDraft, publishedAt, asset_names: [.assets[].name]}'
```

`isDraft: false`, `publishedAt: "<ISO timestamp>"` 확인. 자산 URL 이 `releases/download/v0.1.Y-beta/<filename>` 형식.

### Step 10 — 외부 issue 회복 안내 댓글

각 외부 issue 에 회복 안내 댓글 게시. 형식:

```markdown
@<username> 보고해주신 [영역] [v0.1.Y-beta](https://github.com/hang-in/tunaFlow/releases/tag/v0.1.Y-beta) ([PR #N](URL)) 에서 fix 되었습니다. <감사 한 줄> 🙏

## Root cause

[3~5줄: 무엇이 어디서 어떻게]

## Fix

[2~3줄: 어떤 변경으로 해결]

## 검증 요청 (선택)

다음 시나리오 직접 확인 부탁드립니다:
1. [재현 path]
2. [기대 동작]
3. [회귀 가드 — 다른 영역 정상 작동]

회귀 가드 시나리오 영향 없도록 분기 최소 변경 했지만, 환경별 차이 가능성 있으니 발견 시 알려주세요.
```

여러 issue 면 file 로 분리 후 `gh issue comment <N> --body-file ...` — 하나의 cat heredoc 으로 batch.

### Step 11 — Issue close

각 외부 issue close — close 와 댓글을 한 번에:

```bash
gh issue close <N> --reason completed --comment "v0.1.Y-beta 배포로 fix 적용 완료. 자가 회복 path 회복 확인 후 추가 회귀 발견 시 새 issue 또는 본 issue 재개 부탁드립니다."
```

Step 10 댓글이 이미 게시된 후 close — close 자체로도 사용자 알림 (issue closed event) 발생.

PR description 에 `Closes #N` 이 있었으면 PR 머지 시점에 자동 close 됐을 수도 있음. `Closes part of #N` 같은 한정어는 GitHub auto-close 파서가 무시 — 그 경우 이 단계에서 수동 close.

## Lessons learned (반복 회피)

- **Closes 키워드는 마지막 PR 에만**: 부분 해소 PR 의 description 에 "Closes #N" 쓰면 그 PR 머지 시 issue 가 close 되어 다른 task 가 미해소 상태로 close 됨. 중간 PR 은 `Refs #N` 또는 본문에 "Closes part of #N (영역 A)" — 마지막 PR 에만 명시적 `Closes #N`.
- **3 곳 version bump 누락 검증**: `grep "0.1.X-beta" src-tauri/Cargo.toml src-tauri/tauri.conf.json package.json src-tauri/Cargo.lock` 로 신/구 version 혼재 여부 확인.
- **Tag push 전 main 동기화**: `git pull origin main` 필수 — local main 이 stale 한 상태에서 tag 만들면 tag 가 옛 sha 가리킴.
- **Build run 의 download-artifact 단계 실패는 보통 transient**: rerun 이 1차 대응. 2회 연속 실패하면 root cause 진단.

## 빌드 실패 케이스별 대응

| 실패 단계 | 가능 원인 | 1차 대응 |
|---|---|---|
| `Verify rawq sidecar staged` | download-artifact v4 race | `gh run rerun <id> --failed` |
| `Build & release (Lite)` 의 cargo build | Cargo.lock 의 version 불일치 | local 에서 cargo check 후 재 push |
| `Tauri Lite (windows-latest)` 의 NSIS | Windows installer config 충돌 | tauri.conf.json 의 windows 섹션 review |
| `actions/upload-artifact` | GitHub 일시 장애 | 30분 대기 후 rerun |

연속 2회 실패 + 다른 case 면 build.yml 의 단계 로그 직접 확인. 코드 / config 영역이면 별 PR 로 fix 후 새 cycle.

## Patch suffix 대안 (같은 cycle 내 두 번째 hotfix)

같은 minor cycle 안에서 두 번째 hotfix 가 필요하면 (예: v0.1.5-beta 자산이 빠진 fix 가 추가 발견), patch suffix:

- Version: `v0.1.5-beta-2`
- Tag: `v0.1.5-beta-2`
- 같은 build.yml workflow 트리거
- Release notes 에 *v0.1.5-beta 위에 누적되는 hotfix* 명시
- v0.1.5-beta release 는 그대로 두고 v0.1.5-beta-2 가 새 release entry

minor bump (v0.1.6-beta) 도 가능 — 변경 영향 크기로 판단.

## Version 검증 체크

publish 직전 self-check:

- [ ] CHANGELOG.md head 의 새 버전 섹션 + `[0.1.X-beta] - 2026-XX-XX` 헤더 일관
- [ ] 3 파일 (Cargo.toml + tauri.conf.json + package.json) version 동일
- [ ] Cargo.lock 의 tuna-flow version 동일
- [ ] Tag annotated message 가 release notes 와 일관
- [ ] Build run sha = step 4 commit sha
- [ ] Release notes 본문이 CHANGELOG 새 섹션 + Lite 트랙 default 본문 둘 다 포함
- [ ] 외부 issue 댓글이 release URL 과 PR URL 모두 첨부

## Skill 적용 후 흐름

새 release cycle 진입 시 이 스킬 호출 → 11 단계를 순차 실행. 사용자 confirm 이 필요한 지점:
- Step 6 build watch 진입 전 — sha / version 확정 확인
- Step 8 publish 직전 — release notes 본문 검토 기회
- Step 11 issue close 직전 — 댓글 본문 검토 기회

다른 단계는 자동 진행 가능 (1~5 + 7 + 9 ~ 10 의 댓글 게시까지).
