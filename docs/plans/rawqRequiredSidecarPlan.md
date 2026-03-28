# tunaFlow rawq 필수 sidecar 전환 계획

- 작성자: OpenAI Codex
- 작성 시각: 2026-03-28
- 상태: Phase A-B 완료 (binary resolution + sidecar bundle + bootstrap scripts)

## 목적

현재 `tunaFlow`의 rawq 경로는 문서 기준으로는 "없으면 fallback 가능" 전제가 남아 있지만,
실제 제품 의도는 그렇지 않다.

`rawq`는 선택 기능이 아니라, `tunaFlow`가 코드 컨텍스트를 확보하는 데 필요한 **필수 런타임 의존성**이다.
따라서 방향은 다음처럼 바꾸는 것이 맞다.

1. rawq를 optional tool이 아니라 app-managed sidecar로 본다.
2. 개발/배포 환경에서 rawq를 함께 준비한다.
3. rawq 미존재 시 조용히 degraded mode로 가지 않는다.
4. 앱은 rawq 상태를 명확히 드러내고, 필요하면 bootstrap/build를 유도한다.

## 현재 상태

실제 코드 기준:

- `src-tauri/src/agents/rawq.rs`
  - 실제 rawq CLI만 호출한다.
  - `If rawq is not available, this module returns explicit errors — no silent fallback.`
- `src-tauri/src/commands/projects.rs`
  - `rawq::is_available()`, `rawq::index_status()`, `rawq::ensure_index()`를 사용한다.
- `docs/how-to/rawq-setup.md`
  - rawq가 없어도 앱이 실행 가능하다고 적혀 있다.
  - 현재 Windows 전용 로컬 빌드 경로 TODO가 남아 있다.
- `docs/plans/rawqIntegrationPlan.md`
  - 초기 계획은 "CLI 도입 + graceful fallback" 전제다.

즉, **문서와 현재 구현 전제가 이미 어긋나 있다.**

## 권장 방향

### 결론

`tunaDish`처럼 **submodule/vendor + build script + sidecar bundle** 구조로 가는 것이 맞다.

다만 "앱 시작 시 매번 rawq를 즉석 빌드"하는 방식은 기본 경로로 추천하지 않는다.

이유:

- Rust toolchain 의존이 생긴다.
- 첫 실행 시간이 과도하게 길어진다.
- 빌드 실패 원인이 앱 장애로 직결된다.
- 배포 환경에서 예측 가능성이 낮다.

따라서 기본 원칙은:

- **배포**: 플랫폼별 rawq sidecar를 번들
- **개발**: vendor/submodule rawq를 명시적으로 build
- **런타임**: 준비된 rawq를 탐색하고, 없으면 명확히 실패/안내

이어야 한다.

## 비권장 방향

### 1. 앱 시작 시 자동 Cargo build

기본 전략으로는 비권장.

허용 가능한 경우:

- 개발 모드 전용 bootstrap
- 사용자가 명시적으로 "rawq 준비"를 눌렀을 때

기본 경로로 두면 안 되는 이유:

- startup latency 증가
- toolchain/네트워크/권한 이슈
- 실패 시 UX가 불안정

### 2. 이전 최소 검색 fallback 유지

제품 전제가 "rawq는 반드시 함께 실행"이라면 이 fallback은 제거 대상이다.

이유:

- 사용자는 rawq가 죽었는지 모른 채 품질만 나빠진다.
- 디버깅이 어려워진다.
- 문서/운영 기준이 계속 흔들린다.

## 목표 상태

사용자는 rawq를 별도 설치 도구처럼 인식하지 않는다.

대신 시스템은 아래처럼 동작한다.

1. 앱이 rawq 바이너리를 자체 관리한다.
2. 프로젝트를 열면 rawq 상태를 즉시 확인한다.
3. 인덱스가 없으면 build를 자동 또는 명시적으로 시작한다.
4. rawq 실행 불가 시 원인을 UI에 표시한다.
5. strict mode가 기본값이며, silent fallback은 없다.

## 권장 구현 단계

### Phase A. 런타임 정책 정리

목표:

- rawq를 필수 의존성으로 문서화
- fallback 제거 방향 확정
- binary resolution 우선순위 재정의

권장 우선순위:

1. `RAWQ_BIN`
2. bundled sidecar path
3. 개발용 vendor/local build path
4. PATH (`dev` 보조 경로로만 허용)

완료 기준:

- 문서와 코드가 같은 전제를 가진다.

### Phase B. sidecar/vendor 구조 도입

목표:

- `tunaDish`의 구조를 참고해 rawq를 프로젝트 관리 범위 안으로 넣는다.

후보:

- `vendor/rawq` git submodule
- `scripts/build-rawq.(sh|ps1)`
- target별 output을 `src-tauri/binaries/` 또는 동등 경로에 배치
- `tauri.conf.json`의 sidecar/externalBin 연결

완료 기준:

- macOS/Windows 빌드 산출물에 rawq가 함께 포함된다.

### Phase C. bootstrap / diagnostics

목표:

- 앱이 rawq 상태를 설명 가능하게 만든다.

필요 항목:

- `get_rawq_status` 확장
- "not found / not indexed / build failed / ready" 구분
- 개발 모드용 `prepare_rawq` 또는 별도 스크립트 안내

완료 기준:

- rawq가 왜 안 되는지 사용자가 바로 알 수 있다.

### Phase D. 인덱싱 운영 고도화

목표:

- 프로젝트 열기 시 상태 확인
- 최초 자동 build 또는 explicit bootstrap
- stale index 정책 정리

이 단계는 sidecar 정착 후 진행.

## tunaDish에서 참고할 것

- vendor/submodule 구조
- build script
- Tauri sidecar 번들 방식
- 플랫폼별 binary naming 규칙

중요:

`tunaFlow`는 rawq 내부 로직을 재구현하지 말고,
**rawq를 준비하고 호출하고 상태를 드러내는 얇은 adapter**만 유지해야 한다.

## 이 계획의 실제 작업 범위

우선순위가 높은 것은 아래다.

1. fallback 문서/가정 정리
2. sidecar/vendor 구조 채택
3. macOS + Windows binary resolution 정리
4. rawq 미존재 시 진단 메시지 강화

후순위:

- 업데이트 자동 감지
- code-review-graph 연동
- 고급 검색 UX

## 최종 판단

현재 상황에서 가장 맞는 방향은:

- "rawq가 없으면 그냥 돌아가게 둔다"가 아니라
- "`tunaFlow`가 rawq를 함께 관리하는 제품 구조로 전환한다"

이다.

즉, **tunaDish식 sidecar/vendor 구조를 가져오되, 앱 시작 시 매번 즉석 빌드하는 방식은 기본 경로로 삼지 않는 것**이 가장 현실적이다.
