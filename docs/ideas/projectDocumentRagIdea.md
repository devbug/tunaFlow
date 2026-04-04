# 프로젝트 문서 RAG — 대화 + 코드 + 문서 통합 검색

> Status: idea
> Created: 2026-04-04

---

## 1. 현재 지식 검색 체계

tunaFlow에는 이미 4개의 지식 검색 경로가 있습니다:

| 경로 | 대상 | 방법 | ContextPack 섹션 |
|------|------|------|-----------------|
| **rawq** | 코드 파일 (*.rs, *.ts 등) | AST 청킹 + 벡터 + BM25 하이브리드 | `## Code context (rawq)` |
| **context-hub** | 외부 라이브러리 문서 (React, Zustand 등) | CLI search, 로컬/번들 소스만 | `## Library documentation (context-hub)` |
| **vector_search** | 대화 메시지 | conversation_chunks 코사인 | retrieval chunks에 합산 |
| **FTS5** | 대화 키워드 | messages_fts MATCH | retrieval chunks에 합산 |

### 빠진 것

```
"이전에 작성한 설계 문서에서 뭐라 했지?"
"아이디어 문서에서 검토한 결론이 뭐였지?"
"Plan에서 어떤 결정을 내렸지?"
"Artifact에 저장한 내용 중 관련된 거 있어?"
```

**프로젝트 내부 문서**에 대한 검색 경로가 없습니다.

rawq가 `docs/*.md`를 인덱싱하긴 하지만, rawq는 **코드 검색에 최적화**되어 있습니다 (AST 청킹, 코드 키워드 가중). 자연어 문서 검색에는 `conversation_chunks`의 벡터 검색이 더 적합합니다.

---

## 2. 제안: conversation_chunks에 프로젝트 문서도 인덱싱

### 확장 대상

| 소스 | 경로 | 청킹 전략 | 가치 |
|------|------|----------|------|
| **Plan 문서** | `docs/plans/*.md` | ## 섹션 단위 | "이전 결정 회수" |
| **Idea 문서** | `docs/ideas/*.md` | ## 섹션 단위 | "검토한 적 있는지 확인" |
| **Result 문서** | `docs/plans/*-result.md` | ## 섹션 단위 | "이전 구현 결과 참조" |
| **Artifacts** | DB artifacts 테이블 | 개별 artifact 전체 | "사용자가 중요하다고 판단한 것" |
| **CLAUDE.md** | 프로젝트 루트 | ## 섹션 단위 | "프로젝트 규칙 검색" |
| **사용자 참고 문서** | 사용자가 지정한 경로 | ## 섹션 단위 | "요구사항/스펙 검색" |

### 기존 인프라와의 관계

```
rawq           → 코드 파일 (변경 없음)
context-hub    → 외부 라이브러리 문서 (변경 없음)
vector_search  → 대화 메시지 + 프로젝트 문서 (확장)
FTS5           → 대화 키워드 (변경 없음, 문서 검색은 벡터로)
```

rawq, context-hub와 **역할이 겹치지 않습니다**:
- rawq = "이 코드 어디에?" (코드 파일)
- context-hub = "React 문서에서 뭐라고?" (외부 라이브러리)
- vector_search 확장 = "이전 설계에서 뭐라 했지?" (프로젝트 내부 문서)

---

## 3. 구현 설계

### 3.1 DB 스키마 확장

현재 `conversation_chunks`:
```sql
CREATE TABLE conversation_chunks (
    id               TEXT PRIMARY KEY,
    project_key      TEXT NOT NULL,
    conversation_id  TEXT NOT NULL,       -- 대화 ID (문서는 NULL 가능해야 함)
    kind             TEXT NOT NULL,       -- "pair", "anchor"
    root_message_id  TEXT,
    text_preview     TEXT NOT NULL,
    embedding        BLOB,
    created_at       INTEGER NOT NULL
);
```

확장 (마이그레이션 v23+):
```sql
-- 기존 컬럼에 추가
ALTER TABLE conversation_chunks ADD COLUMN source_type TEXT NOT NULL DEFAULT 'conversation';
  -- 'conversation' | 'document' | 'artifact'
ALTER TABLE conversation_chunks ADD COLUMN file_path TEXT;
  -- 문서: 'docs/plans/auth-migration.md'
ALTER TABLE conversation_chunks ADD COLUMN section_title TEXT;
  -- 문서: '## 3. 구현 설계'
```

`conversation_id`는 문서 청크에서 NULL 허용 (현재 NOT NULL이라 FK 변경 필요).

### 3.2 문서 인덱싱 함수

```rust
/// 프로젝트 문서를 벡터 인덱싱
pub fn index_project_documents(
    conn: &Connection,
    project_key: &str,
    project_path: &str,
) -> Result<usize, AppError> {
    let mut indexed = 0;

    // 1. docs/ 디렉토리 스캔
    let docs_dir = Path::new(project_path).join("docs");
    if docs_dir.is_dir() {
        for entry in walkdir::WalkDir::new(&docs_dir)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map_or(false, |ext| ext == "md"))
        {
            indexed += index_markdown_file(conn, project_key, entry.path())?;
        }
    }

    // 2. CLAUDE.md
    let claude_md = Path::new(project_path).join("CLAUDE.md");
    if claude_md.is_file() {
        indexed += index_markdown_file(conn, project_key, &claude_md)?;
    }

    // 3. Artifacts (DB에서)
    indexed += index_artifacts(conn, project_key)?;

    Ok(indexed)
}

/// 마크다운 파일을 ## 섹션 단위로 청킹 + 임베딩
fn index_markdown_file(
    conn: &Connection,
    project_key: &str,
    file_path: &Path,
) -> Result<usize, AppError> {
    let content = std::fs::read_to_string(file_path)?;
    let relative_path = /* project_path 기준 상대 경로 */;

    // ## 기준으로 분할
    let sections = split_by_headings(&content);

    // 기존 청크 삭제 (재인덱싱)
    conn.execute(
        "DELETE FROM conversation_chunks WHERE project_key = ?1 AND file_path = ?2",
        params![project_key, relative_path],
    )?;

    let mut count = 0;
    for section in &sections {
        if section.content.len() < 20 {
            continue; // 너무 짧은 섹션 스킵
        }

        // 임베딩 (rawq daemon 사용 — 동일 모델)
        let embedding = rawq::embed_text(&section.content, false)?; // passage mode

        conn.execute(
            "INSERT INTO conversation_chunks (id, project_key, conversation_id, kind, text_preview, embedding, created_at, source_type, file_path, section_title)
             VALUES (?1, ?2, '', 'document', ?3, ?4, ?5, 'document', ?6, ?7)",
            params![
                uuid::Uuid::new_v4().to_string(),
                project_key,
                truncate(&section.content, 300),
                embedding_to_blob(&embedding),
                now_epoch_ms(),
                relative_path,
                section.title,
            ],
        )?;
        count += 1;
    }
    Ok(count)
}
```

### 3.3 청킹 전략: ## 섹션 단위

```rust
struct MarkdownSection {
    title: String,    // "## 3. 구현 설계"
    content: String,  // 해당 섹션 전체 텍스트
}

fn split_by_headings(content: &str) -> Vec<MarkdownSection> {
    // ## 또는 ### 기준으로 분할
    // 첫 ## 전의 내용은 "(intro)" 섹션으로
    // 각 섹션은 다음 ## 전까지의 텍스트
    // 500자 초과 시 단락(빈 줄) 기준으로 추가 분할
}
```

**왜 ## 섹션 단위인가**:
- 코드는 함수/클래스 단위가 자연스럽지만 (rawq의 AST 청킹)
- 문서는 ## 헤딩이 의미 단위의 경계
- 검색 결과에 `section_title`을 표시하면 사용자가 어떤 부분인지 즉시 파악

### 3.4 인덱싱 트리거

| 트리거 | 시점 | 대상 |
|--------|------|------|
| **프로젝트 선택 시** | `selectProject()` | 전체 문서 (최초 1회, 이후 변경분만) |
| **에이전트 완료 시** | `finalize_engine_run()` | 변경된 docs/ 파일만 |
| **FS watcher** | 파일 변경 감지 | 변경된 파일만 |
| **Plan 완료 시** | `updatePlanPhase("done")` | 해당 Plan 문서 |
| **Artifact 저장 시** | `create_artifact()` | 해당 Artifact |

### 3.5 변경 감지 (재인덱싱 최적화)

rawq의 SHA-256 해시 패턴 참고:

```rust
// 파일 해시 저장 (conversation_chunks에 hash 컬럼 추가 또는 별도 테이블)
// 해시 변경 시에만 재인덱싱
fn needs_reindex(conn: &Connection, project_key: &str, file_path: &str, content: &str) -> bool {
    let current_hash = sha256(content);
    let stored_hash = conn.query_row(
        "SELECT content_hash FROM document_index_status WHERE project_key = ?1 AND file_path = ?2",
        params![project_key, file_path],
        |row| row.get::<_, String>(0),
    ).ok();
    stored_hash.as_deref() != Some(&current_hash)
}
```

---

## 4. 검색 통합

### 4.1 기존 search_similar() — 변경 없음

`search_similar()`는 `conversation_chunks`에서 프로젝트 단위로 코사인 검색합니다. 문서 청크가 추가되면 **자동으로 검색 대상에 포함**됩니다. 코드 변경 없음.

### 4.2 ContextPack 주입 — source_type별 분리

현재 retrieval chunks는 한 섹션에 합산되는데, 문서 청크는 별도 섹션으로 분리하면 에이전트가 출처를 구분할 수 있습니다:

```
## 관련 대화 기록 (retrieval)
[conversation chunk 1]
[conversation chunk 2]

## 관련 프로젝트 문서 (document)
docs/plans/auth-migration.md > ## 3. 구현 설계
  → "JWT에서 OAuth로 전환, 영향 범위 14파일..."

docs/ideas/sdkIntegrationIdea.md > ## 4. 아키텍처 전환 설계
  → "Dual Path: CLI + SDK 공존..."
```

### 4.3 rawq와의 중복 처리

rawq도 `docs/*.md`를 인덱싱합니다. 중복 결과가 나올 수 있으므로:

```rust
// ContextPack 조립 시 rawq 결과와 document chunk 결과의 file_path를 비교
// 같은 파일이면 document chunk 우선 (자연어 검색이 더 정확)
// rawq 결과에서 해당 파일 제거
```

---

## 5. 기대 효과

### Before (현재)

```
사용자: "이전에 인증 관련해서 어떤 결정 내렸어?"
에이전트: compressed memory에서 토픽 요약만 참조 → "인증 관련 논의가 있었습니다" (디테일 없음)
```

### After (문서 RAG)

```
사용자: "이전에 인증 관련해서 어떤 결정 내렸어?"
에이전트: 
  - 대화 vector: "세션 3에서 OAuth 전환 논의" (대화 원문)
  - 문서 vector: "docs/plans/auth-migration.md §3: JWT→OAuth, 영향 14파일" (설계 문서)
  - artifact: "architect-decision: OAuth2 PKCE 방식 채택" (승격된 결정)
  → 구체적이고 근거 있는 답변
```

---

## 6. 구현 우선순위

### Phase 1: docs/ 문서 인덱싱 (가장 가치 높음)

```
- docs/plans/*.md, docs/ideas/*.md 인덱싱
- ## 섹션 기반 청킹
- 프로젝트 선택 시 최초 인덱싱
- search_similar() 자동 포함 (코드 변경 없음)
변경: vector_search.rs 확장 (~100줄), 마이그레이션 v23 (~10줄)
```

### Phase 2: Artifact 인덱싱

```
- artifacts 테이블 내용을 conversation_chunks에 동기
- Artifact 생성/수정 시 자동 인덱싱
변경: vector_search.rs 확장 (~50줄)
```

### Phase 3: ContextPack 섹션 분리 + rawq 중복 제거

```
- source_type별 섹션 분리 (대화 vs 문서)
- rawq 결과와 문서 결과 dedup
변경: context_loading.rs (~30줄), section_builders.rs (~40줄)
```

### Phase 4: 변경 감지 + 증분 인덱싱

```
- SHA-256 해시 기반 변경 감지
- FS watcher 연동
- 에이전트 완료 시 변경 파일만 재인덱싱
변경: vector_search.rs (~60줄)
```

---

## 7. 변경 범위 예측

| Phase | 신규 코드 | 수정 코드 | DB 변경 |
|-------|----------|----------|---------|
| Phase 1 | ~100줄 | ~20줄 | v23 마이그레이션 (컬럼 3개 추가) |
| Phase 2 | ~50줄 | ~10줄 | 없음 |
| Phase 3 | ~70줄 | ~30줄 | 없음 |
| Phase 4 | ~60줄 | ~20줄 | 없음 (또는 index_status 테이블) |

**총 예상**: ~280줄 신규 + ~80줄 수정.

---

## 8. 리스크

| 리스크 | 대응 |
|--------|------|
| **임베딩 비용 (시간)** | daemon 헬스체크 수정 후 진행. embed_text 최적화 선행 필요 |
| **rawq 중복** | Phase 3에서 dedup. Phase 1에서는 중복 허용 (영향 미미) |
| **문서 크기** | 큰 문서(1000줄+)는 ## 분할 후 500자 단위 추가 분할 |
| **인덱싱 시간** | docs/ 50파일 × 평균 5섹션 = 250청크. 임베딩 ~250회. daemon 있으면 ~30초 |
| **conversation_id NOT NULL** | FK 변경 필요. `conversation_id` NULL 허용 또는 sentinel 값 사용 |

---

## 9. 장기 고려: 프로젝트별 DB 분리

### 현재 구조 (단일 DB)

```
~/.tunaflow/tunaflow.db
├── projects: tunaFlow, tunaInsight, tunaDish, ...
├── conversations: 전 프로젝트 합산
├── messages: 전 프로젝트 합산
├── conversation_chunks: 전 프로젝트 합산 (벡터)
└── messages_fts: 전 프로젝트 합산 (FTS5)
```

벡터 검색 시 `WHERE project_key = ?`로 필터하지만, brute-force는 **전체 테이블을 스캔한 후 필터**합니다. 프로젝트가 많아지면 다른 프로젝트의 청크까지 불필요하게 로딩.

### 분리 구조

```
~/.tunaflow/db/
├── _global.db          ← projects 테이블, 설정, 스킬 프로필
├── tunaFlow.db         ← tunaFlow 대화/메시지/청크/FTS5
├── tunaInsight.db      ← tunaInsight만
└── tunaDish.db         ← tunaDish만
```

### 장점

- **brute-force 범위 자연 축소** — 해당 프로젝트 청크만 스캔 (ANN 없이도 빠름)
- **프로젝트 삭제** = DB 파일 삭제 (깔끔)
- **프로젝트 백업/이동** = DB 파일 복사
- **WAL/lock 경합** 프로젝트 간 격리
- **DB 파일 크기** 작아져서 brute-force가 오래 유효

### 단점

- **마이그레이션** — 기존 단일 DB를 분리하는 일회성 작업 필요
- **연결 관리** — 프로젝트 전환 시 DB 연결 교체 (현재 DbState가 고정 연결)
- **글로벌 데이터** — projects 테이블, 설정 등은 별도 _global.db에 유지

### 도입 시점

현재는 불필요합니다:

```
프로젝트 3개 × 100청크 = 300청크 → brute-force < 1ms
```

프로젝트 문서 RAG 적용 후:

```
프로젝트 10개 × 350청크(대화 100 + 문서 250) = 3,500청크 (단일 DB)
프로젝트별 DB = 350청크/DB → brute-force 최적 상태 유지
```

**트리거**: 프로젝트 5개 이상 + 총 청크 2,000+ 에서 검토. 또는 벡터 검색 지연이 10ms를 넘을 때.

### 구현 시 고려사항

```rust
// 현재
pub struct DbState {
    pub write: Arc<Mutex<Connection>>,  // 고정
    pub read: Arc<Mutex<Connection>>,   // 고정
}

// 분리 후
pub struct DbState {
    pub global: GlobalDb,                              // _global.db (항상 열림)
    pub project: Arc<Mutex<Option<ProjectDb>>>,        // 선택된 프로젝트 DB (전환 가능)
}

struct ProjectDb {
    pub write: Connection,
    pub read: Connection,
    pub project_key: String,
}
```

프로젝트 전환 시 `project` 연결을 교체. 이전 연결 close → 새 DB open. 이 과정에서 진행 중인 에이전트 실행이 있으면 완료 대기 필요.

---

## 참고

- rawq (코드 검색): `src-tauri/src/agents/rawq.rs`
- context-hub (라이브러리 문서): `src-tauri/src/agents/context_hub.rs`
- vector_search (대화 벡터): `src-tauri/src/commands/vector_search.rs`
- FTS5 (대화 키워드): `src-tauri/src/commands/context_queries.rs`
- ContextPack 조립: `src-tauri/src/commands/agents_helpers/context_pack/section_builders.rs`
- 임베딩 최적화 (선행): `docs/ideas/embeddingLatencyOptimizationIdea.md`
- Knowledge Layer 구조: `docs/ideas/knowledgeLayerArchitectureIdea.md`
