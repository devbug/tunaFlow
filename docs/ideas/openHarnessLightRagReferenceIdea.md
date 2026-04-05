# OpenHarness + LightRAG 레퍼런스 분석

> Status: idea
> Created: 2026-04-05
> 출처: HKUDS (홍콩대)
> - OpenHarness: `_research/_util/OpenHarness/` (Python 18,286줄, v0.1.0, 12⭐)
> - LightRAG: `_research/_util/LightRAG/` (Python, EMNLP2025, 28.4k⭐)

---

## 1. OpenHarness — tunaFlow 참고 패턴

### 1.1 개요

Claude Code의 Python 클린룸 구현. 43+ 도구, 54 CLI 명령, 114 테스트. Protocol 기반 LLM 추상화로 Anthropic/OpenAI/Ollama 런타임 스왑 가능.

### 1.2 tunaFlow에 지금 적용 가능한 패턴 (2개)

#### A. 도구 결과 선별 프루닝 (microcompact)

**OpenHarness 패턴** (`services/compact/`):

```python
# LLM 호출 없이 토큰 절감
microcompact_messages(messages, keep_recent=5)
  → 오래된 tool result를 도구 종류별로 선택 제거
  → Read, Bash, Grep, WebFetch 등 결과 → "[Old tool result content cleared]"
  → 최근 5개는 보존
  → 토큰 50%+ 절감, LLM 호출 0
```

**tunaFlow 현재**: compression pre-pass에서 코드블록 프루닝 + 빈줄 collapse. **도구 결과 종류별 선별 제거 없음**.

대화에 남아있는 불필요한 데이터:
- rawq 검색 스니펫 (이미 오래된 결과)
- test runner 전체 출력 (긴 에러 스택트레이스)
- CRG impact radius 결과 (이전 단계의 구조 분석)
- 워크플로우 프롬프트 원문 (이미 처리됨)

**적용 — 두 곳에 필요** (코더 Opus 리뷰 반영):

```
적용 위치 1: conversation_memory.rs — compression 입력 정리 (prune_for_summary)
  → LLM 요약 전에 도구 결과 제거 → 요약 품질 + 비용 개선
  → 이미 compression pre-pass가 있으므로 확장

적용 위치 2: prompt_assembly.rs — recent context 윈도우 ← 핵심
  → 실시간 ContextPack 조립 시 오래된 도구 결과가 context budget을 잡아먹는 곳
  → compression 대상이 아닌 recent 메시지도 도구 결과 프루닝 필요
```

```rust
// 공통 함수 (context_pack/utils.rs 또는 별도 모듈)
fn prune_tool_results(messages: &[Message], keep_recent: usize) -> Vec<Message> {
    // 1. rawq 코드 스니펫 (## Code context 섹션) → 오래된 것 제거
    // 2. test output (```로 감싸진 긴 결과) → 요약으로 교체
    // 3. CRG impact 결과 → 이전 단계 것 제거
    // 4. 워크플로우 프롬프트 (### 🔧, ### 📋 등) → 이전 단계 것 축소
    // 최근 keep_recent개는 보존
}

// 위치 1: conversation_memory.rs
let pruned_transcript = prune_tool_results(&old_messages, 3);
let summary = llm_summarize(&pruned_transcript);

// 위치 2: prompt_assembly.rs — recent context 빌드 시
let pruned_recent = prune_tool_results(&recent_messages, 5);
// pruned_recent로 context window 조립
```

**규모**: ~40줄 Rust (공통 함수 + 두 호출 지점).

#### B. 토큰 기반 압축 트리거

**OpenHarness 패턴** (`engine/query.py`):

```python
# 메시지 수가 아닌 토큰 수로 판단
estimated_tokens = estimate_message_tokens(messages)
if estimated_tokens > context_window - AUTOCOMPACT_BUFFER_TOKENS:  # 13,000 토큰 버퍼
    auto_compact_if_needed(messages, ...)
```

**tunaFlow 현재**: `needs_compression()`이 **메시지 12개 이상 + 이전 압축 이후 6개 추가**로 판단. 고정 메시지 수 기반.

문제:
- 12개 메시지인데 각각 10줄이면 → 압축 불필요한데 트리거됨
- 5개 메시지인데 각각 3000토큰이면 → 압축 필요한데 트리거 안 됨

**적용** (코더 Opus 리뷰 반영 — trace_log 의존 제거):

```rust
// conversation_memory.rs — needs_compression() 변경
fn needs_compression(conn: &Connection, conversation_id: &str) -> bool {
    let msg_count = count_messages(conn, conversation_id);
    let total_chars = sum_message_chars(conn, conversation_id);
    
    // 메시지 수 OR 총 문자 수 — 어느 쪽이든 초과 시 트리거
    msg_count >= 12 || total_chars >= 40_000
}

// ※ trace_log의 input_tokens는 agent:completed 이후에만 기록되므로
//    사전 판단용으로 부적합. sum_message_chars()가 더 적합.
//    (DB에서 SUM(LENGTH(content))로 즉시 계산 가능)
```

**규모**: ~10줄 Rust. `needs_compression()` 수정.

### 1.3 SDK 전환 시 참고할 패턴 (2개)

#### C. Pydantic → JSON Schema 자동 생성

```python
# OpenHarness: 도구 정의
class ReadFileTool(BaseTool):
    input_model = ReadFileInput  # Pydantic BaseModel
    
    def to_api_schema(self) -> dict:
        return pydantic_to_json_schema(self.input_model)
        # → function calling에 필요한 JSON Schema 자동 생성
```

Rust에서는 `schemars` 크레이트가 동일 역할:

```rust
#[derive(JsonSchema)]
struct ReadFileInput {
    path: String,
    start_line: Option<usize>,
    end_line: Option<usize>,
}
// → schemars::schema_for::<ReadFileInput>() → JSON Schema
```

tunaFlow에서 SDK function calling 도구 정의 시 수동 JSON 작성 대신 타입에서 자동 생성.

#### D. 도구 실행 전 Permission 체크

```python
# OpenHarness: 실행 직전 권한 확인
async def execute_tool(tool, args, context):
    permission = check_permission(tool.name, context.permission_mode)
    if permission == "denied":
        return ToolResult(error="Permission denied")
    # ... 실행
```

tunaFlow에서 Developer/Reviewer 역할별 도구 제한:

```
Developer: [read_file, write_file, search, bash, mark_subtask_done] → 허용
Reviewer:  [read_file, search, submit_verdict] → 허용, [write_file, bash] → 차단
```

claw-code의 3-tier Permission과 동일 방향 (`referenceRepoReviewV2Idea.md` §3 참고).

### 1.4 참고 불필요한 것

| 패턴 | 이유 |
|------|------|
| TUI/React 런처 | tunaFlow는 Tauri GUI |
| Swarm/Teammate pane (tmux/iTerm2) | tunaFlow는 Branch/RT로 구현 완료 |
| MCP 클라이언트 | MCP 도입 안 함 |
| Session persistence (파일 기반) | SQLite가 더 나음 |
| 54개 CLI 명령 | 데스크톱 앱이라 불필요 |

### 1.5 신뢰도 평가

v0.1.0, 별 12개. 코드 품질은 괜찮지만 (114 테스트, async throughout, Pydantic 검증) 커뮤니티 검증이 부족합니다. **패턴 참고용으로는 충분하지만, 코드 직접 가져오기는 위험**.

---

## 2. LightRAG — 장기기억 강화 후보

### 2.1 개요

벡터 + 지식 그래프 하이브리드 RAG. EMNLP2025 발표. 28.4k⭐.

```
문서 → 청킹 → 엔티티/관계 추출 (LLM) → KG 구축 → 벡터 임베딩
                                          ↓
쿼리 → 키워드 추출 → KG 탐색 + 벡터 검색 → 컨텍스트 조립 → LLM 응답
```

### 2.2 검색 모드 (6개)

| 모드 | 동작 | 용도 |
|------|------|------|
| **local** | 엔티티 임베딩 검색 → 관련 관계 확장 | "이 사람과 관련된 것은?" |
| **global** | 관계 임베딩 검색 → 연결 엔티티 확장 | "주요 개념은?" |
| **hybrid** | local + global 라운드로빈 병합 | 일반 질문 |
| **naive** | 순수 벡터 검색 (KG 안 씀) | 키워드 매칭 |
| **mix** (기본) | hybrid + 벡터 청크 + 리랭킹 | 복잡한 질문 (**최고 품질**) |
| **bypass** | KG 건너뛰고 벡터만 | 폴백 |

### 2.3 M4 Air 16GB 실용성

| 항목 | 가능? | 조건 |
|------|------|------|
| 실행 | ✅ | JSON 스토리지 + NetworkX + Ollama 7B |
| 1000 문서 이하 | ✅ | ~2-3GB 메모리 |
| 1000+ 문서 | ❌ | NetworkX OOM → PostgreSQL 필요 |
| 인덱싱 속도 | ⚠️ | 문서당 2-3 LLM 호출, 7B로 ~30초/문서 |
| 쿼리 속도 | ✅ | 500ms-2s (캐싱 시) |

**핵심 병목**: 엔티티 추출에 **문서당 2-3 LLM 호출** 필요. qwen3.5:9b thinking 모드 33분 경험을 고려하면, 인덱싱이 실사용에서 문제.

### 2.4 tunaFlow 현재 구조와의 비교

| 기능 | tunaFlow (현재) | LightRAG |
|------|----------------|----------|
| 벡터 검색 | ✅ sqlite-vec brute-force | ✅ NanoVectorDB/Faiss/PG |
| 키워드 검색 | ✅ FTS5 | ✅ (naive 모드) |
| 관계 추론 | ❌ 없음 | ✅ KG 탐색 (multi-hop) |
| 엔티티 추출 | ❌ 없음 | ✅ LLM 기반 |
| 구조적 코드 관계 | ✅ code-review-graph | ❌ (텍스트 문서 전용) |
| 인덱싱 비용 | $0 (rawq embed) | LLM 호출/문서 |
| SQLite 지원 | ✅ | ❌ (PostgreSQL 필요) |
| 운영 복잡도 | 낮음 (단일 바이너리) | 높음 (4개 스토리지 백엔드) |

### 2.5 필요한 시점

**지금은 불필요합니다.** 이유:

1. 85개 대화 청크 + 수십 개 문서 → sqlite-vec + FTS5로 충분
2. 코드 관계 추론은 code-review-graph가 담당 (이미 통합 완료)
3. 엔티티 추출 비용(LLM 호출)이 M4 Air에서 현실적이지 않음
4. SQLite 미지원 → 별도 PostgreSQL 운영 필요 (로컬 퍼스트 위반)

**검토 시점:**

```
트리거 1: 프로젝트 문서 100+ 개에서 "이 결정이 어떤 다른 결정과 연결되는가" 질문 빈번
트리거 2: sqlite-vec 검색 품질이 "관련 문서를 못 찾는다"는 불만 3회 이상
트리거 3: tunaMeta 개발 시 — 프로젝트 레벨 지식 그래프가 필요할 때
트리거 4: vector search 결과의 평균 confidence가 0.4 미만으로 하락 (정량 기준)
          → rawq 검색의 confidence score로 측정 가능
          → trace_log에서 retrieval 품질 메트릭 추적 시 자동 감지
```

### 2.6 도입 시 하이브리드 구조 (장기 비전)

```
일반 검색 (빠름, 무료):
  sqlite-vec + FTS5 → 대화 기록 + 프로젝트 문서
  code-review-graph → 코드 구조 관계

심화 검색 (느림, LLM 비용):
  LightRAG → 엔티티-관계 기반 multi-hop 추론
  트리거: 사용자가 명시적으로 "깊은 분석" 요청 시에만
```

기본은 sqlite-vec, 필요할 때만 LightRAG 호출. 항상 둘 다 돌리는 건 비용 낭비.

---

## 3. 종합 — 참고 우선순위

| 레퍼런스 | 신뢰도 | 적용 시점 | 참고 대상 |
|---------|--------|----------|----------|
| **OpenHarness — microcompact** | 낮음 (v0.1.0) | **지금** | 도구 결과 선별 프루닝 패턴 (~30줄) |
| **OpenHarness — 토큰 기반 트리거** | 낮음 | **지금** | needs_compression() 개선 (~10줄) |
| **OpenHarness — JSON Schema 자동 생성** | 낮음 | SDK 전환 시 | schemars 크레이트 참고 |
| **OpenHarness — Permission 체크** | 낮음 | SDK 전환 시 | claw-code 패턴과 통합 |
| **LightRAG — KG 기반 RAG** | 높음 (28.4k⭐) | 장기 | 프로젝트 100+ 문서 시 |

**"A lot of apparent 'model quality' is really context quality."** (Sebastian Raschka)

두 레퍼런스 모두 이 원칙을 다른 방식으로 구현:
- OpenHarness: 불필요한 컨텍스트를 제거 (microcompact)
- LightRAG: 필요한 컨텍스트를 구조적으로 찾음 (KG 탐색)

tunaFlow의 ContextPack은 이미 이 방향이고, microcompact 패턴으로 "제거" 측을 강화하는 것이 지금 가장 현실적인 개선입니다.

---

## 참고

### OpenHarness 핵심 파일
- `src/openharness/api/client.py` — Anthropic 클라이언트 + 재시도
- `src/openharness/api/openai_client.py` — OpenAI 호환 클라이언트 (Ollama 스왑)
- `src/openharness/services/compact/` — 2-level compaction (microcompact + full)
- `src/openharness/engine/query.py` — 자동 압축 트리거 로직
- `src/openharness/tools/base.py` — Pydantic 기반 도구 정의
- `src/openharness/config/settings.py` — 프로바이더 선택 로직

### LightRAG 핵심 파일
- `lightrag/lightrag.py` — 메인 인터페이스
- `lightrag/operate.py` — 엔티티 추출 + 쿼리 로직
- `lightrag/kg/` — 14개 스토리지 구현
- `lightrag/llm/ollama.py` — Ollama 연동

### 관련 tunaFlow 문서
- 장기기억: `docs/ideas/knowledgeLayerArchitectureIdea.md`
- 프로젝트 문서 RAG: `docs/ideas/projectDocumentRagIdea.md`
- 벡터 검색 계획: `docs/plans/conversationVectorSearchPlan.md`
- SDK 전환: `docs/ideas/sdkIntegrationIdea.md`
- claw-code Permission: `docs/ideas/referenceRepoReviewV2Idea.md` §3
