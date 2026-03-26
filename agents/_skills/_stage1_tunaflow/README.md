# tunaFlow 1차 적용 스킬 묶음

이 폴더는 `tunaFlow`에 바로 적용하기 쉬운 스킬만 1차로 분류한 curated 묶음이다.

원칙:
- 지금 진행 중인 우선순위와 직접 연결되는 스킬만 포함
- UI/UX 정리, 프론트 구현, UI 검증에 바로 쓰는 스킬 위주
- 원본을 복제하지 않고 junction으로 연결해 중복 관리를 피함

## 폴더 구성

### `ui-build`
- `frontend-design`
  - 화면/컴포넌트/UI 개선 작업용
- `react-best-practices`
  - React 코드 작성/리팩터링/성능 패턴 검토용
- `composition-patterns`
  - 컴포넌트 구조 정리, boolean prop 남발 제거, 재사용 API 설계용

### `ui-review`
- `web-design-guidelines`
  - 웹 UI/접근성/디자인 규칙 리뷰용

### `ui-testing`
- `webapp-testing`
  - Playwright 기반 실제 화면 검증, 회귀 확인, UI 플로우 점검용

## 지금 포함하지 않은 스킬

아래는 당장 1차 적용 우선순위가 낮아서 제외했다.

- `theme-factory`
  - 시각 테마 적용엔 유용하지만 현재 `tunaFlow`는 구조 정리와 workflow UX가 우선
- `remotion`
  - 현재 제품 방향과 직접 연결 약함
- `supabase-postgres-best-practices`
  - 향후 DB/백엔드 최적화 시점에 재검토
- 문서/슬라이드/xlsx/pdf/pptx 계열
  - 현재 핵심 제품 흐름과 거리 있음

## 사용 기준

- UI를 만들거나 다듬을 때: `ui-build`
- UI 품질/접근성/구성 감사를 할 때: `ui-review`
- 실제 동작 확인과 시각 회귀 검증을 할 때: `ui-testing`

## 다음 후보

다음 단계에서 검토할 후보:
- `theme-factory`
- `supabase-postgres-best-practices`
- 필요 시 `frontend-design`과 짝지을 추가 디자인/브랜딩 계열 스킬
