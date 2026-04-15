---
title: Retrieval Context Pollution — 진단 및 ABCD 수정
status: active
canonical: true
created_at: 2026-04-15
updated_at: 2026-04-15
owner: architect
related:
  - src-tauri/src/commands/context_queries.rs
  - src-tauri/src/commands/vector_search/query.rs
  - src-tauri/src/commands/agents_helpers/send_common/context_loading.rs
---

# Retrieval Context Pollution — 진단 및 수정 (2026-04-15)

## 증상

사용자가 현재 실험 5b/6을 진행 중인데, Architect에게 새로운 지시를 내릴 때 ContextPack의 "Retrieved memory" 영역에 **3.5 실험 당시의 과거 메시지**가 대부분 차지. 결과적으로 Architect가 과거 맥락을 기준으로 Plan을 만들려고 시도 → 사용자 지시와 불일치.

### 실측 로그 (2026-04-15)

```
쿼리: "응 복잡한 태스크 아니면 플랜 만들지 말고 …"
[retrieval] FTS5: 10 chunks
  fts[0] score=0.857 conv=51a44bfe… text="3.5 결과 넣어뒀어"
  fts[1] score=0.857 conv=branch:a… text="실험 3.5 필요 여부에 대한 의견 개진"
  fts[2] score=0.848 conv=51a44bfe… text="실험결과 확인하고 다음 시험을 진행..."
  ... (대부분 3.5 맥락)
[retrieval] Vector: 1 chunks (threshold 0.3)
  vec[0] score=0.381 conv=branch:8… text="[Reviewer · codex] (codex returned no output)"
[retrieval] Total: 11 chunks after merge
```

## 근본 원인 (5개)

### 1. Recency 가중치 과소 (0.2)

`context_queries.rs:208` 이전:
```rust
c.score = fts_score * 0.5 + recency_score * 0.2 + kind_bonus - overlap_penalty;
```

FTS(0.5) vs Recency(0.2) → "FTS 점수 높은 옛날"이 "FTS 점수 낮은 최근"을 구조적으로 이김.

### 2. Recency decay 감쇠 과약 (168시간/주 단위)

`context_queries.rs:190` 이전:
```rust
let recency_score = 1.0 / (1.0 + age_hours / 168.0);
```

- 3일 전 = 0.69, 방금 = 1.0, 차이 0.31
- 가중치 0.2 곱하면 **총 score 기준 0.062 차이** (무시 수준)
- 같은 프로젝트에서 활발히 작업 중일 때 decay가 사실상 0

### 3. FTS5 OR 쿼리의 비특이성

`context_queries.rs:372` (그대로):
```rust
words.join(" OR ")
```

쿼리 "응 복잡한 태스크 아니면 플랜 만들지 말고"
→ stopword 필터 후 OR: `복잡한 OR 태스크 OR 아니면 OR 플랜 OR 만들지 OR 말고`
→ **하나만 매칭되어도 결과 포함** → `태스크`, `플랜` 포함된 과거 모든 메시지 히트
→ BM25 빈도 기반이라 해당 단어 반복 많은 메시지일수록 고득점

### 4. 현재 대화방 자체 오염

`context_queries.rs:135` 이전 쿼리:
```sql
WHERE messages_fts MATCH ?1 AND c.project_key = ?2
```

현재 대화방의 과거 메시지가 검색 대상에 포함. `recent_message_ids`로 최근 12개만 제외하고 그 이전은 전부 후보 → 현재 대화방에서 이미 "3.5 얘기했던 시절"의 메시지가 다시 등장.

### 5. Vector 검색 기능 정지

로그에서 Vector: **0.3 임계 1개**, 그마저도 "codex returned no output" 같은 에러 메시지. 의미 기반 검색이 FTS5를 보정해주는 역할을 못함. 결과적으로 FTS5 단독 게임 → 위 3개 문제 증폭.

## 적용한 수정 (ABCD)

### A: Recency 가중치 0.2 → 0.4

```rust
// 이전
c.score = fts_score * 0.5 + recency_score * 0.2 + kind_bonus - overlap_penalty;

// 이후
c.score = fts_score * 0.5 + recency_score * 0.4 + kind_bonus + coverage_bonus - overlap_penalty;
```

최근 맥락 우선순위 2배 상향.

### B: Decay 168h → 48h (주 → 2일 단위)

```rust
// 이전
let recency_score = 1.0 / (1.0 + age_hours / 168.0);

// 이후
let recency_score = 1.0 / (1.0 + age_hours / 48.0);
```

감쇠 곡선 비교:

| 경과 시간 | 이전 (168h) | 이후 (48h) |
|-----------|-------------|------------|
| 방금 | 1.0 | 1.0 |
| 1시간 | 0.994 | 0.980 |
| 24시간 | 0.875 | 0.667 |
| 72시간 (3일) | 0.700 | 0.400 |
| 168시간 (1주) | 0.500 | 0.222 |

가중치 상향(0.4)과 결합하면 3일 전 메시지는 최근 대비 0.6 * 0.4 = **0.24 손해** (기존 0.062 대비 4배 증폭).

### C: 현재 대화방 제외

```sql
-- 이전
WHERE messages_fts MATCH ?1 AND c.project_key = ?2
ORDER BY rank LIMIT ?3

-- 이후
WHERE messages_fts MATCH ?1 AND c.project_key = ?2
  AND m.conversation_id != ?3
ORDER BY rank LIMIT ?4
```

현재 대화의 최근 맥락은 이미 `load_recent_messages_with_author`로 별도 로드됨 → retrieval은 **다른 대화/브랜치에서 끌어오는 역할**로 명확화. 자체 오염 차단.

### D: 쿼리 커버리지 bonus

FTS5 rerank에 추가:
```rust
let coverage_bonus = {
    let query_terms = fts_query.split(" OR ")...;
    let hit_count = query_terms.iter()
        .filter(|t| chunk_text_lower.contains(t))
        .count();
    let ratio = hit_count / query_terms.len();
    ratio * 0.3  // 전 단어 포함 시 +0.3
};
```

**의미**: 쿼리 단어 중 **몇 개가 실제로 chunk에 포함되는지** 측정. `태스크 OR 플랜` 만 맞고 나머지 단어는 없는 chunk보다, 쿼리 단어 대부분이 함께 등장하는 chunk를 우선. OR 쿼리의 비특이성을 실질적으로 AND-like 효과로 보정.

## 기대 효과

수정 전 실측 케이스 재계산:

| chunk | fts | recency(48h, 3일 가정) | coverage(추정) | 이전 total | 이후 total |
|-------|-----|------------------------|----------------|------------|------------|
| 3.5 옛날 메시지 (태스크만 겹침) | 0.857 | 0.400 | 0.05 | 0.678 | 0.663 |
| 최근 메시지 (태스크+플랜+복잡 겹침) | 0.70 | 1.0 | 0.20 | 0.55 | **0.95** |

→ 이전엔 3.5 메시지가 앞섰지만, 이후엔 최근 메시지가 0.29 차이로 앞섬.

## 유보한 수정 (E, F) — 트리거 조건

동일/유사 증상이 재발하면 다음 단계로 진행.

### E: 같은 대화방 내 "최근 범위" 정교화

**아이디어**: 현재 대화 완전 제외(C)는 강한 조치. 대화방 내에서도 **진짜 최근 N시간**만 참고할 가치가 있는 경우가 있음 (예: 같은 세션 내 단일 주제 장기 토론).

**구현 후보**:
- retrieval이 현재 대화방 자체를 포함하되, 해당 대화 chunk는 별도 recency 가중치(예: `age_hours / 6`, 6시간 decay) 적용
- `load_recent_messages_with_author`가 이미 처리하는 범위를 초과한 중요 발언만 구제

**트리거**: "다른 대화에서만 검색돼서 같은 대화방 초반 중요 결정을 Architect가 모른다" 같은 증상 발생 시.

### F: Vector 임베딩 품질 / 임계값 조정

**증상**: 현재 Vector: 0.3 임계 1개 → Vector가 사실상 기능 정지.

**후보 조치**:
1. bge-m3 한국어 매칭 조사 (§아래)
2. 임계값 0.3 → 0.25 (결과 늘리되 노이즈 증가 위험)
3. 임베딩 캐시 확장 (현재 conv당 chunk 수 확인 필요 — §추가 조사)
4. Vector 가중치 자체 조정 (merge 시 score를 rerank에 통합)

**트리거**: Vector 로그에서 지속적으로 3개 미만 또는 평균 score < 0.4 관찰 시.

## 추가 조사 결과 (2026-04-15 수행)

### 1. bge-m3 한국어 대화체 성능 — 모델 자체는 문제 없음

**웹 조사 요약**:
- BGE-M3는 한국어 포함 다국어에 강함. 8192 토큰까지 지원.
- 한국어 특화 버전 `dragonkue/BGE-m3-ko` (568M) 존재. 긴 텍스트(한국어 Embedding Benchmark)에서는 강함, 짧은 텍스트(Miracl)에서는 다소 약함.
- 한국 의료 도메인 2025년 RAG 연구에서 fine-tuned BGE-M3는 97.6% retrieval accuracy 기록.
- 대화체 쿼리도 별도 prefix instruction 없이 그대로 임베딩 가능.

**결론**: **모델 자체가 원인이 아닐 확률이 높음**. 오늘 Vector 부진의 진짜 원인은 아래.

### 2. 진짜 원인 발견 — 인덱싱 파이프라인 장애 🔴

DB 스냅샷 실측 (2026-04-15):

```
프로젝트별 chunk 수 / embedding 있는 것
  tunaflow:       6711 / 266  (4.0%)
  gemento:         327 /  12  (3.7%)   ← 오늘 증상의 프로젝트
  secall:          305 / 274  (89.8%)  ← 정상
  tunainsight:     201 /   0  (0.0%)
  tunapi:           11 /   0  (0.0%)
```

gemento 세부:
```
메인 conv 51a44bfe: 70 chunks / 11 embedded (84% 누락)
branch:ae8a44bc:    18 chunks /  0 embedded
branch:a549cfb7:    14 chunks /  0 embedded
branch 나머지 6개:   43 chunks /  1 embedded
__doc__:gemento:   204 chunks /  0 embedded  (전부 누락)
```

source_type별:
```
conversation: 123 chunks /  12 embedded (9.8%)
document:     204 chunks /   0 embedded (0.0%)   ← 문서 chunk 전부 미임베딩
```

**해석**:
- 오늘 증상("Vector 0.3 임계 1개")의 **근본 원인은 인덱싱 파이프라인 실패**
- bge-m3 모델이 아니라 **chunk를 만들고 embedding을 저장하는 경로가 막힌 것**
- `secall`(89.8%)은 정상 → 최근 작업하는 `gemento`, `tunaflow`에서 특히 심각
- s35에서 CPU 스파이크 방지로 추가한 **ONNX 세마포어 / 점진적 인덱싱**이 타임아웃으로 조용히 실패하는 가능성 가장 높음

### 3. vec0 `k` 파라미터

`query.rs:46`의 `vc.k = ?4`는 sqlite-vec KNN의 정상 문법. `fetch_limit = limit * 3`로 over-fetch 후 filter — 정상 동작.

**SQLite CLI로 `SELECT COUNT(*) FROM vec_chunks` 실행 불가** (vec0 확장이 앱 바이너리에만 로드됨). 실제 vec index 크기는 앱 실행 중 확인해야 함.

## F의 범위 재정의 (기존 임계값 조정 → 인덱싱 파이프라인 복구로 변경)

기존 F 후보(임계값 0.3 → 0.25 조정 등)는 **문제가 아님**. 핵심 문제는:

### F-new: 인덱싱 파이프라인 진단 및 복구

**조사할 것**:
1. `src-tauri/src/agents/embedder.rs` — bge-m3 embed_text 호출 실패 경로
2. 세마포어(ONNX 스레드 제한) 타임아웃/skip 로직
3. 점진적 인덱싱 루프의 에러 핸들링 — NULL embedding 저장 시 warn/log 출력 여부
4. 백필 기능 — NULL embedding을 가진 chunk를 재인덱싱하는 경로 존재 여부
5. 문서(`__doc__:*`) 인덱싱이 conversation과 다른 경로를 타는지 (문서 chunk 204개 전부 누락이 유의미한 단서)

**즉시 해볼 실험**:
```sql
-- 앱 내부 shell에서
SELECT COUNT(*) FROM vec_chunks;
-- conversation_chunks 중 embedding NULL인 row의 created_at 분포
SELECT DATE(created_at/1000, 'unixepoch') d, COUNT(*)
FROM conversation_chunks WHERE embedding IS NULL GROUP BY d ORDER BY d DESC LIMIT 10;
-- 특정 NULL chunk로 embed_text를 수동 호출해 결과 확인
```

**트리거**: ABCD 적용 후 실측에서 Vector 여전히 < 3 chunks/쿼리 관찰 시 (매우 높은 확률로 재현).

## 유보한 수정 (E) — 트리거 조건 유지

### E: 같은 대화방 내 "최근 범위" 정교화 (기존 설명 유지)

**아이디어**: 현재 대화 완전 제외(C)는 강한 조치. 대화방 내에서도 **진짜 최근 N시간**만 참고할 가치가 있는 경우가 있음.

**구현 후보**:
- retrieval이 현재 대화방 자체를 포함하되, 해당 대화 chunk는 별도 recency 가중치(예: `age_hours / 6`) 적용
- `load_recent_messages_with_author`가 이미 처리하는 범위를 초과한 중요 발언만 구제

**트리거**: "다른 대화에서만 검색돼서 같은 대화방 초반 중요 결정을 Architect가 모른다" 같은 증상 발생 시.

### 2. vec0 `k` 파라미터 동작 확인

`query.rs:46`:
```rust
WHERE vc.embedding MATCH ?1 AND vc.k = ?4
```

- `vc.k`는 KNN 반환 개수 제한. 정상 사용.
- `fetch_limit = limit * 3` → 현재 limit=5 이므로 15개 fetch 후 5개 take.
- **의문**: threshold 0.3 이상이 1개뿐인데 `k=15`인지 확인. `k` 값이 실제로 반영되는지 테스트 필요.

### 3. 현재 프로젝트 chunk 인덱싱 통계

확인할 것:
- `conversation_chunks` 테이블에 해당 프로젝트의 row 수
- `vec_chunks` 가상 테이블 row 수 (매칭 여부)
- `embedding` 컬럼 NULL 비율
- 최근 24시간 생성 chunk 수 (인덱싱 지연 여부)

진단 쿼리 (앱 DB에서 직접 실행):
```sql
SELECT project_key, COUNT(*) total,
       SUM(embedding IS NOT NULL) with_embedding,
       SUM(embedding IS NULL) missing_embedding
FROM conversation_chunks
GROUP BY project_key;

SELECT source_type, COUNT(*)
FROM conversation_chunks
WHERE project_key = 'gemento'
GROUP BY source_type;
```

## 검증 계획

1. 앱 재시작 후 동일 대화방에서 같은 질의 재현
2. 로그에서 FTS5 chunk의 `conv` 필드 확인 — 현재 대화 ID가 **없어야 함** (C 효과)
3. score 분포 확인 — 3.5 맥락 메시지 점수가 최근 메시지 대비 낮아야 함 (A+B 효과)
4. 실측 쿼리에서 실제로 관련 있는 메시지가 Top 3에 올라오는지 (D 효과)

문제 재발 시 E, F 진행.

## 관련 커밋

- (TBD) `fix/retrieval-context-pollution` 브랜치 — ABCD 적용
