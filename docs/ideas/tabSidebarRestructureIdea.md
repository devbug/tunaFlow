# CenterPanel 탭 + 사이드바 재구성

> Status: idea
> Created: 2026-04-13
> 동기: 실사용에서 Artifacts/Results 탭을 잘 안 보게 됨. Plan 탭 이름이 실제 내용(워크플로우 전체)과 안 맞음.

---

## 1. 현재 문제

### 1.1 CenterPanel 탭 (5개)

```
현재: [Chat] [Plan] [Artifacts] [Results] [Insight]
```

| 탭 | 문제 |
|---|------|
| **Plan** | 이름은 "Plan"인데 서브탭에 Dev/Review/Decision까지 포함. 실제로는 **워크플로우 전체 뷰**인데 이름이 범위를 좁게 느끼게 함 |
| **Artifacts** | 사용 빈도 낮음. 수동 승격한 산출물 보관함인데 5개 탭 중 하나를 차지 |
| **Results** | "뭐의 결과?"가 불명확. 열어봐야 아는 탭 |
| **Insight** | 프로젝트 전체 분석. 탭은 맞지만 일상적으로 자주 안 열림 |

### 1.2 사이드바 (5섹션, 동일 레벨)

```
현재:
  ▸ Branches (3)
  ▸ Roundtables (1)
  ▸ Scratchpad (2)
  ▸ Docs
  ▸ Archive
```

성격이 다른 5개가 같은 레벨에 있음:
- Branches/RT/Scratchpad → **작업 중인 것** (자주 전환)
- Docs/Archive → **참조하는 것** (가끔 확인)

---

## 2. 재구성 제안

### 2.1 CenterPanel: 5탭 → 3탭

```
변경: [Chat] [Workflow] [Insight]
```

| 변경 | 내용 | 이유 |
|------|------|------|
| **Plan → Workflow** | 이름 변경 + 서브탭 유지 (Plan/Subtask/Dev/Review/Done) | 실제 내용(워크플로우 전체)을 이름이 반영 |
| **Results 탭 제거** | Workflow의 Review/Done 서브탭에서 결과 확인 | 별도 탭일 필요 없음. 워크플로우 흐름 안에서 보는 게 자연스러움 |
| **Artifacts → 사이드바 이동** | 하단 참조 영역 탭으로 | 사용 빈도 낮음. 사이드바에서 필요할 때 참조 |
| **Insight 유지** | 프로젝트 전체 분석은 별도 공간 | 탭은 맞지만, 내용 개선은 별도 논의 |

### 2.2 Workflow 서브탭

```
현재 (Plan 탭 서브탭):
  [All] [Plan] [Subtask] [Approved] [Dev] [Review] [Decision]

변경 (Workflow 탭 서브탭):
  [All] [Plan] [Subtask] [Dev] [Review] [Done]
```

변경:
- "Approved" 제거 — Plan과 Dev 사이의 전환 상태일 뿐, 별도 뷰 불필요
- "Decision" → "Done" — 더 직관적
- 6개 → 6개 (All 포함)

### 2.3 사이드바: 2단 분리

```
┌─ Sidebar ─────────────────┐
│ [프로젝트 드롭다운 ▾]      │
│                           │
│ ── 작업 영역 (상단) ──     │
│ ▸ Branches (3)            │
│ ▸ Roundtables (1)    [+]  │
│ ▸ Scratchpad (2)          │
│                           │
│ ═══ 리사이즈 핸들 ═══     │
│                           │
│ ── 참조 영역 (하단 탭) ──  │
│ [Docs] [Artifacts] [Archive]│
│ ┌───────────────────────┐ │
│ │ (선택된 탭의 컨텐츠)    │ │
│ │                       │ │
│ └───────────────────────┘ │
└───────────────────────────┘
```

**상단 (작업 중 — 자주 전환)**:
- Branches — 활성 작업 Branch
- Roundtables — 활성 RT 토론
- Scratchpad — 메모 대화
- 각각 CollapsibleSection 유지 (현재와 동일 패턴)

**하단 (참조 — 가끔 확인)**:
- [Docs] — 프로젝트 문서 트리
- [Artifacts] — CenterPanel에서 이동. 산출물 보관함
- [Archive] — 완료/아카이브된 Branch
- 탭 전환 (한 번에 하나만 표시)

**상단/하단 비율**: 리사이즈 핸들로 조절 가능 (현재 섹션 간 리사이즈와 동일 패턴)

---

## 3. Before / After

```
Before:
┌──────────┬────────────────────────────────────────┐
│ Sidebar  │ [Chat] [Plan] [Artifacts] [Results] [Insight] │
│          │                                        │
│ Branches │  Plan 서브탭:                           │
│ RTs      │  [All][Plan][Subtask][Approved]         │
│ Scratch  │  [Dev][Review][Decision]                │
│ Docs     │                                        │
│ Archive  │                                        │
└──────────┴────────────────────────────────────────┘

After:
┌──────────┬────────────────────────────────────────┐
│ 작업영역  │ [Chat] [Workflow] [Insight]             │
│ Branches │                                        │
│ RTs      │  Workflow 서브탭:                       │
│ Scratch  │  [All][Plan][Subtask][Dev][Review][Done]│
│──────────│                                        │
│ 참조영역  │                                        │
│[Doc][Art]│                                        │
│[Archive] │                                        │
└──────────┴────────────────────────────────────────┘
```

---

## 4. Results 탭 내용의 이동

현재 Results 탭(ReviewPanel)에 있는 것:

| 내용 | 이동 위치 |
|------|----------|
| Review verdict 카드 (PASS/FAIL) | Workflow > Review 서브탭 |
| Architect decision 카드 | Workflow > Plan 서브탭 |
| Findings 목록 | Workflow > Review 서브탭 |
| Review 모달 (상세) | Workflow > Review 서브탭에서 열기 |

→ Results 탭의 **모든 내용이 Workflow 서브탭에 자연스럽게 매핑**됨.

---

## 5. 모바일과의 일관성

```
PC (3탭):
  [Chat] [Workflow] [Insight]

모바일 (3탭):
  [💬 Chat] [📋 Status] [≡ Menu]
```

PC의 3탭과 모바일의 3탭이 자연스럽게 매핑:
- Chat ↔ Chat
- Workflow ↔ Status (Plan 승인/Branch/RT 목록)
- Insight ↔ Menu에서 접근 (모바일에서 Insight는 자주 안 봄)

---

## 6. 구현 범위

### Phase 1: 탭 이름 변경 + Results 통합

```
- CenterPanel.tsx: TABS 배열에서 "plan" → "workflow", "review" 제거
- Plan 관련 컴포넌트 이름/라벨 변경 (Plan 탭 → Workflow 탭)
- ReviewPanel 내용을 Workflow의 Review/Done 서브탭으로 이동
- "Decision" → "Done" 서브탭 이름 변경
```

### Phase 2: Artifacts → 사이드바 이동

```
- CenterPanel에서 Artifacts 탭 제거
- Sidebar 하단 참조 영역에 탭 UI 추가
- ArtifactsPanel을 사이드바 하단 탭으로 렌더링
```

### Phase 3: 사이드바 2단 분리

```
- 상단 작업 영역: Branches/RT/Scratchpad (CollapsibleSection 유지)
- 하단 참조 영역: [Docs] [Artifacts] [Archive] 탭 전환
- 리사이즈 핸들 (상단/하단 비율 조절)
```

---

## 7. 리스크

| 리스크 | 대응 |
|--------|------|
| **Results 탭 사용자가 있으면?** | Workflow > Review 서브탭으로 자연스럽게 리다이렉트 |
| **Artifacts 사이드바 이동 시 화면 크기** | 사이드바 하단 탭이 좁으면 Artifact 내용 보기 어려움 → 클릭 시 모달 또는 드로어 |
| **cmdk 명령어 변경** | "Plan" 탭 전환 명령을 "Workflow"로 업데이트 |
| **문서/코드 내 "Plan 탭" 참조** | grep으로 일괄 변경 |
| **Phase별 자동 탭 전환 로직** | `PHASE_TO_STAGE` 매핑에서 "review" 탭 → Workflow 탭 + subtab "review"로 2단계 전환 처리 필요 |
| **`reviewCount` badge** | `tab.id === "review"` 참조 제거 후 Workflow 탭 badge로 통합 |
| ~~사이드바 리사이즈 버그~~ | ~~Phase 2 전 해결 필요~~ → **해결 완료** (s32), Phase 2 진행 가능 |

---

## 8. 장기 방향 (구현 범위 외)

### 8.1 Branch/RT 관계 그래프

Branches/Roundtables가 많아지면 목록 탐색 한계. **Obsidian 스타일 관계 그래프** 뷰 추가 예정:
- 사이드바 Branches 섹션에 "그래프 뷰" 진입점 버튼
- 대화 간 연결(origin → branch → adopt) 관계를 노드/엣지로 시각화
- 현재 설계에서 사이드바 상단 작업 영역은 목록 뷰 유지, 그래프 뷰는 별도 전환

### 8.2 Archive/Artifacts → 지식창고

Archive와 Artifacts는 단순 보관함이 아니라 **사용자 성향 + 프로젝트 진행 방향 분석의 원천 데이터**:
- 에이전트가 누적된 결정 이력/산출물을 분석 → 사용자 프로파일 + 프로젝트 DNA 추출
- 사이드바 하단 탭의 장기 방향: 단순 열람 → 에이전트 분석 기반 추천/요약
- Insight 탭과 연계 (Archive 분석 결과를 Insight에 반영)
- 현재 doc_graph RAG 설계(`docs/ideas/onboardingMetaAgentIdea.md` §8)와 같은 방향선상

→ **현재 UI 설계 시 정보 구조를 분석 친화적으로 유지할 것** (메타데이터 보존, 타입 분류 명확화)

---

## 참고

- 현재 CenterPanel: `src/components/tunaflow/CenterPanel.tsx` (TABS 배열)
- Workflow 서브탭: `src/components/tunaflow/context-panel/HarnessSummary.tsx` (WorkflowStageId)
- ReviewPanel: `src/components/tunaflow/context-panel/ReviewPanel.tsx`
- ArtifactsPanel: `src/components/tunaflow/context-panel/ArtifactsPanel.tsx`
- 사이드바: `src/components/tunaflow/Sidebar.tsx` (5섹션)
- 모바일 UI: `docs/ideas/mobileArchitectureIdea.md` (3탭 매핑)
- Branch/RT 그래프: `docs/ideas/projectMetaAgentIdea.md` (관련 설계)
- 지식창고 방향: `docs/ideas/onboardingMetaAgentIdea.md` §8 (Auto Fix + 메타에이전트)
