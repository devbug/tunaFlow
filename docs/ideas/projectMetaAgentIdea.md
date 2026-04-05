# 프로젝트 메타 에이전트 — 규칙 기반부터 시작

> Status: idea
> Created: 2026-04-05
> 관련: tunaMeta (예정, 128GB Mac Studio 전제)

---

## 1. 메타 에이전트가 할 일

| 작업 | 현재 누가 하는가 | 메타 에이전트가 하면 |
|------|----------------|-------------------|
| "다음에 뭘 해야 하지?" | 사용자 판단 | Plan 현황 + 활동 분석 → 제안 |
| "이 Plan 순서가 맞나?" | 사용자 판단 | 의존성 + 우선순위 추천 |
| "지금까지 뭘 했지?" | CLAUDE.md 수동 관리 | 자동 히스토리 누적 |
| "반복되는 실패 패턴은?" | Doom Loop (3회 기계적) | 패턴 분석 + 원인 추론 |
| "비용/토큰 최적화" | 없음 | trace_log 분석 → 모델/모드 추천 |
| "프로젝트 아키텍처 방향은?" | 사용자 머릿속 | Artifacts + Plan 문서 기반 요약 |

---

## 2. 3-Tier 접근

### Tier 1: 규칙 기반 대시보드 + 알림 (LLM 불필요, 지금 가능)

```
프로젝트 대시보드:
  ├── Plan 현황 (active/done/failed/rework 카운트)
  ├── 총 비용 (trace_log 집계, 엔진별 분류)
  ├── 최근 활동 (마지막 대화 시간, 커밋 수)
  ├── Rework 비율 (plan_events: review_failed / total_reviews)
  ├── 에이전트별 성공률 (engine × verdict 교차표)
  ├── Artifacts 요약 (타입별 카운트)
  └── 대화 수 / 총 메시지 수
```

```
자동 알림:
  ├── "3일간 활동 없음 — 남은 Plan 2개"
  ├── "Rework 비율 40% — Developer 프롬프트 검토 필요"
  ├── "이번 주 비용 $5.20 — 지난주 대비 +30%"
  ├── "Artifact 10개 도달 — 분석 돌려볼까요?"
  └── "context_length가 budget 90% 초과 빈번 — 대화 분리 권장"
```

**구현**: SQL 집계 + 조건 체크. LLM 호출 0.

### Tier 2: 경량 LLM 분석 (저빈도, 비용 미미)

```
주간 / 프로젝트 완료 시 1회:
  ├── Artifacts 패턴 분석 (artifactsTabDesignReviewIdea.md의 10개 트리거)
  ├── 프로젝트 히스토리 자동 요약 (CLAUDE.md 갱신)
  └── 실패 패턴 분석 (어떤 유형의 Plan이 자주 실패하는가)
```

**비용**: 주 1회 분석 ~$0.05 (Claude). 월 ~$0.20.

### Tier 3: 실시간 메타 추론 (tunaMeta, 장기)

```
매 요청마다:
  ├── "이 질문은 새 Plan이 필요한가, 기존 Plan 수정인가?"
  ├── "이 작업에 어떤 모델이 최적인가?"
  └── "context mode를 자동 조정해야 하는가?"
```

**전제**: 128GB Mac Studio + 로컬 대형 모델. M4 Air 16GB에서는 비현실적.

---

## 3. Tier 1 구현 설계

### 백엔드

```rust
// src-tauri/src/commands/meta.rs (새 파일)

#[derive(Serialize)]
pub struct ProjectDashboard {
    pub plan_counts: PlanCounts,        // active / done / failed / rework
    pub total_cost_usd: f64,            // trace_log SUM(cost_usd)
    pub weekly_cost_usd: f64,           // 최근 7일
    pub rework_ratio: f64,              // review_failed / total_reviews
    pub engine_stats: Vec<EngineStat>,  // 엔진별 호출 수 / 비용 / 성공률
    pub artifact_count: usize,          // 타입별
    pub last_activity: i64,             // 최근 메시지 timestamp
    pub conversation_count: usize,
    pub total_messages: usize,
}

#[derive(Serialize)]
pub struct PlanCounts {
    pub active: usize,
    pub done: usize,
    pub failed: usize,
    pub rework: usize,
}

#[derive(Serialize)]
pub struct EngineStat {
    pub engine: String,
    pub call_count: usize,
    pub total_cost_usd: f64,
    pub avg_duration_ms: f64,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
}

#[derive(Serialize)]
pub struct Alert {
    pub level: String,              // "info" / "warning" / "action"
    pub message: String,
    pub action_hint: Option<String>, // "Artifacts 분석 실행" 등
}

#[tauri::command]
pub fn get_project_dashboard(project_key: String, state: State<DbState>) 
    -> Result<ProjectDashboard, AppError>;

#[tauri::command]
pub fn check_project_alerts(project_key: String, state: State<DbState>) 
    -> Result<Vec<Alert>, AppError>;
```

### SQL 쿼리 예시

```sql
-- Plan 현황
SELECT 
  SUM(CASE WHEN phase IN ('implementation', 'review') THEN 1 ELSE 0 END) as active,
  SUM(CASE WHEN phase = 'done' THEN 1 ELSE 0 END) as done,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
  SUM(CASE WHEN phase = 'rework' THEN 1 ELSE 0 END) as rework
FROM plans WHERE conversation_id IN (
  SELECT id FROM conversations WHERE project_key = ?1
);

-- Rework 비율
SELECT 
  COUNT(CASE WHEN event_type = 'review_failed' THEN 1 END) as fails,
  COUNT(CASE WHEN event_type IN ('review_passed', 'review_failed') THEN 1 END) as total
FROM plan_events WHERE plan_id IN (
  SELECT id FROM plans WHERE conversation_id IN (
    SELECT id FROM conversations WHERE project_key = ?1
  )
);

-- 엔진별 통계
SELECT engine,
  COUNT(*) as call_count,
  SUM(cost_usd) as total_cost,
  AVG(duration_ms) as avg_duration,
  SUM(input_tokens) as total_input,
  SUM(output_tokens) as total_output
FROM trace_log WHERE conversation_id IN (
  SELECT id FROM conversations WHERE project_key = ?1
)
GROUP BY engine;

-- 주간 비용
SELECT SUM(cost_usd) FROM trace_log 
WHERE conversation_id IN (SELECT id FROM conversations WHERE project_key = ?1)
AND recorded_at > ?2;  -- 7일 전 timestamp
```

### 알림 조건

```rust
fn check_alerts(dashboard: &ProjectDashboard) -> Vec<Alert> {
    let mut alerts = Vec::new();
    
    // 비활동 경고
    let days_inactive = (now() - dashboard.last_activity) / 86400000;
    if days_inactive >= 3 && dashboard.plan_counts.active > 0 {
        alerts.push(Alert {
            level: "warning".into(),
            message: format!("{}일간 활동 없음 — 진행 중 Plan {}개", days_inactive, dashboard.plan_counts.active),
            action_hint: None,
        });
    }
    
    // Rework 비율 경고
    if dashboard.rework_ratio > 0.3 {
        alerts.push(Alert {
            level: "warning".into(),
            message: format!("Rework 비율 {:.0}% — Developer 프롬프트 검토 필요", dashboard.rework_ratio * 100.0),
            action_hint: Some("Developer 템플릿 점검".into()),
        });
    }
    
    // 비용 경고 (주간 기준)
    if dashboard.weekly_cost_usd > 5.0 {
        alerts.push(Alert {
            level: "info".into(),
            message: format!("이번 주 비용 ${:.2}", dashboard.weekly_cost_usd),
            action_hint: None,
        });
    }
    
    // Artifact 분석 트리거
    if dashboard.artifact_count >= 10 {
        alerts.push(Alert {
            level: "action".into(),
            message: format!("Artifact {}개 도달 — 패턴 분석 가능", dashboard.artifact_count),
            action_hint: Some("Artifacts 분석 실행".into()),
        });
    }
    
    alerts
}
```

### 프론트엔드

**배치**: 사이드바의 Trace 탭을 확장하거나, 별도 Meta 섹션.

```typescript
// 기존 Trace 탭 확장 방식
// TracePanel.tsx 상단에 프로젝트 대시보드 요약 추가

// 또는 별도 패널
// src/components/tunaflow/context-panel/MetaPanel.tsx (~150줄)
```

---

## 4. Tier 간 전환 경로

```
Tier 1 (지금):
  SQL 집계 → 대시보드 + 알림
  → "프로젝트 상태가 한눈에"

Tier 2 (Tier 1 운영 후):
  알림의 "action" 타입 클릭 → LLM 분석 실행
  → Artifacts 패턴 분석, 히스토리 요약
  → 결과를 Artifact로 저장 (순환 구조)

Tier 3 (tunaMeta):
  별도 프로세스/서비스로 분리
  → 매 요청마다 메타 판단
  → tunaFlow에 제안 주입
```

각 Tier가 이전 Tier의 데이터를 활용. Tier 1의 `ProjectDashboard`가 Tier 2/3의 입력.

---

## 5. 변경 범위

### Tier 1

| 파일 | 변경 | 규모 |
|------|------|------|
| 새 파일: `commands/meta.rs` | 대시보드 + 알림 쿼리 | ~200줄 |
| `lib.rs` | Tauri command 등록 | ~5줄 |
| `commands/mod.rs` | 모듈 추가 | ~1줄 |
| 새 파일 또는 기존 확장: 프론트엔드 | 대시보드 UI | ~150줄 |

**총**: ~350줄, DB 변경 없음, 기존 테이블(plans, plan_events, trace_log, artifacts)에서 SELECT만.

---

## 6. tunaMeta와의 관계

| | Tier 1-2 (tunaFlow 내부) | Tier 3 (tunaMeta) |
|---|---|---|
| 실행 위치 | tunaFlow 프로세스 내 | 별도 프로세스/서비스 |
| LLM 의존 | Tier 1: 없음, Tier 2: 저빈도 | 매 요청 |
| 데이터 소스 | SQLite 직접 쿼리 | tunaFlow API 또는 공유 DB |
| 판단 수준 | 통계 + 규칙 기반 알림 | 추론 + 학습 기반 제안 |
| 비용 | ~$0/월 (Tier 1), ~$0.20/월 (Tier 2) | 로컬 모델 전제 |

Tier 1-2를 tunaFlow 안에서 운영하다가, tunaMeta를 개발할 때 `ProjectDashboard` 데이터를 API로 노출하면 tunaMeta가 소비하는 구조.

---

## 참고

- Artifacts 분석: `docs/ideas/artifactsTabDesignReviewIdea.md` (10개 트리거)
- CI 피드백 루프: `docs/ideas/ciExecutionLoopIdea.md` (tunaMeta 역할 분리)
- Trace 고도화: `docs/ideas/traceEnhancementAbtopIdea.md` (tok/s, context %)
- Doom Loop: plan_events 기반 카운터 (세션 7)
- trace_log 스키마: `src-tauri/src/db/migrations.rs` (v6, v11, v16)
- plans/plan_events 스키마: `src-tauri/src/db/migrations.rs` (v3, v18)
