# NEXT_PHASES_OVERVIEW.md — tunaFlow 다음 단계 정리

## 목적
이 문서는 현재까지 구현된 기능과 앞으로 남은 작업을 다음 채팅에서도 바로 이어갈 수 있도록 정리한 기준 문서다.

---

## 1. 현재 완료 상태

### Core
- Project / Conversation / Message / Branch 기본 구조
- Branch 생성 / 목록 / adopt
- Branch 전용 대화 스트림
- Streaming
- ResumeToken
- ContextPack 최소 버전
- ContextPack 확장
  - Agent prompt
  - Skills
  - 간이 코드 검색(rawq 대체)
  - Cross-session context
  - Conversation / Branch / Parent context

### Multi-agent
- Claude adapter
- Codex adapter
- Gemini CLI adapter
- OpenCode adapter
- Roundtable 기본
- Roundtable multi-engine routing
- Roundtable prior response 공유
- Roundtable 공통 지시문
- Roundtable follow-up 2라운드
- Roundtable topic / prompt 관련 수정 반영

### Data / Docs
- Memo CRUD
- Artifact CRUD
- Skill 최소 버전
- Guardrail 최소 버전
  - 섹션별 truncation
  - 전체 prompt 제한
  - 에러 메시지 표준화
  - 실행 로그

---

## 2. 남은 주요 작업

### A. UI / UX 계층
이제부터는 UI를 먼저 해도 된다.
다만 “디자인”보다 “작업 구조를 드러내는 UI”를 먼저 해야 한다.

우선순위:
1. 레이아웃 정리
2. 패널 구조 정리
3. 현재 기능 접근성 개선
4. 상태 표시 개선
5. 문서/아티팩트 흐름 시각화

### B. 라운드테이블 고도화
- participant 역할 분리 강화
- synthesis 결과 생성
- 결과를 Artifact로 자동 저장
- 라운드 설정 고도화

### C. 브랜치 고도화
- branch별 resume token 분리
- branch별 conv settings 분리
- branch diff
- archive 복원
- git branch 연동

### D. ContextPack 고도화
- 우선순위 정책
- 중복 제거
- 길이 예산 분배
- 엔진별 차등 정책

### E. rawq 실제 연동
- 외부 rawq 코드 도입
- 빌드/배포 구조 확정
- 인덱싱 정책 확정

### F. Skill 고도화
- project / branch 스코프
- 우선순위
- 자동 선택
- 충돌 처리

### G. Memo / Artifact 고도화
- artifact 자동 생성
- 상태 흐름 강화
- memo를 의사결정 기록으로 활용

### H. 실행 / 하네스 계층
- 문서 기반 작업 계획 생성
- 역할 분배
- 실행
- 검증
- 재시도
- 즉, “토론 도구 → 실행 도구” 전환

---

## 3. 지금 권장 방향

### 결론
지금은 UI부터 진행해도 된다.

단, 범위는 아래로 제한한다.

### UI 1차 목표
- 현재 있는 기능을 한 화면에서 덜 불편하게 쓰게 만들기
- 대화 / 브랜치 / 라운드테이블 / 메모 / 아티팩트 / 스킬 / 컨텍스트 상태를 보기 좋게 정리
- 실사용 테스트가 쉬운 구조로 만들기

### UI에서 아직 하지 말 것
- 과한 디자인 시스템
- 복잡한 라우팅 재설계
- 새로운 도메인 로직 추가
- 하네스 자동화
- rawq 실제 연동
- 알고리즘 변경

---

## 4. UI 우선순위 제안

### Phase UI-1
- AppShell 정리
- 좌측: 프로젝트 / 대화
- 중앙: 메시지 / 입력 / 라운드테이블
- 우측: 브랜치 / 메모 / 아티팩트 / 스킬 / 크로스세션

### Phase UI-2
- 상태 배지
  - engine
  - mode
  - branch
  - streaming
  - round
- 에러 / 경고 표시

### Phase UI-3
- 아티팩트 패널 개선
- 메모 패널 개선
- 라운드테이블 결과 가독성 개선

---

## 5. 다음 채팅에서 이어갈 때 기준

항상 아래 문서를 기준으로 이어간다.

### SSOT
- docs/reference/DATA_MODEL_REVISED.md

### 보조 기준
- docs/reference/GLOSSARY.md
- docs/reference/MVP_IMPLEMENTATION_PLAN.md
- docs/reference/RT_FIX_CHANGELOG.md
- 이 문서: docs/reference/NEXT_PHASES_OVERVIEW.md

---

## 6. 한 줄 요약

지금은 기능/로직을 더 벌리기보다,
이미 만든 멀티에이전트 구조를 실제로 쓰기 좋은 UI로 정리하는 단계다.
