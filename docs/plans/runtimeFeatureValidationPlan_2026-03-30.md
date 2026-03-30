# Runtime Feature Validation Plan

상태: 중요 / P1
작성: 2026-03-30

## 배경

이번 세션에서 tunaFlow에는 새 기능이 많이 들어갔다.

대표적으로:

- compressed memory
- conversation retrieval
- unified memory policy + threshold tuning
- memory trace surface / section budget breakdown
- mode-specific heuristics + auto mode
- context budget control UI
- roundtable completion-order / blind verifier / role-based cap

하지만 현재 가장 큰 리스크는 “기능 부재”보다 “실사용 검증 부족”이다.

이미 몇 가지 버그는 검증 중에 발견되어 수정되었다.
즉 다음 단계의 ROI는 새 기능 추가보다, 실제 사용 시나리오 기준 검증과 버그 수습에 있다.

## 목표

다음 세션의 중심을:

- 새 기능 구현

이 아니라

- 실제 사용 흐름 기반 검증
- 발견된 버그 수정

으로 전환한다.

## 이번 검증 대상

### 1. Compressed Memory

확인할 것:

- 긴 대화에서 실제로 생성되는가
- `not_generated / fresh / stale` 전환이 맞는가
- 다음 전송 시 ContextPack에 `compressed-memory` 섹션으로 주입되는가

### 2. Conversation Retrieval

확인할 것:

- 같은 프로젝트 안의 다른 대화가 여러 개 있을 때 관련 chunk를 가져오는가
- pair/anchor/brief chunk가 실제로 의미 단위로 보이는가
- recent/structured memory와 중복 suppression이 과하거나 부족하지 않은가

### 3. Auto Mode

확인할 것:

- 짧은 follow-up은 Lite로 가는가
- 구조화 작업/plan/skills가 있으면 Full로 가는가
- 일반 대화는 Standard로 가는가
- trace reason이 실제 판단과 일치하는가

### 4. Budget Control UI Reflection

확인할 것:

- Settings > Runtime에서 바꾼 mode / cap이 실제 prompt 조립에 반영되는가
- trace의 `context_mode`, `sections`, `chars`가 UI 설정과 맞는가
- override가 branch/thread send 경로에도 반영되는가

### 5. Roundtable Core Regression

확인할 것:

- completion-order가 실제 완료 순서대로 emit/persist 되는가
- blind verifier가 transcript 없이 topic만 받는가
- role-based output cap directive가 prompt에 들어가는가
- role/blind UI 설정이 저장/복원/표시에 일관되게 반영되는가

## 이번 단계에서 하지 않을 것

- 새 memory layer 추가
- vector/embedding 도입
- startup UX 도입
- RT preset 설계
- context-hub 고급 자동 주입

## 검증 방식

### A. 실사용 시나리오 중심

테스트용 프로젝트 하나를 기준으로:

- 일반 chat
- branch
- roundtable

를 실제로 돌려 본다.

### B. Trace 우선 검증

체감만 보지 않고:

- TracePanel
- RuntimeStatusBar
- stderr 로그

를 함께 확인한다.

### C. 버그 발견 시 즉시 수정

검증 중 드러난 문제는:

- 문서만 남기지 말고
- 가능한 한 같은 세션에서 수정까지 간다.

## 성공 기준

- compressed memory / retrieval / auto mode / budget reflection이 실제 시나리오에서 동작함을 확인했다
- RT 핵심 기능(completion-order, blind, role/blind visibility)이 회귀 없이 동작한다
- 발견된 버그는 우선순위 높은 것부터 바로 수정했다
- 다음 구현 라운드를 위한 “실제 병목”이 다시 정리된다

## 후속

검증 결과에 따라 다음은 둘 중 하나로 간다.

1. 버그 수정 라운드
2. 검증 통과 시 다음 기능 라운드

즉 이번 단계는 기능 추가가 아니라,
현재 시스템을 실제 사용 가능한 품질로 끌어올리는 중간 검증 라운드다.
