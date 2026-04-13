# 구조개선 계획 — 삭제 없는 모듈 격리 + 베타 준비 통합

> Status: draft
> Created: 2026-04-13
> 출처: 코덱스 구조 분석 + 오퍼스 제품 방향 검토 합산
> 원칙: 기능 삭제 없음. 핵심 기능을 핵심답게 분리.
> 실행: 코더 Opus 기준 (사람 주 단위 → Opus 시간 단위)

---

## 0. 진단 요약

**"구조 수용력보다 제품 폭이 앞서 있다"** (코덱스)

- 기능 자체는 핵심 (Plan/RT/Memory/Skills/rawq = AOC의 제품 정의)
- 문제는 기능들이 구현된 **방식**: 계층 침범, setTimeout 체인, UI에서 오케스트레이션
- 기능을 줄이는 게 아니라 **경계를 세우는 것**

---

## 1. 실행 계획 (코더 Opus 기준)

### Sprint 1: 베타 BLOCKER + Phase 0 (1일)

```
[1-1] RT prompt.rs unwrap 수정 (1시간)
  → roundtable_helpers/prompt.rs의 .find(...).unwrap() 9곳
  → .unwrap_or(0) 또는 ? 연산자로 교체
  
[1-2] HTTP API unwrap → ? 처리 (2시간)
  → http_api/*.rs의 unwrap 13곳
  → 적절한 에러 응답 (400/404/500) 반환

[1-3] CORS 미들웨어 추가 (30분)
  → http_api/mod.rs에 tower_http::cors::CorsLayer

[1-4] PlanCard 분해 (2-3시간)
  → PlanCard.tsx에서 문서 스캔/서브태스크 복구/브랜치 판정/구현 완료 추론을
    lib/workflow/planWorkflowService.ts로 이동
  → PlanCard는 렌더링 + 이벤트 위임만

[1-5] runtimeSlice setTimeout 체인 → 백엔드 잡 (2시간)
  → runtimeSlice.ts:87의 setTimeout(compress, 500) → setTimeout(refresh, 1500) → ...
  → 새 Tauri command: on_run_completed(conversation_id)
  → 백엔드에서 compress → refresh_links → index_chunks → rawq_index 순서 관리

[1-6] slug 단일화 (30분)
  → migrations.rs와 plans.rs의 slug 로직 → 단일 함수로 통합

검증: cargo check + cargo test + npx tsc --noEmit + npx vitest run
```

### Sprint 2: Phase 1 — 도메인 분리 + 경계 재설계 (1일)

```
[2-1] Plan 도메인 분리 (3-4시간)
  → plans.rs + workflow/*.ts에 흩어진 규칙을 정리
  → 책임 명확화:
    - phase transition 로직
    - branch linkage
    - subtask recovery
    - impl/review completion 판단
    - report/document generation
  → 프론트: planWorkflowService가 오케스트레이션, 컴포넌트는 UI만

[2-2] Thread/Runtime 경계 재설계 (3-4시간)
  → threadSlice.ts에서 분리:
    - thread state (순수 상태)
    - data loading (API 호출)
    - navigation side effects (탭 전환 이벤트)
    - branch recovery
    - RT status
  → runtimeSlice도 동일 패턴으로 정리

[2-3] 중요 경로 silent catch → toast (2-3시간)
  → ptyMessageSender.ts, projectSlice.ts, workflow 관련
  → 에이전트 실행 실패, 프로젝트 저장 실패 등 핵심 경로만
  → 합리적 fallback (.catch(() => "") 등)은 유지

[2-4] 깨진 테스트 수정 + 핵심 테스트 추가 (2시간)
  → smoke-workspace.test.tsx 수정
  → Plan phase transition 테스트 추가
  → run completion → background job 테스트 추가

검증: 전체 테스트 + 수동 풀사이클 1회
```

### Sprint 3: 베타 마무리 (반나절)

```
[3-1] DB 마이그레이션 전 백업 추가 (30분)
  → db/mod.rs에서 마이그레이션 전 .db → .db.bak 복사

[3-2] Tauri command 도메인별 정리 (1시간)
  → lib.rs의 169개 command를 도메인별 그룹 주석으로 정리
  → (파일 분리는 아님, 주석 + 순서 정리만)

[3-3] README 업데이트 (1시간)
  → CLI 요구사항 명확화 (최소: Claude Code 또는 Codex)
  → 빌드/실행 방법 갱신
  → 알려진 제한사항

[3-4] 전체 검증 + 태그 (1시간)
  → cargo check + cargo test + vitest + tsc
  → 수동 테스트: Plan→Dev→Review 1회, RT 1회, Branch 1회
  → git tag v0.1.0-beta.1

검증: 전체 통과 → GitHub Release
```

---

## 2. 베타 이후 (Phase 2, 급하지 않음)

베타 공개 후 피드백 수집하면서 점진 진행:

```
[P2-1] 백엔드 잡 시스템 본격 도입
  → on_run_completed를 범용 잡 큐로 확장
  → 대상: memory compression, session link, chunk indexing,
    rawq indexing, insight extraction, document indexing

[P2-2] Document RAG 서비스화
  → document_index.rs → document_index_service로 분리
  → command는 thin wrapper, 로직은 서비스

[P2-3] Skills 경계 고정
  → skills.rs를 분리: local/external/registry/detection

[P2-4] Insight 격리 (feature freeze)
  → 신규 기능 추가 안 함
  → 기존 기능은 유지하되 서비스 경계만 정리

[P2-5] 프런트 이벤트 버스 개선
  → window.dispatchEvent("tunaflow:*") → typed event hub
  → 주의: store action으로 전부 바꾸면 slice 의존성 증가. 느슨한 결합 유지.
```

---

## 3. 하지 않을 것

| 항목 | 이유 |
|------|------|
| 대규모 리라이트 | 동작하는 코드를 전면 교체하면 회귀 위험 |
| DB 전면 재설계 | 마이그레이션 34개는 알파 단계에서 정상 |
| 기능 삭제 | 핵심 기능 = 제품 정의. 삭제하면 AOC가 아님 |
| 디자인/UX 개편 | 구조개선과 병행하면 충돌 |
| slice를 더 쪼개기만 하고 책임은 그대로 | 파일 분할 ≠ 구조 개선 |
| 기능 동결 중 신규 기능 추가 | Sprint 1-3 동안 feature freeze |

---

## 4. 테스트 우선순위 (Sprint 2에서 병행)

| 순위 | 테스트 대상 | 이유 |
|------|-----------|------|
| 1 | Plan phase transition | 가장 복잡한 상태 머신 |
| 2 | run completion → background job | setTimeout 제거 후 검증 필수 |
| 3 | thread open/recover | threadSlice 재설계 후 검증 |
| 4 | RT execution (unwrap 제거 후) | 패닉 경로 제거 확인 |
| 5 | HTTP API 에러 응답 | unwrap → ? 전환 확인 |

---

## 5. 타임라인

```
Sprint 1 (1일):  BLOCKER + Phase 0
Sprint 2 (1일):  Phase 1 + 테스트
Sprint 3 (반나절): 베타 마무리
────────────────────────────
총: 2.5일 → v0.1.0-beta.1 태그

Phase 2: 베타 이후 점진 (2-3주 걸려도 됨)
```

---

## 6. 코더 Opus 프롬프트 (Sprint 1)

```
구조개선 Sprint 1을 실행합니다. docs/plans/structuralImprovementPlan.md 참고.

순서:
1. RT prompt.rs unwrap 9곳 → 안전 처리 (1시간)
2. HTTP API unwrap 13곳 → ? + 에러 응답 (2시간)
3. CORS 미들웨어 추가 (30분)
4. PlanCard.tsx 오케스트레이션 로직 → lib/workflow/planWorkflowService.ts 분리 (2-3시간)
5. runtimeSlice setTimeout 체인 → on_run_completed Tauri command (2시간)
6. slug 중복 → 단일 함수 (30분)

규칙:
- 기능 변경 없음. 구조만 개선.
- 각 완료 후 cargo check + cargo test
- 전체 완료 후 npx tsc --noEmit + npx vitest run
- PlanCard는 렌더링 + 이벤트 위임만 남겨야 함
- runtimeSlice의 setTimeout은 전부 제거, 백엔드 command 1개로 대체
```

---

## 참고

- 코덱스 구조 분석: 이 세션에서 수행
- 베타 준비 계획: `docs/plans/betaReadinessPlan.md`
- 리팩토링 v3: `docs/plans/codebaseRefactoringProposalV3.md`
- 시니어 리뷰: silent catch 74곳, unwrap 58곳, 테스트 갭
- 계층 침범 사례:
  - `src/components/tunaflow/context-panel/plans/PlanCard.tsx:69`
  - `src/stores/slices/runtimeSlice.ts:87`
  - `src/stores/slices/threadSlice.ts:59`
