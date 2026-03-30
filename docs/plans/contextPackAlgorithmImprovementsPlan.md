# ContextPack 알고리즘 개선 계획

- 작성: 2026-03-30
- 대상: `context_pack.rs`, `guardrail.rs`, `compression.rs`
- 원칙: 외부 의존성 0. entroly/claw-compactor는 알고리즘 레퍼런스로만 사용. 필요한 것만 직접 구현.

---

## 현재 파이프라인의 병목

```
agents.rs에서의 ContextPack 어셈블리 (L85–L234):

  identity          → 그대로
  project_context   → 그대로
  base_system_prompt → 그대로
  plan_section      → truncate(2,000)
  findings_section  → truncate(3,000)
  artifacts_section → truncate(2,000)
  skills_section    → truncate(8,000)
  rawq_section      → truncate(4,000)
  cross_session     → claude 압축 or truncate(6,000)    ← 병목 ①
  thread_inheritance → 그대로
  context_summary   → claude 압축 or truncate(8,000)    ← 병목 ②

  combine_prompt_parts(전부)
  enforce_total_limit(60,000)                            ← 병목 ③
```

| # | 병목 | 현재 방식 | 문제 |
|---|------|----------|------|
| ① | cross-session 압축 | Claude 서브프로세스 호출 | LLM 추론 비용 + 1–3초 지연 |
| ② | context_summary 압축 | 동일 | 동일 |
| ③ | 총 예산 배분 | 하드코딩 상수 → 뒤에서 잘림 | 중요한 섹션이 잘릴 수 있음 |
| ④ | rawq 결과 품질 | confidence + line dedup | 보일러플레이트 코드가 높은 유사도 받을 수 있음 |
| ⑤ | rawq 결과 해상도 | 전부 풀 스니펫 (300자) | 같은 예산에 커버리지 제한적 |

---

## 개선 항목별 설계

### P1. 규칙 기반 텍스트 축소 — Claude 호출 제거

**병목:** ①②
**레퍼런스:** claw-compactor `structural_collapse.py`, `tokenizer_optimizer.py`, `semantic_dedup.py`
**목표:** `compression.rs`의 `compress_context_with_claude()` 호출을 규칙 기반으로 대체하여 LLM 비용과 지연 제거

#### 구현할 규칙 (우선순위순)

**규칙 1: 반복 메시지 접기**

대화 컨텍스트에서 동일하거나 거의 동일한 메시지가 반복되면 접는다.

레퍼런스: claw `semantic_dedup.py` L91–177 (shingle 기반 Jaccard)

```rust
/// context_pack.rs에 추가
/// 3-word shingle Jaccard 유사도로 근사 중복 탐지.
fn jaccard_similar(a: &str, b: &str, threshold: f64) -> bool {
    let shingles = |s: &str| -> HashSet<&str> {
        // 단어 3-gram 셋 구축 — 정확한 SimHash 필요 없음
        // 단어 split → 슬라이딩 윈도우 → HashSet
    };
    let sa = shingles(a);
    let sb = shingles(b);
    let intersection = sa.intersection(&sb).count();
    let union = sa.union(&sb).count();
    if union == 0 { return false; }
    (intersection as f64 / union as f64) >= threshold
}

/// 대화 턴 배열에서 Jaccard >= 0.8인 연속 턴을 접는다.
/// "[assistant] ... (2 similar responses omitted)" 형태로 대체.
fn fold_similar_turns(rows: &[(String, String)]) -> Vec<(String, String)> {
    // 연속된 동일 role + Jaccard >= 0.8이면 첫 번째만 유지
    // 나머지는 "[... N similar turns folded]"로 대체
}
```

적용 위치: `build_context_summary()`, `build_cross_session_section()`에서 rows를 포맷팅하기 전에 `fold_similar_turns()` 적용.

예상 효과: 에이전트가 같은 질문을 반복하거나, RT에서 유사한 응답이 여러 개인 경우 30–50% 축소.

**규칙 2: 마크다운 포맷 경량화**

레퍼런스: claw `tokenizer_optimizer.py` L40–78

```rust
/// guardrail.rs 또는 별도 모듈에 추가
fn strip_markdown_formatting(text: &str) -> String {
    // 1. **bold** → bold (2토큰 절약/건)
    // 2. *italic* → italic
    // 3. 연속 빈 줄 → 단일 빈 줄
    // 4. 들여쓰기 4칸 초과 → 4칸으로 정규화
    // 5. 단순 단어의 `backtick` → backtick 제거
}
```

적용 위치: `enforce_total_limit()` 직전, 또는 개별 섹션 빌드 시.

예상 효과: 전체 프롬프트에서 3–8% 토큰 절감. 적용 비용 거의 0.

**규칙 3: import 블록 접기**

레퍼런스: claw `structural_collapse.py` L42–60, L197–236

rawq 결과에 코드 스니펫이 포함될 때, import 블록이 길면 접는다.

```rust
/// rawq 결과 스니펫에 적용
fn collapse_imports(code: &str) -> String {
    // 연속된 import/from/require 줄이 3개 이상이면:
    // 첫 줄 + "[... N imports]" + 마지막 줄
    // 나머지 코드는 그대로 유지
}
```

적용 위치: `build_rawq_section()`에서 snippet 포맷팅 시.

예상 효과: rawq 결과당 10–30% 축소 (import 헤비한 파일의 경우).

**규칙 4: Claude 압축 fallback 유지**

규칙 1–3 적용 후에도 섹션이 제한을 초과하면, 그때만 Claude 호출.
현재는 무조건 호출 → 규칙 우선, Claude는 최후 수단.

```rust
// compression.rs 수정
pub fn maybe_compress_section_typed(section: Option<String>, limit: usize, section_type: Option<&str>) -> Option<String> {
    let s = section?;

    // 1단계: 규칙 기반 축소 (비용 0, 지연 0)
    let reduced = apply_rules(&s, section_type);

    if reduced.len() <= limit {
        return Some(reduced);   // Claude 호출 불필요
    }

    // 2단계: 그래도 초과하면 Claude 압축 (기존 로직)
    // ...
}

fn apply_rules(text: &str, section_type: Option<&str>) -> String {
    let mut result = strip_markdown_formatting(text);
    if section_type == Some("context") || section_type == Some("cross-session") {
        // fold_similar_turns는 구조화된 데이터에만 적용
        // 여기서는 텍스트 수준의 중복 제거
        result = collapse_repeated_lines(&result);
    }
    result
}
```

**총 구현량:** ~120줄 Rust
**의존성:** 0
**위험도:** 낮음 — 규칙이 텍스트를 줄이지 않으면 기존 경로 그대로 사용

---

### P2. 섹션 우선순위 기반 동적 예산 배분

**병목:** ③
**레퍼런스:** entroly `knapsack.rs` L285–400 (개념만. KKT 냅색은 과잉)
**목표:** `guardrail.rs`의 하드코딩 상수를 상황 인식 동적 배분으로 교체

#### 현재 문제

```
MAX_PLAN_SECTION      = 2,000    항상 고정
MAX_RAWQ_SECTION      = 4,000    rawq 결과가 0개여도 4,000 예약
MAX_SKILLS_SECTION    = 8,000    스킬 1개면 500자인데 8,000 예약
MAX_CROSS_SESSION     = 6,000
MAX_CONTEXT_SECTION   = 8,000
MAX_FINDINGS_SECTION  = 3,000
MAX_ARTIFACTS_SECTION = 2,000
────────────────────────────────
합계                   33,000    (60,000 중 55% 이미 할당)
```

나머지 27,000자에 identity + project_context + base_system_prompt + thread_inheritance가 들어감.
문제: 어떤 섹션은 비어 있는데 예산은 예약됨. 다른 섹션은 풍부한데 잘림.

#### 설계: 우선순위 비례 배분

```rust
// guardrail.rs에 추가

/// 섹션 메타데이터: 이름, 콘텐츠, 최소 보장, 최대 허용, 우선순위 가중치
struct SectionBudget {
    name: &'static str,
    content: Option<String>,
    min_chars: usize,       // 무조건 보장 (0이면 생략 가능)
    max_chars: usize,       // 이 이상은 의미 없음
    weight: f64,            // 우선순위 (높을수록 잔여 예산 더 많이 받음)
}

/// 총 예산을 섹션별로 동적 배분.
/// 1단계: 비어있는 섹션 제외, 존재하는 섹션에 min_chars 보장
/// 2단계: 잔여 예산을 weight 비례로 분배 (max_chars 상한)
/// 3단계: max에 도달한 섹션의 잉여를 나머지에 재분배
fn allocate_budget(sections: &[SectionBudget], total_budget: usize) -> Vec<usize> {
    // 존재하는 섹션만 필터
    let active: Vec<_> = sections.iter()
        .filter(|s| s.content.is_some())
        .collect();

    // 1단계: 최소 보장 합산
    let min_total: usize = active.iter().map(|s| s.min_chars).sum();
    let remaining = total_budget.saturating_sub(min_total);

    // 2단계: 가중치 비례 배분
    let weight_sum: f64 = active.iter().map(|s| s.weight).sum();
    let mut budgets: Vec<usize> = active.iter().map(|s| {
        let extra = ((remaining as f64) * s.weight / weight_sum) as usize;
        (s.min_chars + extra).min(s.max_chars)
    }).collect();

    // 3단계: max 도달 섹션의 잉여 재분배 (1회)
    let used: usize = budgets.iter().sum();
    if used < total_budget {
        let leftover = total_budget - used;
        let expandable: Vec<usize> = budgets.iter().enumerate()
            .filter(|(i, b)| **b < active[*i].max_chars)
            .map(|(i, _)| i)
            .collect();
        if !expandable.is_empty() {
            let share = leftover / expandable.len();
            for &i in &expandable {
                budgets[i] = (budgets[i] + share).min(active[i].max_chars);
            }
        }
    }

    budgets
}
```

#### 가중치 기본값

| 섹션 | min | max | weight | 근거 |
|------|-----|-----|--------|------|
| context_summary | 2,000 | 12,000 | 3.0 | 가장 중요 — 대화 연속성 |
| rawq | 0 | 6,000 | 2.5 | 코드 관련 질문일 때만 |
| skills | 0 | 10,000 | 2.0 | 활성 스킬 수에 비례 |
| plan | 0 | 3,000 | 1.5 | 진행 중 플랜이면 중요 |
| findings | 0 | 3,000 | 1.5 | RT 결과 있을 때 |
| cross_session | 0 | 8,000 | 1.0 | 보조 컨텍스트 |
| artifacts | 0 | 2,000 | 1.0 | 보조 |
| thread_inheritance | 500 | 2,000 | 2.0 | 브랜치면 필수 |

#### 적용 위치

`agents.rs` L193–214에서 현재:
```rust
let plan_s = guardrail::truncate_section(plan_section, guardrail::MAX_PLAN_SECTION);
let rawq_s = guardrail::truncate_section(rawq_section, guardrail::MAX_RAWQ_SECTION);
// ... 각각 독립적으로 truncate
```

변경 후:
```rust
let budgets = guardrail::allocate_budget(&[
    SectionBudget { name: "context", content: context_summary.clone(), min: 2000, max: 12000, weight: 3.0 },
    SectionBudget { name: "rawq", content: rawq_raw.clone(), min: 0, max: 6000, weight: 2.5 },
    // ...
], guardrail::MAX_TOTAL_PROMPT - fixed_sections_len);

let plan_s = guardrail::truncate_section(plan_section, budgets[idx_plan]);
let rawq_s = guardrail::truncate_section(rawq_raw, budgets[idx_rawq]);
// ...
```

**총 구현량:** ~80줄 Rust (allocate_budget + SectionBudget + 호출부 수정)
**의존성:** 0
**참고:** entroly knapsack.rs의 KKT 이분탐색은 연속 확률 변수에 대한 최적화 — 여기서는 섹션 7개에 대한 정수 배분이므로 가중치 비례 배분이 충분하고 정확함.

---

### P3. rawq 결과 정보 밀도 스코어링

**병목:** ④
**레퍼런스:** entroly `entropy.rs` L26–49 (Shannon entropy), L419–446 (information score)
**목표:** rawq confidence에 정보 밀도 점수를 곱해서 보일러플레이트/저정보 코드 필터링

#### 문제

rawq의 confidence는 쿼리-코드 임베딩 유사도. 높은 유사도 ≠ 높은 정보 가치.

예: `import os; import sys; import json; ...` 같은 import 블록도 쿼리와 관련 있으면 높은 confidence를 받을 수 있음.

#### 설계: 바이트 엔트로피 기반 정보 밀도

```rust
/// context_pack.rs에 추가
///
/// Shannon 엔트로피 (bits/byte). 범위 0.0–8.0.
/// - 0.0 = 모든 바이트 동일 (예: "aaaaaaa")
/// - ~4.5 = 일반 코드
/// - ~7.5 = 압축/암호화 데이터
///
/// 레퍼런스: entroly entropy.rs L26–49
fn byte_entropy(data: &[u8]) -> f64 {
    if data.is_empty() { return 0.0; }
    let mut counts = [0u32; 256];
    for &b in data { counts[b as usize] += 1; }
    let len = data.len() as f64;
    let mut entropy = 0.0;
    for &c in &counts {
        if c > 0 {
            let p = c as f64 / len;
            entropy -= p * p.log2();
        }
    }
    entropy
}

/// 코드 스니펫의 정보 밀도 점수 (0.0–1.0).
/// - 엔트로피가 너무 낮으면 (반복/보일러플레이트) 페널티
/// - 엔트로피가 너무 높으면 (minified/base64) 페널티
/// - 빈 줄 비율이 높으면 페널티
fn information_density(snippet: &str) -> f64 {
    let entropy = byte_entropy(snippet.as_bytes());
    let lines: Vec<&str> = snippet.lines().collect();
    let total = lines.len().max(1) as f64;
    let blank_ratio = lines.iter().filter(|l| l.trim().is_empty()).count() as f64 / total;

    // 엔트로피 점수: 3.5–5.5 범위가 최적 (일반 코드)
    let entropy_score = if entropy < 2.0 {
        entropy / 2.0           // 극히 반복적
    } else if entropy > 6.5 {
        1.0 - (entropy - 6.5) / 1.5   // 고엔트로피 (minified)
    } else {
        1.0
    };

    // 빈 줄 페널티: 50% 이상 빈 줄이면 감점
    let blank_penalty = if blank_ratio > 0.5 {
        1.0 - (blank_ratio - 0.5)
    } else {
        1.0
    };

    (entropy_score * blank_penalty).clamp(0.0, 1.0)
}
```

#### 적용 위치

`build_rawq_section()`에서 정렬 기준 변경:

```rust
// 현재: confidence만으로 정렬
results.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(Ordering::Equal));

// 변경: confidence × information_density 복합 점수
results.sort_by(|a, b| {
    let score_a = a.confidence * information_density(&a.snippet);
    let score_b = b.confidence * information_density(&b.snippet);
    score_b.partial_cmp(&score_a).unwrap_or(Ordering::Equal)
});
```

**총 구현량:** ~45줄 Rust
**의존성:** 0
**위험도:** 낮음 — 기존 정렬 기준에 가중치를 곱할 뿐. density가 1.0이면 기존과 동일 동작.

---

### P4. rawq 다해상도 출력

**병목:** ⑤
**레퍼런스:** entroly `skeleton.rs` (코드 스켈레톤), `hierarchical.rs` L54–78 (3레벨 표현)
**목표:** rawq 결과를 해상도별로 출력하여 같은 예산에 더 많은 파일 커버

#### 설계

현재: 5개 결과 × 300자 = 1,500자 (+ 헤더)

변경:
- **상위 2개** (confidence ≥ 0.8): 풀 스니펫 (최대 400자)
- **3~5번째** (confidence 0.5–0.8): 시그니처만 (최대 100자)
- **6~8번째** (confidence 0.4–0.5): one-line 레퍼런스

```rust
/// 코드 스니펫에서 함수/구조체 시그니처만 추출.
/// 전체 바디를 제거하고 선언부만 유지.
///
/// 레퍼런스: entroly skeleton.rs
fn extract_signature(snippet: &str) -> String {
    let mut signatures = Vec::new();
    for line in snippet.lines() {
        let trimmed = line.trim();
        // 함수/메서드/클래스 선언 패턴
        if trimmed.starts_with("fn ")
            || trimmed.starts_with("pub fn ")
            || trimmed.starts_with("async fn ")
            || trimmed.starts_with("def ")
            || trimmed.starts_with("class ")
            || trimmed.starts_with("struct ")
            || trimmed.starts_with("impl ")
            || trimmed.starts_with("function ")
            || trimmed.starts_with("export ")
            || trimmed.contains("func ")
        {
            // 시그니처: 여는 중괄호/콜론까지만
            let sig = if let Some(pos) = trimmed.find('{') {
                &trimmed[..pos]
            } else if let Some(pos) = trimmed.find(':') {
                // Python def/class
                &trimmed[..=pos]
            } else {
                trimmed
            };
            signatures.push(sig.trim_end().to_string());
        }
    }
    if signatures.is_empty() {
        // fallback: 첫 비어있지 않은 줄
        snippet.lines()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("")
            .to_string()
    } else {
        signatures.join("\n")
    }
}
```

#### 적용 위치

`build_rawq_section()` 포맷팅 변경:

```rust
for (i, r) in results.iter().enumerate() {
    let meta = match &r.scope {
        Some(s) => format!(" ({}, {:.0}%)", s, r.confidence * 100.0),
        None => format!(" ({:.0}%)", r.confidence * 100.0),
    };

    if i < 2 {
        // 풀 스니펫
        let snippet = truncate_str(&r.snippet, 400);
        out.push_str(&format!("\n`{}` L{}{}:\n{}\n", r.file, r.line, meta, snippet));
    } else if i < 5 {
        // 시그니처만
        let sig = extract_signature(&r.snippet);
        out.push_str(&format!("\n`{}` L{}{}: {}\n", r.file, r.line, meta, truncate_str(&sig, 120)));
    } else {
        // 한 줄 레퍼런스
        out.push_str(&format!("- `{}` L{}{}\n", r.file, r.line, meta));
    }
}
```

rawq 결과 수 증가: `RAWQ_MAX_RESULTS`를 5→8로.

**총 구현량:** ~60줄 Rust
**의존성:** 0
**예상 효과:** 같은 4,000자에 5파일 → 8파일 커버. 상위 2개는 상세하게, 나머지는 "이런 파일도 있다" 수준.

---

### P5. cross-session 중복 제거

**병목:** cross-session에 여러 대화의 최근 턴이 포함되는데, 같은 주제를 논의한 대화들은 내용이 거의 같을 수 있음
**레퍼런스:** claw `semantic_dedup.py` L209–296 (shingle Jaccard dedup)
**목표:** cross-session 블록 간 중복 제거

#### 설계

```rust
/// context_pack.rs에 추가
///
/// cross-session 블록 중 Jaccard 유사도 >= threshold인 쌍의 후자를 제거.
/// 레퍼런스: claw semantic_dedup.py (shingle 기반)
fn dedup_cross_session_blocks(
    blocks: Vec<(String, Vec<(String, String)>)>,
    threshold: f64,
) -> Vec<(String, Vec<(String, String)>)> {
    let mut kept: Vec<(String, Vec<(String, String)>, String)> = Vec::new();

    for (label, rows) in blocks {
        // 블록 전체를 하나의 텍스트로 합침
        let text: String = rows.iter().map(|(_, c)| c.as_str()).collect::<Vec<_>>().join(" ");

        // 기존 kept 블록과 유사도 비교
        let is_dup = kept.iter().any(|(_, _, existing_text)| {
            jaccard_similar(existing_text, &text, threshold)
        });

        if !is_dup {
            kept.push((label, rows, text));
        }
    }

    kept.into_iter().map(|(l, r, _)| (l, r)).collect()
}
```

적용 위치: `build_cross_session_section()`에서 blocks 조립 전에 dedup.

**총 구현량:** ~30줄 Rust (jaccard_similar 재사용)
**예상 효과:** 유사 대화 2~3개가 cross-session에 포함될 때 1개로 축소.

---

## 구현 우선순위 및 예상 효과

| 순서 | 항목 | 구현량 | 지연 감소 | 토큰 감소 | 품질 향상 |
|------|------|--------|----------|----------|----------|
| **P1** | 규칙 기반 축소 (Claude 호출 제거) | ~120줄 | ⭐⭐⭐ (1–3초 → 0) | ⭐⭐ (3–8%) | — |
| **P2** | 동적 예산 배분 | ~80줄 | — | ⭐⭐ (비어있는 섹션 예산 재분배) | ⭐⭐⭐ (중요 섹션에 더 할당) |
| **P3** | rawq 정보 밀도 스코어링 | ~45줄 | — | — | ⭐⭐ (보일러플레이트 필터) |
| **P4** | rawq 다해상도 출력 | ~60줄 | — | — | ⭐⭐⭐ (커버리지 5→8파일) |
| **P5** | cross-session 중복 제거 | ~30줄 | — | ⭐ (유사 대화 축소) | ⭐ |
| **합계** | | **~335줄** | | | |

---

## 구현하지 않을 것 (명시적 제외)

| 항목 | 레퍼런스 | 제외 이유 |
|------|---------|----------|
| KKT 냅색 솔버 | entroly knapsack.rs | 섹션 7개에 연속 최적화는 과잉. 가중치 비례 배분으로 충분 |
| PRISM RL 가중치 학습 | entroly prism.rs | 피드백 루프 인프라 없음. 수동 가중치 조정이 현실적 |
| Nash-KKT 멀티에이전트 | entroly nkbe.rs | 라운드테이블 에이전트가 독립 ContextPack 사용. 공유 예산 불필요 |
| Nexus ML 토큰 분류 | claw nexus.py | 미학습 모델. 규칙 기반이 더 안전 |
| Ionizer JSON 샘플링 | claw ionizer.py | ContextPack에 대규모 JSON 배열이 들어올 경로 없음 |
| Photon 이미지 압축 | claw photon.py | tunaFlow은 텍스트 전용 |
| QuantumLock KV-cache | claw quantum_lock.py | Claude Code CLI는 자체 KV-cache 관리. 외부 조작 불필요 |
| Engram LLM 요약 | claw engram.py | compression.rs의 Claude 호출과 동일 방식. 제거 대상이지 추가 대상이 아님 |

---

## 의존성 정책

- entroly, claw-compactor를 Cargo/pip 의존성으로 추가하지 않는다
- 알고리즘 아이디어만 참고하고, Rust로 직접 구현한다
- 각 함수는 독립적으로 테스트 가능하게 작성한다
- 기존 동작을 깨뜨리지 않도록, 모든 개선은 opt-in 또는 fallback을 유지한다
