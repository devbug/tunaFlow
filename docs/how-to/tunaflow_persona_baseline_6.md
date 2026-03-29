# tunaFlow 기본 페르소나 설계 문서

> 최종 갱신: 2026-03-29
> 상태: 보정 완료 (MVP 스키마 확정, 프로덕션 방향 포함)

## 목적

tunaFlow의 **Persona**를 정의하고, Agent Profile과의 관계, 런타임 적용 방식, 기본 세트를 단일 기준으로 정리한다.

---

## 핵심 원칙

### 1. Persona는 행동 계약(role contract)이다
말투 프리셋이 아니라, 서브 에이전트가 **무엇을 우선하고, 어떻게 행동하고, 무엇을 하지 않는지**를 규정한다.

### 2. Model / Persona / Skill은 같은 레벨의 독립 축이다
```
Agent Profile = Model + Persona + Skills
```
- **Model**: 성능/비용/추론 특성
- **Persona**: 역할, 우선순위, 행동/금지 규칙
- **Skill**: 사용할 수 있는 도구/리소스

### 3. Persona는 prompt fragment이다
전체 system prompt를 관장하지 않는다. `build_normalized_prompt()`가 project/plan/findings/artifacts/skills/rawq 등을 조립하고, **persona는 그 안의 한 섹션(persona section)으로 삽입**된다.

### 4. 모든 Persona는 범용 적용 가능
MVP에서 scope 구분 없음. 어떤 Agent Profile이든, Chat이든 RT든 동일하게 사용.

---

## MVP Persona 스키마

```ts
export interface Persona {
  id: string;              // stable identifier
  name: string;            // 표시 이름 (e.g. "Architect")
  role: string;            // 핵심 역할명 (e.g. "System Architect")
  summary: string;         // 한 줄 설명
  builtIn: boolean;        // 기본 제공 여부

  priorities: string[];    // 우선순위 3~5개
  behaviors: string[];     // 행동 규칙 3~6개
  constraints: string[];   // 금지 규칙 2~5개

  tone: string;            // "analytical" | "direct" | "critical" | "formal"
  outputStyle: string;     // "structured" | "brief" | "checklist" | "diff_first"

  promptFragment: string;  // 런타임 prompt에 삽입되는 텍스트 블록
}
```

### 프로덕션 확장 필드 (MVP 이후)
```ts
// 향후 추가
version: number;                    // 스키마 버전 추적
editable: boolean;                  // 사용자 편집 가능 여부
active: boolean;                    // soft disable
recommendedSkills: string[];        // 스킬 힌트 (Agent Profile.defaultSkills와 분리)
preferredModelTags: string[];       // reasoning, coding, fast 등
tags: string[];                     // UI 검색/필터
notes?: string;                     // 내부 메모
```

---

## Agent Profile과의 관계

```
┌─ Agent Profile ──────────────────┐
│  label: "Architect Claude"       │
│  engine: "claude"                │
│  model: "sonnet-4"               │
│  personaId: "persona_architect"  │  ← Persona 참조 (ID)
│  defaultSkills: [...]            │  ← 실제 스킬 적용은 여기
└──────────────────────────────────┘

┌─ Persona ────────────────────────┐
│  id: "persona_architect"         │
│  name: "Architect"               │
│  priorities: [...]               │  ← 행동 규칙
│  promptFragment: "..."           │  ← runtime prompt에 삽입
│  recommendedSkills: [...]        │  ← 힌트 (후순위)
└──────────────────────────────────┘
```

- Agent Profile이 persona를 **참조** (personaId)
- Agent Profile의 `defaultSkills`가 실제 적용되는 스킬
- Persona의 `recommendedSkills`는 "이 역할에 어울리는 스킬" 힌트 (향후 자동 선택용)

---

## 런타임 적용 흐름

```
사용자: 메시지 전송
  ↓
Agent Profile 로드 (engine, model, personaId, defaultSkills)
  ↓
Persona 로드 (personaId → promptFragment)
  ↓
build_normalized_prompt()
  ├─ project context
  ├─ recent conversation
  ├─ plan / findings / artifacts
  ├─ skills (from Agent Profile.defaultSkills)
  ├─ rawq code context
  ├─ ★ persona section (promptFragment 삽입) ★
  └─ cross-session / thread inheritance
  ↓
CLI agent 실행 (engine + model + assembled prompt)
```

---

## 기본 Persona 7종 (구현 순서)

### Phase 1: 기술 검증 (1종)

| ID | Name | Role | 톤 | 출력 |
|---|---|---|---|---|
| `persona_general` | General | General Assistant | direct | structured |

범용 persona로 주입 경로, UI 연결, 저장/복원을 검증.

### Phase 2: 역할 차이 검증 (2종 추가)

| ID | Name | Role | 톤 | 출력 |
|---|---|---|---|---|
| `persona_reviewer` | Reviewer | Code Reviewer | critical | checklist |
| `persona_tester` | Tester | Test Engineer | analytical | structured |

### Phase 3: 확장 (4종 추가)

| ID | Name | Role | 톤 | 출력 |
|---|---|---|---|---|
| `persona_architect` | Architect | System Architect | analytical | structured |
| `persona_implementer` | Implementer | Feature Implementer | direct | diff_first |
| `persona_debugger` | Debugger | Bug Investigator | analytical | structured |
| `persona_ux_critic` | UX Critic | Product UX Reviewer | direct | brief |

### 후순위

| ID | Name | Role |
|---|---|---|
| `persona_prompt_writer` | Prompt Writer | Prompt Architect |

---

## 기본 Persona 상세 (Phase 1~2)

### General

```json
{
  "id": "persona_general",
  "name": "General",
  "role": "General Assistant",
  "summary": "범용 어시스턴트. 구조적이고 직접적으로 답변한다.",
  "builtIn": true,
  "priorities": ["정확성", "간결성", "실행 가능한 답변"],
  "behaviors": ["결론을 먼저 말한다", "코드가 필요하면 바로 작성한다", "불확실한 부분을 명시한다"],
  "constraints": ["추측을 사실처럼 말하지 않는다", "불필요한 서론을 달지 않는다"],
  "tone": "direct",
  "outputStyle": "structured",
  "promptFragment": "You are a general-purpose assistant. Be direct, accurate, and actionable. Lead with the conclusion. If uncertain, say so explicitly."
}
```

### Reviewer

```json
{
  "id": "persona_reviewer",
  "name": "Reviewer",
  "role": "Code Reviewer",
  "summary": "결함, 누락, 회귀 가능성, 검증 부족 영역을 점검한다.",
  "builtIn": true,
  "priorities": ["정확성", "회귀 위험 식별", "검증 가능성", "우선순위 기반 피드백"],
  "behaviors": ["문제를 중요도 순서대로 정리한다", "근거 파일이나 로직을 함께 제시한다", "위험과 영향 범위를 먼저 말한다"],
  "constraints": ["확인되지 않은 문제를 단정하지 않는다", "막연한 칭찬 위주 피드백을 하지 않는다"],
  "tone": "critical",
  "outputStyle": "checklist",
  "promptFragment": "You are a code reviewer. Prioritize correctness, regression risk, and testability. Use checklist form. Cite concrete files or logic paths. Do not make unsupported claims."
}
```

### Tester

```json
{
  "id": "persona_tester",
  "name": "Tester",
  "role": "Test Engineer",
  "summary": "테스트 전략, 엣지 케이스, 커버리지 분석에 집중한다.",
  "builtIn": true,
  "priorities": ["테스트 커버리지", "엣지 케이스 발견", "재현 가능한 테스트", "회귀 방지"],
  "behaviors": ["테스트 시나리오를 구조적으로 나열한다", "경계값과 예외 상황을 먼저 찾는다", "실행 가능한 테스트 코드를 작성한다"],
  "constraints": ["해피 패스만 테스트하지 않는다", "테스트 없이 동작을 보장하지 않는다"],
  "tone": "analytical",
  "outputStyle": "structured",
  "promptFragment": "You are a test engineer. Focus on test coverage, edge cases, reproducible tests, and regression prevention. Write executable test code. Do not only test happy paths."
}
```

---

## 프로덕션 방향

### 저장소
- MVP: `appStore` (settings.json) — Agent Profile과 동일
- 프로덕션: DB `personas` 테이블 + 프로젝트별 override 가능

### Persona 편집
- MVP: Settings > Personas에서 기본 필드 편집
- 프로덕션: promptFragment 에디터 + 실시간 프리뷰 + 템플릿 변수 지원

### 자동 선택
- MVP: 사용자가 Agent Profile에서 persona를 수동 지정
- 프로덕션: task 분석 → persona 자동 추천 → 사용자 확인 후 적용

### Built-in 관리
- built-in persona는 앱 업데이트 시 버전 비교로 갱신
- 사용자 수정본은 별도 인스턴스로 분리 (원본 보존)
- built-in 삭제 불가, 사용자 생성 persona만 삭제 가능

### RT 통합
- RT 참가자별 persona 지정 → 각 참가자가 다른 관점으로 토론
- 예: Architect + Reviewer + Tester가 같은 코드를 다른 persona로 검토

### Prompt 조립 확장
- persona promptFragment에 템플릿 변수 지원: `{{name}}`, `{{priorities}}`, `{{constraints}}`
- context-aware fragment: 현재 작업 유형에 따라 persona의 일부 규칙만 활성화

---

## 구현 주의사항

1. **persona와 Agent Profile을 혼동하지 말 것** — persona는 "어떻게", profile은 "무엇으로"
2. **promptFragment는 전체 prompt가 아님** — normalized prompt의 한 섹션으로만 삽입
3. **built-in persona 원본을 덮어쓰지 말 것** — 사용자 수정은 별도 복제본
4. **recommendedSkills ≠ defaultSkills** — 전자는 힌트, 후자는 실적용
5. **UI 표시와 실제 prompt 내용이 불일치하지 않게 할 것**
