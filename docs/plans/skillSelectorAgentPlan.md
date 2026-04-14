---
title: Skill Selector Agent Plan
status: planned
created_at: 2026-04-14
priority: P2
---

# Skill Selector Agent

> 사용자 개입 없이 에이전트가 대화 맥락을 읽고 적절한 스킬을 자동 선택하는 메타에이전트

---

## 1. 현황 및 문제

현재 Layer C(프롬프트 키워드 매칭)는 하드코딩된 패턴으로 매 요청마다 스킬을 주입한다.

| 문제 | 내용 |
|------|------|
| 패턴 과매칭 | `"store"`, `"서버"`, `"test"` 같은 일반 단어에도 매칭 |
| Context mode 승격 | 스킬 3개 이상 → 자동으로 Full 모드 강제 발동 |
| 맥락 무관 주입 | 실제 작업 내용을 이해하지 않고 단어만 보고 결정 |
| 매 요청마다 반복 | 같은 대화에서 계속 재판단 — 비효율적 |

---

## 2. 목표

- 사용자가 스킬을 직접 고르지 않아도 적절한 스킬이 자동 선택됨
- 키워드 매칭이 아닌 실제 맥락 이해 기반 판단
- 결과를 세션 단위로만 유지 — 영구 변경 없음
- 사용자는 결과를 확인하고 해제할 수 있음

---

## 3. 설계

### 3.1 트리거 시점

**대화에서 첫 메시지를 전송하는 순간 백그라운드 실행.**

- 이미 `sessionSkills`가 설정된 대화라면 재실행하지 않음
- 대화 전환(다른 대화로 이동) 시 이전 sessionSkills 소멸
- 사용자가 수동으로 `activeSkills`를 변경한 경우 메타에이전트 결과 무시

```
첫 메시지 전송
  ↓ (비동기, 논블로킹)
SkillSelectorAgent 실행
  ↓
sessionSkills 세팅
  ↓
상태바 표시 갱신
```

### 3.2 에이전트 입력

```
[설치된 스킬 목록]
- anthropic-frontend-design: React/UI 컴포넌트 설계 규칙
- microsoft-zustand-store-ts: Zustand 스토어 패턴
- anthropic-webapp-testing: 웹앱 테스트 전략
- ...

[프로젝트 스택]
React, TypeScript, Zustand, Tailwind, Tauri, Rust

[최근 대화 요약 (최대 5턴)]
사용자: 리뷰 카드 UX가 이상한데 버튼 배치 수정해줘
어시스턴트: ReviewVerdictCard에서 doneConfirm 상태 추가...
사용자: 퀵팁이 세로로 있으니 채팅버블이 길어지는 문제...

[지시]
위 대화와 프로젝트 스택을 분석하여 지금 작업에 유용한 스킬을 최대 3개 선택하라.
반드시 JSON 배열로만 응답하라: ["skill-name-1", "skill-name-2"]
```

### 3.3 에이전트 실행

- `-p` 모드 Claude 호출 (가벼운 단발성 요청)
- 모델: 기본 claude (haiku급으로 충분)
- 타임아웃: 10초 — 초과 시 sessionSkills 없이 진행
- 응답 파싱: JSON 배열 추출, 설치된 스킬 목록과 교차 검증

### 3.4 저장 구조

```typescript
// assetSlice에 추가
sessionSkills: string[];          // 메타에이전트가 세팅, 대화 단위 유효
setSessionSkills: (skills: string[]) => void;
clearSessionSkills: () => void;
```

- `activeSkills`: 수동 선택, 영속 (localStorage)
- `sessionSkills`: 메타에이전트 선택, 휘발성 (메모리만)
- `workflowSkills`: 워크플로우 phase 기반, 영속

### 3.5 getEffectiveSkills 변경

```typescript
// 현재: activeSkills ∪ workflowSkills ∪ Layer C(키워드)
// 변경: activeSkills ∪ workflowSkills ∪ sessionSkills
// Layer C(matchPromptToSkills) 비활성화

getEffectiveSkills: (planPhase, prompt?) => {
  const { activeSkills, workflowSkills, sessionSkills, skills } = get();
  const phaseRefs = workflowSkills[phaseKey] ?? [];
  const expanded = expandSkillRefs([...activeSkills, ...phaseRefs, ...sessionSkills]);
  // procedural 스킬 자동 바인딩 유지
  // matchPromptToSkills 호출 제거
  return [...new Set(expanded)];
}
```

### 3.6 UX

**RuntimeStatusBar에 스킬 인디케이터 추가:**

```
[S:3]  ← sessionSkills 3개 활성 중 (클릭 시 목록 팝오버)
```

팝오버 내용:
```
자동 선택된 스킬 (이번 대화)
• anthropic-frontend-design  [x]
• microsoft-zustand-store-ts  [x]
• anthropic-webapp-testing  [x]
                    [전체 해제]
```

- `[x]` 클릭 → 해당 스킬만 sessionSkills에서 제거
- `[전체 해제]` → clearSessionSkills()
- 수동으로 activeSkills 변경 시 인디케이터 숨김

---

## 4. 구현 범위

### Phase 1 — 코어
- [ ] `assetSlice.ts`: `sessionSkills` 상태 + `setSessionSkills` + `clearSessionSkills`
- [ ] `assetSlice.ts`: `getEffectiveSkills()`에서 Layer C 제거, sessionSkills 합산
- [ ] `src/lib/skillSelectorAgent.ts`: 에이전트 실행 + 응답 파싱 함수
- [ ] `runtimeSlice.ts` / `threadSlice.ts`: 첫 메시지 전송 시 트리거 연결

### Phase 2 — UX
- [ ] `RuntimeStatusBar.tsx`: sessionSkills 인디케이터 (`[S:N]`)
- [ ] 팝오버: 선택된 스킬 목록 + 개별/전체 해제
- [ ] 대화 전환 시 sessionSkills 자동 초기화

### Phase 3 — 품질
- [ ] 10초 타임아웃 처리 (실패 시 graceful degradation)
- [ ] 설치되지 않은 스킬명 반환 시 필터링
- [ ] 에이전트 응답이 JSON이 아닐 때 fallback

---

## 5. 미결 사항

| 질문 | 옵션 |
|------|------|
| Layer C 완전 제거 vs 폴백 유지? | 메타에이전트 실패 시 Layer C 폴백 허용 고려 |
| 트리거를 첫 메시지로 할지 대화 전환 시로 할지? | 첫 메시지가 맥락이 더 풍부함 (현재 방향) |
| 모델 선택 | claude haiku급 고정 vs 사용자 설정 모델 사용 |
| 최대 선택 스킬 수 | 현재 3개 — 조정 가능 |

---

## 6. 관련 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/stores/slices/assetSlice.ts` | sessionSkills 상태, getEffectiveSkills Layer C 제거 |
| `src/stores/slices/types.ts` | AssetSlice 타입 추가 |
| `src/lib/skillSelectorAgent.ts` | 신규 — 에이전트 호출 + 파싱 |
| `src/stores/slices/runtimeSlice.ts` | 첫 메시지 트리거 연결 |
| `src/stores/slices/threadSlice.ts` | 브랜치 첫 메시지 트리거 연결 |
| `src/components/tunaflow/RuntimeStatusBar.tsx` | sessionSkills 인디케이터 |
| `src/lib/skillMappings.ts` | PROMPT_SKILL_MAPPINGS / matchPromptToSkills 비활성화 |
