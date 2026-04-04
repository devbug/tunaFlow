# 워크플로우 에이전트 고도화 (Architect + Developer + Reviewer)

> Status: idea (P0)
> Created: 2026-04-04
> Updated: 2026-04-04 (Developer/Reviewer 고도화 + 결과 문서 문제 추가)
> 발견: 소넷 4.6 Developer가 동일 리뷰 포인트에서 4회 연속 실패 — 복합 원인

---

## 1. 현재 문제

### 1.1 Developer 뺑뺑이 (doom loop의 진짜 원인)

```
Review 실패 → Rework 지시: "fallback을 고쳐라"
  → Developer: metaAgent.engine 대신 다른 걸 시도
  → 또 실패 → Rework 지시: "fallback을 고쳐라" (같은 지시)
  → Developer: 비슷하게 시도
  → 4회 반복
```

**원인**: Rework 프롬프트가 매번 동일한 수준의 추상적 지시를 반복. 이전 실패에서 **무엇이 잘못됐는지** 학습하지 않음.

### 1.2 Architect 태스크 명세의 추상성

현재 Architect가 생성하는 subtask:
```
Task 07: Q&A 엔진 fallback 구현
- 보고서 메타에 분석 시점 기본 엔진을 저장
- chat.post.ts에서 fallback 체인 적용
```

필요한 수준:
```
Task 07: Q&A 엔진 fallback 구현
- reports 테이블에 default_engine 컬럼 추가 (마이그레이션 필요)
- analyzeReport()에서 사용된 engine을 report.defaultEngine에 저장
- chat.post.ts:42의 engine 결정 로직 변경:
  body.engine ?? persona.engine ?? report.defaultEngine ?? 'claude'
- 검증: POST /api/reports/:id/chat에 engine 미지정 시 report.defaultEngine 사용 확인
```

### 1.3 결과 문서(syncResultReport) 누적 오염

Rework 후 Developer가 결과 문서를 재생성할 때:
- 이전 버전 텍스트가 삭제되지 않고 아래에 **누적**
- 오래된 수치(예: "테스트 105개" → 실제 117개)가 잔존
- 중복 섹션 발생 (동일 "Rework 수정 완료" 블록이 2번)
- 문서가 중간에 잘림 (토큰 한도 초과 추정)

**발견 사례**: tunaInsight `docs/plans/ux-result.md` — 40줄에 오래된 "105개", 63줄부터 16-36줄 내용이 통째로 중복, 77줄에서 잘림

**원인**: `syncResultReport()`가 Developer 메시지를 압축해 문서를 생성하는데, rework 전후 메시지가 구분 없이 병합됨

### 1.4 서브에이전트 병렬 실행 부재

현재: 모든 subtask를 Developer 1명이 순차 실행
개선: 독립적인 subtask들을 병렬로 실행 가능

---

## 2. 고도화 방향

### 2.1 [P0] 구체적 태스크 명세 생성

Architect 프롬프트에 다음 규칙 추가:

```markdown
## 태스크 작성 규칙

각 subtask의 작업 지시서(task-NN.md)에 반드시 포함:

1. **변경 대상 파일 목록** — 정확한 경로 (예: `src/api/chat.post.ts`)
2. **변경 내용** — 추가/수정/삭제할 코드의 의도 (예: "42줄의 engine 결정 로직을 fallback 체인으로 변경")
3. **의존성** — 이 태스크가 선행해야 할 다른 태스크 (예: "Task 03의 마이그레이션 완료 후 실행")
4. **검증 조건** — Developer가 자가 검증할 수 있는 구체적 기준 (예: "engine 미지정 요청 시 report.defaultEngine 사용 확인")
5. **위험 요소** — 사이드 이펙트 가능성 (예: "기존 chat API 호출자 중 engine을 명시하는 곳이 있으면 영향 없음 확인")
```

**효과**: Developer가 "뭘 해야 하는지" 명확히 알게 됨 → 첫 시도 성공률 상승

### 2.2 [P0] Rework 실패 이력 주입

Rework 프롬프트에 이전 실패 diff를 포함:

```markdown
### 🔄 Rework (4차 시도)

**이전 시도 이력**:
- 1차: `chat.post.ts:42`에서 `preset.metaAgent.engine` 사용 → ❌ 보고서별 엔진이 아니라 전역 프리셋 엔진
- 2차: `persona.engine` fallback 추가 → ❌ persona가 없을 때 undefined
- 3차: `reportMeta.engine` 필드 추가했으나 저장 로직 누락 → ❌ 항상 null

**이번에 해야 할 것**:
1. `analyzeReport()` 완료 시 `report.defaultEngine = usedEngine` 저장 (DB 필드 존재 확인)
2. `chat.post.ts:42`에서 `body.engine ?? persona.engine ?? report.defaultEngine` 체인 적용
3. 저장 + 읽기 양쪽 모두 동작 확인
```

**구현 위치**: `DevProgressView.tsx`의 rework 프롬프트 구성 시 이전 review verdict의 findings를 누적 포함

### 2.3 [P1] 서브에이전트 병렬 실행 오케스트레이션

Architect가 subtask를 생성할 때 **병렬 가능 그룹**을 지정:

```json
{
  "subtasks": [
    { "id": 1, "title": "DB 마이그레이션", "group": "A", "parallel": false },
    { "id": 2, "title": "API 엔드포인트", "group": "B", "dependsOn": [1] },
    { "id": 3, "title": "UI 컴포넌트", "group": "B", "dependsOn": [1] },
    { "id": 4, "title": "통합 테스트", "group": "C", "dependsOn": [2, 3] }
  ]
}
```

그룹 B의 태스크 2, 3은 그룹 A(태스크 1) 완료 후 **동시 실행** 가능.

**구현**:
- `plan_subtasks` 테이블에 `depends_on` (JSON array), `group` 컬럼 추가
- Architect 프롬프트에 병렬 그룹 지정 규칙 추가
- 실행 엔진: 독립 그룹 내 태스크를 별도 branch에서 동시 실행 (RT 인프라 재사용)

### 2.4 [P1] 리뷰 피드백 해석 → 재설계 판단

현재: 3회 실패하면 무조건 subtask_review (아키텍트 재설계)로 에스컬레이션
개선: Architect가 리뷰 피드백을 분석해서 판단

- **구현 오류** (코드 버그, 누락): rework으로 충분 → 더 구체적인 rework 지시 생성
- **설계 오류** (스키마 미스매치, 아키텍처 충돌): 재설계 필요 → subtask 수정
- **요구사항 모호**: 사용자에게 clarification 요청

### 2.5 [P0] 결과 문서 Rework 시 클린 재생성

`syncResultReport()`가 rework 후 문서를 재생성할 때:

```
현재: Developer의 전체 assistant 메시지를 시간순 압축 → 이전 + 현재 내용 혼합
개선: rework 후에는 마지막 impl-complete 이후 메시지만 기준으로 재생성
      또는 기존 문서를 완전히 교체 (append가 아닌 replace)
```

**구현 옵션**:
- A. `syncResultReport()`에 `replace: true` 모드 추가 — rework 후에는 전체 교체
- B. 메시지 필터링 — `impl-complete` 마커 이후 메시지만 압축 대상
- C. 결과 문서에 버전 섹션 (`## v1`, `## v2 (rework)`) — 이력 보존하되 최신만 활성

---

## 3. Developer 에이전트 고도화

### 3.1 [P0] Rework 시 변경 범위 제한

현재: "전체 subtask를 순서대로 구현하세요" (완료된 것 포함)
개선: 실패 서브태스크만 전달 + "나머지는 수정 금지" 명시

→ B안 (review verdict subtask 매핑)과 연동. `docs/ideas/reworkSubtaskTargetingIdea.md` 참조.

### 3.2 [P1] 자가 검증 체크리스트 실행

Architect가 제공한 검증 조건을 Developer가 구현 후 **직접 확인**:

```markdown
### 🔧 구현 완료 전 자가 검증

□ engine 미지정 요청 시 report.defaultEngine 사용되는지 확인
□ persona.engine이 null일 때 다음 fallback으로 넘어가는지 확인
□ 테스트 전체 통과 확인
```

impl-complete 마커 전에 검증 결과를 명시하도록 Developer 프롬프트에 규칙 추가.

### 3.3 [P1] 결과 문서 정확성 보장

Developer가 impl-complete 시 생성하는 결과 문서에:
- 실제 테스트 수를 `npm test` / `cargo test` 출력에서 추출
- 하드코딩 수치 금지 ("테스트 105개" → 실제 실행 결과 인용)
- 이전 rework 이력은 별도 섹션으로 분리

---

## 4. Reviewer 에이전트 고도화

### 4.1 [P0] Review Verdict에 실패 서브태스크 매핑

→ B안 핵심. `failedSubtaskIds` 필드 추가로 어떤 서브태스크가 문제인지 명확히 전달.

### 4.2 [P1] 이전 실패 이력 기반 심층 검증

Re-review 시 이전에 실패한 **동일 포인트**가 실제로 수정됐는지 코드 diff 기반으로 확인:

```markdown
## 재검토 기준 (강화)

이전 Finding 1: "Q&A 엔진 fallback이 metaAgent.engine에 의존"
- 확인할 파일: chat.post.ts
- 확인할 것: metaAgent.engine 참조가 제거됐는지, report.defaultEngine으로 대체됐는지
- **코드에서 직접 확인** (결과 문서의 주장이 아닌 실제 코드)
```

### 4.3 [P1] 결과 문서 vs 실제 코드 교차 검증

현재: Reviewer가 결과 문서를 신뢰하고 검증
문제: 결과 문서가 부정확하면 (§1.3) 잘못된 pass 판정 가능

개선: Reviewer 프롬프트에 "결과 문서의 주장을 코드로 교차 확인하세요" 규칙 추가.

---

## 5. 메타에이전트와의 관계

메타에이전트 (미래): 전체 프로젝트 맥락을 이해하고 Architect에게 지시하는 상위 계층
에이전트 고도화: 메타에이전트 없이도 워크플로우 품질을 높이는 자체 개선

둘은 독립 — 개별 에이전트가 좋아지면 메타에이전트의 부담도 줄어듦.

---

## 6. 구현 우선순위

| # | 수정 | 대상 | 효과 | 난이도 | 순서 |
|---|------|------|------|--------|------|
| 1 | **구체적 태스크 명세** | Architect | 첫 시도 성공률 상승 | 낮음 | **즉시** |
| 2 | **Rework 실패 이력 주입** | Developer | 반복 실패 제거 | 중간 | **즉시** |
| 3 | **결과 문서 클린 재생성** | Developer | 부정확한 보고 제거 | 중간 | **즉시** |
| 4 | **Review Verdict subtask 매핑** | Reviewer | 타겟 rework | 중간 | **B안과 동시** |
| 5 | **Reviewer 코드 교차 검증** | Reviewer | 잘못된 pass 방지 | 낮음 | **프롬프트만** |
| 6 | **Developer 자가 검증** | Developer | impl-complete 전 확인 | 낮음 | **프롬프트만** |
| 7 | **병렬 실행 오케스트레이션** | Architect | 실행 시간 단축 | 높음 | **후순위** |
| 8 | **리뷰 피드백 해석** | Architect | 불필요한 에스컬레이션 방지 | 높음 | **후순위** |

1-5번이 현재 doom loop 문제의 핵심 원인을 모두 커버합니다.

---

## 7. 현재 코드 위치

| 파일 | 내용 |
|------|------|
| `src/lib/workflowOrchestration.ts:210-231` | Developer 프롬프트 구성 (approveAndStartImplementation) |
| `src/lib/workflowOrchestration.ts:274-290` | Reviewer 프롬프트 구성 (startReviewRT) |
| `src/lib/workflowOrchestration.ts:389-400` | Architect 프롬프트 구성 (requestPlanRevision) |
| `src/lib/workflowOrchestration.ts` (syncResultReport) | 결과 문서 생성 — rework 시 누적 오염 발생 지점 |
| `src/components/tunaflow/context-panel/DevProgressView.tsx:318-358` | Rework 프롬프트 구성 |
| `src/lib/schemas/reviewVerdict.ts` | Review verdict 스키마 (findings, recommendations) |
| `src/lib/planProposalParser.ts` | 마커 파싱 (plan-proposal, review-verdict, impl-complete) |

---

## 참고

- 발견 사례: tunaInsight 프로젝트에서 소넷 4.6이 Task 07 Q&A 엔진 fallback에서 4회 연속 실패
- 결과 문서 오염 사례: tunaInsight `docs/plans/ux-result.md` — 40줄 오래된 수치, 63줄 중복, 77줄 잘림
- 관련: `docs/ideas/reworkSubtaskTargetingIdea.md` (B안 — review verdict subtask 매핑)
