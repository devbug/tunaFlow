---
title: Fragility batch fix — 어제 panic cascade 후속 systematic audit + 진짜 risk 2건 transaction wrap
status: in-progress (architect 직접 처리)
priority: P1 (어제 사고 같은 카테고리 — partial-state cascade 위험)
created_at: 2026-04-26
related:
  - src-tauri/src/commands/branches.rs       # delete_branch 함수
  - src-tauri/src/commands/plans.rs          # update_plan_status 함수
  - docs/plans/branchAdoptAtomicityFix_*     # PR #196 (adopt 만 적용된 axis)
  - docs/plans/planGenerationRollback_*      # PR #195 (generation 만 적용된 axis)
canonical: true
owners:
  - architect (본 plan 작성 + 직접 처리)
---

# 배경

2026-04-25 `identity_analyzer.rs:96` UTF-8 char boundary panic → mutex poisoned → bg-worker / vector indexing cascade 영구 손상 (PR `da2e755` 로 fix 됨). 같은 카테고리의 잠재 risk audit.

# Audit 결과 요약

## False positive (Explore agent 1차 audit 의 오판 — SKIP 확정)

| 위치 | 1차 평가 | 재검증 결과 |
|---|---|---|
| `identity_analyzer.rs:496-504` | `.find().unwrap()` 4회 panic 가능 | `#[test]` 블록 안 (line 472+). production path 아님 |
| `codex.rs:36, 42` | `.last_mut().unwrap()` empty vec panic | `if let Some(last) = texts.last()` guard 안에서 호출. 호출 시점 empty 불가능 |
| `meta_notifications.rs:118-158` | mark_read / dismiss multi-execute | 각 함수 single execute. WHERE 절 기반 multi-row update 라 transaction 의미 없음 |
| `plans.rs:265, 325, 535, 558` | `.ok()` silent fallback | `Optional return` 의도. row 없으면 None 반환이 정상 동작 |

## Production unwrap / expect 전수 grep 결과

`src-tauri/src/agents/` + `src-tauri/src/commands/` 의 `.unwrap()` / `.expect()` 사용처 전수 검토:

- 모두 `#[test]` 블록 또는 `static ref Regex::new(...).expect()` (compile-time 안전) 또는 `if let Some(x) = ...` guard 안의 후속 unwrap (논리적 안전)
- **production path 의 panic 가능 unwrap = 0** (어제 fix 후 깨끗)
- `panic!` / `unreachable!` / `todo!` / `unimplemented!` 도 production = 0

## 진짜 fix 필요 — High 2건 (transaction wrap 누락)

### Fix 1: `branches.rs:387-441` `delete_branch`

8개 DELETE/UPDATE 가 transaction 없이 sequential 실행:

```rust
// active branch 일 때 7 deletes
conn.execute("DELETE FROM conversation_memory ...")?;
conn.execute("DELETE FROM trace_log ...")?;
conn.execute("DELETE FROM agent_jobs ...")?;
conn.execute("DELETE FROM messages ...")?;
conn.execute("DELETE FROM memos ...")?;
conn.execute("DELETE FROM artifacts ...")?;
conn.execute("DELETE FROM conversations ...")?;

// 모든 status — 3 plan unlinks + 1 branch delete
conn.execute("UPDATE plans SET branch_id = NULL ...")?;
conn.execute("UPDATE plans SET implementation_branch_id = NULL ...")?;
conn.execute("UPDATE plans SET review_branch_id = NULL ...")?;
conn.execute("DELETE FROM branches WHERE id = ?1", [branch_id])?;
```

Risk: 중간 statement 가 FK constraint / lock contention 으로 fail 시 partial state — child branches / shadow conversation / plan link 일부만 정리. PR #196 가 *adopt* 에 transaction 적용했지만 *delete* 는 미적용.

### Fix 2: `plans.rs:320-346` `update_plan_status`

3 execute (status / phase / branch archive) sequential:

```rust
conn.execute("UPDATE plans SET status = ?1 ...")?;
if input.status == "done" || input.status == "abandoned" {
    conn.execute("UPDATE plans SET phase = 'done' ...")?;
    conn.execute("UPDATE branches SET status = 'archived' ...")?;
}
```

Risk: status='done' 까지 됐는데 phase='active' 그대로 stuck (phase update fail) → downstream filtering 부정합. PR #195 가 plan *generation* 에 atomic tx 적용했지만 *update* 는 미적용.

# 구현

각 함수 시작에 `let mut conn = ...; let tx = conn.transaction()?;` + 모든 `conn.execute` → `tx.execute` + 함수 끝에 `tx.commit()?;`. 기존 로직 변경 없음.

`branches.rs` 의 `prepare` 호출은 `tx.prepare` 로 변경. `query_map` collect 후 stmt drop 명시 (borrow conflict 회피).

# Invariants

- **[INV-1]** `delete_branch` 의 8 statement 가 atomic — 중간 fail 시 모두 rollback
- **[INV-2]** `update_plan_status` 의 3 statement 가 atomic — status 만 OK + phase fail 같은 partial state 차단
- **[INV-3]** 기존 호출 contract 변경 없음 (반환값 / argument 동일)
- **[INV-4]** `emit_milestone_on_status_change` 등 post-commit 부수효과는 transaction 밖 유지 (실패해도 plan 상태 갱신엔 영향 없음 — 기존 정책)

# 검증

- `cargo check` (dev 자동 recompile 확인)
- `cargo test --lib commands::branches` + `cargo test --lib commands::plans`
- 수동 smoke (선택):
  1. brand 만들고 message 보낸 뒤 delete → 모든 child / shadow conv / plan link 정리됨
  2. plan status='active' → 'done' 전이 시 phase='done' + linked branch archived 동시

# 후속 / Sibling

- 추가 후보 (시간 남으면) — `failure_lessons.rs` (5 lock), `conversations.rs` (5 lock), `conventions_sync.rs` (3 lock) 의 multi-execute 패턴 audit. 본 plan scope 밖.
- `meta_agent/identity_trigger.rs:373-381` artifact insert × 2 — Medium risk. 추후 별 plan.
