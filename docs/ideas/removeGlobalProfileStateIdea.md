# 전역 selectedProfileId 제거 — 대화별 상태 관리 전환

> Status: idea (P0 — 다수 버그의 근본 원인)
> Created: 2026-04-04
> 관련 버그: 리뷰 브랜치 후 메인 채팅에 Reviewer 프로필 잔존, 엔진 변경 시 model race condition, 페르소나 리셋

---

## 1. 문제

### 현재 구조

```
전역: selectedProfileId (Zustand store)
       ↓ useEffect 트리거
모든 NewMessageInput 인스턴스 (메인 + 드로어)
       ↓ 엔진/모델/페르소나 적용

대화별: _convEngineMap[conversationId] → { profileId, engine, model }
       ↓ conversation 전환 시 restore
```

**두 가지 상태 소스가 충돌**:
- `selectedProfileId` (전역) — 모든 패널에 동시 전파
- `_convEngineMap` (대화별) — conversation 전환 시에만 적용

### 발생한 버그들

| 버그 | 원인 | 세션 |
|------|------|------|
| **리뷰 후 Reviewer 프로필 잔존** | DevProgressView가 `selectProfile(reviewerId)` → 전역 변경 → 메인 패널에 전파 | 10 |
| **엔진 변경 시 model=undefined** | useEffect 4개가 전역 profileId 변경에 동시 반응 → race condition | 7 |
| **페르소나 리셋** | 엔진 변경 → 프로필 불일치 → persona 자동 초기화 | 4 |
| **model race condition** | profile-effect + restore-effect + engine-effect 경쟁 → resolveModel() 우회로 해결 | 7 |

**모두 전역 `selectedProfileId`가 여러 컴포넌트에 동시 전파되면서 발생**.

---

## 2. 목표 상태

```
전역: selectedProfileId 제거

대화별: _convEngineMap[conversationId] → { profileId, engine, model }
       ↓ 이것만이 유일한 상태 소스 (SSOT)

NewMessageInput:
  - mount/conversation 전환 시 → _convEngineMap에서 읽기
  - 프로필 선택 시 → _convEngineMap에 쓰기 (해당 대화만)
  - 다른 대화에 영향 없음
```

---

## 3. 영향 범위

### 제거 대상: `selectedProfileId`

| 파일 | 사용 | 변경 |
|------|------|------|
| `src/stores/slices/types.ts` | `selectedProfileId: string \| null` in ChatState | 제거 |
| `src/stores/slices/assetSlice.ts` | `selectProfile()` 메서드 — `set({ selectedProfileId })` | 제거 또는 대화 스코프로 변환 |
| `src/stores/slices/assetSlice.ts` | `loadProfiles()` — `lastProfileId` 복원 | 불필요 |
| `src/components/tunaflow/NewMessageInput.tsx` | profile-effect (line 53-78) — `selectedProfileId` 의존 | `_convEngineMap` 기반으로 교체 |
| `src/components/tunaflow/NewMessageInput.tsx` | `handleProfileSelect()` — `selectProfile()` 호출 | `saveConversationEngine()` 직접 호출로 교체 |
| `src/components/tunaflow/input/ProfileSelector.tsx` | `selectedProfileId` 표시 | 현재 대화의 profileId로 교체 |
| `src/components/tunaflow/context-panel/DevProgressView.tsx` | Reviewer 프로필 선택 시 `selectProfile()` 호출 | shadow conv에만 저장 |
| `src/lib/appStore.ts` | `lastProfileId` 키 | 제거 |

### 유지: `_convEngineMap`

이미 대화별 상태를 관리하고 있으므로 확장만 필요:
- 현재: conversation 전환 시 restore
- 추가: 프로필 선택 시 해당 대화에만 저장

### 유지: `agentProfiles` (프로필 목록)

프로필 정의 자체는 전역 — 어떤 프로필이 "사용 가능한지"는 전역이 맞음.
"어떤 프로필이 현재 선택됐는지"만 대화별로 전환.

---

## 4. 리팩토링 단계

### Phase 1: NewMessageInput 분리 (안전)

1. `effectiveProfileId` 계산을 `_convEngineMap[effectiveConv]?.profileId`에서 직접 읽기
2. `selectedProfileId` useEffect 의존성 제거
3. `handleProfileSelect()`가 `saveConversationEngine()`만 호출 (`selectProfile()` 제거)
4. ProfileSelector에 `effectiveProfileId` 전달

**검증**: 메인 채팅에서 프로필 변경 → 드로어 프로필 영향 없음 확인

### Phase 2: selectProfile() 제거

1. `selectProfile()` 메서드 제거
2. `selectedProfileId` 상태 제거
3. `lastProfileId` appStore 키 제거
4. DevProgressView/SubtaskReviewView에서 shadow conv에만 저장하도록 정리

**검증**: 프로필 전환, 대화 전환, 브랜치 열기/닫기 전체 시나리오 확인

### Phase 3: resolveModel() 단순화

전역 race condition이 사라지면 `resolveModel()` 우회 로직이 불필요해질 수 있음.
실제 동작 확인 후 단순화.

---

## 5. 위험 요소

| 위험 | 대응 |
|------|------|
| **새 대화에서 기본 프로필 결정** | 첫 대화 생성 시 `_convEngineMap`에 기본 프로필(profiles[0]) 저장 — `selectProject()`에서 이미 하고 있음 |
| **드로어와 메인이 같은 프로필을 보여야 하는 경우** | 없음 — 드로어는 thread/branch의 독립 컨텍스트 |
| **ProfileSelector가 "현재 선택된 프로필"을 어디서 읽는지** | `_convEngineMap[effectiveConv]?.profileId` → 빈 값이면 profiles[0] fallback |
| **RT 참가자별 프로필** | RT는 `rt_config.participants`에서 엔진/모델 결정 — `selectedProfileId`와 무관 (이미 독립) |

---

## 6. 현재 코드 위치

| 파일 | 줄 | 내용 |
|------|---|------|
| `NewMessageInput.tsx:53-78` | profile-effect — `selectedProfileId` 의존 (제거 대상) |
| `NewMessageInput.tsx:80-106` | restore-effect — `_convEngineMap` 기반 (유지) |
| `NewMessageInput.tsx:127-142` | `handleProfileSelect()` — `selectProfile()` 호출 (교체) |
| `assetSlice.ts:113-116` | `selectProfile()` — 전역 상태 변경 (제거) |
| `assetSlice.ts:88-106` | `loadProfiles()` — `lastProfileId` 복원 (제거) |
| `types.ts:109` | `selectedProfileId: string \| null` (제거) |
| `DevProgressView.tsx:167` | Reviewer 프로필 → shadow conv 저장 (유지, selectProfile 호출 제거) |

---

## 참고

- model race condition 해결: 세션 7 memory (`feedback_model_race.md`)
- 페르소나 리셋: 세션 4 — 엔진 변경 시 프로필 불일치 → persona 자동 초기화
- 4개 useEffect 경쟁: `resolveModel()`로 우회 해결했지만 근본 원인은 전역 상태
