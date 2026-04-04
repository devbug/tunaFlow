# code-review-graph 통합 계획

> Status: idea (P1 — 트리거 조건 거의 충족)
> Created: 2026-04-04
> 관련: `docs/ideas/referenceRepoReviewV2Idea.md` §2

---

## 1. 목적

Developer/Reviewer에게 **코드 변경의 영향 범위, 호출 관계, 테스트 매핑**을 제공.
rawq(검색)와 상호보완 — code-review-graph는 **탐색(traverse)** 담당.

---

## 2. 통합 방식: CLI 계약 기반 sidecar

### 핵심 원칙

CLI JSON 출력을 **계약(contract)**으로 확정. 내부 구현은 Phase별로 교체 가능.

```
tunaFlow (agents/crg.rs)
    ↓ subprocess + JSON stdout 파싱
code-review-graph CLI (Python → 나중에 Rust)
    ↓
SQLite 그래프 스토어
```

tunaFlow는 stdout JSON만 파싱하므로 **뒤가 Python이든 Rust든 코드 변경 0**.

### CLI 계약 (추가할 명령)

현재 존재하는 CLI: `build`, `update`, `status`, `detect-changes`, `serve` (MCP)

**추가할 쿼리 명령**:

```bash
# 1. callers-of: 이 함수를 호출하는 곳
code-review-graph query callers-of "src/api/chat.post.ts::handlePost" --json --depth 2
→ { "target": "...", "callers": [{ "name": "...", "file": "...", "line": 42 }] }

# 2. tests-for: 이 함수를 테스트하는 곳
code-review-graph query tests-for "src/api/chat.post.ts::handlePost" --json
→ { "target": "...", "tests": [{ "name": "...", "file": "...", "line": 10 }] }

# 3. impact: 이 파일들을 바꾸면 영향 받는 범위
code-review-graph query impact "src/api/chat.post.ts,src/utils/qa.ts" --json --depth 2
→ { "changed": [...], "impacted": [...], "risk_score": 0.7 }

# 4. detect-changes: 기존 명령 (이미 존재, JSON 기본 출력)
code-review-graph detect-changes --base HEAD~1
→ { "summary": "...", "files": [...], "risk_scores": {...} }
```

### tunaFlow sidecar (`agents/crg.rs` ~150줄)

```rust
// rawq.rs와 완전히 같은 패턴

pub fn is_available() -> bool { resolve_bin().is_ok() }

pub fn callers_of(project_path: &str, qualified_name: &str, depth: u32)
    -> Result<CallersResult, CrgError> { /* Command::new + JSON parse */ }

pub fn tests_for(project_path: &str, qualified_name: &str)
    -> Result<TestsResult, CrgError> { /* Command::new + JSON parse */ }

pub fn impact(project_path: &str, changed_files: &[String], depth: u32)
    -> Result<ImpactResult, CrgError> { /* Command::new + JSON parse */ }

pub fn detect_changes(project_path: &str, base: &str)
    -> Result<ChangesResult, CrgError> { /* 기존 CLI 호출 */ }
```

미설치 시 `CrgError::NotFound` → graceful skip (rawq 패턴 동일).

---

## 3. 워크플로우 활용

| 단계 | 호출 | 프롬프트에 주입하는 내용 |
|------|------|------------------------|
| **Developer 구현 시** | `impact(changed_files)` | "이 파일 수정 시 영향 받는 함수/모듈 목록" |
| **Developer impl-complete 전** | `tests_for(changed_functions)` | "변경 함수의 테스트 존재 여부" → 자가 검증 |
| **Reviewer 실행 시** | `detect_changes(diff)` | risk-scored 변경 목록 + blast radius |
| **Reviewer 실행 시** | `callers_of(changed_fn)` | "이 함수를 사용하는 곳" → 사이드 이펙트 검증 |

### ContextPack 주입 위치

`prompt_assembly.rs`에 `build_crg_section()` 추가 (skills, rawq와 같은 레벨):

```rust
// Standard+ 모드에서 graph가 available하면 자동 주입
if ctx_mode >= ContextMode::Standard && crg::is_available() {
    if let Some(s) = build_crg_section(&data.prompt, project_path) {
        sections.push(s);
        included_sections.push("graph".into());
    }
}
```

---

## 4. 그래프 동기화

rawq fs watcher 패턴과 동일:

```
에이전트 완료 (agent:completed)
  → rawq re-index (기존)
  → code-review-graph update (추가)
```

`update`는 incremental이라 변경 파일만 재파싱 — 빠름.

---

## 5. 포팅 로드맵

| Phase | 내용 | Python 의존성 | 시점 |
|-------|------|---------------|------|
| **1. Python CLI 확장** | 쿼리 4개 CLI 추가 + tunaFlow sidecar 연동 | 있음 (graceful skip) | 지금 |
| **2. 실사용 검증** | 워크플로우 3+ 풀사이클에서 효과 확인 | 있음 | Phase 1 후 |
| **3. Rust 포팅 (핵심)** | callers-of, tests-for, impact, detect-changes → Rust | 제거 | Phase 2 검증 후 |
| **4. rawq 통합 (선택)** | `rawq graph callers-of` 형태로 rawq에 합침 | 완전 제거 | Phase 3 후 판단 |

### Phase 3 Rust 포팅 시 재사용 가능 자산

| 컴포넌트 | Python 현재 | Rust 포팅 |
|----------|------------|-----------|
| tree-sitter 파싱 | `tree_sitter_languages` 18언어 | **rawq에 이미 있음** — 파서 공유 |
| SQLite 스토어 | `sqlite3` | `rusqlite` (tunaFlow에 이미 있음) |
| BFS/caller/callee | `graph.py` 893줄 | 순수 알고리즘, 직접 포팅 |
| risk scoring | `changes.py` 295줄 | 작음 |
| Leiden 커뮤니티 | `cdlib` Python 전용 | Rust 동등 크레이트 없음 — 생략 또는 후순위 |

### Phase 4 판단 기준

- rawq + graph 호출이 같은 요청에서 항상 함께 일어나면 → 합침 (프로세스 1개)
- 독립적으로 호출되면 → 분리 유지 (각자 최적화)

---

## 6. Python 의존성 관리

개발 단계에서 Python 의존성 허용. 다른 Python 프로젝트 연동도 예상됨.

```bash
# 설치
pip install code-review-graph
# 또는 프로젝트 로컬
cd _research/_util/code-review-graph && pip install -e .

# 확인
code-review-graph --version
code-review-graph status
```

미설치 시 tunaFlow 동작에 영향 없음 (graceful skip).
`docs/how-to/` 가이드에 rawq와 함께 설치 안내 추가 예정.

---

## 7. 구현 순서

### Step 1: code-review-graph CLI 확장 (별도 프로젝트)
- `query` 서브커맨드 추가 (`callers-of`, `tests-for`, `impact`)
- `--json` 플래그 (기본 출력도 JSON이지만 명시적)
- 기존 테스트에 CLI 쿼리 테스트 추가

### Step 2: tunaFlow sidecar 연동
- `src-tauri/src/agents/crg.rs` — resolve_bin + 4개 함수
- `src-tauri/src/lib.rs` — 모듈 등록
- `section_builders.rs` — `build_crg_section()`
- `prompt_assembly.rs` — Standard+ 주입

### Step 3: 워크플로우 통합
- Developer/Reviewer 프롬프트에 graph 정보 주입
- agent:completed 시 `code-review-graph update` 트리거
- TracePanel에 graph 섹션 표시

---

## 참고

- code-review-graph 소스: `_research/_util/code-review-graph/` (Python 12,900줄, 486+ 테스트)
- rawq sidecar 참고: `src-tauri/src/agents/rawq.rs`
- 관련 아이디어: `referenceRepoReviewV2Idea.md`, `architectEnhancementIdea.md`
- CLI 진입점: `code_review_graph/cli.py` — `[project.scripts]` code-review-graph = cli:main
