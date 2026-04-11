# Multi-Agent Context Strategy

> updated_at: 2026-03-31
> type: reference
> canonical: true

---

## 1. 문제 정의

tunaFlow는 한 대화에서 여러 에이전트(Claude, Gemini, Codex, OpenCode)가 순차적으로 참여한다. 각 에이전트가 메시지를 보낼 때 ContextPack이 조립되는데, **다른 에이전트의 이전 발언을 볼 수 있느냐**가 multi-agent 대화의 품질을 결정한다.

### 고정 window의 한계

4개 에이전트가 각 1턴씩 하면 user+assistant = 8메시지. 고정 6개 window에서는 최초 에이전트의 발언이 이미 범위 밖이다.

```
msg 1: user → "질문"
msg 2: Gemini → 응답           ← window 밖
msg 3: user → "확인"
msg 4: Codex → 응답
msg 5: user → "추가"
msg 6: OpenCode → 응답
msg 7: user → "정리해"
msg 8: OpenCode → 응답
msg 9: user → "클로드 요약해"  ← 현재

Claude가 보는 recent 6개: msg 4~9
Gemini 응답(msg 2): 보이지 않음
```

---

## 2. 현재 전략 (3-layer)

### Layer 1: Conversation Participants Meta (항상 포함)

```
## Conversation participants

Agents active in this conversation:
- **Tester Gemini (gemini)**: 응답 미리보기...
- **Reviewer Codex (codex)**: 응답 미리보기...
- **OpenCodeQwen (opencode)**: 응답 미리보기...
```

- 비용: 200-400자
- 효과: 에이전트 존재 인식 보장. 어떤 에이전트도 다른 에이전트의 참여를 놓치지 않음
- DB 쿼리 추가 없음 (이미 로딩된 current_messages에서 추출)

### Layer 2: Budget-Based Dynamic Window

고정 N개가 아니라, **context_cap 예산 안에서** 최대한 많은 메시지를 포함:

| 모드 | context_cap | 예상 메시지 수 |
|------|------------|---------------|
| Lite | 4,000자 | ~8-10개 |
| Standard | 6,000자 | ~12-15개 |
| Full | 8,000자 | ~16-20개 |

알고리즘:
1. 최근 20개 메시지를 DB에서 로딩 (충분한 headroom)
2. 최신 메시지부터 역순으로 budget 소비
3. budget 초과 시 오래된 메시지부터 제외
4. 단, per-agent 보장 메시지는 예외 (아래 참조)

### Layer 3: Per-Agent Last-Message Guarantee

각 참여 에이전트의 **최신 1개 메시지**는 budget을 초과하더라도 반드시 포함:

```rust
let must_include: HashSet<usize> = agent_last_idx.values().copied().collect();

// budget 내 → 포함
// budget 초과 + must_include → 강제 포함
// budget 초과 + not must_include → 제외
```

이로써 4개 에이전트가 참여한 대화에서 어떤 에이전트도 다른 에이전트의 가장 최근 발언을 놓치지 않는다.

---

## 3. 압축 기억과의 관계

| 계층 | 범위 | 정밀도 | 비용 |
|------|------|--------|------|
| Recent window (dynamic) | 최근 8-20개 메시지 | 원문 | 4-8k chars |
| Compressed memory | 12+ 이전 메시지 요약 | 구조화 요약 (참여자 포함) | 1.5-4k chars |
| FTS5 retrieval | 프로젝트 전체 대화 | 키워드 매칭 chunk | 2-6k chars |

Dynamic window가 넓어지면 compressed memory 의존도가 줄고, compressed memory에서 참여자 정보 유실 문제도 완화된다.

---

## 4. Vector DB 도입 로드맵

### 현재 (Phase 0): 규칙 기반

```
Recent window (dynamic) + Compressed memory + FTS5 retrieval
```

- 장점: LLM 호출 최소, 구현 단순
- 한계: FTS5는 키워드 매칭이라 의미 검색 불가. "Gemini가 아키텍처에 대해 뭐라 했지?"를 검색할 수 없음

### Phase 1 (다음 마일스톤): rawq embedding 활용

rawq daemon이 이미 임베딩 모델을 상주시키고 있음. 이걸 메시지 임베딩에도 활용 가능:

- assistant 메시지 저장 시 rawq에 임베딩 요청 → vector 저장
- ContextPack 조립 시 prompt를 rawq로 유사 메시지 검색 → retrieval 대체/보강
- **추가 인프라 불필요** — rawq가 이미 vector search를 지원

예상 시점: rawq가 안정적으로 동작하고 multi-agent 대화 품질 검증이 끝난 후.
현재 rawq는 코드 검색 전용이므로 메시지 임베딩은 확장 작업 필요.

### Phase 2 (중기): 전용 Vector DB

rawq 임베딩이 한계를 보이면 (메시지 의미 vs 코드 의미 차이, 인덱스 크기) 전용 vector DB 도입:

- 후보: SQLite vec extension, Qdrant embedded, LanceDB
- 저장 대상: 메시지 청크 + 에이전트 메타데이터 + 대화 결정사항
- 검색: 의미 기반 + 에이전트 필터 + 시간 범위

예상 시점: 프로젝트당 대화 50+개, 메시지 1000+개 수준에서 FTS5+rawq로 부족할 때.

### Phase 3 (장기): Agent-Aware Semantic Memory

- 에이전트별 기억 공간 (각 에이전트가 자기 관점의 요약 보유)
- 프로젝트 레벨 지식 그래프 (결정사항, 의존 관계, 미해결 이슈)
- RT 토론 결과의 자동 지식 승격

---

## 5. 설계 원칙

1. **각 layer는 독립적으로 유용해야 한다** — vector DB가 없어도 recent window + compressed memory + participants meta로 동작
2. **상위 layer가 하위를 대체하지 않는다** — vector DB가 들어와도 recent window와 participants meta는 유지
3. **비용은 예측 가능해야 한다** — LLM 호출은 compressed memory 생성 시에만. context 조립은 규칙 기반
4. **에이전트 identity 보존이 최우선** — 어떤 축소/압축에서도 "누가 말했는가"를 잃지 않음

---

## 6. 관련 코드

| 구현 | 파일 | 위치 |
|------|------|------|
| Participants meta 생성 | `send_common.rs` | `assemble_prompt()` 내 "Conversation participants" 블록 |
| Budget-based dynamic window | `send_common.rs` | `assemble_prompt()` 내 per-agent trimming 로직 |
| Per-agent guarantee | `send_common.rs` | `must_include` HashSet + 강제 포함 |
| Message loading (20개) | `send_common.rs` | `load_context_data()` → `load_recent_messages_with_author(conn, id, 20)` |
| Author attribution format | `context_pack.rs` | `build_context_summary_with_authors()` |
| Compressed memory participants | `conversation_memory.rs` | SUMMARY_PROMPT `## Participants` 섹션 |
