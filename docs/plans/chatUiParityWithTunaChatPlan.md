# tunaFlow Chat UI Parity with tunaChat 계획

- 작성자: OpenAI Codex
- 작성 시각: 2026-03-29
- 상태: 제안

## 목적

현재 `tunaFlow`의 채팅 UI를 `tunaChat` 수준의 읽기 경험과 상호작용 품질로 끌어올린다.

중요:

- `tunaChat`를 복붙하지 않는다
- `tunaFlow`의 branch / roundtable / artifacts / follow-up 구조는 유지한다
- 채팅 표면만 단계적으로 강화한다

## 기준 문서

- `docs/reference/chatUiVsTunaChatGapReview_2026-03-29.md`
- 기존 참고: `docs/plans/chatUiMarkdownUpgradePlan.md`

## 단계

### Phase 1. Markdown / 코드블록 고도화

목표:

- 코드블록을 읽기 쉬운 UI로 개선
- 긴 코드블록 collapse/expand 지원
- copy feedback 강화

범위:

- `MarkdownComponents.tsx`
- 필요 시 `MessageItem.tsx`

### Phase 2. 파일 경로 클릭 + FileViewer

목표:

- 메시지 안 파일 경로를 클릭 가능하게 만들기
- markdown/text/code 파일 preview 제공

범위:

- `MarkdownComponents.tsx`
- 새 `FileViewer` 컴포넌트
- `ChatPanel.tsx` 또는 앱 셸에 뷰어 마운트

### Phase 3. 메시지 메타 / 그룹핑 정리

목표:

- grouped message 시각 밀도 향상
- engine/model metadata 가독성 향상
- branch/follow-up 관련 메타를 더 안정적으로 배치

범위:

- `MessageItem.tsx`
- `MessageMeta.tsx`
- `MessageActions.tsx`

### Phase 4. 긴 대화 스크롤 / virtualization

목표:

- 긴 세션에서도 성능과 스크롤 안정성 확보

범위:

- `ChatPanel.tsx`
- 필요 시 virtualization 도입

### Phase 5. 입력 영역 생산성 보강

목표:

- command palette 또는 quick actions
- action feedback

범위:

- `NewMessageInput.tsx`
- 입력 보조 컴포넌트

## 권장 실행 순서

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5

이 순서가 맞는 이유:

- Markdown/code/file UX가 체감 효과가 가장 큼
- 입력 UX는 후순위여도 제품 사용성에 치명적이지 않음

## 비목표

- 전체 레이아웃 재설계
- branch/roundtable 모델 변경
- 엔진/컨텍스트 아키텍처 변경
- unrelated refactor

## 완료 기준

1. 코드블록 UX가 `tunaChat` 수준에 근접
2. 파일 경로 클릭과 문서 preview 가능
3. 메시지 읽기 밀도와 긴 대화 스크롤이 개선
4. 문서와 실제 UI가 일치

