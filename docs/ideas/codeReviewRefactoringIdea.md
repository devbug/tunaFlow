# 코드 리뷰 기반 리팩토링 계획

> Status: idea (P1)
> Created: 2026-04-04
> 출처: 시니어 엔지니어 코드 리뷰 (세션 10)

---

## 1. 즉시 수정 (완료)

| # | 수정 | 상태 |
|---|------|------|
| 1 | background `.catch(() => {})` → `console.error` (runtimeSlice:80-90) | ✅ 완료 |
| 3 | `failCount === 2` → `>= 2` (doom loop 감지 안정화) | ✅ 완료 |

---

## 2. 리팩토링 대상 (별도 세션)

### 2.1 [P1] chunk throttle → Zustand state 이동

**현재**: `pendingChunk`가 closure 변수 — 이론적 race condition
**가드**: `e.payload.conversationId !== selectedConversationId` 필터가 있어서 실질 위험 낮음
**수정**: pendingChunk를 store state로 이동하거나 useRef 패턴으로 전환

파일: `runtimeSlice.ts:171-176`

### 2.2 [P1] 스트리밍 로직 중복 제거

**현재**: runtimeSlice + threadSlice에 거의 동일한 스트리밍 코드 (listener 등록, chunk throttle, cleanup)
**수정**: `createStreamingListener()` 공유 함수 추출

파일: `runtimeSlice.ts`, `threadSlice.ts`

### 2.3 [P1] BranchThreadPanel 분할

**현재**: 12개 useState, 11개 책임, 5+ async callback — god component
**수정**:
- `useBranchThread()` 커스텀 훅 — 상태 관리
- `BranchHeader`, `BranchMessages`, `BranchInput` 분리
- async 로직을 훅으로 이동

파일: `BranchThreadPanel.tsx`

### 2.4 [P2] section_builders.rs 분할

**현재**: 677줄, DB 쿼리 + 포맷팅 + 검색이 혼재
**수정**:
- `plan_sections.rs` — build_plan_section, build_findings_section
- `context_sections.rs` — build_context_summary, build_cross_session_section
- `tool_sections.rs` — build_skills_section, build_crg_section, build_chops_section

파일: `section_builders.rs`

### 2.5 [P2] assemble_prompt() 결합도 개선

**현재**: `included_sections`와 `sections` 벡터의 인덱스 1:1 대응 가정
**수정**: `PromptSection { name: String, content: String }` 구조체로 통합
**실질 위험**: 매우 낮음 (push 직후 push 패턴이라 off-by-one 거의 불가)

파일: `prompt_assembly.rs:37-443`

### 2.6 [P2] linkedPlan async race

**현재**: BranchThreadPanel에서 빠른 브랜치 전환 시 이전 브랜치의 plan 표시 가능
**수정**: `if (get().threadBranchId !== branchId) return` 가드 추가 (projectSlice rawq 패턴)

파일: `BranchThreadPanel.tsx:46-49`

---

## 3. DB 의존 섹션 빌더 테스트

### 필요 테스트

| 함수 | 테스트 내용 |
|------|-----------|
| `build_plan_section` | active 플랜 있을 때/없을 때, subtask 상태별 아이콘 |
| `build_findings_section` | findings 있을 때/없을 때 |
| `build_thread_inheritance_section` | 부모 메시지 존재/부재 |
| `processReviewVerdict` | pass/fail/conditional + doom loop 카운트 |

### 테스트 방식

Rust: in-memory SQLite (`rusqlite::Connection::open_in_memory()`) + 스키마 적용 + 테스트 데이터 삽입
TypeScript: vitest mock (`vi.mock("@tauri-apps/api/core")`)

---

## 4. 잔여 `.catch(() => {})` 정리

세션 6에서 대부분 `console.error`로 전환했지만 일부 남아있음.

```bash
# 현재 남은 silent catch 찾기
grep -rn "\.catch(() => {})" src/ --include="*.ts" --include="*.tsx"
```

모두 `console.error` 또는 `console.warn`으로 교체 필요.

---

## 5. 우선순위 정리

| 순서 | 항목 | 규모 |
|------|------|------|
| **1** | 스트리밍 로직 중복 제거 (2.2) | 중간 — 공유 함수 추출 |
| **2** | BranchThreadPanel 분할 (2.3) | 중간 — 훅 + 컴포넌트 분리 |
| **3** | DB 섹션 빌더 테스트 (3) | 중간 — Rust in-memory 테스트 |
| **4** | chunk throttle 이동 (2.1) | 낮음 — 실질 위험 낮음 |
| **5** | section_builders 분할 (2.4) | 낮음 — 기능에 영향 없음 |
| **6** | assemble_prompt 결합도 (2.5) | 낮음 — 위험 매우 낮음 |
| **7** | linkedPlan race (2.6) | 낮음 — 가드 1줄 추가 |

---

## 참고

- 세션 6: silent error 표면화 (12개 파일 정리)
- 세션 7: Virtuoso + model race condition 해결
- 세션 8-9: 이벤트 격리 + 스트리밍 race condition 근본 해결
- 에러 표시 정책: `docs/ideas/` → `feedback_error_visibility.md` (memory)
