# Entroly vs rawq: 역할 비교 및 통합 가능성 분석

- 작성: 2026-03-30
- 대상: tunaFlow ContextPack 파이프라인 내 rawq 역할과 entroly 모듈의 관계

---

## 1. 용어 정의

| 시스템         | 정체                                       | 핵심 기능                        |
| ----------- | ---------------------------------------- | ---------------------------- |
| **rawq**    | 시맨틱 코드 검색 엔진 (Rust 바이너리, ONNX 임베딩)       | 쿼리 → 코드베이스 검색 → 상위 N개 스니펫 반환 |
| **entroly** | 컨텍스트 최적화 엔진 (Rust core + Python 오케스트레이터) | 코드베이스 전체를 토큰 예산 내에 최적 압축·선택  |

---

## 2. rawq가 tunaFlow에서 하는 역할

tunaFlow의 컨텍스트 어셈블리 파이프라인 (`context_pack.rs`):

```
ContextPack = [
  Project context      — 프로젝트 경로
  Base system prompt   — 에이전트 프롬프트
  Plan section         — 활성 플랜/서브태스크
  Findings section     — 라운드테이블 브리프
  Artifacts section    — 최근 아티팩트
  Skills section       — 활성 스킬
  ★ rawq section      — 코드 검색 결과 (최대 5개, 4,000자 제한)
  Cross-session        — 다른 대화 컨텍스트
  Thread inheritance   — 브랜치 앵커/부모 턴
]
→ guardrail::enforce_total_limit (60,000자)
```

rawq는 이 파이프라인에서 **한 가지 역할**만 한다:

> 사용자 프롬프트에서 코드 관련 키워드를 감지하면,
> `rawq search "<query>" <path> -n 5 --threshold 0.3 --json`을 실행하고,
> 결과를 `## Code context (rawq)` 섹션으로 삽입한다.

**특성:**

- **리트리벌 전용** — 관련 코드 스니펫을 찾아오는 것이 전부
- **시맨틱 검색** — snowflake-arctic-embed-s ONNX 모델 기반 임베딩 유사도
- **스코프 인식** — `Struct.method` 단위 청크, 줄 번호 포함
- **confidence 점수** — 0.0~1.0 유사도 스코어
- **데몬 아키텍처** — 앱 시작 시 모델 프리로드, 이후 검색 < 10ms

---

## 3. entroly 모듈별 역할과 rawq 기능 중첩 분석

### 3.1 기능이 겹치지 않는 모듈 (rawq와 무관)

| entroly 모듈         | 기능                             | rawq 대응 | 판정     |
| ------------------ | ------------------------------ | ------- | ------ |
| `knapsack.rs`      | KKT 이분탐색으로 토큰 예산 내 최적 부분집합 선택  | 없음      | **독립** |
| `knapsack_sds.rs`  | 다해상도 냅색 + 서브모듈러 다양성            | 없음      | **독립** |
| `entropy.rs`       | Shannon/Rényi 엔트로피로 정보 밀도 스코어링 | 없음      | **독립** |
| `prism.rs`         | 스펙트럴 자연 경사로 가중치 학습             | 없음      | **독립** |
| `nkbe.rs`          | 멀티에이전트 토큰 예산 분배 (Nash-KKT)     | 없음      | **독립** |
| `cognitive_bus.rs` | 에이전트 간 이벤트 라우팅                 | 없음      | **독립** |
| `sast.rs`          | 54개 보안 규칙 정적 분석                | 없음      | **독립** |
| `health.rs`        | 코드베이스 건강도 분석 (클론, 데드코드)        | 없음      | **독립** |
| `utilization.rs`   | 응답 활용도 피드백 (trigram 오버랩)       | 없음      | **독립** |
| `anomaly.rs`       | 엔트로피 이상 탐지                     | 없음      | **독립** |

### 3.2 기능이 부분 중첩되는 모듈

| entroly 모듈                      | 기능                              | rawq 대응                      | 중첩도                        |
| ------------------------------- | ------------------------------- | ---------------------------- | -------------------------- |
| `dedup.rs` + `lsh.rs`           | SimHash + LSH로 중복 프래그먼트 탐지      | rawq는 청크 단위 인덱싱 시 중복을 다루지 않음 | **낮음** — 단계가 다름            |
| `skeleton.rs`                   | 코드 스켈레톤 추출 (시그니처만 유지, 바디 제거)    | rawq는 코드를 있는 그대로 반환          | **낮음** — 압축 vs 검색          |
| `depgraph.rs`                   | 의존성 그래프 구축 (import/type ref 추적) | rawq는 의존성 무시                 | **낮음** — 보완 관계             |
| `query.rs` + `query_persona.rs` | 쿼리 분석 (모호성 점수, 키워드 추출, 아키타입 분류) | rawq는 임베딩 유사도만 사용            | **중간** — 쿼리 이해             |
| `hierarchical.rs`               | 3레벨 계층적 표현 (스켈레톤맵/의존클러스터/풀콘텐츠)  | rawq는 단일 해상도 (풀 스니펫)         | **중간** — 같은 문제를 다른 방식으로 접근 |

### 3.3 기능이 직접 겹치는 모듈

| entroly 모듈          | 기능                                         | rawq 대응                               | 판정                                           |
| ------------------- | ------------------------------------------ | ------------------------------------- | -------------------------------------------- |
| `semantic_dedup.rs` | 시맨틱 유사도로 중복 제거 (marginal information gain) | rawq의 임베딩 유사도와 유사 목적                  | **부분 대체 가능** — 단, rawq는 검색용, entroly는 선택/제거용 |
| `guardrails.rs`     | criticality 기반 프래그먼트 고정                    | tunaFlow `guardrail.rs`의 섹션 제한과 유사 의도 | **부분 중첩** — 구현 수준이 다름                        |

---

## 4. 핵심 질문에 대한 답

### Q1. rawq와 entroly 모듈의 역할이 겹치는가?

**거의 겹치지 않는다.**

rawq와 entroly는 컨텍스트 엔지니어링 파이프라인의 **다른 단계**를 담당한다:

```
[인덱싱] → [검색/리트리벌] → [스코어링] → [선택/압축] → [전달]
              ↑ rawq                ↑ entroly      ↑ entroly
```

| 단계        | rawq             | entroly                             | tunaFlow 현재                  |
| --------- | ---------------- | ----------------------------------- | ---------------------------- |
| **인덱싱**   | ONNX 임베딩 + 청크 분할 | 없음 (크롤러는 Python 레이어)                | rawq `index build`           |
| **검색**    | 시맨틱 유사도 top-K    | 없음 (LSH는 내부 중복 탐지용)                 | rawq `search`                |
| **스코어링**  | confidence (0~1) | 엔트로피 + 최근성 + 빈도 + 의존성 + criticality | 없음                           |
| **선택**    | top-K (고정 개수)    | KKT 최적 냅색 (예산 기반)                   | 없음 (RAWQ_MAX_RESULTS=5 하드코딩) |
| **압축**    | 없음               | 3레벨 계층 + 스켈레톤 + 중복 제거               | `compression.rs` (Claude 요약) |
| **예산 관리** | 없음               | 토큰 예산 최적 분배                         | `guardrail.rs` (문자수 하드 리밋)   |
| **학습**    | 없음               | PRISM RL + 피드백 루프                   | 없음                           |

**결론: rawq = 리트리벌, entroly = 최적화. 파이프라인의 다른 층이므로 대체 관계가 아니라 보완 관계.**

### Q2. rawq를 entroly로 대체할 수 있는가?

**아니오. entroly는 rawq를 대체할 수 없다.**

이유:

1. **entroly에는 시맨틱 검색 엔진이 없다.** 임베딩 모델도 없고, 벡터 인덱스도 없고, 코사인 유사도 검색도 없다. entroly의 LSH는 내부 프래그먼트 간 중복 탐지용이지, 쿼리→코드 검색용이 아니다.

2. **entroly는 "이미 있는 프래그먼트"를 최적화한다.** 어떤 코드가 관련 있는지 찾는 건 entroly의 범위 밖. 프래그먼트가 먼저 주어져야 entroly가 작동한다.

3. **rawq의 핵심 가치는 ONNX 임베딩 기반 시맨틱 검색이다.** "fix SQL injection" 같은 자연어 쿼리로 관련 코드를 찾는 건 entroly가 할 수 없는 일.

### Q3. 그렇다면 rawq를 대체하는 게 아니라, 보완재인가?

**맞다. 명확한 보완재다.**

현재 tunaFlow의 컨텍스트 파이프라인에는 두 가지 갭이 있다:

**갭 1: 검색 결과 최적화가 없다**

- rawq가 5개 스니펫을 반환하면, 그대로 4,000자 제한에 잘라서 넣는다
- 5개가 최적인지, 3개면 충분한지, 8개가 필요한지 판단하지 않는다
- 중복된 결과가 있어도 그대로 넣는다

**갭 2: ContextPack 전체의 예산 분배가 정적이다**

- `guardrail.rs`에 하드코딩된 문자수 제한:
  - rawq: 4,000자
  - skills: 8,000자
  - cross-session: 6,000자
  - plan: 2,000자
  - 총합: 60,000자
- 상황에 따라 plan이 중요할 수도, rawq가 중요할 수도 있는데, 현재는 고정 배분

**entroly가 이 갭을 채울 수 있다:**

```
현재:
  rawq search → top 5 → 하드코딩 4,000자 → ContextPack

개선 가능:
  rawq search → top N → entroly 스코어링/선택 → 동적 예산 배분 → ContextPack
```

---

## 5. 통합 가능성: 모듈별 현실성 및 가치 평가

### Tier 1: 현실적이고 가치 높음

#### 5.1 `knapsack.rs` — ContextPack 동적 예산 분배

**현재 문제:** `guardrail.rs`의 섹션별 제한이 전부 하드코딩.

**entroly 적용:**

- ContextPack의 각 섹션(plan, rawq, skills, cross-session, artifacts)을 프래그먼트로 취급
- 각 섹션에 정보 밀도 점수 부여 (예: rawq 결과가 고신뢰도면 높은 점수)
- `knapsack_optimize()`로 60,000자 예산 내 최적 배분

**통합 난이도:** 중간

- `guardrail.rs`의 하드코딩 제한을 동적 배분으로 교체
- 각 섹션의 "가치"를 정의하는 스코어링 함수 필요
- Rust-to-Rust이므로 FFI 오버헤드 없음

**예상 효과:** 상황에 따라 rawq에 6,000자, plan에 500자를 줄 수도 있고, 반대도 가능. 현재의 정적 배분 대비 토큰 효율 향상.

#### 5.2 `entropy.rs` — rawq 결과 리랭킹

**현재 문제:** rawq가 반환하는 confidence는 임베딩 유사도 하나뿐. 보일러플레이트 코드가 높은 유사도를 받을 수 있다.

**entroly 적용:**

- rawq 결과 5~10개를 받아서 각각의 Shannon 엔트로피 / 보일러플레이트 점수 계산
- 정보 밀도가 낮은 결과(import 블록, 빈 테스트 등) 필터링
- rawq confidence × entropy score로 리랭킹

**통합 난이도:** 낮음

- `context_pack.rs`의 `build_rawq_section()`에서 결과를 받은 후 리랭킹 추가
- `entropy::information_score(content)` 호출 하나면 됨

**예상 효과:** rawq가 가져온 보일러플레이트/저정보 스니펫 자동 필터링. 4,000자 안에 더 유용한 코드만 남음.

#### 5.3 `dedup.rs` — rawq 결과 중복 제거

**현재 문제:** rawq가 유사한 코드 스니펫 여러 개를 반환할 수 있음 (예: 같은 함수의 다른 호출부).

**entroly 적용:**

- SimHash 핑거프린팅으로 O(1) 중복 탐지
- Hamming distance ≤ 3인 결과 제거

**통합 난이도:** 낮음

- rawq 결과 파싱 후 `simhash(content)` 비교 추가
- 5~10개 결과에 대한 pairwise 비교는 무시할 수준의 비용

**예상 효과:** rawq 결과 5개 중 실질적으로 유사한 2개를 1개로 줄이고, 빈 슬롯에 다른 결과를 채울 수 있음.

### Tier 2: 가치는 있으나 통합 비용 중간

#### 5.4 `skeleton.rs` — 다해상도 컨텍스트

**현재 문제:** rawq 결과는 전부 풀 스니펫. 핵심 파일은 상세하게, 보조 파일은 시그니처만 보여주면 같은 4,000자에 더 많은 파일을 커버할 수 있다.

**entroly 적용:**

- 상위 2개 결과: 풀 콘텐츠
- 3~5번째 결과: 스켈레톤 (함수 시그니처만)
- 나머지: one-line 레퍼런스

**통합 난이도:** 중간

- `skeleton::extract_skeleton(content)` 호출 추가
- `build_rawq_section()`의 포맷팅 로직 변경 필요

**예상 효과:** rawq 섹션에서 5개 파일 대신 10~15개 파일 커버. "100% 가시성"에 가까워짐.

#### 5.5 `depgraph.rs` — 의존성 확장

**현재 문제:** rawq가 `auth.py`를 반환해도, `auth.py`가 import하는 `auth_config.py`는 포함되지 않음.

**entroly 적용:**

- rawq 결과의 파일에서 import/dependency 추적
- 1-hop 의존성을 자동 포함

**통합 난이도:** 높음

- depgraph 구축에 코드베이스 파싱 필요
- rawq 인덱싱 시점에 의존성 정보를 함께 저장하거나, 별도 파싱 단계 필요
- 현재 tunaFlow에는 AST 파싱 인프라 없음

**예상 효과:** 컨텍스트 완전성 향상. 에이전트가 "관련 파일 누락"으로 실패하는 경우 감소.

### Tier 3: 흥미롭지만 현재는 불필요

| 모듈                           | 이유                                                     |
| ---------------------------- | ------------------------------------------------------ |
| `prism.rs` (RL 학습)           | tunaFlow에 피드백 루프가 없음. 에이전트 응답 품질을 자동 평가하는 시스템이 먼저 필요   |
| `nkbe.rs` (멀티에이전트 예산)        | 라운드테이블이 있지만, 현재 각 에이전트가 독립 ContextPack 사용. 공유 예산 개념 없음 |
| `cognitive_bus.rs` (이벤트 라우팅) | tunaFlow 이벤트 시스템(Tauri emitter)이 이미 존재하고 충분            |
| `sast.rs` (보안 스캔)            | 코드 검색과 무관. 별도 기능으로 도입한다면 모를까                           |
| `health.rs` (코드 건강도)         | rawq 보완과 무관                                            |
| `query_persona.rs` (쿼리 아키타입) | 흥미롭지만, 현재 `prompt_needs_rawq()` 키워드 매칭으로 충분            |

---

## 6. 권장 통합 로드맵

### Phase 0: entroly-core를 Cargo 의존성으로 추가 (선행 조건)

```toml
# src-tauri/Cargo.toml
[dependencies]
entroly-core = { path = "../_research/_util/entroly/entroly-core" }
```

entroly의 Python 레이어는 불필요. Rust core만 직접 링크.
단, 현재 entroly-core는 PyO3 cdylib로 빌드됨 → `rlib` 타겟 추가 필요.

### Phase 1: rawq 결과 후처리 (낮은 비용, 즉시 효과)

**대상 파일:** `context_pack.rs`의 `build_rawq_section()`

변경 내용:

1. rawq에서 `limit`을 5 → 10으로 늘림
2. 결과를 `entropy::information_score()`로 리스코어링
3. `dedup::simhash()` + Hamming distance로 유사 결과 제거
4. 상위 5개만 ContextPack에 삽입

예상 변경량: `context_pack.rs` ~30줄 추가

### Phase 2: ContextPack 동적 예산 분배 (중간 비용, 구조 개선)

**대상 파일:** `guardrail.rs`, `agents.rs`의 어셈블리 로직

변경 내용:

1. 각 섹션을 `ContextFragment`로 매핑 (source, token_count, score)
2. `knapsack_optimize(fragments, budget=15000, ...)` 호출
3. 반환된 선택 결과에 따라 섹션별 예산 동적 조정
4. 기존 하드코딩 제한은 fallback으로 유지

예상 변경량: `guardrail.rs` 리팩토링 + 새 함수 ~80줄

### Phase 3: 다해상도 rawq 섹션 (중간 비용, 커버리지 확대)

**대상 파일:** `context_pack.rs`

변경 내용:

1. rawq 결과 상위 2개: 풀 콘텐츠
2. 3~5번째: `skeleton::extract_skeleton()` 적용
3. 6~10번째: one-line 레퍼런스 (`file:line — function_name`)
4. 같은 4,000자에 3배 더 많은 파일 커버

---

## 7. 최종 판정

```
rawq  = "어떤 코드가 관련 있는가?" (리트리벌)
entroly = "관련 코드를 어떻게 최적으로 넣을까?" (최적화)

관계: 보완재. 대체 불가.
```

| 항목                | 평가                                                                |
| ----------------- | ----------------------------------------------------------------- |
| rawq → entroly 대체 | ❌ 불가능 — entroly에 시맨틱 검색 없음                                        |
| entroly → rawq 대체 | ❌ 불가능 — rawq에 컨텍스트 최적화 없음                                         |
| 보완 가치             | ⭐⭐⭐⭐ — rawq 결과 후처리 + 동적 예산 분배                                     |
| 즉시 통합 가능 모듈       | `entropy.rs`, `dedup.rs`, `knapsack.rs`                           |
| 중기 통합 가능 모듈       | `skeleton.rs`, `hierarchical.rs`                                  |
| 불필요 모듈            | `nkbe.rs`, `cognitive_bus.rs`, `sast.rs`, `health.rs`, `prism.rs` |

### 주의사항

1. **entroly는 검증되지 않은 프로젝트다.** 22일간 1인 개발, LLM 생성 코드, 실사용자 부재 (이슈 0건). 알고리즘 수학은 올바르나 통합 검증은 없음. 개별 모듈(entropy, dedup, knapsack)만 추출해서 쓰는 것이 현실적.

2. **entroly 전체를 의존성으로 가져가지 말 것.** PyO3/MCP 서버/프록시 등 tunaFlow에 불필요한 레이어가 대부분. Rust core의 특정 함수만 직접 호출하거나, 알고리즘을 참고해서 tunaFlow 내부에 재구현하는 것이 더 깨끗함.

3. **rawq 자체를 강화하는 게 먼저다.** 현재 rawq 결과에 대한 후처리가 아예 없는 상태. entroly 없이도 rawq 결과의 confidence 기반 필터링, 중복 제거, limit 동적 조정 등은 tunaFlow 자체적으로 구현 가능.
