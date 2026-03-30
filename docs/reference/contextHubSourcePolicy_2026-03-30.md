# context-hub Source Policy

상태: 초안
작성: 2026-03-30

## 목적

`context-hub`를 tunaFlow에 도입할 때, 어떤 source를 허용하고 어떤 원격 접근을 금지할지 정책을 고정한다.

## 핵심 원칙

1. `context-hub`는 tunaFlow 내부에 흡수하지 않는다
2. `context-hub`는 sidecar / CLI / MCP 성격의 외부 런타임으로 연결한다
3. 기본 동작에서 공개 레포/공개 registry 자동 접속은 금지한다

## 허용되는 source

- 앱 번들에 포함된 로컬 source
- 사용자가 명시적으로 등록한 로컬 source
- 사용자가 명시적으로 등록한 private/internal source

## 기본 금지

- 임의 public registry 자동 조회
- 실행 중 공개 레포 자동 fetch
- source가 없을 때 인터넷 fallback
- 사용자 동의 없는 remote sync

## 네트워크에 대한 구분

- 에이전트 모델 호출 자체는 네트워크를 사용할 수 있다
- 그러나 `context-hub` source fetch 정책은 별도로 통제한다

즉:
- `model network access`와
- `knowledge source network access`
를 같은 것으로 취급하지 않는다

## 개발 vs 배포

### 개발

- 로컬의 `context-hub` 레포 또는 실행 파일을 붙여 실험 가능
- 다만 public source 자동 조회는 기본 비활성

### 배포

- 원본 레포 클론을 요구하지 않는다
- 실행 가능한 sidecar와 허용된 source만 함께 번들한다
- 최종 사용자는 공개 레포를 직접 다루지 않아도 된다

## 권장 기본 정책

- default: `bundled/local/private only`
- optional: 사용자가 명시적으로 활성화한 source만 추가 허용

## 이유

- 재현성
- 보안
- 예측 가능성
- 기업/팀 환경 적합성

## 메모

이 정책은 `context-hub`를 “인터넷 검색기”가 아니라 “통제된 knowledge sidecar”로 취급한다는 선언이다.
