---
title: rawq index build cancel 채널 추가 (subprocess kill 대안)
status: ready-to-implement (gray-box plan, 우선순위 낮음)
priority: P3 (영향 범위 작음 — UI freeze 까진 안 가는 것으로 추정)
created_at: 2026-04-25
related:
  - docs/reference/asyncCancelPipelineAudit_2026-04-25.md  # 항목 5
  - src-tauri/src/agents/rawq.rs  # ensure_index, start_rawq_index
  - src-tauri/src/commands/project_tools.rs  # rebuild_rawq_index (PR #182 에서 추가)
canonical: true
owners:
  - architect (본 plan 작성)
  - developer (구현)
---

# 배경

`asyncCancelPipelineAudit_2026-04-25` 의 항목 5 — rawq index build 중 명시적 cancel 채널 부재.

현재 `ensure_index` 는 `Command::wait_with_output` 으로 동기 대기 (`rawq.rs:348`). subprocess kill 외 cancel 경로 없음. 사용자가 프로젝트를 닫아도 rawq subprocess 가 끝까지 진행 → CPU/메모리 일시 점유.

# 현실적 영향

- **UI freeze 까진 안 감** — rawq 는 별 thread 에서 spawn 되어 main loop 블로킹 안 함
- **CPU 점유 일시** — 큰 프로젝트 (Rust target/ 같은 큰 디렉터리 — 다만 #180 fix 로 exclude 됨) 는 여전히 수 분 진행 가능
- **사용자 경험** — "왜 indexing 이 끊기지 않고 끝까지 가나" 의문. 명시적 stop/cancel UI 없음

# 우선순위 낮은 이유

- 영향 범위가 작음 (백그라운드만)
- 현실적 trigger 가 적음 (사용자가 프로젝트 닫고 다른 거 열 때 정도)
- onboarding / branch adopt / plan generation 과 달리 데이터 일관성 위험 없음 (rawq DB 는 자체 idempotent)

# 수정 방향 가설

## Option A — subprocess kill on Drop (간단)

`start_rawq_index` 가 spawn 한 thread / Child 의 reference 를 보관. 사용자가 프로젝트 닫으면 (또는 새 프로젝트 열면) `Child::kill()` 호출.

장점: rawq upstream 변경 없음. tunaFlow 단 수정만.
단점: 즉시 종료 (graceful shutdown 없음). 부분 인덱스 남을 수 있음 (다음 build 에서 재생성하니 영향 작음).

## Option B — rawq daemon 모드 활용 (현재 daemon 모드 운영 중이라면)

rawq daemon 에 cancel 신호를 socket 으로 전송. graceful shutdown.

장점: 깔끔. 부분 인덱스 정리 가능.
단점: rawq upstream 에 cancel 신호 채널 추가 필요. PR 작성 비용.

## Option C — rawq upstream 에 cancel flag 추가 PR

`rawq index build` 에 `--cancel-on-signal SIGTERM` 같은 옵션. tunaFlow 가 그 신호 활용.

장점: 다른 rawq 사용자도 혜택.
단점: 시간 큼.

# 권장: Option A

가장 빠르고 수용 가능한 절충. subprocess kill 은 OS 레벨 기본 메커니즘이라 안정적. graceful shutdown 못 하는 단점은 "부분 인덱스 → 다음 build 시 재생성" 으로 흡수.

# Invariants

- **[INV-1]** start_rawq_index 호출자가 cancel 가능 (실시간 또는 lifecycle hook)
- **[INV-2]** cancel 후 부분 인덱스가 남아도 다음 ensure_index 호출이 정상 작동 (idempotent / 자동 재빌드)
- **[INV-3]** 동시 진행 중인 다른 프로젝트의 rawq build 에 영향 없음

# Developer 핸드오프 프롬프트

```
[작업] rawq index build cancel 채널 추가 (Plan rawqIndexCancelChannel / asyncCancel audit #5)

[SSOT] docs/plans/rawqIndexCancelChannelPlan_2026-04-25.md + docs/reference/asyncCancelPipelineAudit_2026-04-25.md

[배경 3줄]
- rawq subprocess 가 사용자 프로젝트 dismiss 후에도 끝까지 진행 → CPU 점유
- UI freeze 까진 안 가지만 사용자 경험상 의문 발생
- 우선순위 낮은 cleanup — 다른 audit 항목 (onboarding/branch/plan) 처리 후 진행

[수정 범위 — Option A 권장]

1) src-tauri/src/agents/rawq.rs:
   - ensure_index 시그니처에 Optional<Arc<AtomicBool>> cancel flag 추가
   - 또는 spawn 한 Child 의 reference 를 caller 가 보관할 수 있게 변경
   - graceful 종료 시 Child::kill() 호출

2) src-tauri/src/commands/project_tools.rs:
   - start_rawq_index 가 Child reference 를 RawqIndexing State 에 저장
   - 신규 cancel_rawq_index command (또는 기존 lifecycle 에 통합)
   - 사용자가 프로젝트 dismiss 시 자동 cancel

3) src/lib/api/rawq.ts:
   - cancelRawqIndex 함수 (필요 시)

4) UI hook:
   - 프로젝트 dismiss 시 invoke("cancel_rawq_index", { projectPath }) 호출
   - 또는 자동 cleanup (lifecycle hook 으로)

[검증]
- cargo check / cargo test
- 수동: 큰 프로젝트 indexing 진행 중 다른 프로젝트 열기 → 첫 프로젝트 indexing 즉시 중단 확인 (Activity Monitor)

[커밋 분리]
- feat(rawq): cancel-aware ensure_index + Child reference保管
- feat(rawq): cancel_rawq_index command + state 통합
- feat(ui): auto-cancel rawq on project dismiss

[셀프 이슈]
"feat: rawq index build cancel channel (audit follow-up, low priority)"
```

# 후속 — Upstream PR (선택)

Option A 머지 후 안정 운영 검증되면, **Option B/C 로 rawq upstream 에 cancel 신호 PR 제안 가능**. rawq upstream owner (auyelbekov) 가 active 한 maintainer 라 (#12 이슈 응답 1-2 일 내 약속) 협조 가능성 높음.

# 관련 기록

- `asyncCancelPipelineAudit_2026-04-25` 항목 5
- rawq #12 (upstream gitignore 이슈) 와 별 트랙 — 이 plan 은 tunaFlow 단 수정 우선
