# tunaFlow rawq 도입 계획

- 작성자: OpenAI Codex
- 작성 시각: 2026-03-26 08:26 KST

## 목적

`tunaFlow`의 현재 코드 검색은 이름만 rawq이고, 실제로는 요청 시점에 프로젝트 파일을 순회하는 최소 키워드 검색이다. 이 문서는 `tunaDish`에서 이미 사용 중인 rawq CLI 기반 검색/인덱싱 구조를 참고해, `tunaFlow`에서도 실제 rawq를 사용할 수 있도록 단계별 도입 방향을 정리한다.

## 현재 상태 확인

실제 코드 기준:

- `src-tauri/src/agents/rawq.rs`
  - 주석에 `Minimal rawq: keyword-based code file search`라고 명시되어 있다.
  - persistent index, daemon, semantic search, map 기능이 없다.
- `src-tauri/src/commands/agents_helpers/context_pack.rs`
  - `build_rawq_section()`이 `rawq::search(path, prompt, RAWQ_MAX_RESULTS)`를 호출한다.
  - 현재 결과는 `## Code context` 텍스트 블록으로만 주입된다.
- `tunaDish`
  - `docs/prompts/integration/rawq_integration.md`
  - `docs/prompts/feature/rawq-agent-enhancement.md`
  - `docs/prompts/feature/rawq-scoped-indexing.md`
  - 위 문서들과 `vendor/rawq`, 브리지 구조를 보면 CLI 브리지, 인덱스 상태 확인, map, 자동 인덱싱, graceful fallback이 이미 정리되어 있다.

결론:

- `tunaFlow`에는 rawq 섹션이 있긴 하지만, 아직 `tunaDish` 수준의 rawq 도입은 아니다.
- 현재 상태는 "간이 코드 검색"이며, 실제 rawq CLI 통합은 미도입 상태다.

## 목표 상태

`tunaFlow`에서 rawq를 다음 수준으로 사용한다.

1. rawq CLI 사용 가능 여부를 감지한다.
2. 프로젝트별 인덱스 상태를 확인할 수 있다.
3. Claude 경로의 `ContextPack`에서 실제 rawq 검색 결과를 사용한다.
4. rawq가 없거나 실패하면 현재의 최소 키워드 검색으로 안전하게 fallback 한다.
5. 이후 단계에서 code map, 수동 검색, 상태 표시까지 확장할 수 있다.

## 설계 원칙

- 기존 `ContextPack` 조립 구조를 유지한다.
- rawq가 설치되지 않은 환경에서도 앱이 깨지면 안 된다.
- 초기 단계에서는 `Claude` 경로 우선 적용으로 충분하다.
- 현재 `rawq.rs` 최소 검색은 즉시 제거하지 말고 fallback으로 유지한다.
- 프로젝트 전체를 무조건 인덱싱하지 말고, 현재 활성 프로젝트 경로만 대상으로 한다.

## 단계별 계획

### Phase 1. CLI 브리지 + graceful fallback

목표:

- rawq 바이너리 감지
- `rawq search ... --json` 실행
- 실패 시 기존 `agents/rawq.rs` 검색으로 fallback

구현 포인트:

- `src-tauri/src/agents/rawq.rs` 확장 또는 인접 helper 추가
- `rawq --version` 또는 지정 경로 실행 가능 여부 확인
- `rawq search "<query>" "<path>" --json --top 5`
- 타임아웃 추가
- JSON 파싱 실패/프로세스 실패 시 fallback

완료 기준:

- rawq 설치 환경에서는 실제 CLI 검색 결과가 `ContextPack`에 들어간다.
- rawq 미설치 환경에서는 현재 동작이 유지된다.

### Phase 2. 프로젝트별 인덱스 상태/빌드

목표:

- 활성 프로젝트 기준으로 `rawq index status`
- 필요 시 `rawq index build`
- 인덱싱은 현재 프로젝트만 수행

구현 포인트:

- Tauri command 추가 예:
  - `getRawqStatus`
  - `buildRawqIndex`
- rawq 상태를 `ContextPanel` 또는 작은 상태 UI로 표시
- 인덱스 빌드는 수동 트리거 우선

완료 기준:

- 사용자가 현재 프로젝트 rawq 상태를 볼 수 있다.
- 수동 인덱스 빌드가 가능하다.

### Phase 3. Code Map / 수동 검색 UX

목표:

- `rawq map`
- 수동 `code search`
- 검색 결과를 `ContextPanel`에서 확인

구현 포인트:

- `tunaDish`의 ContextPanel 구조 참고
- 결과를 별도 탭 또는 기존 context 영역에 표시
- 자동 주입과 수동 탐색을 분리

완료 기준:

- 사용자가 rawq 결과를 직접 조회할 수 있다.
- 구조 파악용 code map을 볼 수 있다.

### Phase 4. 협업 기능과 연결

목표:

- Follow-up / plan / artifact 흐름과 rawq를 느슨하게 연결

예:

- follow-up 시 source + rawq 검색 결과를 함께 넘김
- 특정 subtask 문맥에서 rawq 검색어 보정

이 단계는 후순위다.

## tunaDish에서 직접 참고할 문서

- `D:\privateProject\tunaDish\docs\prompts\integration\rawq_integration.md`
- `D:\privateProject\tunaDish\docs\prompts\feature\rawq-agent-enhancement.md`
- `D:\privateProject\tunaDish\docs\prompts\feature\rawq-scoped-indexing.md`

## tunaFlow에서 우선 수정될 가능성이 큰 위치

- `src-tauri/src/agents/rawq.rs`
- `src-tauri/src/commands/agents_helpers/context_pack.rs`
- `src-tauri/src/commands/agents.rs`
- 향후:
  - `src/components/tunaflow/context-panel/*`
  - `src/lib/api/*`

## 추천 순서

1. Phase 1만 먼저 구현
2. 실제 검색 품질과 fallback 확인
3. 그 다음 Phase 2로 상태/인덱싱 추가
4. 마지막에 map/UI 확장

## 현재 판정

지금 `tunaFlow`의 rawq는 "관련 개념이 들어간 최소 구현" 수준이며, `tunaDish`처럼 실제 rawq를 쓴다고 보기 어렵다. 따라서 다음 고도화 항목으로 삼을 가치가 충분하다. 다만 한 번에 map/UI/daemon까지 넣지 말고, CLI 브리지와 fallback부터 도입하는 것이 맞다.
