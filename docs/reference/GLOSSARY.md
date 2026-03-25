# GLOSSARY — tunaFlow 용어 정의

## 1. Workspace
로컬 파일시스템 루트. Project들을 포함한다.

---

## 2. Project
작업 단위.
- git repo
- 채팅 공간
- 외부 채널

---

## 3. Conversation
사용자와 AI 에이전트 간 대화 세션.

- Message들의 컨테이너
- Branch들의 루트

---

## 4. Branch
Conversation 내부의 **독립 메시지 스트림 분기**

- 특정 Message(checkpoint)에서 생성
- 부모 Conversation과 일부 컨텍스트 공유
- adopt 시 요약이 부모에 삽입됨

---

## 5. Message
대화의 최소 단위.

- role: user / assistant
- 상태: sending / streaming / done / error

---

## 6. Agent
AI 에이전트 정의.

- markdown 기반 선언형
- model / tools / system prompt 포함

---

## 7. ResumeToken
CLI 에이전트 세션 연속성 토큰.

- Conversation 단위
- 엔진 변경 시 폐기

---

## 8. ContextPack
실행 시점에 생성되는 컨텍스트 묶음.

구성:
- Agent system prompt
- Skill
- rawq 결과
- cross-session summary
- ResumeToken

※ 영속화되지 않음

---

## 9. Artifact
대화 결과로 생성된 문서.

- plan
- task_brief
- diff
- test_report

---

## 10. Memo
중요 메시지 스냅샷.

- 프로젝트 지식 저장소 역할

---

## 11. Roundtable
멀티 에이전트 토론 모드.

- Conversation.mode = "roundtable"

---

## 12. rawq
코드 검색 엔진.

- 프로젝트 코드 기반 검색
- ContextPack에 포함됨
