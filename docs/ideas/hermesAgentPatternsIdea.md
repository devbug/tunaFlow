# Hermes Agent — 자기 개선형 멀티 에이전트 프레임워크 참고

> Status: idea
> Created: 2026-04-03
> 출처: https://github.com/NousResearch/hermes-agent (Python, 8,781줄 core)
> 로컬: `_research/_util/hermes-agent/`

---

## 1. Hermes Agent란

NousResearch의 자기 개선형 멀티 에이전트 프레임워크. OpenAI SDK 기반 멀티 프로바이더, 멀티 플랫폼(Telegram/Discord/Slack/WhatsApp/Signal), SQLite+FTS5, 플러거블 메모리, 스킬 자동 생성.

핵심 철학: **에이전트가 경험을 통해 스스로를 개선한다** — 스킬 자동 생성, 메모리 학습, iterative context compression.

---

## 2. tunaFlow에 적용 가능한 패턴

### 2.1 Iteration Budget + Pressure Injection — **높음**

**hermes 구현** (`run_agent.py:165-207, 634-639`):

```python
class IterationBudget:
    max_total: int
    _used: int  # thread-safe counter

    def consume() -> bool:  # 예산 소비, 없으면 False
    def refund():           # execute_code는 반환 (실행이 목적이므로)
```

70%/90% 도달 시 **tool result에 경고 주입** (메시지가 아닌 도구 결과에):

```python
if budget.used_pct >= 0.7:
    tool_result += "\n⚠️ Budget 70% consumed. Prioritize completion."
if budget.used_pct >= 0.9:
    tool_result += "\n🛑 Budget 90%. Finish NOW or summarize progress."
```

**왜 tool result에 주입하나**: 메시지로 보내면 에이전트가 무시할 수 있음. tool result는 에이전트가 다음 추론에서 **반드시 읽는** 위치.

**tunaFlow 적용**:
- 워크플로우 Rework 카운트를 review verdict findings에 주입
- SDK 전환 후: tool call result에 budget pressure 삽입
- 현재(CLI): Developer 프롬프트에 "이전 N회 실패" 컨텍스트 명시적 삽입

### 2.2 Toolset Composition — **높음, 스킬 시스템**

**hermes 구현** (`toolsets.py`):

```python
TOOLSETS = {
    "research": ["web_search", "browser", "extract_page"],
    "file": ["read_file", "write_file", "patch_file", "search_files"],
    "terminal": ["execute_code"],
    "delegation": ["delegate_task"],
}
# 조합: enabled_toolsets=["research", "file"] → 7개 도구 활성화
```

에이전트 생성 시 `enabled_toolsets` / `disabled_toolsets`로 도구 세트 필터링.

**tunaFlow 적용**: 스킬을 toolset 단위로 그룹화

```typescript
const SKILL_SETS = {
  "frontend": ["anthropic-frontend-design", "microsoft-zustand-store-ts"],
  "review": ["microsoft-frontend-design-review", "anthropic-webapp-testing"],
  "api": ["openai-openai-docs", "anthropic-claude-api"],
};
```

ClawSouls `recommendedSkills`와 결합: Persona가 skill set을 선언 → 선택 시 해당 스킬 자동 활성화.

### 2.3 Context Compression 3-Phase — **중간**

**hermes 구현** (`agent/context_compressor.py`):

```
Phase 1: Tool output 프루닝 (LLM 비용 0)
  - 오래된 tool result → "[pruned]"
  - 최근 N개만 보존
  - 이것만으로 50%+ 토큰 절감

Phase 2: Head/Tail 보호
  - 첫 3턴 (초기 맥락) 보호
  - 마지막 ~20K 토큰 (최근 작업) 보호
  - 중간만 압축 대상

Phase 3: LLM 요약 (비용 발생)
  - auxiliary model (저가 모델)로 요약
  - 이전 요약이 있으면 iterative update
  - 요약 예산: context의 5%, 최대 12K 토큰
```

50% context 도달 시 자동 트리거.

**tunaFlow 현재**: 12+ 메시지 → 바로 LLM 요약 (Phase 3만 있음)

**적용 포인트**: Phase 1(프루닝 pre-pass) 추가. LLM 호출 전에 오래된 메시지의 tool output/코드블록을 `[pruned]`로 교체하면 요약 품질 + 비용 모두 개선.

### 2.4 Memory Manager Lifecycle — **중간**

**hermes 구현** (`agent/memory_manager.py:140-276`):

```
Turn 시작:
  prefetch_all(user_message)     → 관련 메모리 미리 로드
  
Turn 종료:
  sync_all(user, assistant)      → 새 정보 저장
  queue_prefetch_all()           → 다음 턴 백그라운드 프리캐시

Compression 전:
  on_pre_compress()              → "이것만은 기억해" 프롬프트 주입
```

**tunaFlow 현재**: `load_compressed_memory()`만 (prefetch 1단계)

**적용 포인트**: sync(후처리) 단계 추가 — 턴 종료 시 토픽별 메모리 업데이트 트리거. 현재는 메시지 카운트 기반 트리거만.

### 2.5 Delegate Tool (Subagent) — **SDK 전환 시**

**hermes 구현** (`tools/delegate_tool.py`):

```python
# 제약
MAX_CONCURRENT_CHILDREN = 3
MAX_DEPTH = 2  # 손자 에이전트 금지

# 자식 에이전트에 차단된 도구
BLOCKED_TOOLS = ["delegate_task", "clarify", "memory", "send_message", "execute_code"]

# 자식은 받는 것
- 부모의 enabled_toolsets (allowed 교집합)
- 독립 iteration budget (기본 50)
- task-specific ephemeral system prompt
- 격리된 터미널 세션
# 자식은 안 받는 것
- 부모 대화 히스토리
- 메모리 접근
- 메시지 전송 권한
```

**tunaFlow 적용**: SDK 전환 후 Developer/Reviewer를 subagent로 실행할 때 참고. 현재 Branch 기반 분리와 유사하지만, hermes의 blocked tools 패턴은 역할별 도구 제한(`allowedTools`)의 구체적 구현 사례.

### 2.6 Prompt Injection Guard — **중간**

**hermes 구현** (`agent/prompt_builder.py:36-73`):

```python
# 36개 위협 패턴 매칭
THREAT_PATTERNS = [
    r"ignore.*(?:previous|above|all).*instructions",
    r"you are now",
    r"system:\s*",
    r"<\|(?:im_start|system)\|>",
    # ... 32 more patterns
]

# invisible Unicode 감지
INVISIBLE_CHARS = ['\u200b', '\u200c', '\u200d', '\ufeff', ...]

def _scan_for_injection(content: str) -> list[str]:
    # context file (SOUL.md, AGENTS.md, .cursorrules) 로딩 시 스캔
    # 감지 시 경고 + 해당 파일 차단 (non-fatal)
```

**tunaFlow 적용**: ContextPack에서 외부 파일(docs/plans/*.md, skills/*.md)을 로딩할 때 injection 스캔 추가. 특히 사용자가 프로젝트에 넣는 문서가 의도치 않게 에이전트 행동을 변경하는 케이스 방지.

---

## 3. 참고만 하고 채택하지 않을 것

| 패턴 | 이유 |
|------|------|
| **멀티 플랫폼 Gateway** | tunaFlow는 Tauri 데스크톱 앱. 메시징 게이트웨이 불필요 |
| **Provider Fallback Chain** | 현재 CLI 기반이라 프로바이더 체인 불필요. SDK 전환 후에도 사용자가 엔진 명시 선택 |
| **Skill Auto-creation** | 매력적이지만 현재 우선순위 아님. 스킬 시스템 안정화 후 장기 검토 |
| **MCP Server 모드** | hermes가 MCP 서버로 동작. tunaFlow는 MCP 클라이언트 측 |
| **Batch Runner** | RL trajectory 수집용. tunaFlow는 RL 학습 안 함 |
| **Codex Responses Adapter** | Codex 전용 API 래핑. SDK 전환 문서에서 별도 다룸 |
| **Credential Pool** | 멀티 키 라운드로빈. tunaFlow는 단일 키 |

---

## 4. 다른 아이디어 문서와의 연결

| 문서 | hermes 패턴과의 관계 |
|------|---------------------|
| `knowledgeLayerArchitectureIdea.md` | Memory Manager lifecycle → KnowledgeSource의 prefetch/sync 패턴 |
| `sdkIntegrationIdea.md` | Anthropic/Codex Adapter → SDK 전환 시 어댑터 구조 참고 |
| `sdkAsInterfaceLayerIdea.md` | OpenAI SDK 범용 사용 → 동일 방향 (OpenAI SDK로 모든 프로바이더) |
| `clawSoulsPersonaSpecIdea.md` | Toolset composition + allowedTools → Persona-Skill 연동 |
| `rawqGraphEvolutionStrategyIdea.md` | Context compression pre-pass → rawq 결과 프루닝 전략 |
| `chatReadabilityImprovementIdea.md` | Budget pressure injection → 워크플로우 프롬프트에 상태 정보 주입 |

---

## 5. 핵심 파일 참조

| 파일 | 줄 수 | 핵심 내용 |
|------|------|----------|
| `run_agent.py` | 8,781 | AIAgent 오케스트레이터, tool loop, API 호출, 스트리밍 |
| `agent/prompt_builder.py` | 400+ | 시스템 프롬프트 조립, injection guard, 스킬 인덱스 |
| `agent/memory_manager.py` | 300+ | 메모리 프로바이더 오케스트레이션, lifecycle hook |
| `agent/context_compressor.py` | 400+ | 3-phase 자동 context compression |
| `agent/auxiliary_client.py` | 400+ | 보조 모델 라우팅 (vision, web, compression) |
| `agent/anthropic_adapter.py` | 250+ | Anthropic Messages API 어댑터, thinking, cache |
| `tools/delegate_tool.py` | 400+ | subagent spawning, depth limit, blocked tools |
| `toolsets.py` | 250+ | 도구 그룹화 + 조합 |
| `hermes_state.py` | 350+ | SQLite + FTS5, WAL mode, write jitter |
| `skills/` | 28 카테고리 | 마크다운 + YAML frontmatter 스킬 정의 |

---

## 참고 자료

- hermes-agent 소스: `_research/_util/hermes-agent/`
- NousResearch GitHub: https://github.com/NousResearch/hermes-agent
- tunaFlow 관련:
  - Doom Loop 감지: 이번 세션에서 논의 (plan_events 기반 카운터)
  - 스킬 시스템: `~/.tunaflow/skills/`, `clawSoulsPersonaSpecIdea.md`
  - SDK 전환: `sdkIntegrationIdea.md`, `sdkAsInterfaceLayerIdea.md`
  - Context compression: `conversation_memory.rs`
  - ContextPack: `send_common.rs`
