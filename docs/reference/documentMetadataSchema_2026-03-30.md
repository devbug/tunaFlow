# tunaFlow 문서 메타 스키마 초안

- 작성자: OpenAI Codex
- 작성 시각: 2026-03-30
- 목적: 에이전트와 사람이 문서를 읽기 전에 판단할 수 있도록 공통 메타 기준을 정의

## 핵심 판단

문서 수가 많아질수록 본문보다 먼저 필요한 것은
`이 문서가 무엇인지`, `지금도 유효한지`, `무엇과 연결되는지`를 빠르게 판단하게 해 주는 메타다.

따라서 문서 상단에 최소한의 공통 메타를 붙이는 방향이 맞다.

## 권장 형식

문서 상단 YAML frontmatter:

```md
---
title: Agent Profile Chat Input Binding Plan
type: plan
status: partial
updated_at: 2026-03-30
owner: codex
summary: Agent Profile을 chat input과 실행 경로에 연결하는 계획
canonical: true
tags: [agents, profiles, input]
related:
  - docs/plans/agentProfilesSettingsMvpPlan_2026-03-29.md
  - docs/prompts/2026-03-29/agent_profile_chat_input_binding_prompt.md
read_before:
  - CLAUDE.md
  - docs/reference/implementationStatus.md
---
```

## 공통 메타

### 필수

| 필드 | 의미 | 예시 |
|---|---|---|
| `title` | 문서 표시 제목 | `Knowledge Sources Settings Shell Plan` |
| `type` | 문서 종류 | `reference`, `plan`, `prompt`, `how-to`, `archive` |
| `status` | 현재 상태 | `draft`, `in_progress`, `partial`, `done`, `archived` |
| `updated_at` | 마지막 갱신일 | `2026-03-30` |
| `owner` | 주요 작성/관리 주체 | `codex`, `claude`, `human`, `shared` |
| `summary` | 한두 줄 요약 | 짧은 설명 |
| `canonical` | 현재 기준 문서인지 | `true`, `false` |

### 강하게 권장

| 필드 | 의미 | 예시 |
|---|---|---|
| `created_at` | 최초 작성일 | `2026-03-29` |
| `last_verified_at` | 코드/구조 기준 마지막 검증일 | `2026-03-30` |
| `tags` | 기능 축 분류 | `[skills, settings, ia]` |
| `related` | 관련 문서 경로 | plan/prompt/reference 연결 |
| `read_before` | 먼저 읽어야 할 문서 | SSOT/reference |
| `read_when` | 언제 읽어야 하는지 | `새 세션 시작 전`, `UI 작업 전` |

### 관계 메타

| 필드 | 의미 | 예시 |
|---|---|---|
| `paired_plan` | 연결된 계획 문서 | prompt에서 사용 |
| `paired_prompt` | 연결된 실행 프롬프트 | plan에서 사용 |
| `supersedes` | 대체한 문서 | 이전 문서 경로 |
| `superseded_by` | 대체한 새 문서 | 최신 문서 경로 |
| `depends_on` | 선행 문서/작업 | 상위 plan |

## 문서 타입별 권장 메타

### `reference`

추가 권장:

- `ssot_level`: `primary`, `secondary`, `advisory`
- `source_of_truth_for`: 이 문서가 사실 기준인 영역

예:

- data model
- implementation status
- navigation model

### `plan`

추가 권장:

- `goal`
- `non_goals`
- `completion_criteria`
- `priority`

### `prompt`

추가 권장:

- `target_agent`
- `paired_plan`
- `expected_output`

### `how-to`

추가 권장:

- `prerequisites`
- `steps_for`

### `archive`

추가 권장:

- `superseded_by`
- `archive_reason`

## 최소 적용 세트

처음부터 모든 문서에 모든 메타를 넣을 필요는 없다.

1차 최소 적용 추천:

- `title`
- `type`
- `status`
- `updated_at`
- `summary`
- `canonical`
- `related`

이 정도만 있어도 에이전트 탐색성이 크게 좋아진다.

## 상태 값 정의

| 값 | 의미 |
|---|---|
| `draft` | 초안, 기준 미확정 |
| `in_progress` | 현재 작업 중 |
| `partial` | 일부 구현/적용 완료 |
| `done` | 현재 기준으로 완료 |
| `archived` | 더 이상 현재 기준 아님 |

## owner 값 정의

| 값 | 의미 |
|---|---|
| `codex` | Codex가 주도 작성 |
| `claude` | Claude가 주도 작성 |
| `human` | 사용자가 주도 작성 |
| `shared` | 공동 관리 문서 |

## canonical 규칙

- `true`: 현재 기준으로 에이전트가 우선 참고해야 하는 문서
- `false`: 참고용, 기록용, 보조용

중요:

- 완료된 문서라도 `canonical: false`일 수 있다
- 아카이브 문서는 원칙적으로 `canonical: false`

## 관계 메타 우선순위

에이전트 탐색성에 가장 도움이 큰 관계 메타는 아래 순서다.

1. `related`
2. `read_before`
3. `paired_plan` / `paired_prompt`
4. `superseded_by`

## 적용 원칙

1. 한 문서에 한 목적
2. 메타는 짧고 기계적으로 읽기 쉬워야 함
3. 경로는 저장소 루트 기준 상대경로 사용
4. index 문서가 메타를 활용해 읽기 순서를 안내해야 함

## 최종 판단

문서 메타의 핵심은 “예쁘게 정리”가 아니라
에이전트가 문서를 **읽기 전에 판단**하게 만드는 것이다.

따라서 날짜만이 아니라
`현재성`, `문서 종류`, `관련 문서`, `읽는 순서` 메타가 중요하다.

