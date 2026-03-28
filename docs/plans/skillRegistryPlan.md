# Skill Registry Plan

작성자: OpenAI Codex  
작성일: 2026-03-27

## 목적

`tunaFlow`의 skill 기능을 단순 "SKILL.md 스캔"에서 멈추지 않고,  
**프로젝트 로컬 + 전역 skill registry + 컬렉션 + 프롬프트 적용 계층**으로 확장 가능한 구조로 정리한다.

이 문서는 `D:\privateProject\_research\_util\chops` 레포를 참고해,
`tunaFlow`에 실제로 가져올 만한 점과 가져오지 않을 점을 구분하기 위한 계획 메모다.

## 현재 상태

현재 `tunaFlow`는 아래까지만 구현되어 있다.

- `~/.tunaflow/skills/` 스캔
- project local skill 스캔
- backend `list_capabilities`에서 skills + MCP tool 목록 노출
- agent prompt 조립 시 active skill 내용을 system prompt prefix로 주입

즉 지금은 **skill loading / prompt injection** 중심이고,
아래는 아직 없다.

- skill 전용 UI 브라우저
- 컬렉션/그룹
- tool별 포맷 차이 흡수
- live reload / file watch
- skill 설치/복제/템플릿 생성

## chops에서 참고할 점

`chops`는 "스킬 관리 앱"이고 `tunaFlow`는 "스킬을 쓰는 오케스트레이션 앱"이므로 그대로 복제하진 않는다.
다만 아래 구조는 참고 가치가 높다.

### 1. 파일 기반 registry

`chops`는 skill을 DB 원본으로 보지 않고,
**실제 파일 시스템의 skill 파일을 source of truth**로 본다.

이 방향은 `tunaFlow`에도 맞다.

권장 원칙:

- skill 원본은 파일
- DB는 캐시/인덱스/즐겨찾기/컬렉션 메타만 담당 가능
- prompt 주입도 항상 파일 기준 내용 사용

### 2. tool별 포맷 지원

`chops`는 Claude/Cursor/Codex/Windsurf/Amp 등 tool별 path와 포맷 차이를 흡수한다.

`tunaFlow`도 장기적으로는 아래를 고려할 수 있다.

- Claude Code style `SKILL.md`
- Cursor `.mdc`
- Codex/other tool-specific metadata
- project-local vs global path 차이

단, 1차는 `SKILL.md`만 유지해도 충분하다.

### 3. collection 계층

`chops`는 원본 파일을 옮기지 않고 별도 collection으로 그룹화한다.

이 개념은 `tunaFlow`에도 잘 맞는다.

예:

- `Frontend`
- `Review`
- `Testing`
- `Harness`
- `Project Local`
- `Global`

중요:
- collection은 파일 원본을 바꾸지 않는 분류 메타여야 한다
- project context와 충돌하지 않게 "적용 묶음" 중심으로 써야 한다

### 4. file watch / live reload

`chops`는 파일 변경 감지 후 재스캔한다.

`tunaFlow`에도 유용하지만, 우선순위는 높지 않다.

도입 순서:

1. 수동 refresh
2. debounce된 file watch
3. 필요 시 project path 단위 selective rescan

## chops에서 그대로 가져오지 않을 점

### 1. 스킬 관리 전용 앱 관점

`chops`는 skill 브라우저/에디터가 중심이다.

반면 `tunaFlow`는:

- 어떤 작업에서
- 어떤 skill을
- 어떤 agent prompt에
- 왜 붙였는지

가 더 중요하다.

즉 `tunaFlow`의 중심은 **skill 관리**보다 **skill 적용**이다.

### 2. macOS 전용 가정

`chops`는 SwiftUI + macOS filesystem 접근 + FSEvents 기반이다.

`tunaFlow`는 Tauri 크로스플랫폼이므로
watcher/path/convention을 다시 설계해야 한다.

### 3. 내장 에디터 우선

내장 skill editor는 있으면 좋을 수 있으나,
`tunaFlow`의 1차 핵심은 아니다.

우선은:

- registry
- search/filter
- apply to prompt
- active skill visibility

가 더 중요하다.

## tunaFlow에 맞는 목표 구조

### Phase 1. Skill Registry

목표:

- 전역 skill 스캔
- 프로젝트 로컬 skill 스캔
- source/path/tool/type 메타 정리
- backend capability registry와 연결

필드 예:

- `id`
- `name`
- `description`
- `path`
- `scope` (`global` / `project`)
- `toolTargets` (`claude`, `codex`, `cursor` ...)
- `projectKey?`
- `tags[]`

### Phase 2. Skill Collections

목표:

- 파일 원본을 건드리지 않고 collection으로 묶기
- prompt preset이나 workflow preset에 연결

예:

- `UI Build`
- `Testing`
- `Review`
- `Docs`
- `Runtime`

### Phase 3. Skill Application Layer

가장 중요하다.

`tunaFlow`는 skill을 저장만 하지 말고,
**실제로 어느 작업에서 어떤 skill이 적용되었는지**가 보여야 한다.

예:

- 현재 conversation active skills
- branch-specific skill set
- prompt 실행 로그에 "applied skills"
- handoff prompt / architect prompt 생성 시 skill preset 연결

### Phase 4. Search / Watch / Install

후순위 기능:

- search/filter
- 수동 refresh
- file watch
- boilerplate 생성
- 외부 registry 설치

이 단계는 `chops` 참고 가치가 크다.

## 기존 tunaFlow 문서와의 관계

현재 가장 가까운 문맥은 아래다.

- `implementationStatus.md`
  - backend skill loading / capability registry
- `projectOnboardingLifecyclePlan.md`
  - project-level defaults / global registry 언급
- `dataModelRevised.md`
  - skill content가 ContextPack에 주입되는 구조

즉 이 문서는 새 독립 기능 문서라기보다,
이미 존재하는 skill loading을 **registry/application 구조로 확장하는 상위 계획**이다.

## 우선순위 판단

현재 우선순위는 높지 않다.

이유:

- `tunaFlow`는 아직 harness/owner assignment/plan dispatch/test 흐름이 더 중요하다
- skill은 backend loading만으로도 기본 사용은 가능하다

따라서 지금 단계에서는:

- 구현 즉시 진행 대상 아님
- 다만 방향 문서로는 유지 가치 높음

## 완료 기준

이 계획의 1차 완료는 아래를 의미한다.

1. skill source of truth가 파일 기준으로 명확히 정리됨
2. global / project-local skill registry를 UI에서 구분해서 볼 수 있음
3. active skills가 conversation/branch 단위로 더 잘 보임
4. prompt 실행 시 어떤 skill이 적용됐는지 추적 가능
5. collection/preset 구조를 추가할 확장점이 생김
