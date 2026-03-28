# tunaFlow 공용 스킬 runtime snapshot 운영 계획

- 작성자: OpenAI Codex
- 작성 시각: 2026-03-28
- 상태: Phase 1 완료 (publish script + snapshot 발행 + manifest + _meta.json)

## 목적

현재 공용 스킬 원본은 `privateProject/_research/_skills` 아래에 흩어져 있다.
개발 중인 tunaFlow와 Claude Code가 이를 안정적으로 사용하려면,
원본 저장소를 직접 링크/동기화하기보다 **runtime snapshot 복사본**을 만들어 사용하는 쪽이 맞다.

이번 계획의 목표는 아래 두 가지다.

1. `_research/_skills`를 source of truth로 유지
2. tunaFlow가 실제로 읽는 `~/.tunaflow/skills`를 **runtime snapshot**으로 운영

## 왜 snapshot 복사가 맞는가

링크/직접 참조 방식의 문제:

- 원본 변경이 즉시 런타임에 반영되어 안정성이 떨어진다
- 개발 환경과 배포 환경의 구조가 달라진다
- Claude가 어떤 시점의 스킬을 보고 있는지 명확하지 않다

snapshot 복사의 장점:

- 런타임은 항상 자기 복사본을 가진다
- 원본 저장소와 배포/실행 구조를 분리할 수 있다
- 나중에 앱 번들 포함 또는 명시적 업데이트 흐름으로 확장하기 쉽다
- "현재 적용된 스킬 집합"을 명확히 설명할 수 있다

## 전제

현재 tunaFlow의 스킬 로딩 경로는 다음으로 고정돼 있다.

- `~/.tunaflow/skills/*/SKILL.md`

즉 지금 단계에서는 loader를 다중 루트로 바꾸기보다,
원본 스킬을 runtime snapshot으로 복사하는 방식이 가장 현실적이다.

## source of truth

공용 원본 스킬 저장소:

- `/Users/d9ng/privateProject/_research/_skills`

여기에는 vendor별 스킬 묶음이 존재한다.

예:

- `skills-anthropic`
- `skills-microsoft`
- `skills-openai`
- `skills-remotion`
- `skills-supabase`
- `skills-vercel`

이번 계획에서는 **특정 vendor만 선별하지 않고, 모든 vendor를 고려한 snapshot 복사**를 기본 방향으로 둔다.

## runtime target

런타임 스킬 복사본 경로:

- `~/.tunaflow/skills`

이 경로는 tunaFlow가 실제로 스캔하는 경로이며,
Claude에게도 "현재 적용 가능한 스킬 집합"을 설명할 때 기준이 된다.

## 복사 정책

### 원칙

1. 원본은 `_research/_skills`
2. 런타임은 `~/.tunaflow/skills`
3. 복사는 명시적 snapshot publish 동작으로 수행
4. 수동 개별 복사 대신 스크립트 1개로 수행
5. 런타임 디렉토리는 "현재 배포된 스냅샷"으로 취급

### 모든 vendor를 고려하는 이유

- 현재는 어떤 vendor 스킬이 필요할지 미리 고정하기 어렵다
- Claude/Codex/OpenAI/기타 도구 프롬프트 설계 시 참조 범위가 넓다
- 나중에 vendor별 필터링은 추가 가능하지만, 처음부터 제외하면 운영 기준이 흔들린다

즉 1차는:

- `_research/_skills` 아래 vendor들을 모두 스캔
- 각 vendor 내부에서 실제 스킬로 쓸 수 있는 항목만 추출
- `~/.tunaflow/skills`에 정규화된 snapshot으로 배치

가 맞다.

## 권장 런타임 구조

`~/.tunaflow/skills` 아래는 tunaFlow가 읽기 쉬운 단일 포맷으로 정리한다.

권장 형태:

```text
~/.tunaflow/skills/
  anthropic-template/
    SKILL.md
    _meta.json
  microsoft-docs-site/
    SKILL.md
    _meta.json
  microsoft-tests/
    AGENTS.md
    README.md
    _meta.json
  openai-...
    ...
```

중요:

- tunaFlow가 지금 바로 읽는 것은 `SKILL.md`다
- `AGENTS.md`, `README.md`, `metadata.json` 같은 부가 파일은 참고 자산으로 복사 가능
- 최소 요구조건은 `SKILL.md`가 존재하는 런타임 폴더들이다

## publish 규칙

### Phase 1

목표:

- `_research/_skills` 전체 vendor를 스캔
- `SKILL.md`가 있는 항목을 `~/.tunaflow/skills`로 복사
- 필요하면 관련 `README.md`, `AGENTS.md`, `metadata.json`도 같이 복사
- 각 복사본에 source vendor/path 정보를 `_meta.json`으로 기록

완료 기준:

- tunaFlow의 `list_skills()`가 복사본을 읽을 수 있다
- Claude는 runtime snapshot을 기준으로 스킬을 사용할 수 있다

### Phase 2

목표:

- snapshot manifest 추가
- 마지막 publish 시각과 source inventory 기록
- overwrite 정책 명확화

완료 기준:

- 현재 런타임 snapshot이 어떤 원본에서 왔는지 추적 가능하다

### Phase 3

목표:

- 앱 번들 포함 또는 update flow로 확장

예:

- 앱 설치 시 기본 skills snapshot 포함
- "update skills" 명령으로 새 snapshot publish

## 비목표

- 지금 당장 다중 루트 skill loader 구현
- vendor별 선택적 enable/disable UI
- remote registry 도입
- skill auto-update daemon

## Claude Code 운영 규칙

Claude에게는 항상 아래 전제를 준다.

1. `_research/_skills`는 원본 저장소다
2. `~/.tunaflow/skills`는 현재 런타임 snapshot이다
3. tunaFlow 동작 검증은 runtime snapshot 기준으로 한다
4. 스킬 변경 필요 시 원본과 snapshot publish 둘 다 고려한다

## 권장 다음 작업

1. snapshot publish 스크립트 추가
2. 운영 문서 추가
3. Claude용 실행 프롬프트 추가
4. 필요 시 이후에 skill source metadata 가시화 검토

## 최종 판단

현재 단계에서는 **모든 vendor를 고려한 snapshot 복사**가 가장 현실적이다.

즉 방향은:

- 링크하지 않는다
- 원본을 직접 읽게 하지 않는다
- `_research/_skills`를 source of truth로 둔다
- `~/.tunaflow/skills`를 runtime snapshot으로 발행한다

가 맞다.
