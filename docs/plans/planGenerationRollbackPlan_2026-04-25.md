---
title: Plan 생성 (LLM-backed) 중 실패 시 rollback + 사용자 피드백
status: ready-to-implement (gray-box plan, Developer 가 audit 단계부터 진행)
priority: P2 (잠재 위험)
created_at: 2026-04-25
related:
  - docs/reference/asyncCancelPipelineAudit_2026-04-25.md  # 항목 4
  - src/lib/api/plans.ts  # generatePlanDocument
  - src-tauri/src/commands/  # plan 생성 Tauri command (이름 미확인)
canonical: true
owners:
  - architect (본 plan 작성)
  - developer (audit + 구현)
---

# 배경

`asyncCancelPipelineAudit_2026-04-25` 의 항목 4 — Plan 생성 중 LLM 응답 실패 시 rollback / 사용자 피드백 미확인.

`generatePlanDocument` (plans.ts:107) 는 Tauri command 호출로 Rust 쪽에 위임 → Rust plan generation 의 실패 매트릭스 + UI catch 처리 미분석.

# 현재 추정 (Developer 가 검증)

Plan 생성 흐름 (의심 단계):

1. UI 가 사용자 입력 (제목, 요구사항) 받음
2. `invoke("generate_plan_document", ...)` 호출 → Rust
3. Rust 가 LLM (Architect engine) 호출 → 프롬프트 전송
4. Rust 가 응답 파싱 → plan 구조체로
5. Rust 가 DB 에 plan + subtasks insert
6. Rust 가 .md 문서 파일 생성
7. UI 가 결과 표시 (PlansPanel refresh)

각 단계 실패 위험:
- step 3 (LLM call) → timeout / network → UI 가 spinner 영구 표시 위험
- step 4 (응답 파싱) → 모델이 형식 안 맞춤 → 빈 plan / 잘못된 plan
- step 5 (DB insert) → 일부 subtask 만 insert → split state
- step 6 (.md 생성) → 디스크 권한 에러 → DB 에는 있는데 파일 없음

# 의심 시나리오

- 모델 timeout (긴 plan, 토큰 예산 초과) → UI freeze
- 모델이 "I cannot generate this" 응답 → 파싱 실패 → empty plan
- DB write 실패 (드물지만 lock) → partial subtasks
- 디스크 full → step 6 실패 → DB/file 불일치

# 수정 방향 가설

## Layer A — Rust 단 transaction + atomic write

step 5 (DB) + step 6 (file) 를 atomic 하게:
- DB transaction 내부에서 file 도 write (실패 시 transaction abort)
- 또는 DB write 먼저 + 성공 후 file write 시도 + file 실패 시 DB 롤백

## Layer B — LLM 응답 파싱 강건화

step 4 가 실패하면:
- 명확한 error message ("LLM 이 형식에 맞는 plan 을 생성하지 못했습니다 — 재시도하시겠습니까?")
- LLM 응답 raw 를 사용자에게 보여줌 (debug 가시화)
- 재시도 1회 자동 (다른 temperature 등)

## Layer C — UI timeout + cancel

UI 가 invoke 호출 시 N초 timeout 설정. timeout 시 cancel 신호 + 명확한 에러 표시. cancel 신호 받은 Rust 는 LLM 호출 중단 (engine 별 cancel 구현 필요).

## Layer D — 부분 적용 감지

앱 기동 시 plan.status="generating" + last_update < N분 인 row 검사. 발견 시 사용자 prompt.

# Invariants

- **[INV-1]** generate_plan_document 가 성공 반환하면 DB plan + subtasks + .md 파일이 모두 일관 상태
- **[INV-2]** 실패 시 부분 적용 없음 (전부 또는 전무)
- **[INV-3]** 사용자에게 실패 사유 즉시 표면화 (toast / dialog)
- **[INV-4]** UI invoke 가 reasonable timeout 내에 완료 또는 실패 응답

# Developer 핸드오프 프롬프트

```
[작업] Plan 생성 (LLM) 중 실패 시 rollback + 사용자 피드백 (Plan planGenerationRollback / asyncCancel audit #4)

[SSOT] docs/plans/planGenerationRollbackPlan_2026-04-25.md + docs/reference/asyncCancelPipelineAudit_2026-04-25.md

[배경 3줄]
- generatePlanDocument 는 Tauri command 위임이라 Rust 단 실패 매트릭스 미확인
- LLM 응답 형식 불일치 / DB 부분 insert / 디스크 에러 가능성
- onboarding fix 와 동일 카테고리 (long-running async + UI 응답 + 부분 상태)

[수정 범위]

1) Audit:
   - src-tauri/src/commands/ 내 plan 생성 command 본문 (정확한 이름 grep 필요: generate_plan_document 등)
   - LLM 호출 / DB write / file write 단계 별 실패 처리 현재 상태
   - UI 단 catch 가 사용자에게 어떻게 노출되는지
   - 결과: docs/reference/planGenerationFailureAudit_2026-04-2X.md

2) Layer A — Rust transaction + atomic write
   - DB + file write 를 atomic 하게 (transaction 내부에서 file 도 write)
   - 실패 시 부분 적용 방지

3) Layer B — LLM 응답 파싱 강건화
   - 파싱 실패 시 명확한 error + raw 응답 노출
   - 자동 retry 1회 (다른 temperature 또는 prompt 변형)

4) Layer C — UI timeout + cancel
   - generate_plan_document invoke 에 timeout (90초 정도)
   - timeout 시 cancel 호출 + 사용자 prompt
   - Rust 단 cancel flag 추가 (engine 별 cancel 구현 — engine parity 고려)

5) Layer D — 부분 적용 복구 UX
   - 앱 기동 시 plan.status="generating" + stale 검사
   - 발견 시 알림 + 재시도/삭제 옵션

[검증]
- npx tsc / cargo check / cargo test
- 수동: 네트워크 차단 / 디스크 full / LLM 응답 mock 변형으로 각 시나리오 재현

[커밋 분리]
- docs(ref): plan generation failure audit
- fix(plan): atomic db+file write transaction
- fix(plan): llm response parsing fallback + retry
- fix(plan): timeout + cancel for invoke
- feat(plan): stale generating-state recovery

[셀프 이슈]
"bug: plan generation may leave inconsistent DB/file state on LLM/disk failure (audit follow-up)"
```

# 관련 기록

- `asyncCancelPipelineAudit_2026-04-25` 항목 4
- 일반 패턴: long-running async + 부분 적용 위험 (sibling: onboarding, branch adopt, reviewRT entry)
