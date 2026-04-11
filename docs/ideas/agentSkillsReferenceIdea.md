# agent-skills 레포 검토 — tunaFlow 참고 가능성 평가

> Status: idea
> Created: 2026-04-11
> 출처: `https://github.com/addyosmani/agent-skills`
> 대상: `addyosmani/agent-skills`
> 분석 기준 시점: 2026-04-11 clone 기준
> 로컬 분석 경로: `/tmp/agent-skills`

---

## 1. 한 줄 결론

`agent-skills`는 tunaFlow의 **전체 아키텍처 레퍼런스**로는 맞지 않다.

하지만 아래 3가지는 참고 가치가 높다.

- lifecycle 기반 skill 체계화
- skill / agent / reference / hook 분리
- “행동 규약을 문서로 강제”하는 운영 패턴

즉, tunaFlow에 그대로 이식할 대상은 아니고, **skill system / agent operating policy / workflow docs 구조**를 정리할 때 참고할 가치가 있다.

---

## 2. 코드/문서에서 확인한 사실

### 2.1 이 레포는 “코드 프레임워크”보다 “운영 규약 패키지”에 가깝다

핵심 파일:

- `README.md`
- `AGENTS.md`
- `CLAUDE.md`
- `agents/`
- `references/`
- `hooks/`

구조상 중심은 런타임 코드가 아니라:

- `skills/<name>/SKILL.md`
- `agents/*.md`
- `references/*.md`
- `hooks/*.sh`

즉 이 프로젝트는 **skill 문서 + 실행 규약 + 세션 훅**으로 에이전트 행동을 통제하는 쪽이다.

### 2.2 skill은 라이프사이클에 맞춰 조직되어 있다

README 기준으로 20개 skill이 다음 단계에 매핑된다.

- Define
- Plan
- Build
- Verify
- Review
- Ship

이건 tunaFlow의 현재 workflow 단계와 상성이 있다.

예:

- Architect 단계
- Plan 단계
- Developer 구현 단계
- Review / Test 단계
- Ship/Release 단계

### 2.3 AGENTS.md는 “intent → skill” 자동 매핑 규칙을 강하게 요구한다

핵심 규칙:

- task가 skill과 맞으면 반드시 skill 먼저 사용
- 작아 보여도 skill 생략 금지
- build 전에 spec/plan을 먼저 만들도록 강제

이건 tunaFlow가 지향하는 `plan-first`, `workflow-first`, `human-led orchestration`과 방향이 비슷하다.

### 2.4 references/와 hooks/를 별도 계층으로 둔 점이 좋다

이 레포는 skill 본문에 모든 내용을 집어넣지 않고:

- quick reference checklist
- session-start hook
- ignore/simplify helper

를 분리한다.

이건 tunaFlow에도 적용 가능하다.

---

## 3. tunaFlow에 참고할 수 있는 것

### 3.1 Skill anatomy 표준화

이 레포의 장점은 skill마다 최소 구조가 거의 고정된다는 점이다.

- Overview
- When to Use
- Process
- Common Rationalizations
- Red Flags
- Verification

### tunaFlow 적용 가치

높음.

현재 tunaFlow에도:

- persona
- workflow prompt
- codex/claude handoff
- docs/agents/*
- docs/how-to/*

가 있지만 형식이 조금씩 다르다.

`agent-skills`처럼 최소 공통 구조를 잡아두면:

- persona 문서
- workflow stage 문서
- review/test 규칙

을 더 일관되게 유지할 수 있다.

### 3.2 Agent persona와 skill의 분리

이 레포는 `agents/`와 `skills/`를 분리한다.

- agent = 관점/역할
- skill = 수행 절차

### tunaFlow 적용 가치

매우 높음.

현재 tunaFlow도:

- persona
- profile
- workflow stage
- RT role

이 이미 분리되기 시작했는데, 문서 체계는 아직 섞여 있다.

이 레포처럼 다음을 더 분리하는 게 맞다.

- `agent persona`
- `execution skill`
- `reference checklist`

즉:

- Reviewer persona
- review skill
- review checklist

를 한 파일에 넣지 않는 구조가 맞다.

### 3.3 Hook 사고방식

`hooks/session-start.sh` 같은 구조는 “세션 시작 시 자동으로 해야 하는 것”을 분리한다.

### tunaFlow 적용 가치

중간 이상.

tunaFlow는 이미:

- startup scaffold
- rawq index
- context assembly
- runtime background tasks

를 갖고 있다.

여기서 참고할 만한 건 “hook를 코드로 그대로 이식”하는 게 아니라:

- project open 시
- workflow stage 전환 시
- review 시작 시

자동 실행되는 규칙을 **명시적인 lifecycle hook 문서/구조**로 빼는 방식이다.

### 3.4 Anti-rationalization 규칙

이 레포는 skill마다 “왜 생략하면 안 되는가”를 문서 안에 넣는다.

### tunaFlow 적용 가치

중간.

특히:

- 승인 전 구현 금지
- 테스트 없이 완료 선언 금지
- 리뷰 없이 pass 주장 금지

같은 tunaFlow 운영 원칙을 더 구조화하는 데 도움 된다.

---

## 4. 그대로 가져오면 안 되는 것

### 4.1 Slash command 중심 구조

`/spec`, `/plan`, `/build`, `/review` 같은 구조는 agent-skills 쪽에선 자연스럽지만, tunaFlow는 CLI가 아니라 AOC UI다.

따라서:

- 개념은 참고 가능
- 사용자 인터페이스로 그대로 차용은 부적합

이다.

### 4.2 “Skill first or fail” 강제 규칙의 과도한 적용

이 레포는 OpenCode/Claude Code 같은 환경에선 “skill이 맞으면 무조건 skill”을 강하게 요구한다.

tunaFlow는 더 혼합적이다.

- 사람 주도
- workflow stage
- RT
- branch
- artifact

가 함께 돌아가므로, 모든 행동을 skill gate 하나로 통제하면 오히려 무거워질 수 있다.

### 4.3 문서 중심 패키지를 제품 코어로 오해하면 안 된다

이 레포는 운영 규약 패키지다.

tunaFlow의 핵심은:

- conversation
- branch
- roundtable
- plan
- artifact
- memory

라는 런타임 구조다.

즉 이 레포는 tunaFlow의 코어 아키텍처를 대체하지 못한다.

---

## 5. tunaFlow 기준 최종 판단

### 적합한 사용처

- `docs/agents/` 재정리
- workflow prompt / persona / checklist 분리
- skill anatomy 표준화
- agent 운영 규칙 문서화

### 부적합한 사용처

- AOC 전체 아키텍처 레퍼런스
- UI 구조
- memory / retrieval / branch / RT 코어 설계

---

## 6. 권장 후속

1. tunaFlow의 `persona / skill / checklist / hook` 문서 체계를 분리할지 검토
2. `docs/agents/*.md`와 `docs/how-to/*.md`에 공통 anatomy를 도입할지 검토
3. 실제 런타임 skill system까지 확장할지, 문서 규약 수준에서 멈출지 결정

---

## 결론

`agent-skills`는 잘 만든 **agent operating manual**에 가깝다.

tunaFlow에 가장 유용한 부분은:

- 역할과 절차의 분리
- 검증 요구의 명시성
- lifecycle 기반 skill 조직

이다.

반면:

- branch
- roundtable
- memory
- artifact
- context orchestration

같은 tunaFlow 코어 설계 레퍼런스로 쓰기엔 맞지 않는다.

---

## 7. 구현 방향: 2-Layer Skill System (세션 20 검토 결과)

### 현재 스킬 시스템과의 관계

tunaFlow는 이미 4-layer 스킬 구조(A/B/C/D)를 갖고 있다:
- A: 프로젝트 자동 감지
- B: 프로젝트별 영속
- C: **프롬프트 동적 활성화** ← 여기에 procedural skill 태움
- D: Persona recommendedSkills

### 2-Layer 분리

| 레이어 | 용도 | 저장 위치 | ContextPack 주입 조건 |
|--------|------|-----------|----------------------|
| **Reference skill** | 라이브러리/프레임워크 사용법 문서 | `~/.tunaflow/skills/` (vendor snapshot) | 키워드 매칭 (기존 C레이어) |
| **Procedural skill** | 행동 절차 + 검증 기준 + anti-rationalization | `docs/skills/` 또는 DB | workflow phase 전환 시 자동 (C레이어 확장) |

### Procedural Skill Anatomy (agent-skills 참고)

```markdown
# {skill-name}

## When to Use
- 어떤 workflow phase에서 활성화되는가

## Process
1. 구체적 절차 (번호 목록)

## Red Flags
- 이 스킬을 생략하면 안 되는 이유 (anti-rationalization)

## Verification
- 이 스킬이 적용됐는지 확인하는 체크리스트
```

### 현재 코드에서 산발적으로 존재하는 procedural 내용

| 현재 위치 | 내용 | 분리 대상 skill |
|-----------|------|----------------|
| `docs/agents/architect.md` PLATFORM_TIER0 | subtask 검증 명령 필수, 파일 경로 검증 | `plan-verification` |
| `docs/agents/developer.md` PLATFORM_TIER0 | Changed files 외 수정 금지, silent error 금지 | `implementation-discipline` |
| `docs/agents/reviewer.md` PLATFORM_TIER0 | 코드 읽기만, 빌드/테스트 실행 금지 | `review-protocol` |
| CLAUDE.md §15 작업 안전 규칙 | 실행 경로 검증 우선, 단일 경로 수정 원칙 | `change-safety` |
| CLAUDE.md §16 코딩 컨벤션 | Zustand selector, Tauri command 패턴 | `coding-conventions` (reference에 가까움) |

### 구현 순서

1. `docs/skills/` 디렉토리 생성 + anatomy 템플릿
2. 기존 PLATFORM_TIER0에서 procedural 내용 추출 → skill 파일 분리
3. `effectiveSkills` 계산 시 phase→procedural skill 매핑 추가 (기존 C레이어 확장)
4. ContextPack에 procedural skill 섹션 주입 (reference skill과 별도 섹션)

### 선행 조건

- 문서 RAG 인덱싱 정상 동작 확인 (세션 20에서 진행 중)
- 기존 workflow phase→skill 매핑 구조 (`appStore` effectiveSkills) 검증
