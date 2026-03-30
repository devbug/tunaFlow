# Roundtable Role Terminology Separation Plan

상태: 중요 / P1
작성: 2026-03-30

## 배경

현재 Roundtable participant에는:

- `role`
- `blind`
- `max_tokens`

가 들어가 있다.

하지만 이 `role`은 실제로는:

- 프로젝트 워크플로우 역할
  - `Architect`
  - `Reviewer`
  - `Tester`
  - `General`

이 아니라,

- Roundtable 내부 토론 역할
  - `proposer`
  - `reviewer`
  - `verifier`
  - `synthesizer`

을 의미한다.

즉 지금 이름은 의미를 제대로 전달하지 못하고,
프로필 역할과 RT 토론 역할을 혼동하게 만든다.

## 목표

RT 전용 `role`을:

- 데이터 모델에서는 `rt_role`
- UI에서는 `토론 역할` 또는 `RT Role`

로 분리해 표현한다.

핵심은:
- profile 역할과
- RT 기능 역할

을 다른 층으로 분리하는 것이다.

## 왜 필요한가

### 1. 지금 `role`은 잘못 읽히기 쉽다

사용자는 `role`을 보면 자연스럽게:

- 이 participant가 Architect인지
- Reviewer인지

를 떠올리게 된다.

하지만 현재 구현의 `role`은 그 의미가 아니다.

### 2. tunaFlow의 기본 단위는 profile이다

사용자-facing 1급 정체성은:

- `Architect Claude`
- `Reviewer Codex`
- `Tester Gemini`

같은 profile이다.

RT role은 여기에 덧붙는 실행 보조 속성이지,
기본 정체성이 아니다.

### 3. blind verifier와 cap도 RT role에 종속된다

`blind`
`max_tokens`

는 profile 자체보다:

- verifier
- proposer
- synthesizer

같은 RT 토론 역할과 더 강하게 연결된다.

따라서 이름도 그 관계를 반영해야 한다.

## 이번 단계에서 할 것

### 1. 타입/필드 명확화

가능하면:

- `role` → `rtRole` 또는 `rt_role`

로 명확히 바꾼다.

완전한 데이터 마이그레이션이 부담되면,
최소한 프론트 타입과 UI 라벨부터 분리한다.

### 2. UI 용어 변경

`CreateRoundtableDialog`와 RT 표면에서:

- `role`

대신

- `토론 역할`
- `RT Role`

처럼 표시한다.

### 3. profile과 RT role을 함께 읽을 수 있게 한다

예:

- `Architect Claude` + `proposer`
- `Reviewer Codex` + `reviewer`
- `Tester Gemini` + `verifier`

처럼 기본 정체성과 RT 역할이 다른 층임을 보이게 한다.

### 4. 문서/주석 정리

`role-based output cap`도 실제로는:

- `rt_role-based output cap`

이라는 뜻임을 코드 주석이나 문서에서 명확히 한다.

## 이번 단계에서 하지 않을 것

- RT orchestration 재설계
- blind verifier 규칙 변경
- role 종류 확장
- lead decomposition

## 구현 원칙

- 사용자-facing 1급 정체성은 profile
- RT role은 보조 실행 속성
- 필드/라벨/설명이 같은 의미를 가리키게 할 것
- 가능한 한 compatibility를 깨지 않게 점진 수정

## 성공 기준

- 사용자가 `role`을 프로젝트 워크플로우 역할로 오해하지 않는다
- RT 설정과 실행 표면에서 `토론 역할`이라는 뜻이 명확해진다
- blind/max token이 RT role과 연결된 속성이라는 점이 더 잘 드러난다

## 후속

이 단계 다음은:

1. max token override 고급 옵션 최소 노출
2. verifier/synthesizer preset
3. 필요 시 RT preset library

순으로 이어진다.
