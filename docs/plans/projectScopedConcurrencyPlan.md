# 프로젝트 단위 동시성 설계

작성자: OpenAI Codex  
작성일: 2026-03-26

## 목적

`tunaFlow`에서 채팅앱 수준의 반응성과 에이전트 런타임의 안전성을 동시에 만족하기 위해, 동시성 경계를 프로젝트 단위로 정리한다.

핵심 원칙:

- 프로젝트 간 실행은 병렬 허용 가능
- 같은 프로젝트 내부의 같은 thread는 직렬 처리
- UI는 전역 busy가 아니라 thread-local busy로 보이게 한다

## 기본 판단

프로젝트는 다음 자원의 경계가 된다.

- project path / cwd
- rawq index / code context
- plans / memos / artifacts
- branch / roundtable
- git 상태 (향후)

따라서 서로 다른 프로젝트는 비교적 안전하게 분리된 실행 단위가 될 수 있다.

반면 같은 프로젝트 내부는 공유 자원이 많기 때문에 무작정 병렬화하면 안 된다.

## 권장 모델

### 프로젝트 간

- 서로 다른 프로젝트는 다른 worker / task / thread에서 병렬 실행 가능

예:

- Project A conversation 실행 중
- Project B conversation 실행 가능

이 경우 context, path, rawq, branch, artifact 경계가 달라 충돌 가능성이 낮다.

### 프로젝트 내부

프로젝트 내부에서는 다시 thread 단위 직렬화가 필요하다.

예:

- main conversation
- branch stream
- roundtable thread

이 thread들은 각각 자체 queue를 가질 수 있다.

즉 모델은:

- `project-scoped concurrency`
- `thread-local serialization`

이다.

## 왜 이 구조가 맞나

### 장점

- 다른 프로젝트 작업을 동시에 돌릴 수 있음
- 한 프로젝트에서 긴 작업이 돌아도 다른 프로젝트는 덜 막힘
- path / cwd / rawq / git 경계가 프로젝트 기준으로 맞음

### 주의점

- 같은 프로젝트 내부의 shared state는 여전히 조심해야 함
- 예:
  - rawq 인덱싱
  - project context snapshot 갱신
  - git 상태 갱신
  - 공용 memo/artifact 자동 생성

즉 프로젝트 내부도 완전 병렬이 아니라, thread 단위 직렬이 안전하다.

## 구현 원칙

1. 전역 `isRunning` 제거
2. thread-local run state 도입
3. queue는 thread 단위로 유지
4. 프로젝트 간 실행은 장기적으로 병렬 허용
5. 프로젝트 내부 shared resource 작업은 별도 정책 검토

## 완료 기준

1. 프로젝트 A 실행 중에도 프로젝트 B 탐색/실행이 가능하다
2. 같은 thread에서는 메시지가 queue로 직렬 처리된다
3. 전역 busy 느낌이 사라진다
4. 프로젝트 경계와 실행 경계가 일치한다

