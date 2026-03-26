# tunaFlow Tauri 2 플러그인 적용 방안

- 작성자: OpenAI Codex
- 작성 시각: 2026-03-26 20:29 KST

## 목적

현재 `tunaFlow`에 도입된 Tauri 2 플러그인 상태를 실제 코드 기준으로 확인하고,
앞으로 플러그인을 어떤 원칙으로 확장할지 정리한다.

이 문서는 다음 두 가지를 함께 다룬다.

1. 이미 적용된 플러그인의 현재 상태
2. 앞으로 도입할 수 있는 플러그인과 적용 우선순위

## 현재 적용 상태 확인

실제 확인 파일:

- `D:\privateProject\tunaFlow\src-tauri\Cargo.toml`
- `D:\privateProject\tunaFlow\src-tauri\src\lib.rs`
- `D:\privateProject\tunaFlow\src-tauri\capabilities\default.json`
- `D:\privateProject\tunaFlow\src\lib\appStore.ts`
- `D:\privateProject\tunaFlow\src\stores\chatStore.ts`
- `D:\privateProject\tunaFlow\src\components\tunaflow\AppShell.tsx`

확인된 플러그인:

- `tauri-plugin-dialog`
- `tauri-plugin-notification`
- `tauri-plugin-store`
- `tauri-plugin-window-state`

즉 `notification`, `store`뿐 아니라 `dialog`, `window-state`도 이미 의존성과 등록이 들어가 있다.

## 이미 적용된 기능

### 1. notification

실제 코드 기준:

- `src-tauri/Cargo.toml`
  - `tauri-plugin-notification = "2"`
- `src-tauri/src/lib.rs`
  - `.plugin(tauri_plugin_notification::init())`
- `src-tauri/capabilities/default.json`
  - `notification:default`
  - `notification:allow-notify`
  - `notification:allow-is-permission-granted`
  - `notification:allow-request-permission`
- `src/stores/chatStore.ts`
  - `_endRun(threadId)`에서 `document.hidden`일 때 알림 전송

현재 동작:

- 에이전트 실행 완료 시 `_endRun`
- 앱이 포커스 밖이면
- `tunaFlow / 에이전트 응답이 완료되었습니다.` 알림 표시

판정:

- 기본 도입은 적절함
- 현재는 "완료 알림" 하나만 쓰는 상태
- 이후에는 notification type을 더 세분화할 수 있다

### 2. store

실제 코드 기준:

- `src-tauri/Cargo.toml`
  - `tauri-plugin-store = "2"`
- `src-tauri/src/lib.rs`
  - `.plugin(tauri_plugin_store::Builder::new().build())`
- `src-tauri/capabilities/default.json`
  - `store:default`
- `src/lib/appStore.ts`
  - `getSetting`
  - `setSetting`
  - `settings.json` 자동 저장
- `src/stores/chatStore.ts`
  - `selectProject()`에서 `lastProjectKey` 저장
- `src/components/tunaflow/AppShell.tsx`
  - 초기화 시 `lastProjectKey` 복원

현재 동작:

- 마지막 프로젝트 기억
- 앱 시작 시 마지막 프로젝트 자동 복원

판정:

- 현재 사용 방식은 적절함
- 앞으로 UI/UX 상태 저장의 중심 계층으로 확장할 가치가 높음

### 3. dialog

실제 코드 기준:

- `src-tauri/Cargo.toml`
  - `tauri-plugin-dialog = "2"`
- `src-tauri/src/lib.rs`
  - `.plugin(tauri_plugin_dialog::init())`
- `src-tauri/capabilities/default.json`
  - `dialog:default`
  - `dialog:allow-open`

이미 알려진 사용처:

- 프로젝트 폴더 선택 UX

판정:

- 패널/워크스페이스 선택, import/export 계열로 확장 가능

### 4. window-state

실제 코드 기준:

- `src-tauri/Cargo.toml`
  - `tauri-plugin-window-state = "2"`
- `src-tauri/src/lib.rs`
  - `.plugin(tauri_plugin_window_state::Builder::new().build())`

현재 프론트 직접 사용 흔적은 아직 강하지 않지만,
윈도우 크기/위치 복원 기반은 이미 들어간 상태다.

판정:

- 향후 panel width와 연계하면 사용자 체감이 더 좋아질 수 있다

## 현재 적용 방향의 평가

현재 도입은 전체적으로 건강하다.

이유:

- plugin을 무작정 많이 붙인 것이 아니라
- 실제 UX 가치가 바로 있는 것들만 들어갔다
  - folder picker
  - completion notification
  - last project restore
  - window state 기반

특히 `store`와 `window-state`는 앞으로 패널 리사이즈/모드 저장과 자연스럽게 연결된다.

## 앞으로 store에 넣기 좋은 항목

현재 `lastProjectKey`만 저장 중인데,
다음 항목들은 store로 올리기 좋다.

### 우선순위 높음

- `sidebarWidth`
- `workspacePanelWidth`
- `threadDrawerWidth`
- `workspaceMode`
- 마지막 활성 채팅 탭
- 마지막 열린 branch/thread

### 중간 우선순위

- 기본 엔진
- 기본 모델
- notification on/off
- rawq auto-build 관련 사용자 설정

### 후순위

- 실험적 기능 토글
- reviewer lane 기본 표시 방식
- trace panel 기본 필터

## notification 확장 방향

현재 완료 알림 하나만 있지만, 앞으로는 알림 타입을 나눌 수 있다.

권장 확장:

### 우선순위 높음

- 에이전트 응답 완료
- 리뷰 완료
- RT 완료
- long-running 인덱싱/그래프 build 완료

### 조건부

- 테스트 실패
- 승인 대기
- branch adopt 완료

중요:

- notification은 "중요한 상태 전환"에만 써야 한다
- 모든 내부 이벤트에 알림을 붙이면 금방 시끄러워진다

## 패널 UX와의 연결

앞서 정리한 `panelDrawerUxPlan`과 가장 자연스럽게 맞물리는 플러그인은 `store`와 `window-state`다.

### store가 맡을 것

- 좌측 패널 폭
- 우측 workspace panel 폭
- thread/RT drawer 폭
- workspace panel 현재 모드

### window-state가 맡을 것

- 앱 윈도우 크기/위치
- 멀티 모니터 환경 복원

즉:

- `window-state`는 앱 창 수준
- `store`는 앱 내부 레이아웃 수준

으로 역할을 분리하는 것이 좋다.

## code-review-graph / rawq와의 연결

앞으로 `rawq`와 `code-review-graph`를 함께 다룰 때도 플러그인 계층이 도움이 된다.

예:

- graph build 완료 notification
- 마지막 graph 상태/패널 모드 저장
- 마지막 review mode 복원

다만 이들 도구 자체는 Tauri plugin으로 넣기보다,
현재처럼 외부 CLI/도구 래퍼로 두는 것이 맞다.

즉 Tauri plugin은 인프라 보조층이지, rawq/graph 자체를 대체하는 층은 아니다.

## 적용 원칙

### 1. 플러그인은 UX 가치가 명확할 때만 추가한다

좋은 예:

- dialog
- store
- notification
- window-state

나쁜 예:

- 지금 당장 쓰지도 않을 plugin 선탑재

### 2. plugin state와 domain state를 섞지 않는다

예:

- `lastProjectKey`, panel widths, workspace mode는 plugin store에 적합
- messages, plans, branches, artifacts는 앱 domain state와 DB가 진실원이어야 한다

### 3. capability 최소 권한을 유지한다

현재도 capability에 필요한 permission만 넣는 방향은 좋다.
앞으로도 plugin 추가 시 permission 범위를 최소화하는 것이 맞다.

## 추천 다음 단계

### Phase 1. store 확장

목표:

- 패널 리사이즈 상태 저장
- workspace mode 저장
- notification preference 저장

### Phase 2. notification 정리

목표:

- 완료/리뷰/RT/build 완료 알림 타입 분리
- 사용자 설정으로 on/off 가능하게

### Phase 3. window-state 연계

목표:

- 앱 레이아웃 복원 경험 개선
- panel state와 조합해 "이전 작업 맥락 복원" 강화

## 현재 판정

현재 Tauri 2 plugin 도입은 방향이 좋다.

특히 `store`와 `notification`은 이미 `tunaFlow`의 장기 작업 UX와 잘 맞고,
앞으로 `panelDrawerUx`, `workspace panel`, `review workflow`까지 고려하면
가장 먼저 확장할 가치가 있는 기반이다.

즉 지금은 plugin을 더 늘리기보다,
이미 도입한 plugin들을 레이아웃 복원, 알림 정책, 작업 맥락 복원 쪽으로 깊게 쓰는 것이 맞다.
