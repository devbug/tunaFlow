# CLI 도구 최적화 — speedy-claude 패턴 적용

> Status: idea
> Created: 2026-04-03
> Updated: 2026-04-03 (코더 Opus 리뷰 반영)
> 출처: `_research/_util/speedy-claude/` (NousResearch)
> 목적: 개발자 CLI 생산성 향상 + 에이전트 대규모 작업 시 보조

---

## 1. 문제

### 1.1 개발자 본인의 CLI 생산성

터미널에서 파일 탐색/검색/치환에 기본 도구(find, grep, sed)를 쓰면 느리다. Modern CLI 도구로 10-64x 개선 가능.

### 1.2 에이전트의 파일 작업 (제한적)

speedy-claude의 원래 전제는 "Claude Code의 Read+Edit 루프를 bash 파이프라인으로 대체"인데, **tunaFlow 환경에서 실효성이 제한적**입니다.

**이유**: tunaFlow의 Developer 에이전트는 CLI agent(claude, codex, gemini)를 subprocess로 실행. 이 CLI들은 자체 tool system(Read, Edit, Grep)을 우선 사용하므로, CLAUDE.md에 "sd를 써라"라고 적어도 내장 도구 대신 bash를 선택할지 보장할 수 없습니다.

**실효성이 있는 경우**:
- 에이전트가 Bash tool로 쉘 명령을 직접 실행할 때 (빌드, 테스트, 대규모 리팩토링)
- 50+ 파일 일괄 치환처럼 Read+Edit 루프가 명백히 비효율적인 경우

**실효성이 없는 경우**:
- 일반적인 코드 수정 (에이전트가 자체 Edit 도구를 선호)
- 파일 읽기 (에이전트가 자체 Read 도구를 사용)

---

## 2. 설치 필요 도구

### 핵심 (brew install 한 줄)

```bash
brew install fd ripgrep sd bat jq git-delta difftastic eza
```

| 도구 | 대체 대상 | 속도 개선 | 핵심 용도 |
|------|----------|----------|----------|
| `fd` | `find` | 64x | 파일 찾기 (.gitignore 자동 존중) |
| `ripgrep` (rg) | `grep -r` | 6x | 코드 검색 (SIMD 가속) |
| `sd` | `sed` | 12x | 정규식 치환 (BSD/GNU 차이 없음) |
| `bat` | `cat` | — | 구문 강조 파일 보기 |
| `jq` | `python3 -c` | 1.8x | JSON 파싱 (네이티브 C) |
| `delta` | git diff pager | — | 구문 강조 diff |
| `difftastic` (difft) | `diff` | — | AST 기반 구조 비교 |
| `eza` | `ls` | — | 아이콘 + 색상 디렉토리 목록 |

### 추가 (선택)

```bash
brew install amber sad zoxide tree watchexec lazygit
```

| 도구 | 설치 명령 | 실행 명령 | 용도 |
|------|----------|----------|------|
| amber | `brew install amber` | `ambr` | 코드베이스 전체 대화형 치환 (538파일 490ms) |
| `sad` | diff 미리보기 후 치환 |
| `zoxide` | 디렉토리 점프 (`z` 명령) |
| `tree` | 디렉토리 구조 (JSON 출력 지원) |
| `watchexec` | 파일 변경 감지 → 자동 재실행 |
| `lazygit` | git TUI |

### 설치 후 설정

```bash
# delta를 git diff pager로 설정
git config --global core.pager delta
git config --global interactive.diffFilter "delta --color-only"

# zoxide 초기화 (선택)
echo 'eval "$(zoxide init zsh)"' >> ~/.zshrc
```

---

## 3. 에이전트에게 가르치는 방법

### 3.1 CLAUDE.md에 규칙 추가

프로젝트 CLAUDE.md 또는 `~/.claude/CLAUDE.md`에 아래 규칙을 추가하면, Claude Code가 자동으로 빠른 도구를 선택합니다.

```markdown
## CLI 도구 최적화 규칙

### 도구 대체 테이블

| 피해야 할 것 | 사용할 것 | 이유 |
|-------------|----------|------|
| `find . -name "*.ts"` | `fd -e ts` | 64x 빠름, .gitignore 존중 |
| `grep -r "pattern"` | `rg "pattern"` | 6x 빠름, SIMD 가속 |
| `sed -i 's/old/new/g'` | `sd 'old' 'new'` | 12x 빠름, BSD/GNU 차이 없음 |
| `cat file` | `bat file` | 구문 강조, 줄 번호 |
| `ls -la` | `eza -la` | 아이콘, 색상, git 상태 |
| `diff a b` | `difft a b` | AST 기반, 구조 비교 |
| `python3 -c "import json..."` | `jq '.field'` | 1.8x 빠름, 파이프 친화적 |

### 워크플로우 규칙

**규칙 1: Read+Edit 루프 금지**
```
WRONG: Grep → Read file1 → Edit file1 → Read file2 → Edit file2 → ... (N×2 tool call)
RIGHT: ambr 'old' 'new'                                    (1 command)
RIGHT: fd -e ts | xargs sd 'old' 'new'                     (1 command)
```

**규칙 2: 검색 + 컨텍스트를 한 번에**
```
WRONG: rg 'myFunc' → Read each result file                 (N+1 calls)
RIGHT: rg -n 'myFunc' -C 5                                 (1 command, 전후 5줄 포함)
RIGHT: rg -n 'myFunc' --type ts -l | xargs bat             (파일 전체 구문 강조)
```

**규칙 3: 구조적 diff 사용**
```
WRONG: git diff main → Read changed files for context      (multiple calls)
RIGHT: difft main...HEAD                                   (1 command, AST 기반)
```

**규칙 4: 병렬 실행이 기본**
- `fd -x` — 기본 병렬 실행 (별도 플래그 불필요)
- `rg` — 자동 멀티스레드
- `ambr` — 기본 10스레드

**규칙 5: 파이프라인 > 루프**
```
WRONG: for f in $(find . -name "*.ts"); do wc -l "$f"; done
RIGHT: fd -e ts | xargs wc -l
RIGHT: fd -e ts -x wc -l                                   (병렬)
```

**규칙 6: JSON은 jq로**
```
WRONG: python3 -c "import json; print(json.load(open('data.json'))['key'])"
RIGHT: jq '.key' data.json
RIGHT: cat response.json | jq '.data[].name'
```
```

### 3.2 tunaFlow Developer 템플릿에 추가

`DEVELOPER_TEMPLATE` (`project_tools.rs`)에 조건부 규칙 추가:

```markdown
## CLI 도구 최적화 (설치되어 있는 경우)

아래 도구가 설치되어 있으면 기본 도구 대신 사용하세요:
- `fd` (find 대체) — `which fd` 로 확인
- `rg` (grep 대체) — `which rg` 로 확인
- `sd` (sed 대체) — `which sd` 로 확인
- `ambr` (전체 치환) — `which ambr` 로 확인

**핵심 원칙**: 파일을 하나씩 Read+Edit 하지 말고, 한 번의 커맨드로 일괄 처리하세요.
```

### 3.3 Skills로 제공

`~/.tunaflow/skills/` 에 `cli-optimization.md` 스킬로 제공:

```markdown
---
name: cli-optimization
vendor: tunaflow
description: Modern CLI tools for fast file operations
keywords: [file, search, replace, grep, find, sed, diff]
---

# CLI 최적화

(위 규칙 내용 포함)
```

Developer persona의 `recommendedSkills`에 포함하면 구현 시 자동 주입.

---

## 4. 벤치마크

### 4.1 tunaFlow 코드베이스 실측 (2026-04-03)

| 작업 | 기존 도구 | 최적화 도구 | 속도 차이 | 판정 |
|------|----------|-----------|----------|------|
| 파일 찾기 (*.ts 48개) | `find` 1716ms | `fd` 15ms | **114x** | **확실히 효과적** |
| JSON 파싱 (100회) | `python3` 1855ms | `jq` 289ms | **6.4x** | **확실히 효과적** |
| 코드 검색 (conversationId) | `grep -r` 31ms | `rg` 16ms | **2x** | 소규모 프로젝트에서 차이 작음. 대형에서 벌어짐 |
| 치환 (단일 파일) | `sed` 4ms | `sd` 7ms | 비슷 | 단일 파일에서 차이 없음. **멀티 파일에서 차이남** |
| 구조적 diff | `diff` ~0ms | `difft` 1697ms | difft가 느림 | AST 파싱 비용. **속도 아닌 출력 품질용** |

**결론**:
- `fd`, `jq` — 확실히 효과적. 항상 추천
- `rg` — 대형 코드베이스에서 가치. 소규모에서는 grep과 큰 차이 없음
- `sd` — 멀티 파일 일괄 치환에서 가치. 단일 파일은 sed와 동일
- `difft` — 속도가 아니라 품질 도구. 리뷰/비교 시 사용

### 4.2 speedy-claude 참고치 (직접 측정 아님)

> 아래 수치는 speedy-claude 프로젝트의 측정값이며, tunaFlow 환경 실측이 아닙니다.

| 시나리오 | 파일 수 | 기존 방식 | 최적화 | 속도 개선 |
|---------|--------|----------|--------|----------|
| 멀티 파일 치환 | 47 | Read+Edit ~95s | `rg \| sad -k` 67ms | ~1400x |
| 코드베이스 리네임 | 538 | 순차 ~538s | `ambr` 490ms | ~1100x |
| 파일 찾기 | 733 | `find` 3573ms | `fd` 56ms | 64x |
| 대용량 정규식 치환 | 1 (large) | `sed` 11.3s | `sd` 0.94s | 12x |
| JSON 추출 | 1 | `python3 -c` 56ms | `jq` 31ms | 1.8x |

---

## 5. 적용 방안 (3가지 경로)

### 경로 A: CLAUDE.md 직접 추가 (가장 간단)

tunaFlow 프로젝트의 CLAUDE.md에 §3.1 규칙을 직접 추가.

**장점**: 즉시 효과, 코드 변경 없음
**단점**: 프로젝트마다 수동 추가 필요

### 경로 B: Developer 템플릿에 포함 (자동화)

`DEVELOPER_TEMPLATE`에 §3.2 규칙을 포함. 모든 프로젝트의 Developer 에이전트에 자동 적용.

**장점**: 한 번 추가하면 모든 프로젝트에 적용
**단점**: ContextPack 토큰 사용 증가 (~300-500 토큰)

### 경로 C: Skill로 제공 (선택적)

§3.3처럼 스킬로 제공. Developer persona가 필요할 때만 주입.

**장점**: 선택적, 토큰 낭비 없음
**단점**: 스킬 시스템 고도화 후 가능

### 권장 순서

```
1. 먼저 본인 환경에서 테스트 (brew install + CLAUDE.md 추가)
2. 효과 확인 후 → 경로 B (Developer 템플릿에 포함)
3. 스킬 시스템 고도화 후 → 경로 C (Skill로 전환)
```

---

## 6. 주의사항

### 도구 미설치 환경 대응

```markdown
## 조건부 사용 규칙

아래 도구는 **설치되어 있을 때만** 사용하세요.
설치 여부는 `which <도구>` 로 확인합니다.
설치되어 있지 않으면 기본 도구(find, grep, sed)를 사용하세요.
```

에이전트가 `ambr`이 없는 환경에서 `ambr`을 실행하면 에러. 조건부 사용 규칙이 필수.

### ContextPack 토큰 비용

전체 규칙(§3.1)을 포함하면 ~500 토큰. Lite 모드에서는 주입하지 않고, Standard 이상에서만 포함하는 게 적절합니다.

### 사용자 환경 다양성

tunaFlow 사용자가 이 도구들을 설치했다는 보장이 없습니다. 따라서:
- tunaFlow 문서에 "권장 도구" 섹션으로 안내
- 설치 스크립트 제공 (speedy-claude의 install.sh 참고)
- 미설치 시 graceful fallback (기본 도구 사용)

---

## 참고

- speedy-claude 소스: `_research/_util/speedy-claude/`
- speedy-claude CLAUDE.md: `_research/_util/speedy-claude/CLAUDE.md` (182줄, 9개 규칙)
- speedy-claude install.sh: `_research/_util/speedy-claude/install.sh` (183줄)
- tunaFlow Developer 템플릿: `src-tauri/src/commands/project_tools.rs` (DEVELOPER_TEMPLATE)
- tunaFlow CLAUDE.md: `/Users/d9ng/privateProject/tunaFlow/CLAUDE.md`
- tunaFlow Skills: `~/.tunaflow/skills/`
- 관련: `clawSoulsPersonaSpecIdea.md` (recommendedSkills 패턴)
- 관련: `hermesAgentPatternsIdea.md` (Toolset Composition 패턴)
