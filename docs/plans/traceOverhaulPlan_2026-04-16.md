---
title: Trace 시스템 정비 + 고도화
status: planned
created_at: 2026-04-16
priority: P1
related: traceEnhancementAbtopIdea.md, sdkUrlSessionModePlan.md, engineServerModePlan.md
references: duckbar(SessionDiscovery.swift), abtop(collector/), claude-status-bar(statusline.sh)
---

# Trace 시스템 정비 + 고도화

> 현재 trace가 정상 동작 안 하는 부분을 먼저 고치고,
> duckbar/abtop/claude-status-bar 패턴을 참고해 실시간 모니터링으로 확장한다.

---

## 1. 현재 상태 — 깨져있는 것

| # | 문제 | 위치 | 심각도 |
|---|------|------|--------|
| A | Error 경로에서 context 메타데이터 미기록 | `persistence.rs:221` — `insert_trace_log()` 사용 (context 버전 아님) | 높음 |
| B | Real-time trace 갱신 미작동 | `useTraceData.ts:72-77` — threadRunning 중 jobs만 폴링, traces 미갱신 | 중간 |
| C | contextHash 파싱 불안정 | `TraceSpanCard.tsx:231` — 값 없으면 catch로 무시 | 낮음 |
| D | 토큰 속도/컨텍스트 %/rate limit 미구현 | `traceEnhancementAbtopIdea.md` Phase 1-2 전체 | 미구현 |
| E | duckbar rate limit 캐시 연동 미구현 | `~/.claude/.duckbar-ratelimits-cache.json` 존재하지만 읽지 않음 | 미구현 |

---

## 2. 구현 단계

### Phase 1: 버그 수정 (기존 trace 정상화)

**범위: A + B + C — DB 변경 없음, 프론트+백엔드 수정만**

#### 1-A: Error 경로 context 메타데이터 기록

`persistence.rs` `finalize_engine_run` Error 분기에서 `insert_trace_log` → `insert_trace_log_with_context` 변경.
ctx_meta는 이미 함수 파라미터로 전달되고 있으므로 호출만 바꾸면 됨.

```rust
// 변경 전 (persistence.rs:221)
insert_trace_log(conn, conversation_id, 0, 0, 0.0, now, &SpanInfo { ... });

// 변경 후
insert_trace_log_with_context(conn, conversation_id, 0, 0, 0.0, now,
    &SpanInfo { ..., status: "error" }, ctx_meta, Some(msg_id));
```

**변경 파일**: `persistence.rs` (1줄)

#### 1-B: Real-time trace 갱신

`useTraceData.ts`에서 threadRunning 중 traces도 폴링.
현재 jobs만 1초 간격으로 폴링하는데, traces를 5초 간격으로 추가.

```typescript
// useTraceData.ts — threadRunning 중
useEffect(() => {
  if (!threadRunning) return;
  const interval = setInterval(() => {
    loadJobs();
    loadTraces();  // 추가
  }, 5000);  // 5초 (기존 jobs는 1초였지만 trace는 5초로 충분)
  return () => clearInterval(interval);
}, [threadRunning]);
```

**변경 파일**: `useTraceData.ts` (~5줄)

#### 1-C: contextHash 안전한 파싱

`TraceSpanCard.tsx`에서 contextHash 파싱 시 빈 값/null 처리 명확화.

**변경 파일**: `TraceSpanCard.tsx` (~3줄)

---

### Phase 2: 토큰 속도 + 컨텍스트 윈도우 % (DB 변경 없음)

**참고**: `traceEnhancementAbtopIdea.md` §2.1, §2.2

#### 2-A: 토큰 처리 속도 (tok/s)

TracePanel에서 기존 `output_tokens / duration_ms` 계산 + 미니 차트.
abtop의 `token_history` 패턴 참고 — 스팬 히스토리에서 추출.

```typescript
const tokPerSec = span.outputTokens / (span.durationMs / 1000);
```

**표시**: TraceSpanCard 내 tok/s 수치 + TracePanel 상단 미니 SVG 라인차트.

**변경 파일**: `TraceSpanCard.tsx` (~10줄), `TracePanel.tsx` (~30줄), 새 `SpeedChart.tsx` (~60줄)

#### 2-B: 컨텍스트 윈도우 사용률 %

모델별 최대 컨텍스트 한도 대비 `input_tokens` 비율.
abtop의 `last_context_tokens / model_limit` 패턴.
duckbar의 `context_window.remaining_percentage` 패턴.
claude-status-bar의 3-tier 경고 (< 70% / 70-79% / >= 80%).

```typescript
const MODEL_LIMITS: Record<string, number> = {
  "claude-sonnet-4-6": 200_000,
  "claude-opus-4-6": 1_000_000,
  "gpt-5.4-mini": 200_000,
  "gemini-2.5-pro": 1_000_000,
};
const pct = (span.inputTokens / (MODEL_LIMITS[span.model] ?? 200_000)) * 100;
```

**표시**:
- TraceSpanCard: 프로그레스 바 + %
- RuntimeStatusBar: 모드 뱃지 옆 % 표시
- 색상: 0-60% 초록, 60-80% 노랑, 80-90% 주황, 90%+ 빨강

**변경 파일**: `TraceSpanCard.tsx` (~20줄), `RuntimeStatusBar.tsx` (~15줄)

---

### Phase 3: Rate Limit + 시간당 비용 (새 Tauri 커맨드)

**참고**: duckbar `SessionDiscovery.swift:621-656`, abtop `rate_limit.rs`

#### 3-A: Rate Limit 읽기

3단계 폴백 (duckbar 패턴):
1. `~/.claude/.duckbar-ratelimits-cache.json` (duckbar가 생성, 5분 캐시)
2. `~/.claude/plugins/oh-my-claudecode/.usage-cache.json` (OMC 플러그인)
3. `~/.claude/abtop-rate-limits.json` (abtop StatusLine 훅)

Staleness: 10분 이상이면 무시 (abtop 패턴).

```rust
#[tauri::command]
pub fn get_rate_limit_info() -> Result<Option<RateLimitInfo>, AppError> {
    // 1. duckbar 캐시
    // 2. OMC 캐시
    // 3. abtop 캐시
    // staleness 10분 체크
}
```

**표시**: RuntimeStatusBar에 5h/7d 게이지.
**폴링**: 60초 간격 (duckbar의 300초보다 짧게 — UI 반응성 우선, 파일 읽기만이라 저비용).

**변경 파일**: 새 `src-tauri/src/commands/diagnostics.rs` (~80줄), `RuntimeStatusBar.tsx` (~30줄), `lib.rs` 커맨드 등록

#### 3-B: 시간당 비용 ($/h)

claude-status-bar 패턴: `total_cost / (duration_s / 3600)`.
세션 시작 시간 = 첫 trace_log의 recorded_at.

**표시**: RuntimeStatusBar 비용 옆에 `($X.XX/h)`.

**변경 파일**: `RuntimeStatusBar.tsx` (~10줄) — DB 변경 없음, 기존 trace 데이터로 계산

#### 3-C: Git 상태 표시

`get_git_status` Tauri 커맨드 이미 존재 (`project_tools.rs`).
RuntimeStatusBar에 branch + dirty 표시만 추가.

**표시**: `main* (+3 ~7)` — branch 이름 + dirty * + added/modified 수.

**변경 파일**: `RuntimeStatusBar.tsx` (~15줄) — 기존 커맨드 호출만

---

### Phase 4: 캐시 토큰 분류 (DB 스키마 확장)

**참고**: abtop `session.rs:87-95`, duckbar `Models.swift:121-161`

현재 trace_log에는 `input_tokens`, `output_tokens`만 기록.
캐시 토큰 분류 추가:

```sql
ALTER TABLE trace_log ADD COLUMN cache_read_tokens INTEGER DEFAULT 0;
ALTER TABLE trace_log ADD COLUMN cache_creation_tokens INTEGER DEFAULT 0;
```

sdk-url 모드에서 Claude가 반환하는 usage에 `cache_read_input_tokens`, `cache_creation_input_tokens` 포함.
이걸 trace_log에 기록하면 정확한 비용 계산 가능:

```
실비용 = input × $15/M + output × $75/M + cache_create × $18.75/M + cache_read × $1.50/M
```

**변경 파일**: `migrations.rs` (v31), `trace_log.rs`, `persistence.rs`, `TraceSpanCard.tsx`

---

## 3. 변경 범위 예측

| Phase | 신규 | 수정 | DB | 파일 |
|-------|------|------|-----|------|
| 1 (버그 수정) | 0줄 | ~15줄 | 없음 | persistence.rs, useTraceData.ts, TraceSpanCard.tsx |
| 2 (속도+%) | ~90줄 | ~45줄 | 없음 | TraceSpanCard, TracePanel, RuntimeStatusBar, SpeedChart(신규) |
| 3 (rate limit+cost+git) | ~80줄 | ~55줄 | 없음 | diagnostics.rs(신규), RuntimeStatusBar |
| 4 (캐시 토큰) | ~20줄 | ~30줄 | v31 | migrations, trace_log, persistence, TraceSpanCard |

**총**: ~190줄 신규 + ~145줄 수정. Phase 1-3은 DB 변경 없음.

---

## 4. 우선순위

| 순서 | 항목 | 이유 |
|------|------|------|
| 1 | Phase 1 (A+B+C) | 기존 기능이 깨져있음 — 정상화 필수 |
| 2 | Phase 2 (속도+%) | DB 변경 없이 기존 데이터로 바로 표시 가능 |
| 3 | Phase 3-C (Git) | 기존 커맨드 있음, UI만 연결 |
| 4 | Phase 3-A (Rate Limit) | duckbar 캐시 읽기만, 새 의존성 없음 |
| 5 | Phase 3-B ($/h) | 계산만, 1줄 |
| 6 | Phase 4 (캐시 토큰) | DB 마이그레이션 필요, 베타 후 |

---

## 5. 참고 파일

| 레퍼런스 | 파일 | 핵심 패턴 |
|---------|------|----------|
| duckbar | `SessionDiscovery.swift:621-656` | 3단계 rate limit 폴백 + 5분 캐시 |
| duckbar | `SessionMonitor.swift:27-51` | 빠른/느린 이중 폴링 |
| duckbar | `Models.swift:121-161` | cache_read/cache_creation 분리 비용 계산 |
| abtop | `rate_limit.rs:92-107` | 10분 staleness + 원자적 캐시 쓰기 |
| abtop | `session.rs:45-95` | AgentSession 모델 (토큰 히스토리, 상태 판정) |
| abtop | `collector/mod.rs:69-114` | 빠른/느린 tick 분리 + 캐시된 포트 재사용 |
| abtop | `claude.rs:104-150` | JSONL 증분 파싱 (inode+mtime 기반 변경 감지) |
| claude-status-bar | `statusline.sh:36-96` | $/h 계산, context % 3-tier 경고, git dirty |
| tunaFlow | `traceEnhancementAbtopIdea.md` | 기존 아이디어 초안 (Phase 1-2와 대응) |
