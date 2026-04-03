# Modern SQLite 기능 — tunaFlow 적용 검토

> Status: idea
> Created: 2026-04-03
> 참고: https://slicker.me/sqlite/features.htm

---

## 1. WAL 모드 — ✅ 이미 적용됨

### 현재 상태

```rust
// src-tauri/src/db/mod.rs:42
write_conn.execute_batch("PRAGMA journal_mode = WAL;")?;
```

Write connection에서 WAL 활성화 완료. Read connection은 `SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_NO_MUTEX` 플래그로 열리며 WAL 모드를 상속.

### Dual Connection 패턴

```rust
pub struct DbState {
    pub write: Arc<Mutex<Connection>>,  // 쓰기 전용
    pub read: Arc<Mutex<Connection>>,   // 읽기 전용
}
```

| 연결 | WAL | Foreign Keys | 용도 |
|------|-----|-------------|------|
| Write | ✅ 명시 설정 | ✅ ON | 에이전트 메시지 저장, Plan 상태 변경 등 |
| Read | ✅ 상속 | ✅ ON | UI 목록 조회, 검색, 트레이스 |

### 추가 개선 가능한 PRAGMA

현재 설정되지 않은 PRAGMA 중 유용한 것:

```sql
-- 현재 없음, 추가 검토 대상
PRAGMA synchronous = NORMAL;    -- WAL에서는 NORMAL이 안전하면서 빠름 (기본값 FULL)
PRAGMA cache_size = -8000;      -- 캐시 8MB (기본 2MB). 읽기 빈번한 앱에 유리
PRAGMA busy_timeout = 5000;     -- lock 대기 5초 (현재 없으면 즉시 SQLITE_BUSY)
PRAGMA mmap_io = 268435456;     -- 메모리 맵 256MB. 큰 DB에서 읽기 가속
```

| PRAGMA | 효과 | 리스크 | 적용 시기 |
|--------|------|--------|----------|
| `synchronous = NORMAL` | WAL에서 쓰기 속도 개선 | 매우 낮음 (WAL에서는 NORMAL이 권장) | **지금** |
| `busy_timeout = 5000` | 동시 접근 시 BUSY 에러 방지 | 없음 | **지금** |
| `cache_size = -8000` | 읽기 캐시 확대 (2MB→8MB) | 메모리 사용 증가 | 필요 시 |
| `mmap_io` | 큰 DB에서 읽기 가속 | 플랫폼 호환성 | 나중 |

**판단**: `synchronous = NORMAL`과 `busy_timeout = 5000`은 즉시 추가할 가치가 있습니다. 리스크가 거의 없고, 에이전트 동시 실행 시 BUSY 에러를 방지합니다.

---

## 2. STRICT 테이블 — ❌ 미사용, 부분 적용 검토

### 현재 상태

모든 테이블이 표준 SQLite 타입 어피니티(TEXT, INTEGER, REAL, BLOB)를 사용. STRICT 선언 없음.

### STRICT의 효과

```sql
-- 일반 테이블: 아무 값이든 INSERT 가능 (SQLite의 유연한 타입)
INSERT INTO messages(timestamp) VALUES ('not-a-number');  -- 성공 (!)

-- STRICT 테이블: 타입 위반 시 에러
CREATE TABLE messages (...) STRICT;
INSERT INTO messages(timestamp) VALUES ('not-a-number');  -- 에러!
```

### 적용 대상 검토

| 테이블 | STRICT 가치 | 이유 |
|--------|------------|------|
| `messages` | **높음** | timestamp, status 등 잘못된 타입 삽입 방지 |
| `plans` | **높음** | phase, status 필드의 타입 안전성 |
| `conversation_chunks` | **중간** | embedding BLOB의 타입 보장 |
| `trace_log` | **중간** | context_length 등 숫자 필드 보호 |
| `conversations` | **낮음** | rt_config(JSON 문자열)이 TEXT로 충분 |
| `schema_version` | 불필요 | 내부 관리용 |

### 마이그레이션 비용

SQLite는 **기존 테이블을 STRICT로 ALTER할 수 없습니다.** 방법:

```sql
-- 1. 임시 테이블 생성
CREATE TABLE messages_new (...) STRICT;
-- 2. 데이터 복사
INSERT INTO messages_new SELECT * FROM messages;
-- 3. 교체
DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;
-- 4. 인덱스 + FTS5 트리거 재생성
```

**비용이 높습니다.** messages 테이블은 FTS5 트리거, 29개 인덱스 중 다수가 연결되어 있어 마이그레이션이 복잡합니다.

**판단**: 기존 테이블을 STRICT로 전환하는 건 비용 대비 가치가 낮습니다. **새로 만드는 테이블에만 STRICT 적용**하는 게 현실적입니다. 다음 마이그레이션(v23+)에서 새 테이블 생성 시 STRICT를 기본으로 사용.

---

## 3. Generated Columns — ❌ 미사용, 활용 가능 케이스 있음

### Generated Column이란

```sql
CREATE TABLE users (
    first_name TEXT,
    last_name TEXT,
    full_name TEXT GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED
);
-- full_name은 자동 계산됨. INSERT/UPDATE 시 자동 반영.
```

### tunaFlow에서 활용 가능한 케이스

**케이스 1: conversation_chunks.text_length**

현재 text_preview의 길이를 Rust에서 계산하여 사용. Generated column으로 자동 계산 가능.

```sql
ALTER TABLE conversation_chunks
ADD COLUMN text_length INTEGER GENERATED ALWAYS AS (length(text_preview)) STORED;
```

검색 시 짧은 청크를 필터링할 때 유용: `WHERE text_length >= 20`

**케이스 2: messages.content_length**

ContextPack의 budget 계산에서 메시지 길이를 자주 사용. 현재 Rust에서 `content.len()` 호출.

```sql
ALTER TABLE messages
ADD COLUMN content_length INTEGER GENERATED ALWAYS AS (length(content)) STORED;
```

**케이스 3: trace_log에서 mode 추출**

현재 context_mode가 TEXT로 저장되는데, 인덱싱이 필요하면 generated column + 인덱스 조합 가능.

### 판단

**지금은 불필요합니다.** 현재 규모에서 Rust 코드로 계산하는 것으로 충분하며, DB 레벨 최적화가 필요한 병목이 없습니다. 메시지가 10만 건 이상이 되고 길이 기반 필터링이 빈번해지면 그때 검토.

---

## 4. FTS5 — ✅ 사용 중, 개선 가능

### 현재 상태

```sql
-- schema.rs:273
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
    USING fts5(content, content=messages, content_rowid=rowid);
```

- External content table (messages 테이블 연결)
- 3개 자동 동기화 트리거 (insert/delete/update)
- 기본 토크나이저 사용 (porter stemmer 없음)
- context_queries.rs에서 쿼리 빌드: 불용어 필터 + OR 조합 + 최대 8단어

### 개선 가능한 부분

**4.1 Porter 토크나이저 추가**

현재 기본 토크나이저는 정확한 단어 매칭만 합니다. Porter stemmer를 추가하면 `running` → `run`, `implementation` → `implement` 같은 어간 매칭이 가능.

```sql
-- 현재
CREATE VIRTUAL TABLE messages_fts USING fts5(content, content=messages, content_rowid=rowid);

-- 개선
CREATE VIRTUAL TABLE messages_fts USING fts5(
    content,
    content=messages,
    content_rowid=rowid,
    tokenize='porter unicode61'
);
```

**문제**: 기존 FTS5 테이블을 토크나이저 변경하려면 DROP + 재생성 필요. 데이터 재인덱싱 비용.

**판단**: 영어 검색 품질 개선에 효과적이지만, tunaFlow의 대화는 한국어+영어 혼용이라 porter stemmer 효과가 제한적입니다. **한국어 토크나이저(ICU)가 더 필요**하지만 SQLite FTS5의 한국어 지원이 약합니다. 나중에 검토.

**4.2 BM25 랭킹 활용**

현재 `rank` 컬럼을 사용하고 있는데, FTS5의 기본 rank는 BM25입니다. 이미 적절히 활용되고 있습니다.

추가 가능: `bm25()` 함수로 가중치 커스텀:

```sql
-- 현재
ORDER BY rank

-- 가중치 적용 (content 컬럼에 가중치 2.0)
ORDER BY bm25(messages_fts, 2.0)
```

단일 컬럼(content)만 인덱싱하고 있으므로 현재 구조에서는 차이 없음. 다중 컬럼 인덱싱 시 유용.

**4.3 FTS5 prefix 인덱스**

타이핑 중 실시간 검색(autocomplete)에 유용:

```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(
    content,
    content=messages,
    content_rowid=rowid,
    prefix='2 3 4'  -- 2~4글자 접두사 인덱싱
);
```

**판단**: 현재 SearchBox가 Enter 키 기반 검색이므로 prefix 인덱스 불필요. 실시간 검색 도입 시 검토.

---

## 5. JSON 컬럼 — ❌ JSON 함수 미사용, 개선 가능

### 현재 상태

JSON을 저장하는 컬럼 3개:

| 테이블.컬럼 | 내용 | JSON 함수 사용 |
|------------|------|---------------|
| `conversations.rt_config` | RT 참가자/모드 설정 | ❌ Rust에서 역직렬화 |
| `plans.reviewer_engines` | `["claude", "gemini"]` | ❌ Rust에서 역직렬화 |
| `memos.tags` | `["tag1", "tag2"]` | ❌ Rust에서 역직렬화 |

모든 JSON 처리가 Rust 애플리케이션 레이어에서 이루어지고, SQL 쿼리에서 JSON 함수를 사용하지 않습니다.

### 활용 가능한 케이스

**케이스 1: rt_config에서 참가자 수 쿼리**

현재 RT 참가자 수를 알려면 rt_config 전체를 Rust로 가져와서 파싱해야 합니다.

```sql
-- JSON 함수 사용 시
SELECT id, json_array_length(rt_config, '$.participants') as participant_count
FROM conversations
WHERE json_array_length(rt_config, '$.participants') > 2;
```

**케이스 2: reviewer_engines에서 특정 엔진 포함 여부**

```sql
-- 현재: Rust에서 plans 전부 가져와서 필터
-- JSON 함수:
SELECT * FROM plans
WHERE json_each.value = 'gemini'
FROM plans, json_each(plans.reviewer_engines);
```

**케이스 3: JSON 컬럼 인덱싱**

```sql
-- Generated column + 인덱스로 JSON 필드 인덱싱
ALTER TABLE conversations
ADD COLUMN rt_mode TEXT GENERATED ALWAYS AS (json_extract(rt_config, '$.mode')) STORED;
CREATE INDEX idx_conversations_rt_mode ON conversations(rt_mode);
```

### 판단

**지금은 불필요합니다.** 현재 JSON 데이터에 대한 SQL 레벨 필터링이 없고, Rust 역직렬화로 충분히 동작합니다. JSON 함수를 도입하면 쿼리는 간결해지지만, Rust의 타입 안전성(serde)을 포기하는 트레이드오프.

**도입 시기**: JSON 컬럼 기반 필터/집계가 빈번해질 때 (예: "Gemini가 참여한 RT 목록" 같은 대시보드 쿼리).

---

## 6. 기타 Modern SQLite 기능

### 6.1 Window Functions — 활용 가능

```sql
-- 대화별 메시지 순번 매기기 (현재 Rust에서 enumerate)
SELECT *, ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY timestamp) as msg_num
FROM messages;

-- 에이전트별 누적 비용 (trace_log에서)
SELECT engine, SUM(cost) OVER (ORDER BY created_at) as cumulative_cost
FROM trace_log;
```

**판단**: 분석/대시보드 기능 추가 시 유용. 지금은 불필요.

### 6.2 CTE (Common Table Expressions) — 활용 가능

```sql
-- 재귀 CTE로 브랜치 트리 탐색
WITH RECURSIVE branch_tree AS (
    SELECT id, parent_branch_id, label, 0 as depth
    FROM branches WHERE id = ?1
    UNION ALL
    SELECT b.id, b.parent_branch_id, b.label, bt.depth + 1
    FROM branches b JOIN branch_tree bt ON b.parent_branch_id = bt.id
)
SELECT * FROM branch_tree;
```

현재 브랜치 트리 탐색을 Rust에서 반복 쿼리로 수행. CTE로 단일 쿼리로 가능.

**판단**: 브랜치 depth가 깊어질 때(3+ depth) 성능 차이가 날 수 있음. 지금은 depth 2 이내라 불필요.

### 6.3 UPSERT (ON CONFLICT) — ✅ 이미 사용 중

```sql
-- session_discovery.rs에서 이미 사용
INSERT INTO session_links (...) VALUES (...)
ON CONFLICT(conversation_id, linked_conv_id) DO UPDATE SET score = excluded.score;
```

추가 활용 가능: plan_events, conversation_memory 등에서 "있으면 업데이트, 없으면 삽입" 패턴.

### 6.4 RETURNING — 미사용, 유용

```sql
-- 현재: INSERT 후 별도 SELECT로 생성된 ID/timestamp 조회
INSERT INTO plans (...) VALUES (...);
SELECT * FROM plans WHERE id = ?;

-- RETURNING 사용:
INSERT INTO plans (...) VALUES (...) RETURNING *;
```

**판단**: 코드 간소화에 유용하지만 기존 패턴이 동작하므로 새 코드 작성 시 적용.

---

## 7. 우선순위 분류

### 지금 당장 (리스크 없음, 즉시 효과)

| 항목 | 변경 | 파일 | 규모 |
|------|------|------|------|
| `PRAGMA synchronous = NORMAL` | WAL 모드에서 쓰기 속도 개선 | `db/mod.rs` | 1줄 |
| `PRAGMA busy_timeout = 5000` | 동시 접근 시 BUSY 에러 방지 | `db/mod.rs` | 1줄 |

```rust
// db/mod.rs — init() 함수에 추가
write_conn.execute_batch("PRAGMA journal_mode = WAL;")?;
write_conn.execute_batch("PRAGMA synchronous = NORMAL;")?;   // 추가
write_conn.execute_batch("PRAGMA busy_timeout = 5000;")?;    // 추가
write_conn.execute_batch("PRAGMA foreign_keys = ON;")?;

read_conn.execute_batch("PRAGMA busy_timeout = 5000;")?;     // 읽기도 추가
read_conn.execute_batch("PRAGMA foreign_keys = ON;")?;
```

### 새 코드 작성 시 적용 (관습 변경)

| 항목 | 적용 방식 |
|------|----------|
| **STRICT 테이블** | v23+ 마이그레이션에서 새 테이블 생성 시 `STRICT` 선언 |
| **RETURNING** | 새 INSERT 쿼리 작성 시 별도 SELECT 대신 RETURNING 사용 |
| **UPSERT** | 새 "있으면 업데이트" 패턴에서 ON CONFLICT 사용 (이미 일부 사용 중) |

### 필요 시 검토 (지금은 불필요)

| 항목 | 트리거 조건 |
|------|-----------|
| `cache_size = -8000` | DB 크기 100MB+ 또는 읽기 쿼리 지연 체감 |
| Generated Columns | 메시지 10만+ 건에서 길이 기반 필터링 빈번 |
| JSON 함수 | JSON 컬럼 기반 SQL 필터/집계 필요 시 (대시보드 등) |
| FTS5 Porter stemmer | 영어 검색 품질 불만 시 (한국어에는 효과 없음) |
| FTS5 Prefix 인덱스 | 실시간 타이핑 검색 도입 시 |
| Window Functions | 분석/대시보드 기능 추가 시 |
| CTE 재귀 쿼리 | 브랜치 depth 3+ 빈번 시 |
| `mmap_io` | DB 크기 500MB+ 시 |

### 하지 않을 것

| 항목 | 이유 |
|------|------|
| 기존 테이블 STRICT 전환 | 마이그레이션 비용 과도 (FTS5 트리거 + 29개 인덱스 재생성) |
| JSON 함수로 Rust 역직렬화 대체 | 타입 안전성(serde) 포기 대비 가치 부족 |
| 한국어 FTS5 토크나이저 | SQLite FTS5의 한국어 지원 자체가 약함. vector search가 대안 |

---

## 참고

- Modern SQLite Features: https://slicker.me/sqlite/features.htm
- tunaFlow DB 초기화: `src-tauri/src/db/mod.rs`
- 스키마: `src-tauri/src/db/schema.rs`
- 마이그레이션: `src-tauri/src/db/migrations.rs` (v1-v22)
- FTS5 쿼리: `src-tauri/src/commands/context_queries.rs`
- Vector 검색: `src-tauri/src/commands/vector_search.rs`
- Session Discovery: `src-tauri/src/commands/session_discovery.rs`
