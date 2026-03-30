# Project-First Entry Policy

작성: 2026-03-30
상태: 기준 문서

## 결론

tunaFlow의 최종 제품 진입점은 **프로젝트 선택부터** 시작해야 한다.

즉:
- 프로젝트가 선택되지 않은 상태에서
- 일반 chat / branch / RT / artifact / evaluation 작업이 시작되면 안 된다.

`projectless conversation`은 개발 중 예외 상태일 뿐, 정상 사용 시나리오가 아니다.

## 왜 중요한가

### 1. tunaFlow는 범용 채팅 앱이 아니다

tunaFlow는
- 도메인 지식을 기반으로 서비스를 구축하는
- 인간지능 주도형 개발 애플리케이션

이다.

따라서 모든 작업은 기본적으로 어떤 프로젝트/워크스페이스 맥락 안에서 일어나야 한다.

### 2. agent-first 원칙과도 맞다

에이전트가 편하게 일하려면:
- 현재 프로젝트 경로
- 코드베이스
- 구조화 memory source
- git 상태
- 관련 artifacts / plan / retrieval 범위

가 명확해야 한다.

프로젝트 없는 시작은:
- rawq 의미 약화
- retrieval 품질 저하
- context-hub relevance 저하
- memory policy 왜곡

를 만든다.

### 3. 품질 지표 해석이 흔들린다

프로젝트 없는 테스트 대화에서는:
- input budget
- retrieval 효용
- structured memory relevance

같은 수치가 정상 사용 시나리오를 대표하지 못한다.

따라서 performance / cost / memory 품질 평가는
기본적으로 `project-selected state`에서만 해석해야 한다.

## 제품 원칙

### 정상 진입 흐름

1. 앱 시작
2. 프로젝트 폴더 선택 또는 기존 프로젝트 선택
3. 프로젝트 컨텍스트 활성화
4. 그 후 chat / plan / artifact / RT / evaluation 시작

### 허용하지 않을 상태

- 프로젝트 미선택 상태에서 일반 채팅 시작
- 프로젝트 없는 상태에서 memory/retrieval 품질을 정상 제품 지표로 간주
- projectless state를 기본 UX로 허용

## 구현 방향

최종 제품에서는:
- 첫 실행 또는 미선택 상태에서 프로젝트 선택 UX가 먼저 떠야 한다
- 선택 전에는 작업 화면이 아니라 onboarding / selector 상태여야 한다
- `projectless mode`를 별도 제품 모드로 지원하지 않는다

## dogfood 테스트에 대한 판단

지금 당장 dogfood test project를 강하게 운영할 단계는 아닐 수 있다.

하지만 장기적으로 실제 제품 품질 검증은:
- 프로젝트가 선택된 상태
- 실제 구조화 memory source가 존재하는 상태
- retrieval / rawq / git / artifact 흐름이 살아 있는 상태

에서 이루어져야 한다.

즉 dogfood는 나중에 하더라도,
제품 원칙은 지금부터 `project-first`로 고정한다.

## 한 줄 요약

tunaFlow는 프로젝트 없는 범용 채팅 도구가 아니다.  
**프로젝트 선택이 먼저이고, 모든 작업은 그 이후에 시작되어야 한다.**
