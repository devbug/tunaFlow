# Rework 서브태스크 타겟팅 (B안)

> Status: idea (P0 — 구현 대기, 사용자 지시 후 진행)
> Created: 2026-04-04
> 관련: `docs/ideas/architectEnhancementIdea.md`

---

## 1. 문제

Review에서 서브태스크 1개가 실패 → Rework → Developer가 **전체 서브태스크를 다시 구현**.
이미 완료된 B, C, D 서브태스크의 코드까지 불필요하게 수정됨.

### 현재 흐름

```
approveAndStartImplementation()
  const subtasks = await planApi.listSubtasks(plan.id);  // 전체 로드
  // → "task-01.md, task-02.md, ... 순서대로 구현하세요"
  // → 완료/실패 구분 없음
```

---

## 2. 해결: Review Verdict에 failedSubtaskIds 추가

### 2.1 Review Verdict 스키마 확장

`src/lib/schemas/reviewVerdict.ts`:

```typescript
// 현재
findings: z.array(z.object({
  description: z.string().min(1),
  file: z.string().optional(),
  line: z.number().int().optional(),
  severity: z.enum(["critical", "major", "minor"]).optional(),
}))

// 추가
failedSubtaskIds: z.array(z.number().int()).default([])
```

Reviewer 프롬프트에 "실패한 서브태스크 번호를 `failedSubtaskIds`에 명시하세요" 규칙 추가.

### 2.2 Rework 프롬프트에서 실패 서브태스크만 전달

`DevProgressView.tsx` rework 구성:

```typescript
// 현재: 전체 subtask 나열
const subtasks = await planApi.listSubtasks(plan.id);

// 개선: 실패한 것만 필터
const failedIds = new Set(verdict.failedSubtaskIds ?? []);
const targetSubtasks = subtasks.filter((_, i) => failedIds.has(i + 1));
// failedIds가 비어있으면 전체 (하위 호환)
const targets = targetSubtasks.length > 0 ? targetSubtasks : subtasks;
```

### 2.3 Rework 프롬프트 구조 변경

```markdown
### 🔄 Rework

**대상 서브태스크**: Task 07 (Q&A 엔진 fallback)
**나머지 태스크 (01-06)**: 이미 완료됨 — 수정하지 마세요.

**수정 항목** (2건):
□ 1. 보고서 메타에 분석 시점 기본 엔진 미저장
  파일: chat.post.ts
□ 2. 결과 문서 부정확
  파일: docs/plans/ux-result.md

**Recommendations**:
• ...

> 완료 조건: 위 항목만 해결하세요. 다른 태스크의 코드를 변경하지 마세요.
```

### 2.4 approveAndStartImplementation도 수정

Doom loop 후 architect 재설계 → 다시 dev로 갈 때:

```typescript
// 현재: 전체 subtask
const subtasks = await planApi.listSubtasks(plan.id);

// 개선: status !== "done"인 것만
const pendingSubtasks = subtasks.filter(s => s.status !== "done");
const taskItems = pendingSubtasks.map(...)
```

---

## 3. 변경 범위

| 파일 | 변경 |
|------|------|
| `src/lib/schemas/reviewVerdict.ts` | `failedSubtaskIds` 필드 추가 |
| `src/lib/workflowOrchestration.ts` | Reviewer 프롬프트에 subtask 번호 지시 추가 |
| `src/lib/workflowOrchestration.ts` | `approveAndStartImplementation()`에서 pending subtask만 전달 |
| `src/components/tunaflow/context-panel/DevProgressView.tsx` | rework 프롬프트에 대상 서브태스크 필터링 |
| `src/lib/planProposalParser.ts` | verdict 파싱에 `failedSubtaskIds` 추출 추가 |

DB 변경 없음. 마커 스키마 확장만.

---

## 4. 하위 호환

- `failedSubtaskIds`가 없는 기존 verdict → 빈 배열 (`default([])`) → 전체 subtask 대상 (현재 동작 유지)
- 새 verdict부터 subtask 번호 포함 → 타겟 rework 동작

---

## 5. 검증

1. Review verdict에 `failedSubtaskIds: [7]` 포함 확인
2. Rework 프롬프트에 "대상 서브태스크: Task 07" 표시 확인
3. Developer가 다른 태스크 파일을 수정하지 않는지 확인
4. `failedSubtaskIds` 미포함 verdict → 기존 동작 (전체 대상) 확인
