# 프로젝트 추가 라이프사이클 설계

작성자: OpenAI Codex  
작성일: 2026-03-26

## 목적

`tunaFlow`에서 프로젝트 추가를 단순 DB 등록이 아니라, 이후 대화, 브랜치, plan, rawq, 컨텍스트 준비의 시작점으로 정의한다.

프로젝트는 앞으로 다음의 상위 경계가 된다.

- conversations
- branches
- plans / subtasks
- memos
- artifacts
- roundtable
- rawq / project context

즉 프로젝트 추가는 "폴더 하나 등록"이 아니라 "작업 공간 초기화"에 가깝다.

## 프로젝트 경계 책임

프로젝트는 단순 경로 메타가 아니라 `tunaFlow`의 기본 작업 경계여야 한다.

즉 아래 항목들은 기본적으로 프로젝트 단위로 관리되는 것이 맞다.

### 프로젝트 내부 책임

- conversations
- branches / branch streams
- roundtable threads
- plans / subtasks
- memos / shared brief / findings
- artifacts / reviews
- rawq index / code context
- trace / evaluation
- project instructions (`CLAUDE.md`, `AGENTS.md`, `SKILL.md`)
- project-level defaults
  - engine
  - model
  - persona
  - trigger mode

### 전역 책임

반대로 아래는 전역이어도 된다.

- 앱 UI 설정
- 전역 모델 카탈로그
- 전역 skill registry
- 공용 템플릿 / 프롬프트

즉 원칙은:

- 작업 지속성과 산출물은 프로젝트 내부
- 앱 운영/환경 설정은 전역

## 프로젝트 추가와 책임 범위의 관계

프로젝트가 위 경계 역할을 하려면, 추가 시점에 최소한 그 경계가 바로 작동해야 한다.

그래서 프로젝트 추가 라이프사이클은 단순 `INSERT INTO projects`로 끝나면 안 된다.
최소한 아래까지 이어져야 한다.

- 기본 conversation 생성
- project defaults 초기화
- project context 초기 수집
- rawq 준비
- 즉시 사용 가능한 선택 상태 진입

즉 "프로젝트 추가"는 곧 "프로젝트 경계 활성화"다.

## 현재 상태

현재 `tunaFlow`는 프로젝트 추가 시 아래까지만 한다.

- path validation
- project row 생성
- Sidebar 목록 반영

그리고 프로젝트 선택 시:

- 해당 `project_key`의 conversation 목록 로드
- rawq 상태 확인
- 필요 시 rawq 인덱싱

이 흐름은 동작하지만, 프로젝트가 실제 루트 경계라는 개념에 비해 자동 설정이 부족하다.

## 목표

프로젝트 추가 시 최소한 아래가 자동으로 정리되어야 한다.

1. 경로 검증과 정규화
2. path 기준 중복 방지
3. 프로젝트 row 생성
4. 기본 conversation 생성
5. 프로젝트 기본 설정 확보
6. rawq 준비 예약
7. project context 초기 수집
8. 즉시 사용 가능한 상태로 전환

## 라이프사이클 제안

### Phase 1. 입력 검증

- path 존재 여부
- 디렉토리 여부
- normalized path 생성
- 같은 normalized path의 기존 프로젝트 존재 여부 검사

권장:

- 같은 path면 새 project를 만들지 않고 기존 프로젝트를 재사용
- 최소한 path duplicate는 막는다

### Phase 2. 프로젝트 identity 생성

프로젝트 row에 최소한 아래를 확정한다.

- `key`
- `name`
- `path`
- `type`
- `default_engine`
- `workspace_root`
- `source`

권장 추가 개념:

- path fingerprint
- git root 추적용 필드

### Phase 3. 기본 conversation 생성

프로젝트 추가 직후 기본 conversation 하나를 자동 생성한다.

권장:

- label: `main`
- type: `main`
- mode: `chat`

이유:

- 프로젝트를 추가했는데 대화가 하나도 안 보이는 UX를 없애기 위함
- 이후 브랜치, plan, memo의 기본 기준점이 생김

### Phase 4. 기본 설정 초기화

프로젝트 수준 기본값을 확보한다.

예:

- default engine
- default model
- persona
- trigger mode
- rawq enabled 여부

지금은 일부가 conversation에만 흩어져 있으므로, 장기적으로는 project defaults가 필요하다.

### Phase 5. project context 초기 수집

프로젝트 추가 후 또는 첫 선택 시 1회 자동 수집:

- git repo 여부
- git root
- current branch
- `CLAUDE.md`, `AGENTS.md`, `SKILL.md` 존재 여부
- rawq 사용 가능 여부
- capabilities / skills 스캔 결과

### Phase 6. rawq 준비

프로젝트 추가 후 또는 첫 선택 시:

- rawq availability check
- index status
- 없으면 build

이 과정은 UI를 막지 않는 것이 좋다.

### Phase 7. 활성화

프로젝트 추가 완료 후:

- 해당 프로젝트 선택
- 기본 conversation 선택
- 필요한 context fetch 수행

즉 "등록"이 아니라 "바로 작업 가능" 상태로 끝나야 한다.

## path duplicate 정책

이 부분은 중요하다.

현재 구조는 `conversation.project_key` 기준으로 묶이기 때문에, 같은 실제 path를 다른 `project_key`로 등록하면 기존 대화가 안 보이는 문제가 생길 수 있다.

권장 정책:

- 같은 normalized path의 project가 이미 있으면 새 project 생성 금지
- 대신 기존 project를 선택/복구

## cross-session 기본 정책

맥락 유지도 기본적으로는 프로젝트 내부가 맞다.

권장 정책:

- 기본 cross-session 참조 범위는 같은 프로젝트 내부
- cross-project context 공유는 기본 off
- 정말 필요할 때만 명시적 opt-in

이 원칙이 있어야 프로젝트 경계가 흐려지지 않는다.

## 완료 기준

아래가 되면 1차 완료로 본다.

1. invalid path는 등록되지 않는다
2. 같은 path는 중복 등록되지 않는다
3. 프로젝트 추가 시 기본 conversation이 자동 생성된다
4. 프로젝트 추가 후 즉시 conversation이 보인다
5. 첫 선택 시 rawq 준비가 자동으로 연결된다
6. 프로젝트 내부 책임 범위가 코드와 UX 모두에서 일관되게 유지된다
