# Workflow Document V2 — Architect 직접 작성 + Semantic Versioning

> Status: draft
> Created: 2026-04-01
> Supersedes: workflowDocumentSpec.md (tunaFlow 자동 생성 방식 → Architect 직접 작성 방식)

---

## 1. 핵심 변경

| | V1 (현재) | V2 (변경) |
|---|---|---|
| 문서 작성 | tunaFlow (DB→마커 파싱→템플릿 생성) | Architect가 직접 파일 작성 |
| 문서 수정 | 마커 재제출 → 전체 교체 | Architect가 해당 파일만 수정 |
| subtask 문서 | DB details 필드 (plain text) | 개별 markdown 파일 |
| 버전 | revision 정수 (0,1,2...) | semantic (v1.0, v1.13, v2.0) |
| 수정 경로 | 메인 채팅만 | 슬라이더(minor) + 메인 채팅(major) |

---

## 2. 디렉토리 구조

```
{project_root}/docs/plans/
├── {slug}.md                 ← 전체 계획서 (메인 plan 문서)
├── {slug}-task-01.md         ← Subtask 1 작업 지시서
├── {slug}-task-02.md         ← Subtask 2 작업 지시서
├── {slug}-task-NN.md         ← Subtask N 작업 지시서
├── {slug}-result.md          ← 구현 결과 보고서 (Dev 완료 시)
├── {slug}-review-r1.md       ← Review 보고서 (라운드 1)
└── {slug}-review-r2.md       ← Review 보고서 (rework 후)
```

---

## 3. 버전 체계

```
v{major}.{minor}

major++: Chat ↔ Plan 간 전체 plan 변경 시
minor++: Subtask 슬라이더에서 세부 수정 병합 시

v1.0   — 최초 생성
v1.1   — Subtask 3 작업지시 수정
v1.2   — Subtask 7 작업지시 수정
v1.3   — Subtask 2 재수정
v2.0   — Chat에서 전체 plan 변경 (구조적 수정)
v2.1   — Subtask 5 수정
```

minor 자릿수 제한 없음 (v1.13, v1.127 가능).

---

## 4. 수정 경로

### 4.1 Subtask 세부 수정 (minor)

```
Subtask stage → [수정] 클릭 → Subtask 전용 슬라이더 대화 열림
  → Chat과 동일한 에이전트(Architect) 사용
  → 해당 subtask 논의 → Architect가 문서 직접 수정
  → 병합 시:
    - 해당 {slug}-task-NN.md 업데이트
    - 메인 {slug}.md 요약 섹션 업데이트
    - 버전: v1.2 → v1.3
```

### 4.2 전체 plan 수정 (major)

```
Subtask stage → [전체 수정] 클릭 → Chat 탭으로 이동
  → Architect와 전체 plan 재논의
  → 변경된 부분만 업데이트 (전체 재작성 아님)
  → 병합 시:
    - {slug}.md 변경 부분 업데이트
    - 영향받는 {slug}-task-NN.md 업데이트
    - 버전: v1.3 → v2.0
```

---

## 5. 워크플로우 흐름

```
Chat (Architect)
  │  대화 → plan-proposal 마커 → [승격]
  ↓
Plan 생성 (v1.0)
  │  Architect가 직접 작성:
  │    {slug}.md + {slug}-task-01.md ~ NN.md
  │  [검토 시작] → Subtask로 이동
  ↓
Subtask (검토)
  │  사용자가 각 작업 지시서 검토
  │
  │  세부 수정: 슬라이더 → Architect 수정 → minor++ → 병합
  │  전체 수정: Chat으로 → Architect 수정 → major++ → 병합
  │
  │  [승인] → Approved
  ↓
Approved → Dev → Review → Decision
```

---

## 6. 구현 순서

### Phase 1: DB 스키마 + 버전 체계

1. plans 테이블: `revision INTEGER` → `version_major INTEGER DEFAULT 1, version_minor INTEGER DEFAULT 0`
2. TS 타입: `Plan.revision` → `Plan.versionMajor, Plan.versionMinor`
3. 표시: `rev.N` → `v{major}.{minor}`

### Phase 2: Architect 직접 문서 작성

1. Plan 승격 시 Architect에게 "docs/plans/ 에 문서를 작성하세요" 프롬프트 전송
2. plan-proposal 마커 → DB에 plan/subtask 저장 (제목+메타만)
3. Architect가 후속 응답으로 파일 직접 생성 (CLI 에이전트의 파일 생성 기능 활용)
4. `generate_plan_document` 제거 (tunaFlow 자동 생성 폐기)

### Phase 3: Subtask 슬라이더 대화

1. Subtask 카드에서 [수정] → 슬라이더 대화 열림 (Branch)
2. Chat과 동일한 에이전트(Architect) 자동 설정
3. 병합 시: Architect가 해당 task 파일 수정 + 메인 plan 요약 업데이트
4. version_minor++

### Phase 4: 전체 수정 (Chat ↔ Plan)

1. [전체 수정] → Chat 탭 이동
2. Architect가 기존 문서를 읽고 변경 부분만 수정
3. version_major++, version_minor = 0

### Phase 5: UI 업데이트

1. PlanDocumentModal: 파일 시스템에서 직접 읽기 (DB가 아닌 파일 기반)
2. SubtaskReviewView: 개별 task 파일 내용 표시
3. 버전 표시: `v1.13` 형식

---

## 7. PLATFORM_TIER0 변경

```
현재: "Do NOT create files directly in docs/plans/"
변경: "Plan 문서는 docs/plans/ 에 직접 작성하세요.
      메인 계획서: {slug}.md
      작업 지시서: {slug}-task-NN.md
      tunaFlow가 파일 변경을 감지하여 DB와 동기화합니다."
```

---

## 8. 절대 하지 말 것

1. generate_plan_document를 Phase 2 전에 제거하지 않음 (V1 fallback 유지)
2. DB의 plan/subtask 레코드를 제거하지 않음 (메타데이터는 DB, 본문은 파일)
3. 한 번에 전체 전환하지 않음 (Phase별 점진적 진행)
