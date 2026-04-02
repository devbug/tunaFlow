# ClawSouls Soul Spec — 페르소나 패키징 + 스킬 연동 참고

> Status: idea
> Created: 2026-04-03
> 출처: https://github.com/clawsouls/clawsouls (문서 전용 레포, 코드 없음)
> 관련: 스킬 시스템 고도화, Persona 시스템, SDK 전환 후 tool 제한

---

## 1. ClawSouls란

**AI 에이전트 페르소나 공유 플랫폼**. 마크다운 파일 묶음(Soul)으로 에이전트의 성격/행동/스타일을 정의하고 공유하는 오픈 스펙. 80+ 큐레이션된 Soul. Apache 2.0.

핵심 철학: Anthropic Skills가 에이전트가 **무엇을 할 수 있는지** 정의한다면, Souls는 에이전트가 **그것을 할 때 누구인지** 정의한다.

---

## 2. Soul 패키지 구조

```
my-soul/
├── soul.json       # 메타데이터 (이름, 버전, 호환성, 도구, 스킬)
├── SOUL.md         # 핵심 성격 — 시스템 프롬프트에 주입
├── IDENTITY.md     # 이름, 이모지, 분위기
├── AGENTS.md       # 행동 가이드라인 (상세 규칙)
├── STYLE.md        # 글쓰기 톤/스타일
├── HEARTBEAT.md    # 주기적 체크 항목 (heartbeat 시 확인)
└── examples/       # 좋은/나쁜 출력 예시 (calibration)
```

### soul.json 핵심 필드 (v0.5)

```json
{
  "specVersion": "0.5",
  "name": "surgical-coder",
  "displayName": "Surgical Coder",
  "version": "1.0.0",
  "description": "Disciplined, minimal, goal-driven coder.",
  "tags": ["coding", "minimal"],
  "category": "work/engineering",

  "compatibility": {
    "frameworks": ["openclaw", "cursor", "zeroclaw"],
    "models": ["anthropic/*", "openai/*"],
    "minTokenContext": 8000
  },

  "allowedTools": ["browser", "exec", "web_search"],

  "recommendedSkills": [
    { "name": "github", "version": ">=1.0.0", "required": false },
    { "name": "healthcheck", "required": true }
  ],

  "disclosure": {
    "summary": "Disciplined, minimal coder. Precise and goal-driven."
  },

  "deprecated": false,
  "supersededBy": null
}
```

---

## 3. tunaFlow 현재 구조와의 대응

| ClawSouls | tunaFlow 현재 | 상태 |
|-----------|--------------|------|
| **SOUL.md** (핵심 성격) | Persona `promptFragment` | 있음. 7종 built-in persona |
| **IDENTITY.md** (이름/분위기) | Agent Profile `label` + engine | 있음. 이름만 |
| **AGENTS.md** (행동 규칙) | 없음 (persona에 통합) | 분리 안 됨 |
| **STYLE.md** (글쓰기 톤) | 없음 (persona에 통합) | 분리 안 됨 |
| **HEARTBEAT.md** (주기 체크) | 없음 | 해당 없음 |
| **examples/** (calibration) | 없음 | 미구현 |
| **soul.json** (메타데이터) | Agent Profile JSON (appStore) | 유사 |
| **allowedTools** | 없음 | SDK 전환 후 적용 가능 |
| **recommendedSkills** | `activeSkills` (수동 선택) | 자동 연결 미구현 |
| **compatibility.frameworks** | engine 선택 (claude/gemini/codex/opencode) | 유사 |
| **compatibility.minTokenContext** | 없음 (ContextPack 예산은 있음) | 참고 가능 |
| **disclosure.summary** | 없음 | Progressive Disclosure에 활용 가능 |
| **deprecated / supersededBy** | 없음 | Soul 라이프사이클 관리 |

---

## 4. 채택할 가치가 있는 패턴

### 4.1 Progressive Disclosure (3-level) — **높음**

```
Level 1 — Quick Scan:   soul.json의 disclosure.summary만 (200자)
Level 2 — Full Read:    SOUL.md + IDENTITY.md
Level 3 — Deep Dive:    AGENTS.md + STYLE.md + HEARTBEAT.md + examples/
```

**tunaFlow 적용**: Persona/Skill을 ContextPack에 주입할 때 모드에 따라 레벨 분리

| ContextPack 모드 | Persona 주입 레벨 | Skill 주입 레벨 |
|-----------------|-----------------|---------------|
| Lite | summary 한 줄 | 없음 |
| Standard | promptFragment 전체 | 키워드 매칭 섹션만 (현재) |
| Full | promptFragment + 행동 규칙 + 스타일 | 전체 섹션 |

현재 tunaFlow는 모든 모드에서 persona `promptFragment` 전체를 주입하거나 안 하거나. 중간 단계가 없다.

### 4.2 recommendedSkills (Persona → Skill 자동 연결) — **높음**

현재: 사용자가 Settings에서 skill을 수동 선택 (`activeSkills`)
ClawSouls: Soul이 자신에게 필요한 skill을 선언

```json
"recommendedSkills": [
  { "name": "github", "version": ">=1.0.0", "required": false },
  { "name": "healthcheck", "required": true }
]
```

**tunaFlow 적용**: Persona에 `recommendedSkills` 필드 추가

```typescript
interface Persona {
  id: string;
  label: string;
  promptFragment: string;
  // 새로 추가
  recommendedSkills?: {
    name: string;       // skill ID (vendor/name)
    required?: boolean; // true면 경고 표시
  }[];
}
```

사용자가 Persona를 선택하면 `recommendedSkills`가 자동으로 `activeSkills`에 추가됨. 사용자가 필요 없으면 제거 가능.

### 4.3 allowedTools (Persona별 tool 제한) — **SDK 전환 후**

현재: 모든 에이전트가 동일한 tool set
ClawSouls: Soul이 사용할 도구를 선언

**tunaFlow 적용**: SDK 전환 후 function calling이 가능해지면, 워크플로우 역할에 따라 tool 제한

```typescript
// Developer persona
allowedTools: ["read_file", "search_codebase", "mark_subtask_done", "save_artifact"]

// Reviewer persona  
allowedTools: ["read_file", "search_codebase", "submit_review_verdict"]
// write 계열 도구 없음 → 코드 수정 불가
```

Claude Code의 Skill → allowedTools 패턴과 동일. `sdkIntegrationIdea.md` §5.2 참조.

### 4.4 Persona 파일 분리 (SOUL/IDENTITY/AGENTS/STYLE) — **중간**

현재 tunaFlow Persona는 `promptFragment` 하나에 모든 것을 담는다:
- 성격
- 행동 규칙
- 글쓰기 스타일
- 우선순위

ClawSouls는 이를 4개 파일로 분리. 장점:
- 성격(SOUL)은 바꾸지 않고 행동 규칙(AGENTS)만 프로젝트별로 교체 가능
- 스타일(STYLE)만 한국어/영어 버전으로 분리 가능
- Progressive Disclosure 적용 가능 (Level 2에서 SOUL만, Level 3에서 AGENTS+STYLE 추가)

**tunaFlow 적용 판단**: 현재 7개 built-in persona에서는 과도. **사용자 커스텀 persona가 10+개가 되면** 분리가 의미 있음. 지금은 구조만 참고.

### 4.5 Calibration Examples (good/bad outputs) — **장기**

Soul이 좋은 출력과 나쁜 출력 예시를 포함:

```
examples/
├── good-outputs.md    # "이렇게 응답해야 한다"
└── bad-outputs.md     # "이렇게 응답하면 안 된다"
```

**tunaFlow 적용**: Few-shot 예시를 ContextPack에 주입하면 에이전트 출력 품질 개선 가능. 특히 워크플로우에서 Developer/Reviewer의 출력 형식을 calibration할 때 유용.

다만 토큰 비용이 증가하므로 Full 모드에서만, 그리고 첫 요청에서만 주입하는 전략 필요.

### 4.6 Dual Declaration (soul.json + SOUL.md) — **참고**

```
soul.json: 기계 판독용 (정적 분석, 레지스트리, 프로그래밍 검증)
SOUL.md:   LLM 판독용 (실제 시스템 프롬프트에 주입)
```

**tunaFlow에서 이미 비슷한 패턴**:
- `plan_events` (DB, 기계 판독) + 마커 (`<!-- tunaflow:review-verdict -->`, LLM 판독)
- Agent Profile (JSON, 기계 판독) + Persona promptFragment (텍스트, LLM 판독)

의식적으로 유지할 패턴. 한쪽에만 선언하면 다른 쪽에서 불일치 발생 (ClawSouls의 SEC102 규칙과 동일한 문제).

---

## 5. 채택하지 않을 것

| 개념 | 이유 |
|------|------|
| **Embodied Agent** (로봇/IoT) | tunaFlow는 텍스트 기반 코딩 에이전트. 물리 환경 무관 |
| **safety.laws** (Asimov 계층) | PLATFORM_TIER0이 이미 이 역할. 별도 계층화 불필요 |
| **SoulScan** (정적 분석) | 레지스트리 운영이 아니므로 불필요 |
| **Multi-platform auto-detect** | tunaFlow는 단일 앱. 플랫폼 감지 불필요 |
| **Soul lifecycle (deprecated/supersededBy)** | Persona 수가 적어 라이프사이클 관리 불필요 |
| **HEARTBEAT.md** | tunaFlow에 heartbeat 개념 없음 |

---

## 6. 스킬 시스템 고도화 시 적용 로드맵

### Phase 1: recommendedSkills 연결

```
Persona 선택 → recommendedSkills 자동 활성화
  └── 사용자가 수동 해제 가능
  └── required=true인 skill 없으면 경고 표시
```

변경: Persona 타입에 `recommendedSkills` 필드 추가, ProfileSelector에서 자동 활성화 로직.

### Phase 2: Progressive Disclosure 적용

```
Lite mode:   persona summary 1줄 (새로 추가)
Standard:    promptFragment 전체 (현재와 동일)
Full:        promptFragment + 행동 규칙 + calibration examples
```

변경: Persona 타입에 `summary`, `agentRules`, `examples` 필드 추가. ContextPack 조립에서 모드별 분기.

### Phase 3: allowedTools (SDK 전환 후)

```
Persona별 tool 허용목록 → SDK function calling에서 강제
  └── Developer: read + write + search + mark_done
  └── Reviewer: read + search + submit_verdict (write 없음)
  └── Architect: read + search + submit_proposal
```

변경: Persona 타입에 `allowedTools` 필드 추가. SDK 엔진에서 tool 필터링.

### Phase 4: Persona 파일 분리 (커스텀 persona 10+개 시)

```
~/.tunaflow/personas/
  └── my-persona/
      ├── persona.json      # 메타데이터 + recommendedSkills + allowedTools
      ├── PERSONA.md         # 핵심 성격 (promptFragment)
      ├── RULES.md           # 행동 규칙
      ├── STYLE.md           # 글쓰기 톤
      └── examples/          # calibration
```

변경: 파일 기반 persona 로딩. built-in은 코드 내장 유지.

---

## 7. Soul Spec 버전 히스토리 (참고)

| 버전 | 날짜 | 핵심 변경 |
|------|------|----------|
| v0.1 | 2026-02-12 | 초기 프로토타입 (내부) |
| v0.2 | 2026-02-13 | STYLE.md, examples, modes, interpolation (내부) |
| v0.3 | 2026-02-16 | specVersion 필드, soul.json 리네임, 라이선스 허용목록 |
| v0.4 | 2026-02-20 | frameworks, allowedTools, recommendedSkills, progressive disclosure, lifecycle |
| v0.5 | 2026-02-24 | Embodied Agent (로봇/IoT), safety.laws, sensor/actuator 스키마 |
| v0.5.1 | 2026-02-28 | safety.laws 계층 (Asimov 영감), SoulScan SEC100-102 |
| v0.5.2 | 2026-03-02 | Dual Declaration 요구사항 (soul.json + SOUL.md 양쪽 선언) |

### 설계 결정 기록 (v0.4)

흥미로운 점 — ClawSouls는 v0.2에서 도입한 `modes`와 `interpolation` 필드를 v0.4에서 deprecated:
- 8일간 프로덕션 사용 + 80+ 게시된 Soul에서 **어떤 런타임도 이 필드를 소비하지 않음**
- **어떤 크리에이터도 의미 있게 사용하지 않음**
- 결론: "사용되지 않는 필드는 인지 부하만 추가" → 제거

tunaFlow에도 적용할 원칙: **실제로 소비되지 않는 메타데이터는 추가하지 않는다.**

---

## 참고 자료

- ClawSouls 레포: https://github.com/clawsouls/clawsouls
- Soul Spec v0.5: `/tmp/clawsouls/docs/soul-spec-v0.5.md`
- Soul Spec 설계 결정: `/tmp/clawsouls/docs/soul-spec.md` (Design Decisions 섹션)
- tunaFlow Persona: `src/components/tunaflow/settings/PersonasSection.tsx`
- tunaFlow Skills: `src/components/tunaflow/settings/` + `~/.tunaflow/skills/`
- tunaFlow ContextPack: `src-tauri/src/commands/agents_helpers/send_common.rs`
- SDK 전환 아이디어: `docs/ideas/sdkIntegrationIdea.md`
- Claude Code Skill 패턴: `docs/ideas/sdkIntegrationIdea.md` §2.7
