---
title: Branch inherits main CLI session — sdk-url WS 모드의 session 키 통합 + ContextPack 낭비 제거
status: ready-to-implement (Architect 직접 fix)
priority: P1 (사용자 가시 UX 결함 + 토큰 낭비, 의도 SSOT 회복)
created_at: 2026-04-25
related:
  - docs/ideas/ptySessionPolicy.md  # PTY 시점 정책 (의도 원본, sdk-url WS 도입 후 stale)
  - docs/plans/sessionContinuityFixPlan.md  # conv_id 단위 운영의 정착, 본 plan 의 sibling
  - docs/plans/longTermMemoryRoadmapPlan_2026-03-30.md  # SSOT-first 메모리 철학
  - src-tauri/src/agents/claude_sdk_session.rs
  - src-tauri/src/commands/agents_helpers/send_common/context_loading.rs
canonical: true
owners:
  - architect (본 plan 작성)
  - developer (구현)
---

# 의도 SSOT (직접 인용)

본 plan 의 fix 는 **새 디자인이 아니라 사용자가 이미 박아둔 의도를 코드로 회복** 하는 작업이다.

## 1. `docs/ideas/ptySessionPolicy.md:164` (PTY 시점 정책)

```
| Branch | 부모 채팅의 PTY 세션 공유 | 분기→adopt/폐기, 같은 맥락에서 작업 |
```

## 2. 사용자 직접 (`~/.claude/projects/-Users-d9ng-privateProject-tunaFlow/037bb82f-5739-440e-ac08-7a2bd0ad295c.jsonl`, 2026-04-17, PTY → WS 전환 시기)

> 브랜치는 ws모드로 입장하는데 엔진이 바뀌면(사용자마다 선호 엔진/모델 선택에서 성향이나 상황이 다를 수 있는 문제) 어떻게 맥락을 알려주지? 그리고 가능하면 **컨텍스트팩에 모든걸 넣지말고 중요한 컨텍스트+필요시(맥락이 이해가 안되거나 할 때) 검색할 수 있는 대규모의 컨텍스트 저장소(첫대화부터 직전대화까지 모두 원본으로 저장되어있는)** 가 있잖아?

## 3. 사용자 직접 (2026-04-25, 본 plan 트리거)

> RT는 컨텍스트팩으로도 충분했고, **브랜치는 메인에서 바로 이어지는 건데 컨텍스트팩 올리면 낭비**라고 생각했었었고

# Divergence Timeline

| 시점 | 사건 | 사용자 의도 반영 여부 |
|---|---|---|
| ~ s35 | PTY 시대. brand = 부모 PTY 세션 공유 | ✅ ptySessionPolicy.md 명시 |
| s36 (2026-04-15) | sdk-url WS 모드 도입. `claude_sdk_session.rs` 전면 재작성 | ❌ brand session 통합 별 task 로 띄워지지 않음. SESSIONS/RESUME_IDS 가 conv_id 단위로 굳어짐 |
| 2026-04-17 | 사용자가 raw conversation log 에 brand=ws + ContextPack 낭비 의도 명시 | ❌ Architect 들이 surface 못함 |
| s37 (2026-04-18) | review 브랜치 archive 등 워크플로우 보강 | ❌ brand 통합 미언급 |
| s38 (2026-04-19) | ContextPack continuation drop + recent_turns 도입 | ❌ **반대 방향** — brand 도 ContextPack 으로 채우는 시도 |
| 2026-04-22 | sessionContinuityFix P0 — conv_id 단위 운영을 코드 invariant 로 강화 | ❌ divergence 굳어짐 |
| 2026-04-25 (오늘) | 사용자가 본인 직접 raw log 에 의도 박혀있음을 확인. 본 plan 작성 | — |

핵심: **사용자가 "지시 못했을 수도" 추측 = 정확**. 의도는 jsonl 안에 있었지만 plan/task/code 파이프라인으로 옮겨지지 않음. tunaFlow 가 풀려는 메타 문제 (architect 의도 surface 부재) 가 본 프로젝트 자체에서 발현 — 이건 별 plan (`userIntentSsotSurfacingPlan_2026-04-25`) 으로 분리.

# 현재 상태 (사실 확인)

## (A) `src-tauri/src/agents/claude_sdk_session.rs`

```rust
type SessionRegistry = Arc<PlMutex<HashMap<String, Arc<SdkSession>>>>;
type ResumeRegistry = Arc<PlMutex<HashMap<String, String>>>;
static ref SESSIONS: SessionRegistry = ...;
static ref RESUME_IDS: ResumeRegistry = ...;
```

키 = `conversation_id`. `branch:b20` 와 `conv-abc` 가 별 entry.

`rg "branch:|brand|root_conv|main_conv" claude_sdk_session.rs` → **0 hits**. brand 처리 로직 코드에 한 번도 들어간 적 없음.

## (B) `src-tauri/src/commands/agents_helpers/send_common/context_loading.rs:137`

```rust
let is_branch = conversation_id.starts_with("branch:");
```

`is_branch=true` 이면 parent_messages 빌드 (line 165-180), thread_inheritance 섹션 (line 483) 추가. brand 진입 시 ContextPack 풍성히 빌드 — **사용자 의도 "낭비" 와 충돌**.

## (C) `src-tauri/src/commands/branches.rs`

```rust
let branch_conv_id = format!("branch:{}", branch_id);  // line 247
```

shadow conv 모델. DB 분리는 사용자 의도 (UI 격리 + 메시지 보존) 와 정합. 손 안 댐.

# Fix Scope

## Layer A — SESSIONS / RESUME_IDS key normalize

**파일**: `src-tauri/src/agents/claude_sdk_session.rs`

```rust
/// brand:* conv_id 를 root main conv_id 로 normalize.
/// branches.root_conversation_id 컬럼 또는 parent_id 체인 lookup 으로 root 도달.
/// non-branch conv 는 그대로 반환.
fn session_key_for(conn: &Connection, conv_id: &str) -> String {
    if let Some(branch_id) = conv_id.strip_prefix("branch:") {
        // branches.root_conversation_id 또는 parent_branch_id 체인 거슬러 main conv 찾기
        if let Ok(root) = conn.query_row(
            "SELECT root_conversation_id FROM branches WHERE id = ?1",
            [branch_id], |row| row.get::<_, String>(0),
        ) {
            return root;
        }
    }
    conv_id.to_string()
}
```

`SESSIONS.get(...)` / `RESUME_IDS.get(...)` / `bootstrap_resume_id_from_db` / `current_session_key` 등 모든 키 lookup 에 적용. **DB 의 conn 접근 필요** — 함수 시그니처 조정.

`branches.root_conversation_id` 컬럼이 이미 있는지 검증 (DB schema). 없으면 `parent_branch_id` 체인 추적 또는 마이그레이션. 일반 case 는 brand 가 main conv 의 직속 자식이라 1회 lookup 충분.

## Layer B — Branch send 시 ContextPack skip

**파일**: `src-tauri/src/commands/agents_helpers/send_common/context_loading.rs`

```rust
let is_branch = conversation_id.starts_with("branch:");
let same_engine_as_root = check_engine_continuity(conn, conversation_id, engine);

if is_branch && same_engine_as_root {
    // brand 가 same Claude session 이라 prior history 자동 포함.
    // ContextPack 재주입은 토큰 낭비 (사용자 의도, 037bb82f log).
    return ContextPackData {
        is_branch: true,
        skip_context: true,
        identity: ..., persona: ..., project: ...,  // 정적 레이어만
        recent_messages: vec![],
        parent_messages: vec![],
        compressed_memory: None,
        retrieval_chunks: vec![],
    };
}
```

**Engine 변경 시 (Claude → Codex) 예외**: 이 경우 별 session 이라 ContextPack 필요. `check_engine_continuity` 가 `convEngineMap` 또는 conversations.last_engine 체크.

## Layer C — Codex app-server 동일 패턴

**파일**: `src-tauri/src/agents/codex_app_server.rs`

Codex 도 sdk-url WS (app-server `--listen ws://...`) 모드. 동일하게 SESSIONS/RESUME 키 normalize. 검증 필요: codex app-server 가 `--resume` 동등 매커니즘 보유하는지. (Layer A 와 같은 helper 재사용)

## Layer D — Documentation

1. **`docs/ideas/ptySessionPolicy.md`** → `docs/reference/branchSessionPolicy.md` 로 **승격 + rename**
   - "PTY" 의존 제거. "interactive session backbone (PTY → sdk-url WS)" 로 일반화
   - 본 plan 의 invariants 박기
   - **canonical: true** + status: active
2. **`CLAUDE.md`** §13 "문서 참조" 섹션에 reference 추가:
   ```
   | docs/reference/branchSessionPolicy.md | brand session = main session 공유 원칙 |
   ```
3. **INV 박기** (아래 §Invariants 참조)

# Invariants

- **[INV-1]** brand:* send 시 SESSIONS / RESUME_IDS lookup 키는 root main conversation_id. 검증: `rg "SESSIONS\.get\(\|RESUME_IDS\.get\(" src-tauri/` 결과 모두 `session_key_for` 통과
- **[INV-2]** brand send 시 (same engine) ContextPack 의 recent_messages / parent_messages / compressed_memory / retrieval_chunks 빌드 skip. 정적 레이어 (identity / persona / project) 만 포함
- **[INV-3]** Engine 변경 시 (Claude → Codex 등) 는 별 session 으로 fallback. ContextPack 정상 빌드 (현재 동작 유지)
- **[INV-4]** DB raw 메시지 = SSOT. retrieval / compressed memory / vector search 는 SSOT 위 helper layer (정책 위배 아님)
- **[INV-5]** 본 fix 는 brand session 통합 + ContextPack 낭비 제거. shadow conv DB 모델, adopt summary placeholder, branches 테이블 등은 그대로

# Test

## 수동 Smoke (PR 필수)

1. **Same engine continuation**: 메인 (Claude) 에서 5턴 → 브랜치 열기 (Claude) → 3턴 → adopt → 메인에서 다음 메시지 → architect 가 brand 의 3턴 본문 자연 access 확인 (ContextPack 없이도 history 봄)
2. **Engine 변경 시 fallback**: 메인 (Claude) → 브랜치 (Codex) → ContextPack 정상 빌드 확인 (별 session 이라 필요)
3. **Token 측정**: brand send 의 prompt token 이 fix 전 대비 감소 (ContextPack skip 효과)

## 자동 (cargo test --lib)

- `session_key_for` unit test (brand:* → root, non-brand 그대로, 잘못된 prefix 처리)
- SESSIONS / RESUME_IDS lookup 통합 시 brand 와 main 의 entry 가 같은 SdkSession 가리킴 검증

# Developer 핸드오프 프롬프트

```
[작업] Branch inherits main CLI session — sdk-url WS 모드의 session 키 통합 + ContextPack 낭비 제거 (Plan branchInheritsMainSession)

[SSOT] docs/plans/branchInheritsMainSessionPlan_2026-04-25.md 먼저 읽고 §Fix Scope (Layer A~D) 순서대로 처리.

[배경 3줄]
- 사용자 원래 의도: brand = main session 공유 (raw log + ptySessionPolicy.md)
- s36 sdk-url WS 도입 시 brand 통합이 별 task 로 띄워지지 않아 conv_id 단위로 굳음
- 본 fix 는 코드를 의도에 맞춤 + 토큰 낭비 제거

[수정 범위]

1) Layer A — claude_sdk_session.rs:
   - session_key_for(conn, conv_id) helper 추가 (brand:* → root_conv)
   - SESSIONS / RESUME_IDS / bootstrap_resume_id_from_db / current_session_key 모두 normalize
   - DB conn 접근 시그니처 조정 필요

2) Layer B — context_loading.rs:
   - is_branch + same_engine_as_root 조건일 때 ContextPack 의 dynamic 섹션 skip
   - 정적 레이어 (identity / persona / project) 만 유지
   - check_engine_continuity helper 추가

3) Layer C — codex_app_server.rs:
   - 동일 normalize 패턴
   - codex --resume 동등 매커니즘 검증

4) Layer D — Documentation:
   - docs/ideas/ptySessionPolicy.md → docs/reference/branchSessionPolicy.md (승격 + rename + canonical: true)
   - CLAUDE.md §13 에 reference 추가
   - branches.root_conversation_id 컬럼 존재 여부 schema 검증 (없으면 마이그레이션)

5) 테스트:
   - session_key_for unit test
   - 수동 smoke (plan §Test)

[검증]
- cargo check --all-targets / cargo test --lib
- 수동 smoke 3 시나리오 (plan §Test)
- Token 측정: brand send prompt token before vs after

[커밋 분리]
- refactor(session): session_key_for helper + SESSIONS/RESUME_IDS normalize (Layer A)
- fix(contextpack): skip dynamic context for same-session branch (Layer B)
- chore(codex): apply same session-key normalization (Layer C)
- docs(ref): branchSessionPolicy + CLAUDE.md reference (Layer D)

각 커밋 trailer: Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

[PR 제목]
feat(session): brand inherits main CLI session — sdk-url WS key normalize + ContextPack waste fix

[셀프 이슈 본문]
"refactor: brand session inherits main (sdk-url WS divergence from s36) — restore user intent + remove ContextPack token waste"
이슈 본문에 raw log 인용 + ptySessionPolicy.md cite + s36 timeline.

[주의]
- shadow conv DB 모델, adopt summary placeholder, branches 테이블, UI 드로어 → 손 안 댐
- INV-3 (engine 변경 시 ContextPack 빌드) 는 회귀 위험 — engine_continuity 정확히 검증
- branches.root_conversation_id 컬럼 없으면 별 마이그레이션 plan 분리 (V47+1)
```

# 셀프 이슈 본문 (gh issue create 용)

```markdown
## Summary

User intent (multiple sources, oldest 2026-04-17): brand should inherit main CLI session in sdk-url WS mode. ContextPack re-injection on brand send is a token waste because Claude session already holds the prior history.

Code reality: `SESSIONS` / `RESUME_IDS` (in `src-tauri/src/agents/claude_sdk_session.rs`) keyed by `conversation_id`, so `branch:b20` ≠ `conv-abc`. Brand session starts as a separate Claude process with no shared history — directly contradicts the original intent.

Divergence point: s36 (2026-04-15, PTY → WS transition). The transition itself was completed but brand-session unification was not raised as a separate task. Subsequent sessions (s37, s38) drifted further (s38 added ContextPack continuation drop — opposite direction).

## Reproduction

1. Open project, send a message in main conversation (Claude meta agent)
2. Open a branch drawer, send a few turns
3. Adopt branch → return to main
4. Ask architect about content from the brand turns
5. Architect cannot access the brand turns' content (only sees the 300-char adopt summary placeholder + ContextPack-rebuilt main)

## Fix

Tracked in `docs/plans/branchInheritsMainSessionPlan_2026-04-25.md`. 4 layers:

- Layer A: `SESSIONS` / `RESUME_IDS` key normalize (`branch:*` → root main `conversation_id`)
- Layer B: brand send skips ContextPack dynamic sections (same session, history already present)
- Layer C: same pattern for Codex app-server
- Layer D: `docs/ideas/ptySessionPolicy.md` → `docs/reference/branchSessionPolicy.md` promotion + CLAUDE.md reference

## Discovery

User raised "왜 architect 가 brand 본문을 못 잡지" symptom. Diagnosis traced through: ptySessionPolicy.md (PTY-era policy) → raw conversation log 037bb82f (2026-04-17 explicit user intent) → s36 timeline (intent never moved into a task) → current code grep (zero brand handling in claude_sdk_session.rs).

## Sibling

`docs/plans/userIntentSsotSurfacingPlan_2026-04-25.md` — meta-level plan to prevent this kind of intent loss. tunaFlow's own conversation DB should auto-surface user intent at architect entry.
```

# 후속 / Sibling

- **`userIntentSsotSurfacingPlan_2026-04-25`** (Task B) — 메타 level. tunaFlow conversation DB 를 architect 진입 시 자동 surface. 본 plan 머지 후 진행.
- **rawqIndexCancelChannelPlan / branchAdoptRollbackPlan / planGenerationRollbackPlan / reviewRTEntryFailureRollbackPlan** — 다른 plans, 영역 독립
