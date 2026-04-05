# Known Issues & Improvements — 2026-04-05 (세션 12 종료 시점)

---

## P1: 개선 필요

### Review 완료 감지가 탭 전환에 의존
- **현상**: Reviewer가 verdict를 보내도 Dev 탭에 돌아와야 rework 버튼 표시
- **원인**: useSubtaskProgress가 polling(5초)으로 review branch를 스캔. plan.phase가 "review"일 때 Plan은 Review 탭에 있어 Dev 탭의 polling이 안 돌음
- **수정 방향**: agent:completed 이벤트에서 자동 verdict 스캔 → processReviewVerdict 호출. 또는 phase="review"일 때도 DevProgressView가 verdict를 감지하도록 변경

### Verdict 자동 처리 (single-agent review)
- **현상**: handleStartReview로 단일 에이전트 리뷰 시, agent:completed 후 verdict 마커 자동 감지 + processReviewVerdict 호출이 안 됨
- **원인**: RT 경로(startReviewRT)에는 ReviewVerdictCard가 처리하지만, 단일 에이전트 경로에는 없음
- **수정 방향**: agent:completed 시 review branch 메시지 스캔 → verdict 마커 발견 시 자동 processReviewVerdict

### 스마트 scaffold — 기존 CLAUDE.md 갱신 안내
- **현상**: refresh_project_stack_info가 §1을 갱신하지만 사용자에게 알림 없음
- **수정 방향**: toast 알림 "프로젝트 스택 정보가 업데이트되었습니다" 추가

---

## P2: 후순위

### microcompact 적용 확장
- prune_tool_results가 compression pre-pass + recent context에 적용됨
- 추가: rawq 결과의 `## Relevant code` 섹션 감지 패턴 보강
- 추가: CRG graph impact 결과의 다양한 헤더 형식 대응

### 컨텍스트 메뉴 확장
- 빈 영역 우클릭 메뉴 (ChatAreaContextMenu) 미적용
- 코드블록 우클릭 메뉴 미구현

### CenterPanel 추가 분할
- MemoPopover 추출 가능 (408줄 → ~340줄)
- 효과 제한적이라 보류

---

## 참고: 세션 12에서 해결된 이슈

| 이슈 | 해결 |
|------|------|
| Dev↔Review 과다 순환 | 3-role 프롬프트 전면 수정 + 에이전트 템플릿 동기화 |
| EngineSelector ollama 크래시 | ENGINE_LIST + fallback 방어 |
| 테스트 반복 실행 (탭 전환) | testResultCache 모듈 레벨 + cancelled 가드 제거 |
| subtask 완료 표시 누락 | impl-complete = 전부 done + 0-based idx 수정 |
| slug 충돌 (한국어 Plan) | DB plan.slug + collision detection (v26) |
| abandoned Plan 표시 | status filter 추가 |
| workflow stage 칩 색상 | 선택된 것만 highlight |
| 드로어 애니메이션 밀림 | translateX 100% → 24px |
| hover toolbar 깜빡임 | Radix data-state=open 활용 |
