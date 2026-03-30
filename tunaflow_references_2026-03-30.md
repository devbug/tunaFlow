# tunaFlow 외부 레퍼런스 분석 문서
> **성격:** 브레인스토밍 / 외부 참고 자료. 현재 구현 상태 SSOT 아님.  
> **목적:** tunaFlow 설계/개발 에이전트들이 관련 기술 생태계를 파악하고 토론하기 위한 참고 자료  
> **작성:** 2026-03-29~30 동구(tunaFlow 개발자) + Claude 브레인스토밍 세션에서 수집  
> **현재 구현 기준 문서:** `CLAUDE.md`, `docs/reference/implementationStatus.md`, `docs/reference/codexProjectReference_2026-03-29.md`  
> **사용 방법:** 각 레퍼런스의 `tunaFlow 적용 질문`을 바로 실행 계획으로 보지 말고, 설계 검토의 출발점으로 활용할 것

---

## 배경: tunaFlow란

tunaFlow는 tunaPi + tunaDish 생태계의 **AOC(Agent Orchestration Client)**.  
터미널 에이전트(Claude Code, Codex, Gemini CLI)를 단일 인터페이스에서 오케스트레이션하는 데스크탑 앱.

**핵심 철학:**
- 인간이 관제탑, 에이전트들이 실행
- 컨텍스트팩으로 에이전트 간 맥락 자동 공유
- "Of the agent, By the agent, For the agent. Just add tokens."

**현재 상태에 대한 브레인스토밍 관찰 (2026-03-30 기준):**
- 진행도 약 60~65%
- UI 리팩토링 진행 중 (Linear.app 미학 참고)
- flow-agent 방향 검토 중 (Agent Profile / Persona / default skills / runtime binding은 진행됨)
- Artifacts(설계문서 허브), Plan/Review/Test 탭 방향이 유력

---

## 레퍼런스 목록

---

### [REF-01] Context Hub
**링크:** https://github.com/andrewyng/context-hub  
**작성자:** Andrew Ng (DeepLearning.AI 창립자)  
**분류:** 에이전트용 API 문서 허브 / 자기개선 에이전트  
**깃헙 스타:** 6.1k

**무엇인가:**  
에이전트가 API를 할루시네이션하거나 세션마다 같은 것을 다시 배우는 문제를 해결.  
큐레이션된 버전별 API 문서를 CLI(`chub`)로 가져오고, 에이전트가 발견한 것을 어노테이션으로 남겨 다음 세션에 자동 반영.

```bash
chub get openai/chat --lang py       # 최신 문서 가져오기
chub annotate stripe/api "웹훅 검증에 raw body 필요"  # 에이전트가 배운 것 기록
chub feedback stripe/api up          # 문서 품질 피드백
```

**핵심 개념:**
- 문서는 마크다운으로 오픈 관리 (누구나 기여 가능)
- 어노테이션: 로컬에 저장, 다음 세션 `chub get` 시 자동 포함
- 피드백: 문서 저자에게 전달 → 문서 개선 → 모두에게 혜택
- Incremental Fetch: 필요한 레퍼런스만 가져와 토큰 절약

**cq(REF-03)와의 차이:**
| | Context Hub | cq (Mozilla) |
|--|--|--|
| 지식 출처 | 공식 API 문서 (정적) | 에이전트 실전 경험 (동적) |
| 대상 | 라이브러리/API 사용법 | 어떤 도메인 지식이든 |
| 공유 범위 | 전체 커뮤니티 | 팀 또는 커뮤니티 |

**tunaFlow 적용 질문:**  
> "Context Hub의 어노테이션 메커니즘을 tunaFlow Artifacts에 통합할 수 있는가? 에이전트가 작업 중 발견한 것을 Artifacts에 저장하고, 다음 컨텍스트팩 생성 시 자동 포함하는 루프를 어떻게 설계할 것인가?"

---

### [REF-02] Harness (revfactory)
**링크:** https://github.com/revfactory/harness  
**한국어:** https://github.com/revfactory/harness/blob/main/README_KO.md  
**작성자:** Minho Hwang (한국인 개발자, 논문까지 직접 작성)  
**분류:** Claude Code 플러그인 / 에이전트 팀 아키텍처 메타 스킬

**무엇인가:**  
"Build a harness for this project" 한 마디로 도메인에 맞는 에이전트 팀 + 스킬을 자동 생성.  
6가지 아키텍처 패턴 중 선택하여 `.claude/agents/`와 `.claude/skills/` 자동 생성.

**6가지 아키텍처 패턴:**
| 패턴 | 설명 | tunaFlow 연관 |
|------|------|--------------|
| Pipeline | 순차 의존 작업 | 기본 Plan→Review→Test 플로우 |
| Fan-out/Fan-in | 병렬 독립 작업 후 취합 | RT 병렬 분석 |
| Expert Pool | 상황별 전문가 선택 | flow-agent 프리셋 선택 |
| **Producer-Reviewer** | 생성 후 품질 검토 | Review 탭 핵심 |
| **Supervisor** | 중앙 에이전트가 동적 배분 | 인간 관제탑 역할 |
| Hierarchical Delegation | 하향식 재귀 위임 | 복잡한 태스크 분해 |

**실측 데이터:**
- 하네스 없음: 평균 품질 49.5점
- 하네스 있음: 평균 품질 79.3점 (**+60%**, 15/15 승률)
- 태스크 복잡도 높을수록 효과 증가 (+23.8 기본, +29.6 고급, +36.2 전문가)

**tunaFlow 적용 질문:**  
> "tunaFlow의 flow-agent 프리셋이 Harness의 아키텍처 패턴 중 어떤 것에 해당하는가? Supervisor 패턴이 tunaFlow 인간 관제탑 역할을 에이전트로 위임할 때의 설계와 일치하는지 분석하라."

---

### [REF-03] cq (Mozilla AI)
**블로그:** https://blog.mozilla.ai/cq-stack-overflow-for-agents/  
**깃헙:** https://github.com/mozilla-ai/cq  
**작성자:** Mozilla AI (공익 스타트업)  
**분류:** 에이전트 지식 공유 공유지 / 오픈 표준 지향

**무엇인가:**  
에이전트들이 같은 실수를 각자 반복 → 토큰 낭비. 에이전트가 발견한 지식을 공유 저장소에 기여하고 다른 에이전트가 재활용하는 "에이전트를 위한 Stack Overflow".

**역사적 맥락:**
1. Stack Overflow 지식 → LLM 학습 데이터
2. LLM 등장 → Stack Overflow 질문 급감 (2025년 12월 3,862건, 창립 월 수준)
3. 에이전트들이 다시 같은 문제 반복 → cq 필요성 대두

**현재 제공:**
- Claude Code + OpenCode 플러그인
- MCP 서버 (로컬 지식 저장소 관리)
- 팀 API (조직 내 공유)
- Human-in-the-loop 리뷰 UI

**tunaFlow와의 관계:**
```
tunaFlow ContextPack = 실행 시점 컨텍스트 조립 계층
cq = 글로벌/팀 레벨 지식 공유지

미래 파이프라인 구상:
에이전트 작업 → Artifacts 저장(수동 승격) → cq 기여
cq 지식 → 컨텍스트팩 자동 주입
```

**tunaFlow 적용 질문:**  
> "tunaFlow Artifacts(설계문서 허브)가 cq 기여 단위로 작동할 수 있는가? Artifacts에 저장된 검증된 지식을 cq에 자동 기여하는 파이프라인의 구체적 구현 방안을 제안하라."

---

### [REF-04] rawq
**링크:** https://github.com/auyelbekov/rawq  
**분류:** 코드베이스 시맨틱+렉시컬 검색 / 토큰 최적화  
**상태:** ✅ tunaFlow에 이미 통합 완료

**무엇인가:**  
에이전트가 코드베이스 전체를 읽는 토큰 낭비 해결. 자연어 쿼리로 관련 청크만 반환.

```bash
rawq "인증 관련 코드"     # → 5~10개 관련 청크만 반환 (10k 파일 코드베이스에서)
rawq diff "변경된 부분"   # git diff 범위에서만 검색
rawq map                  # AST 기반 코드베이스 구조 표시
```

**특징:**
- Rust 단일 바이너리, 완전 오프라인 (ONNX Runtime)
- GPU 자동 감지, 데몬 모드 (30분 유휴 시 자동 종료)
- `--json`, `--stream`, `--token-budget` 에이전트 친화적

**code-review-graph(REF-05)와의 차이:**
| | rawq | code-review-graph |
|--|--|--|
| 방식 | 시맨틱+렉시컬 (의미 기반) | AST 지식 그래프 (구조 기반) |
| 질문 유형 | "인증 코드 어디있어?" | "이 함수 바꾸면 뭐가 영향받아?" |
| 토큰 절감 | ~10배 | 6.8~49배 |

**tunaFlow 적용 질문:**  
> "rawq와 code-review-graph를 tunaFlow MCP 옵션 레이어에서 어떻게 조합할 것인가? 어떤 상황에서 어떤 툴을 에이전트가 자동 선택하도록 할 것인가?"

---

### [REF-05] code-review-graph
**링크:** https://discuss.pytorch.kr/t/code-review-graph-claude-code/9331  
**분류:** AST 기반 코드 지식 그래프 / 토큰 최적화

**무엇인가:**  
Tree-sitter로 코드베이스를 파일 간 의존성 그래프로 만들어 SQLite 저장. 에이전트가 관련 파일만 골라 읽는 구조.

**실측 데이터:**
- 코드 리뷰: 토큰 6.8배 절감
- 대규모 모노레포: 최대 49배 절감

**tunaFlow 적용 질문:**  
> "rawq(REF-04)와 code-review-graph를 함께 활성화했을 때 중복 인덱싱 문제가 발생하는가? 두 툴의 SQLite/인덱스를 공유하거나 통합할 방법이 있는가?"

---

### [REF-06] cc-history-search
**링크:** https://github.com/mlshv/cc-history-search  
**분류:** Claude Code 플러그인 / 과거 대화 검색

**무엇인가:**  
벡터 DB 없이 `~/.claude/projects/` JSONL 파일을 직접 스캔. 세션 시작 시 과거 세션 수/날짜 범위 자동 주입.

**핵심 교훈:**  
"No fancy FTS or vector DBs, just straightforward file searches" — 심플하게 먼저 작동하게 만들고 나중에 고도화.

**tunaFlow 적용 질문:**  
> "tunaFlow Artifacts 장기기억 허브의 초기 구현을 cc-history-search처럼 파일 기반으로 시작하고, 데이터가 쌓인 후 sqlite-vec으로 고도화하는 점진적 전략이 적절한가? 전환 시점 기준을 어떻게 정할 것인가?"

---

### [REF-07] Context7 (MCP)
**분류:** MCP 서버 / 라이브러리 최신 문서 실시간 주입  
**상태:** tunaFlow MCP 옵션 레이어 후보

**무엇인가:**  
LLM 학습 데이터의 구버전 문제 해결. 필요할 때만 켜는 옵션 방식 권장 (상시 활성화 시 토큰 비용 높음).

**Context Hub(REF-01)와의 차이:**
| | Context7 | Context Hub |
|--|--|--|
| 문서 출처 | 공식 문서 자동 크롤링 | 오픈소스 커뮤니티 큐레이션 |
| 어노테이션 | 없음 | 있음 (에이전트 학습 가능) |
| 접근 방식 | MCP 서버 | CLI (`chub`) |

**tunaFlow 적용 질문:**  
> "Context7과 Context Hub를 동시에 사용할 때 중복이 발생하는가? tunaFlow에서 두 툴의 역할을 어떻게 분담시킬 것인가?"

---

### [REF-08] nullclaw/ironclaw 아키텍처
**링크:** https://georgelarson.me/chat  
**분류:** 멀티 에이전트 계층 분리 아키텍처 사례

**무엇인가:**  
포트폴리오 사이트에 IRC 기반 AI 에이전트 구축. public 에이전트(nully/Haiku)와 private 에이전트(ironclaw/Sonnet+)를 Tailscale로 분리.

**핵심 설계 원칙:**
1. **역할별 모델 선택:** 인사/단순질문 → Haiku, 코드분석/추론 → Sonnet
2. **public/private 경계:** 공개 에이전트는 최소 권한, private 에이전트만 민감 정보 접근
3. **API 키 단일화:** ironclaw 게이트웨이를 passthrough로 사용 → billing 단일화
4. **IRC 프로토콜:** 30년 된 표준, 벤더 종속 없음

**tunaFlow 적용 질문:**  
> "tunaFlow Roundtable에서 태스크 복잡도에 따라 모델을 자동 라우팅(단순→Haiku, 추론→Sonnet)하는 것이 가능한가? flow-agent 프리셋에 역할별 모델을 고정하는 방식과 동적 라우팅 방식 중 어떤 것이 tunaFlow 철학에 더 맞는가?"

---

### [REF-09] oh-my-agent
**긱뉴스:** https://news.hada.io/topic?id=27560  
**분류:** 범용 에이전트 하네스 / 역할 기반 팀

**무엇인가:**  
`.agents/` 폴더를 SSOT로 사용. PM, QA, Frontend, Backend, DB, TF Infra 등 역할 기반 팀. `/brainstorm` 워크플로우로 코드 없이 설계 먼저.

**tunaFlow 적용 질문:**  
> "oh-my-agent의 역할 분류(PM, QA, Frontend, Backend 등)를 tunaFlow flow-agent 프리셋에 그대로 적용할 수 있는가? tunaFlow 특화 역할(Architect, Reviewer, Tester)과 oh-my-agent 역할의 겹치는 부분과 다른 부분은?"

---

### [REF-10] vm0
**링크:** https://github.com/vm0-ai/vm0  
**분류:** 경쟁/차별화 분석 대상

**tunaFlow와의 차이:**
| | vm0 | tunaFlow |
|--|--|--|
| 실행 환경 | 클라우드 SaaS | 로컬 데스크탑 |
| 인간 개입 | 최소화 (자동화) | 관제탑 (의도적) |
| 타겟 | 반복 자동화 작업 | 복잡한 개발 오케스트레이션 |
| 철학 | "자면서 돌아가는 파이프라인" | "인간지능 + 에이전트 협업" |

**tunaFlow 적용 질문:**  
> "vm0 같은 완전 자동화 방향이 시장에서 성장할 경우, tunaFlow의 '인간 주도' 철학은 차별점이 되는가 아니면 한계가 되는가? tunaFlow가 자동화 수준을 어디까지 지원해야 하는가?"

---

### [REF-11] TurboQuant
**링크:** https://github.com/tonbistudio/turboquant-pytorch  
**분류:** LLM 인프라 / KV 캐시 최적화  
**현재 relevance:** 낮음 (API 기반 tunaFlow에 직접 해당 없음)  
**미래 relevance:** 높음 (로컬 모델 도입 시)

**무엇인가:**  
Google ICLR 2026 논문 구현. LLM KV 캐시 3~7배 압축, 3-bit에서 99.5% attention 정확도 유지. Contributors에 `@claude` 포함.

**tunaFlow 적용 질문:**  
> "tunaFlow가 Cerebras OSS 120B 같은 로컬/자체 추론 모델을 지원할 계획이 있는가? 그때 TurboQuant 같은 KV 캐시 최적화가 컨텍스트팩의 크기 제한을 완화하는 데 어떻게 기여할 수 있는가?"

---

### [REF-12] CodeSpeak
**링크:** https://codespeak.dev  
**분류:** 명세 기반 차세대 프로그래밍 언어 (철학 참고)

**무엇인가:**  
코틀린 창시자가 만든 LLM 기반 언어. "Maintain Specs, Not Code" 철학.

**실측:** yt-dlp 6.7배, Faker 7.9배, beautifulsoup4 5.9배 코드 축소

**커뮤니티 비관론:**  
"명세가 프로그램을 완전히 정의할 정도면 명세 쓰는 것이 프로그래밍만큼 어렵다" (Joel Spolsky)

**tunaFlow 적용 질문:**  
> "tunaFlow Plan 탭의 task brief가 CodeSpeak의 명세(spec)와 유사한 역할을 하는가? 에이전트가 task brief를 읽고 구현하는 tunaFlow 워크플로우가 CodeSpeak의 spec→code 자동생성과 어떻게 다른가?"

---

## 에이전트를 위한 토론 가이드

### 우선순위별 토론 주제

**즉시 적용 가능 (현재 개발 단계)**
1. Context Hub(REF-01) 어노테이션을 tunaFlow의 어떤 계층에 둘 것인가
2. Harness(REF-02) 패턴을 Agent/Profile/Review 구조에 어떻게 해석할 것인가
3. rawq(REF-04) + code-review-graph(REF-05)를 언제 함께 검토할 것인가

**중기 적용 (tunaFlow 베타 이후)**
4. cq(REF-03) 기여 파이프라인 설계
5. 역할별 모델 자동 라우팅 (REF-08 참고)
6. cc-history-search(REF-06) 방식 → sqlite-vec 고도화 전환 시점

**장기 검토 (tunaFlow 성숙 후)**
7. TurboQuant(REF-11) — 로컬 모델 도입 시
8. vm0(REF-10) — 자동화 수준 결정

### 통합 질문 (전체 레퍼런스 종합)

> "이 레퍼런스들을 종합했을 때, tunaFlow 컨텍스트팩의 다음 버전은 어떤 구조여야 하는가?  
> Context Hub(REF-01) 어노테이션 + cq(REF-03) 지식 + cc-history-search(REF-06) 과거 대화 + rawq(REF-04) 코드 검색을  
> 어떻게 단일 컨텍스트팩으로 통합할 것인가?"

주의:
- 위 질문들은 현재 구현 상태를 설명하는 문장이 아니라, 향후 설계 검토용 질문이다.
- 현재 제품 우선순위와 구현 현황은 위의 기준 문서를 먼저 따른다.

---

*문서 버전: 2026-03-30*  
*다음 업데이트 시 새로 발견된 레퍼런스 추가 예정*
