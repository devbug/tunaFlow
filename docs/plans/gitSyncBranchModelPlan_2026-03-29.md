# tunaFlow Branch ↔ Git 동기화 모델 계획

- 작성자: Claude Opus 4.6
- 작성 시각: 2026-03-29
- 상태: 초안 (설계 방향 확정, 구현 미착수)

## 목적

tunaFlow의 branch/adopt 모델을 Git의 branch/merge 모델과 동기화 가능하도록 설계한다.
최종 목표: **코드 변경(git)과 대화 이력(tunaFlow)이 동일한 branch 구조로 관리**되는 것.

## 핵심 원칙

### Git과의 개념 매핑

| Git | tunaFlow | 비고 |
|---|---|---|
| commit | message | 대화의 각 턴 |
| branch | branch | 분기 포인터 |
| merge | adopt | 결과를 부모에 통합 |
| merge commit | adopt 요약 메시지 | 통합 시점 마커 |
| `git branch -d` | delete_branch (adopted) | 포인터만 삭제, 이력 보존 |
| `git branch -D` | delete_branch (active) | 전체 삭제 |
| working tree | shadow conversation | branch의 작업 공간 |

### 현재 구현 상태 (2026-03-29)

1. **Branch 생성**: `create_branch` → shadow conversation 생성 → 메시지 독립 저장 ✅
2. **Adopt = Merge**: 요약만 부모에 삽입 (전체 메시지 복사 아님) ⚠️
3. **Branch 삭제**:
   - Active: 전체 삭제 (messages + shadow conv + branch row) ✅
   - Adopted/Archived: **포인터만 삭제, shadow conv + messages 보존** ✅ (git branch -d 방식)
4. **parentBranchId**: depth 추적 가능 ✅
5. **Branch status**: active → adopted / archived ✅

## Adopt 전략: 요약 vs 전체 복사

### 현재: 요약 방식

```
부모:
  msg1 → msg2 → [adopt summary: "b1.1 결과 요약..."]
```

- 장점: 부모 대화가 깔끔, 컨텍스트 비용 낮음
- 단점: 전체 맥락 손실, branch 삭제 시 원본 접근 불가 (→ 해결됨: shadow conv 보존)

### 미래: 전체 메시지 복사 (git merge 방식)

```
부모:
  msg1 → msg2 → [b1.1 msg3] → [b1.1 msg4] → ... → [merge marker]
```

- 장점: 부모 하나에서 전체 이력 열람, git log와 동일 구조
- 단점: 대화가 길어짐, RT merge 시 복잡, 컨텍스트 비용 증가

### 권장 방향: 이중 구조

**UI에서는 요약 표시, DB에서는 전체 보존, Git에서는 전체 이력**

1. tunaFlow UI: adopt 시 요약 메시지만 부모에 표시 (현재 방식 유지)
2. DB: shadow conversation의 messages를 영구 보존 (구현 완료)
3. Git sync: shadow conv의 messages를 git commit으로 매핑

이렇게 하면:
- UI는 깔끔하게 유지
- DB는 전체 이력 보존
- Git은 full history 제공
- 세 계층이 각자 역할에 맞는 granularity로 동작

## Git 동기화 설계 (Phase별)

### Phase 1: Branch ↔ Git Branch 매핑 (DB 준비)

현재 `branches` 테이블에 이미 `git_branch` 필드가 있음 (미사용).

```sql
branches.git_branch TEXT  -- e.g. "feature/api-design"
```

- tunaFlow branch 생성 시 git branch 자동 생성 (optional)
- git branch 이름 규칙: `tf/{branchLabel}` 또는 사용자 지정

### Phase 2: Message ↔ Git Commit 매핑

각 agent 응답을 git commit으로 기록:

```
git log --oneline tf/b1.1:
  abc1234 [claude] GraphQL schema 초안
  def5678 [user] 인증 추가 요청
  ghi9012 [claude] JWT 인증 구현
```

commit message = agent 응답 요약 (첫 줄)
commit body = 전체 응답 내용
commit author = `{agent_name} <{engine}@tunaflow>`

### Phase 3: Adopt ↔ Git Merge

```bash
git checkout main-chat
git merge --no-ff tf/b1.1 -m "Adopt: b1.1 (JWT 인증 구현)"
```

- `--no-ff`: merge commit 생성 (adopt 시점 기록)
- merge commit message = adopt 요약
- branch 삭제: `git branch -d tf/b1.1` (포인터만 제거)

### Phase 4: RT ↔ Git Octopus Merge

RT는 여러 agent가 동시에 응답하는 구조 → git octopus merge와 유사:

```bash
git merge tf/rt-round1-claude tf/rt-round1-codex tf/rt-round1-gemini
```

또는 각 participant의 응답을 sequential commit으로:

```
git log tf/rt-discussion:
  abc [claude/architect] 설계 제안...
  def [codex/reviewer] 리뷰 의견...
  ghi [gemini/tester] 테스트 관점...
```

## 파일 구조 동기화

tunaFlow 프로젝트의 코드 변경과 대화를 연결:

```
project/
  .tunaflow/
    conversations/
      main.json         ← 메인 대화 메타
      branches/
        b1.json         ← branch 메타
        b1.1.json
    artifacts/
      design-brief.md   ← artifact를 파일로 export
```

이 디렉토리를 `.gitignore`하지 않고 함께 커밋하면:
- 코드 리뷰 시 대화 맥락 확인 가능
- branch별로 "왜 이 결정을 했는지" 추적 가능
- CI/CD에서 artifact 참조 가능

## 미해결 질문

1. **conflict resolution**: 같은 branch에서 tunaFlow와 git 양쪽에서 변경 시?
2. **orphan messages**: branch 포인터 삭제 후 shadow conv의 messages는 GC 대상인가?
3. **cross-project sync**: 여러 프로젝트가 같은 git repo를 공유할 때?
4. **실시간 sync vs batch**: 매 메시지마다 commit인가, adopt 시점에만 commit인가?

## 선행 조건

- [x] parentBranchId 추적
- [x] adopted/archived branch 삭제 시 messages 보존
- [x] branch status 모델 (active/adopted/archived)
- [ ] `branches.git_branch` 필드 활용
- [ ] git CLI 연동 (Rust `std::process::Command`)
- [ ] `.tunaflow/` 디렉토리 구조 정의
- [ ] conflict resolution 정책

## 참고

- `docs/plans/gitAwareBranchModelPlan.md` — 기존 git 연동 계획 (필드 준비만 됨)
- `src-tauri/src/commands/branches.rs` — branch CRUD + adopt + delete
- `branches.git_branch` 컬럼 — DB에 존재, 미사용
