# Artifacts 탭 설계 검토 + 개선 방향

> Status: idea
> Created: 2026-04-03

---

## 1. 현재 구현 상태

### DB 스키마 (v1 + v4)

```sql
CREATE TABLE artifacts (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT,
    branch_id       TEXT,
    type            TEXT NOT NULL,
    title           TEXT NOT NULL,
    content         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft',
    subtask_id      TEXT,              -- v4 추가, ON DELETE SET NULL
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);
```

### 타입 체계

| 카테고리 | 타입 | 용도 |
|---------|------|------|
| 일반 | `note` | 자유 형식 메모 |
| 일반 | `code` | 코드 스니펫 |
| 일반 | `spec` | 스펙/요구사항 |
| 일반 | `plan` | 계획 문서 |
| 하네스 | `task-brief` | 작업 지시서 |
| 하네스 | `review-findings` | 리뷰 결과 |
| 하네스 | `architect-decision` | 아키텍처 결정 |
| 하네스 | `test-report` | 테스트 보고서 |

### ContextPack 주입

- 위치: Layer 2 (Structured task memory — Plan + Findings + **Artifacts**)
- 모드: Standard 이상에서 포함
- 쿼리: 최근 3개, status 무관, 120자 preview
- 예산: 최대 2,000자 (`MAX_ARTIFACTS_SECTION`)

### 등록 방식

- **수동만**: SaveArtifactDialog (메시지 hover toolbar → "Artifact로 저장")
- ArtifactsPanel 인라인 폼
- 자동 승격 없음

---

## 2. 발견된 문제

### 2.1 [즉시 수정] rejected artifact가 ContextPack에 주입된다

현재 `build_artifact_handoff_section()`은 status 구분 없이 최근 3개를 주입.

```sql
-- 현재
SELECT title, type, status, content FROM artifacts
WHERE conversation_id = ?1 ORDER BY updated_at DESC LIMIT 3

-- 문제: rejected도 포함됨
-- 사용자가 "이건 틀렸어"라고 거부한 내용을 에이전트가 참고하게 됨
```

**수정**: `WHERE status != 'rejected'` 추가. rejected artifact는 에이전트에게 전달하지 않음.

또는 더 가치 있는 접근: rejected를 **"이전에 거부된 접근법"** 별도 섹션으로 주입하면 에이전트가 같은 실수를 반복하지 않음. 다만 이건 복잡도가 올라가므로 일단 제외가 현실적.

### 2.2 [즉시 수정] 정렬이 recency만으로 되어있다

approved architect-decision이 최근 note 3개에 밀려서 ContextPack에서 빠짐.

```sql
-- 현재
ORDER BY updated_at DESC LIMIT 3

-- 개선: approved + harness 타입 우선
ORDER BY
  CASE status WHEN 'approved' THEN 0 ELSE 1 END,
  CASE type WHEN 'architect-decision' THEN 0
            WHEN 'review-findings' THEN 1
            WHEN 'task-brief' THEN 2
            WHEN 'test-report' THEN 3
            ELSE 4 END,
  updated_at DESC
LIMIT 3
```

**효과**: approved 하네스 artifact가 항상 우선. 일반 note는 하네스가 3개 미만일 때만 포함.

### 2.3 [참고] 프로젝트 귀속 컬럼 부재

artifact 테이블에 `project_key`가 없다. `conversation_id`로 간접 연결. 현재는 모든 artifact가 conversation에 속하므로 문제 없지만, 글로벌 artifact(특정 대화에 속하지 않는)를 만들려면 `project_key` 추가 필요.

**판단**: 지금은 불필요. 글로벌 artifact 필요가 확인될 때 마이그레이션.

### 2.4 [참고] 중복 저장 감지 없음

수동 승격이라 같은 메시지를 여러 번 저장 가능. 현재 규모에서 문제 아님. 10개 트리거 분석 시 중복 감지 추가.

### 2.5 [참고] subtask 연결 UI 미노출

`subtask_id` 컬럼 + `link_artifact_to_subtask()` 커맨드는 있지만 UI에서 연결 메커니즘이 노출되지 않음. PlanCard에서 subtask별 artifact를 보여주려면 연결 UI가 필요.

---

## 3. 역할 정의와 경계

### Artifacts ≠ ContextPack

```
Artifact = 사용자가 "이건 중요하다"고 판단한 것 (명시적 승격)
ContextPack = 에이전트에게 전달되는 모든 것 (자동 조립)

관계: Artifact ⊂ ContextPack 재료
```

| 콘텐츠 | Artifact인가 | ContextPack 재료인가 | 관할 |
|--------|-------------|-------------------|------|
| 설계 문서 (사용자 저장) | ✅ | ✅ artifact 섹션 | Artifacts 탭 |
| compressed memory | ❌ | ✅ memory 섹션 | 자동 (시스템) |
| rawq 검색 결과 | ❌ | ✅ rawq 섹션 | 자동 (시스템) |
| plan 문서 | ❌ | ✅ plan 섹션 | Plan 탭 |
| review findings (저장 시) | ✅ | ✅ artifact 섹션 | Artifacts 탭 |
| handoff 문서 (저장 시) | ✅ | ✅ artifact 섹션 | Artifacts 탭 |
| 에이전트 분석 결과 | ✅ (자동 저장) | ✅ artifact 섹션 | Artifacts 탭 |
| cross-session 데이터 | ❌ | ✅ cross-session 섹션 | 자동 (시스템) |

**원칙**: Artifact에는 **사용자 판단이 개입된 것** + **에이전트 분석 결과(사용자가 트리거)**만. 자동 생성 데이터는 각자의 ContextPack 섹션에서 관리.

### Artifacts 탭의 위치

```
메인 탭 (작업 플로우):      Plan | Review | Test
오른쪽 사이드바 (참조):     Artifacts / Trace / Files
```

Artifacts는 **참조 허브**. 작업 흐름에 직접 개입하지 않고, 에이전트와 사용자 모두에게 "과거의 중요 결정"을 제공.

---

## 4. 수동 승격 UI 개선

### 4.1 현재 트리거

- 메시지 hover toolbar → "Artifact로 저장" → SaveArtifactDialog
- ArtifactsPanel 인라인 폼

### 4.2 추가할 트리거 (자동 제안)

| 시점 | 제안 내용 | 구현 |
|------|----------|------|
| Plan done (phase=done) | "이 Plan의 결정사항을 artifact로 저장할까요?" | 토스트 + 원클릭 저장 |
| Review pass | "리뷰 findings를 artifact로 저장할까요?" | 토스트 + 원클릭 저장 |
| architect-decision 마커 감지 | 에이전트가 아키텍처 결정을 내렸을 때 | 메시지 하단 제안 배너 |

**핵심**: 자동 **저장이 아니라 제안**. 사용자가 거부할 수 있어야 함. 에이전트가 만든 모든 것이 artifact가 되면 노이즈.

### 4.3 저장 시 메타데이터

현재 필드로 충분하다:

| 필드 | 현재 | 추가 필요? | 시기 |
|------|------|----------|------|
| title | 자동 추출 (첫 줄) + 편집 가능 | 충분 | — |
| type | 드롭다운 선택 | 충분. context 기반 자동 선택 추가 가능 | 다음 |
| content | 원문 | 충분 | — |
| status | draft 기본 | 충분 | — |
| tags | **없음** | 10개 분석 시 필요 | 나중 |
| summary | **없음** | ContextPack 주입 품질이 120자 자동 생성으로 부족할 때 | 나중 |

**type 자동 선택**: 저장 context에 따라 기본값 제안

```
Plan 탭에서 저장 → type 기본값: "architect-decision"
Review 탭에서 저장 → type 기본값: "review-findings"
Dev Branch에서 저장 → type 기본값: "task-brief"
일반 채팅에서 저장 → type 기본값: "note"
```

### 4.4 저장 위치

**프로젝트별** (conversation_id 귀속). 글로벌 artifact는 당분간 불필요.

---

## 5. 10개 트리거 분석 기능

### 5.1 트리거 흐름

```
[assetSlice] artifacts.length >= 10
  ↓
[토스트] "Artifacts가 10개 모였습니다. 패턴 분석을 돌려볼까요?"
  ↓ 사용자 승인
[분석 프롬프트 구성]
  - artifact 전문(content 전체)을 프롬프트에 포함
  - ContextPack의 120자 preview로는 분석 불가능 → 전용 프롬프트
  ↓
[에이전트 실행] 현재 선택된 엔진으로 분석
  ↓
[결과 저장] type="analysis-report" artifact로 자동 저장
  ↓
[순환] 분석 결과도 artifact → 다음 분석에 포함
```

### 5.2 분석 프롬프트 설계

```markdown
## Artifacts 패턴 분석

아래는 사용자가 저장한 {N}개의 Artifacts입니다.

{artifact 전문 목록}

### 분석 요청
1. 반복되는 결정 패턴 (예: "항상 trait 추상화를 선호", "테스트를 마지막에 추가")
2. 모순되는 결정 (예: "A에서는 X를 선호했지만 B에서는 반대")
3. 누락된 영역 (예: "보안 관련 결정이 없음", "성능 기준 미정의")
4. 사용자 성향 요약 (50자 이내)
5. 향후 에이전트 행동 제안 (사용자 성향에 맞춘)
```

### 5.3 어느 레이어에 붙이는가

| 레이어 | 역할 |
|--------|------|
| **프론트엔드 (assetSlice)** | 트리거 감지 (count >= 10), 토스트 표시, 사용자 승인 |
| **프론트엔드 (analysisWorkflow.ts)** | 분석 프롬프트 구성, 에이전트 호출, 결과 저장 |
| **백엔드** | 기존 send 경로 사용. 별도 커맨드 불필요 |
| **sqlite-vec / FTS5** | 직접 관여 안 함. 분석은 LLM이 수행 |

FTS5/vector는 "이전 대화에서 유사한 패턴이 있었는지"를 분석 프롬프트에 추가할 때만 간접 활용.

### 5.4 분석 에이전트 모델

현재 선택된 엔진 사용. 분석은 빈번하지 않으므로(10개 모일 때마다) 별도 모델 설정은 과도.

### 5.5 순환 구조

```
사용자 작업 → Artifact 저장 (수동)
                ↓
             10개 도달 → 분석
                ↓
             분석 결과 → Artifact 저장 (자동)
                ↓
             ContextPack에 분석 결과 포함
                ↓
             에이전트가 사용자 성향 반영
                ↓
             사용자 작업 (에이전트 품질 향상)
                ↓
             새 Artifact 저장 ... (순환)
```

---

## 6. 구현 우선순위

### 즉시 (코드 수정 5분)

| 항목 | 파일 | 변경 |
|------|------|------|
| rejected 제외 | `section_builders.rs` | WHERE 절에 `AND status != 'rejected'` |
| approved + harness 우선 정렬 | `section_builders.rs` | ORDER BY 절 변경 (3줄) |

### 다음 (기능 구현)

| 항목 | 규모 | 설명 |
|------|------|------|
| 워크플로우 완료 시 artifact 제안 | ~50줄 FE | Plan done / Review pass 시 토스트 |
| type 자동 선택 | ~20줄 FE | 저장 context에 따라 기본값 |
| subtask 연결 UI | ~30줄 FE | PlanCard에서 artifact 연결 |

### 나중 (장기 비전)

| 항목 | 트리거 조건 |
|------|-----------|
| 10개 분석 기능 | artifact 수 >= 10 |
| tags 컬럼 | 분석 기능 구현 시 (마이그레이션) |
| summary 컬럼 | ContextPack 120자 자동 생성이 부족할 때 |
| 자동 승격 | 워크플로우 안정화 + 승격 패턴 확립 후 |
| project_key 컬럼 | 글로벌 artifact 필요 시 |

---

## 7. 장기 비전과 현재의 간극

| 비전 | 현재 상태 | 간극 |
|------|----------|------|
| 인간이 빨간펜 → Artifacts 쌓임 | ✅ 수동 승격 동작 | 워크플로우 완료 시 자동 제안 없음 |
| 10개 기준 분석 알림 | ❌ 미구현 | 트리거 + 프롬프트 + 저장 흐름 필요 |
| 에이전트가 패턴 분석 | ❌ 미구현 | 분석 프롬프트 설계 필요 |
| 분석 결과도 Artifacts에 저장 | 설계만 | type="analysis-report" 정의만 |
| 개인화된 에이전트 행동 | ❌ 미구현 | 분석 결과 → ContextPack 주입 경로 필요 |

**현재 기반은 건강하다.** 수동 승격, DB 스키마, ContextPack 주입, 하네스 타입 체계 모두 준비됨. 2개 즉시 수정(rejected 제외, 정렬 개선)을 하고, 워크플로우 실사용 검증을 계속하면서 10개 분석은 자연스럽게 도달할 때 구현하면 된다.

---

## 참고

- DB 스키마: `src-tauri/src/db/schema.rs` (v1, v4)
- Artifact CRUD: `src-tauri/src/commands/artifacts.rs`
- ContextPack 주입: `src-tauri/src/commands/agents_helpers/context_pack/section_builders.rs`
- 예산: `src-tauri/src/guardrail.rs` (`MAX_ARTIFACTS_SECTION = 2_000`)
- ArtifactsPanel: `src/components/tunaflow/context-panel/ArtifactsPanel.tsx` (394줄)
- SaveArtifactDialog: `src/components/tunaflow/SaveArtifactDialog.tsx`
- Store: `src/stores/slices/assetSlice.ts`
- 타입: `src/types/index.ts` (Artifact interface)
