---
title: rawq → CRG 파이프라인 — 두 sidecar 결과 결합 구조화
status: ready-to-implement
priority: P1 (베타 후 첫 주 작업 우선순위)
created_at: 2026-04-24
related:
  - src-tauri/src/agents/rawq.rs
  - src-tauri/src/agents/crg.rs
  - src-tauri/src/commands/agents_helpers/context_pack/rawq_section.rs
  - docs/posts/07-rawq-code-review-graph.md
---

# rawq → CRG 파이프라인

## TL;DR

현재 rawq (코드 검색) 와 code-review-graph (AST impact 분석) 는 **병렬로 돌고 결과가 ContextPack 에 따로 꽂힘**. 에이전트가 두 섹션을 각각 읽고 머릿속에서 조합해야 하는데 실제로는 잘 못함. **rawq 결과의 파일 목록을 CRG impact 입력으로 넘겨서 "관련 파일 + 그 파일 수정 시 blast radius" 가 한 섹션으로 합쳐지는 파이프라인** 이 목표. 반나절~1일.

## 현재 구조

```
[prompt]
  ├─→ rawq search  → SearchResult (file, snippet, score)  ──→ ContextPack §rawq
  └─→ CRG query    → ImpactResult (file, impact_files)    ──→ ContextPack §crg
```

두 섹션이 독립. 에이전트는:
- §rawq 에서 "관련 함수 위치" 학습
- §crg 에서 "이 파일 바꾸면 어디가 깨지는지" 학습
- 머릿속에서 "이 함수 바꾸면 어디 깨지지?" 를 결합해야 함

실제로는 잘 안 됨 (사용자 체감).

## 목표 구조

```
[prompt]
  └─→ rawq search (1~5 hits)
       └─→ CRG impact(rawq_hit.file)  — 각 hit 별 blast radius 계산
            └─→ 합쳐진 섹션: "관련 파일 + 그 파일 수정 시 영향 파일"
```

## 핵심 변경점

### 1. 새로운 combined 섹션 빌더

파일: `src-tauri/src/commands/agents_helpers/context_pack/combined_code_section.rs` (신규) 또는 기존 `rawq_section.rs` 확장.

pseudocode:

```rust
pub fn build_combined_code_section(
    query: &str,
    rawq_hits: &[rawq::SearchResult],
    crg_enabled: bool,
) -> Option<String> {
    if rawq_hits.is_empty() { return None; }

    let mut out = String::from("## Relevant code + impact\n\n");
    for hit in rawq_hits.iter().take(RAWQ_MAX_RESULTS) {
        out.push_str(&format!("### {}:{}\n", hit.file, hit.line));
        out.push_str(&format!("```\n{}\n```\n", hit.snippet));

        if crg_enabled {
            if let Ok(impact) = crg::impact(&hit.file, CRG_IMPACT_DEPTH) {
                if !impact.is_empty() {
                    out.push_str("**Touching this file may affect:**\n");
                    for f in impact.iter().take(CRG_IMPACT_MAX_FILES) {
                        out.push_str(&format!("- {}\n", f));
                    }
                    out.push('\n');
                }
            }
        }
    }
    Some(out)
}
```

### 2. ContextPack 조립 경로 변경

`prompt_assembly.rs::build_normalized_prompt_with_budget()` 에서:

- 기존: `build_rawq_section()` 과 `build_crg_section()` 을 각각 호출
- 변경: `build_combined_code_section(query, rawq_hits, crg_available)` 한 번만 호출
- CRG 가 독립적으로 다른 용도 (예: "plan 이 영향 주는 파일" 선행 조회) 에 쓰이면 그 경로는 유지

### 3. CRG 없을 때 graceful fallback

CRG 가 설치 안 됐거나 (`crg::is_available() == false`) daemon 응답 실패 시 impact 만 생략하고 rawq 결과만 출력. 기존 동작과 동일.

### 4. 캐싱

동일 파일에 대한 CRG impact 는 ContextPack 생성 주기 안에서 **중복 쿼리 방지**. 간단한 `HashMap<PathBuf, Vec<PathBuf>>` 로 커버 가능.

## Invariants

- **[INV-1]** CRG 미사용 환경에서도 rawq 결과는 기존과 동일하게 출력된다. (fallback)
- **[INV-2]** rawq hit 가 0 이면 CRG 호출 없음. 불필요한 subprocess spawn 금지.
- **[INV-3]** CRG impact 결과는 최대 `CRG_IMPACT_MAX_FILES = 10` 개로 제한. ContextPack 토큰 폭주 방지.
- **[INV-4]** 각 rawq hit 의 file path 는 프로젝트 root 상대 경로로 정규화된 뒤 CRG 에 전달. 절대 경로 사용 시 CRG 쪽 index lookup 실패.
- **[INV-5]** 결합 섹션 총 토큰이 ContextPack tier (Lite/Standard/Full) 예산을 초과하면 rawq hit 수부터 깎고, 그다음 파일별 impact 수를 깎는다 (토큰 보호 순서 고정).

## Developer 핸드오프

```
[작업] rawq → CRG pipeline 섹션 도입

[SSOT] docs/plans/sidecarPipelinePlan_2026-04-24.md 먼저 읽기.

[파일]
- 신규: src-tauri/src/commands/agents_helpers/context_pack/combined_code_section.rs
  (또는 rawq_section.rs 에 확장)
- 수정: src-tauri/src/commands/agents_helpers/send_common/prompt_assembly.rs (조립 경로)
- 수정: CRG 호출 fallback 처리 확인 (crg.rs 의 is_available / query 인터페이스)

[동작]
1. rawq search (기존 그대로) → top N hit
2. CRG enabled 시 각 hit.file 에 대해 impact 조회 (병렬 OK, 순차도 OK)
3. 결합 섹션 문자열 조립
4. ContextPack 에 한 덩어리로 삽입

[검증]
- cargo test --lib
- 수동: 실제 프로젝트에서 send_with_budget 실행 후 ContextPack 출력에 "Relevant code + impact" 섹션이 나오는지
- CRG 없는 환경 (crg 바이너리 제거) 에서 rawq 만 나오는지 fallback 확인
- rawq 0 hit 일 때 CRG 호출 로그가 나오지 않는지

[커밋]
- feat(contextpack): combine rawq hits with CRG impact radius
- refactor(prompt): drop parallel rawq/crg sections in favor of unified one
- test: fallback coverage (CRG missing / rawq empty)

[PR]
feat(contextpack): rawq → CRG pipeline (single combined section)
```

## Rationale

### 왜 지금 하나

7 편에서 "두 sidecar 조합이 약하다" 를 한계로 기록했는데, 사용자 피드백이 "우선 처리" 로 잡음. 실제로 이 조합이 약한 건 에이전트의 blast-radius 인식도를 낮추는 직접 원인이고, Review 품질에도 영향을 줌.

### 왜 "rawq hit 기반 CRG 트리거" 인가

반대 방향 — "CRG impact 로 파일 찾고 → rawq 로 그 파일들의 스니펫 추출" — 도 가능하지만, 사용자 질문은 **자연어로 들어오고** (rawq 적합), CRG 는 **파일 경로 기반 탐색** 이라 rawq 를 entry 로 두는 것이 자연스러움.

### 왜 하나의 섹션으로

분리돼 있으면 에이전트가 머릿속에서 조인해야 하는데 실패율이 높음. 한 섹션으로 주면 "이 파일 + 영향 파일" 을 한 눈에 보고 고민할 수 있음.

## 관련

- `docs/posts/07-rawq-code-review-graph.md` — 이 plan 의 공개된 맥락 (위키)
- `src-tauri/src/agents/rawq.rs` — rawq 인터페이스
- `src-tauri/src/agents/crg.rs` — CRG 인터페이스
