# tunaFlow 기술 포스트 시리즈 — 킬러 기능 소개

> Status: idea
> Created: 2026-04-12
> 톤: 기술 공유. 마케팅 아님. 과장/거짓 없이, 같은 것을 만드는 사람들에게 팁(요령)을 알려주는 것.
> 기 발행: ContextPack 포스트 (시리즈 내에서 "이전 글 참고" 링크로 연결)

---

## 시리즈 목록 (10편)

| # | 제목 | 핵심 | 톤 |
|---|------|------|---|
| **1** | **"에이전트에게 프로세스를 줘라" — AOC를 만들면서 배운 것** | 왜 오케스트레이션 레이어가 필요한지, 어떤 구조로 풀었는지 | "이런 문제가 있어서 이렇게 만들었다" |
| **2** | **"Plan → Dev → Review" — 워크플로우 파이프라인 구현기** | 에이전트 역할 분리 + 승인 게이트를 어떻게 설계했는지 | "사람이 개입하는 지점을 이렇게 잡았다" |
| **3** | **"대화를 분기한다" — Branch 설계와 활용** | 왜 대화 분기가 필요한지, git branch처럼 독립 실험 후 adopt하는 구조 | "드로어 vs 전체화면, 고정 패널까지 온 과정" |
| **4** | **"에이전트끼리 토론시키기" — Roundtable 설계와 한계** | RT를 만들면서 부딪힌 문제들, 순차 vs 병렬, 정리를 누가 하는가 | "이게 잘 되는 경우와 안 되는 경우" |
| **5** | **"대화가 길어지면" — 에이전트 장기 메모리 구현기** | 토픽 압축, 벡터 검색, brute-force로 시작한 이유 | "sqlite-vec 안 쓰고 plain BLOB으로 시작한 이유" |
| **6** | **"Claude $20으로 워크플로우 돌리기" — 엔진 아키텍처** | 엔진 1개부터 3개까지, CLI subprocess 방식의 장단점 | "SDK 안 쓰는 이유, 쓰면 뭐가 좋은지" |
| **7** | **"코드 구조를 에이전트에게 알려주기" — rawq + code-review-graph** | 코드 검색과 구조 분석을 ContextPack에 넣는 방법 | "rawq와 CRG의 역할 분담을 이렇게 잡았다" |
| **8** | **"246개 스킬 중 필요한 것만" — 스킬 자동 적용 구현기** | 프로젝트 감지 → 추천 → 영속까지 | "수동 선택 UX가 왜 안 되는지, 어떻게 풀었는지" |
| **9** | **"에이전트가 같은 실수를 반복하면" — 품질 보증 설계** | Doom Loop, Failure Learning, Rework 에스컬레이션 | "3번 실패하면 어떻게 할 것인가" |
| **10** | **"tunaFlow로 풀사이클 돌려보기" — 워크플로우 실전 테스트 회고** | tunaInsight 프로젝트로 테스트하면서 겪은 것 | "잘 된 것, 안 된 것, 고친 것" |

**+ 기 발행**: ContextPack 포스트 (시리즈 2-3편 사이에서 참고 링크)

---

## 각 편 공통 구조

```
1. 문제: 이걸 왜 만들었는가 (직접 겪은 불편함)
2. 설계: 어떤 선택지가 있었고 왜 이걸 골랐는가 (트레이드오프)
3. 구현: 핵심 코드/구조 (실제 코드 스니펫)
4. 결과: 실사용에서 어떠했는가 (숫자가 있으면 숫자로)
5. 한계: 아직 못 푼 것, 다른 사람이라면 이렇게 할 수도 (솔직하게)
```

---

## 편별 상세

### 1. "에이전트에게 프로세스를 줘라" — AOC를 만들면서 배운 것

**문제**: Claude Code/Codex를 단독으로 쓰면 설계도 구현도 리뷰도 한 에이전트가 함. 자기가 짠 코드를 자기가 리뷰. 맥락이 길어지면 품질 저하.

**다루는 것**:
- AOC(Agent Orchestration Client)가 뭔지
- "Human with Agent" 철학 — 판단은 사람, 실행은 에이전트
- tunaFlow 전체 아키텍처 개요 (Tauri + React + Rust + SQLite)
- 에이전트를 subprocess로 호출하는 이유
- ContextPack 소개 (기 발행 포스트 링크)

### 2. "Plan → Dev → Review" — 워크플로우 파이프라인 구현기

**문제**: 에이전트한테 "이거 만들어줘"하면 바로 코딩 시작함. 설계 없이. 리뷰 없이.

**다루는 것**:
- 5-phase 워크플로우: Chat → Plan → Approve → Implementation → Review → Done
- 마커 기반 감지 (`<!-- tunaflow:plan-proposal -->` 등)
- ApprovalGate 3-way (승인/검토요청/보류)
- Implementation Branch 자동 생성
- Review RT 자동 실행
- Rework 루프 (fail → 수정 → 재리뷰)
- "사람이 개입하는 지점"을 어디로 잡았는가

### 3. "대화를 분기한다" — Branch 설계와 활용

**문제**: 메인 대화에서 실험하면 실패 시 되돌리기 어려움. 여러 방향을 동시에 시도하고 싶음.

**다루는 것**:
- Branch = git branch와 유사한 대화 분기
- shadow conversation (`branch:{branchId}`)
- 드로어에서 열리는 UX (왜 전체화면이 아닌가)
- 고정 패널 모드 (50:50 분할)
- adopt (결과를 메인에 삽입)
- git branch 연동 (linkGitBranch)
- Implementation Branch / Review Branch / Subtask Branch 구분
- 워크플로우와 Branch의 관계 (Plan 승인 → Branch 자동 생성)

### 4. "에이전트끼리 토론시키기" — Roundtable 설계와 한계

**문제**: 하나의 에이전트 의견만 듣기 불안함. 여러 관점을 듣고 싶음.

**다루는 것**:
- Sequential vs Deliberative 모드
- 멀티 엔진 혼합 (Claude + Gemini + Codex)
- ContextPack RT 주입 + 캐싱
- RT는 Branch의 확장 모드 (독립 기능 아님)
- blind verifier 패턴
- 한계: RT가 잘 안 되는 경우 (단순 질문에 과도, 합의 도달 어려움)
- 라운드 판정 게이트 설계 (Human 판정 아이디어)

### 5. "대화가 길어지면" — 에이전트 장기 메모리 구현기

**문제**: 12개 메시지 넘으면 에이전트가 앞의 대화를 잊음. 예전 결정을 다시 물어봄.

**다루는 것**:
- compressed memory (토픽별 JSON 배열)
- compression pre-pass (LLM 호출 전 프루닝)
- vector search (plain BLOB brute-force — sqlite-vec 안 쓴 이유)
- FTS5 + vector 하이브리드 (RRF가 아닌 append 방식, 그 이유)
- cross-session 자동 발견 (session_links)
- 60초 지연 문제 발견과 해결 (embed_text 캐싱)
- brute-force가 현재 규모에서 충분한 이유 (85 청크, < 1ms)

### 6. "Claude $20으로 워크플로우 돌리기" — 엔진 아키텍처

**문제**: 모든 사용자가 Max $100 플랜은 아님. $20으로도 되어야 함.

**다루는 것**:
- CLI subprocess 방식 (`claude -p --model claude-sonnet-4-6`)
- 같은 엔진(Claude)으로 3역할 (Architect/Developer/Reviewer) — Persona + ContextPack이 역할 분리
- ENGINE_CONFIGS 패턴 (엔진별 command/event 매핑)
- Ollama (openai_compat.rs) — base_url 교체로 모든 OpenAI 호환 백엔드
- SDK를 도입하지 않는 이유 (CLI가 파일 편집/MCP 등 전체 기능 제공)
- 비용 구조: $20 vs $100 vs 3-engine 조합

### 7. "코드 구조를 에이전트에게 알려주기" — rawq + code-review-graph

**문제**: 에이전트가 "이 함수를 고쳐라"는 알지만, 누가 호출하는지는 모름.

**다루는 것**:
- rawq = 검색 ("관련 코드 어디에?") — hybrid search (벡터 + BM25)
- code-review-graph = 탐색 ("바꾸면 어디가 깨져?") — AST 그래프 BFS
- 둘의 역할 분담 (겹치는 부분과 안 겹치는 부분)
- sidecar 패턴 (rawq.rs, crg.rs — 같은 구조)
- ContextPack 주입 vs 워크플로우 프롬프트 직접 주입
- rawq 미사용 옵션 활성화로 얻은 것 (--rerank, --text-weight)

### 8. "246개 스킬 중 필요한 것만" — 스킬 자동 적용 구현기

**문제**: 246개 스킬을 Settings에서 일일이 찾아 선택하는 UX가 번거움.

**다루는 것**:
- 4-layer 스킬: A(프로젝트 자동 감지) + B(프로젝트별 영속) + C(프롬프트 동적 활성화) + D(Persona recommendedSkills)
- detect_project_stack() — package.json/Cargo.toml 파싱
- skillMappings.ts — 의존성 → 스킬 매핑 테이블
- SkillRecommendationBanner — "이 스킬 켤까요?" 제안 UX
- 키워드 기반 섹션 선별 주입 (전체가 아닌 관련 ## 섹션만)
- toolset composition (hermes-agent 패턴 참고)

### 9. "에이전트가 같은 실수를 반복하면" — 품질 보증 설계

**문제**: Review fail → Rework → 또 fail → 또 Rework → 무한 반복.

**다루는 것**:
- Doom Loop 감지 (plan_events 카운터, 3회 에스컬레이션)
- Failure Learning (failure_lessons 테이블, FTS5 검색, Rework 시 자동 주입)
- Budget Pressure (rework 프롬프트에 실패 횟수 경고 주입)
- Review verdict 자동 감지 (autoDetectReviewVerdict)
- Resume vs Fresh Session (Optio 패턴 — 아직 미구현)
- PLATFORM_TIER0 (항상 주입되는 규칙)
- 한계: CLI subprocess라 에이전트 내부 tool call은 관찰 불가

### 10. "tunaFlow로 풀사이클 돌려보기" — 워크플로우 실전 테스트 회고

**문제**: 기능은 만들었는데 실제로 되는가?

**다루는 것**:
- tunaInsight 프로젝트로 Plan→Dev→Review 풀사이클 테스트
- 4회 풀사이클에서 발견한 버그들
- 결과 문서 마커 잔존 문제 (syncResultReport)
- Reviewer 템플릿 모순 (fail vs 워크플로우 이슈)
- 60초 임베딩 지연 발견과 해결
- 비용: 풀사이클 1회당 얼마
- 시간: Plan부터 Done까지 얼마나 걸렸나
- "잘 된 것": 역할 분리로 리뷰 품질 향상
- "안 된 것": 결과 문서 품질, Rework 반복
- "다음에 고칠 것": RT 라운드 판정, Fresh Session, 메타 에이전트

---

## 발행 순서 고려사항

- 1번(개요)이 먼저 나와야 나머지가 맥락을 가짐
- 2번(워크플로우)과 3번(Branch)은 연결 — 워크플로우가 Branch를 생성하므로
- ContextPack 기 발행 포스트는 2-3번 사이에서 참고 링크
- 10번(실전 회고)은 마지막 — 모든 기능을 알아야 맥락이 이해됨

```
발행 순서:
1 → 2 → (ContextPack 기존 글 참고) → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10
```

---

## 참고

- tunaFlow CLAUDE.md: 전체 기능 목록 + 세션 이력
- docs/ideas/: 각 기능별 아이디어 문서 (설계 근거)
- docs/reference/sessionHistory.md: 세션별 구현 내역
