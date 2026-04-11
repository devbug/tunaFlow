# tunaFlow Chat UI vs tunaChat Gap Review

- 작성자: OpenAI Codex
- 작성 시각: 2026-03-29
- 기준 비교 대상:
  - `tunaFlow/src/components/tunaflow/*`
  - `tunaChat/client/src/components/chat/*`
  - `tunaChat/client/src/components/layout/ChatArea.tsx`

## 결론

`tunaFlow`는 멀티에이전트 기능과 오케스트레이션 메타는 강하지만,
채팅 표면 UI/UX는 아직 `tunaChat`보다 한 단계 덜 다듬어져 있다.

특히 아래 영역에서 차이가 크다.

1. 코드블록 UX
2. 파일 경로/문서 참조 UX
3. 메시지 그룹핑과 메타 밀도
4. 스트리밍 읽기 경험
5. 입력 영역 생산성
6. 긴 대화 스크롤 성능

## 비교 기준 파일

### tunaFlow

- `src/components/tunaflow/ChatPanel.tsx`
- `src/components/tunaflow/MessageItem.tsx`
- `src/components/tunaflow/chat/MarkdownComponents.tsx`
- `src/components/tunaflow/NewMessageInput.tsx`
- `src/components/tunaflow/message/MessageActions.tsx`

### tunaChat

- `client/src/components/layout/ChatArea.tsx`
- `client/src/components/chat/MessageView.tsx`
- `client/src/components/chat/MarkdownComponents.tsx`
- `client/src/components/chat/InputArea.tsx`
- `client/src/components/chat/FileViewer.tsx`
- `client/src/components/chat/MessageActions.tsx`

## 주요 갭

### 1. Markdown / 코드블록

`tunaFlow`:

- `react-markdown + remark-gfm`
- Prism + oneDark
- copy button
- language badge

부족한 점:

- 긴 코드블록 접기/펼치기 없음
- 줄 수 표시 없음
- Shiki 수준의 시각 완성도 없음
- 코드블록 상단 툴바 정보량이 적음

`tunaChat`:

- code header
- line count
- collapse/expand
- copy feedback
- Shiki 기반 highlighter

### 2. 파일 경로 / 문서 뷰어

`tunaFlow`:

- 외부 링크 처리만 존재
- 로컬 파일 경로 클릭 열기 없음
- markdown 문서 파일 preview 없음

`tunaChat`:

- inline code/file path 감지
- 일반 텍스트 파일 경로도 링크화
- `FileViewer`로 markdown/text 파일 미리보기

### 3. 메시지 정보 구조

`tunaFlow`:

- avatar
- message meta
- hover actions
- branch badges 일부

부족한 점:

- grouped message 밀도 낮음
- engine/model 변화 강조 약함
- saved/bookmark 상태 없음
- branch tag 시각적 밀도 낮음

`tunaChat`:

- grouped layout
- model 변화 강조
- branch tag
- saved state
- assistant header 정보 밀도 높음

### 4. 스트리밍 UX

`tunaFlow`:

- progress-first surface 존재
- streaming 중 markdown 재렌더는 어느 정도 피함

부족한 점:

- progress 블록 펼치기/축소 제어 약함
- 완료 후 summary/answer 전환이 단순함
- 시각적 상태 차등이 적음

`tunaChat`:

- rolling progress lines
- done 상태 축약
- expandable progress view

### 5. 입력 영역 UX

`tunaFlow`:

- engine/model selector
- roundtable controls
- context badges
- queue/cancel 표시

부족한 점:

- command palette 없음
- quick chips 없음
- action toast 없음
- 입력 생산성을 높이는 짧은 상호작용 부족

`tunaChat`:

- command palette
- quick chips
- lightweight action feedback

### 6. 긴 대화 성능

`tunaFlow`:

- 단순 메시지 map 렌더
- 새 메시지 기준 auto-scroll

부족한 점:

- 긴 세션에서 virtualization 부재
- 스크롤 추적 로직이 단순

`tunaChat`:

- `react-virtuoso`
- at-bottom tracking
- sticky input과 footer padding 정교화

## 우선순위 제안

### P0

1. Markdown / 코드블록 UX 고도화
2. 파일 경로 클릭 + FileViewer

### P1

3. 메시지 그룹핑 / 메타 밀도 개선
4. 긴 대화 virtualization

### P2

5. 입력 영역 quick actions
6. 모바일/좁은 창 액션 개선

## 판단

`tunaFlow`는 이미 오케스트레이션 도구로서 강하다.
그래서 지금 필요한 것은 새 기능 추가보다,
채팅 표면이 현재 기능 수준에 맞는 완성도를 갖추도록 정리하는 일이다.

