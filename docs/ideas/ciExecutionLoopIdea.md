# CI 피드백 루프 + 실행 레이어 자동화

> Status: idea
> Created: 2026-04-04
> 참고: github.com/jonwiggins/optio (CI 기반 자동 PR 관리)
> 관련: tunaMeta (예정, 프로젝트 레벨 메타 에이전트)

---

## 1. 제안 구조

```
Human → RT (토론/판단) → Human 승인 → [실행 에이전트 루프] → PR 머지
                                        ↓
                                   Developer 실행
                                        ↓
                                   테스트 실행
                                        ↓
                                   실패 → 자동 수정 → 재테스트 (루프)
                                        ↓
                                   성공 → PR 생성 → 머지
```

현재 tunaFlow 워크플로우에서 빠진 부분: **테스트 실패 → 자동 수정 → 재테스트** 루프와 **PR 자동 관리**.

---

## 2. tunaFlow 철학���의 관계

### 충돌하지 않음

tunaFlow의 핵심: 인간이 방향을 결정하고, 에이전트가 실행한다. CI 피드백 루프는 **Human 승인 이후의 실행 자동화**이므로 철학과 일치.

현재도 동일 패턴이 존재:
- Human이 Plan 승인 → Developer 자동 실행
- Developer 완료 → Review RT 자동 실행
- Review pass → Done 자동 전환

CI 피드백 루프는 "Developer 자동 실행"의 연장선.

### 충돌 가능 지점: 무한 루프

```
위험:  Human 승인 → 실행 → CI 실패 → 자동 수정 → CI 실패 → 자동 수정 → ... (무한)
해결:  Doom Loop 패턴 적용 — 3회 실패 → Human 에스컬레이션
```

이미 구현된 Doom Loop 감지(plan_events 기반 카��터)와 동일한 패턴. CI 루프에도 동일 적용.

```
1회 실패: 자동 수정 시도
2회 실패: 경고 + 자동 수정 시도
3회 실패: "CI가 계속 실패합니다. 직접 확인하시겠습니까?" → Human 판단
```

---

## 3. MVP 적절성 — 나중

### 지금 하면 안 되는 이유

**1. 워크플로우 안정화가 먼저**

풀사이클 4회 완료했지만 아직 버그가 발견되는 단계 (임베딩 지연, 결과 문서 품질 등). 실행 레이어 위에 CI 레이어를 얹으면 디버깅 표면이 두 배.

**2. CI 연동은 프로젝트마다 다름**

```
tunaFlow:     cargo test + vitest
tunaInsight:  다른 구성일 수 있음
다른 프로젝트: pytest, go test, GitHub Actions, ...
```

범용 CI 연동은 추상화 비용이 높음. Optio는 GitHub Actions에 특화되어 가능한 것이고, tunaFlow는 로컬 ��스트라 CI 환경이 다양.

**3. 최소 형태가 이미 존재**

현재 `run_project_tests` Tauri command가 있고, Review RT 전에 테스트를 실행. 차이는 "실패 시 자동 수정" 부분뿐.

### 단계적 도입 로드맵

```
Phase 1 (현재):  워크플로우 안정화 + 실사용 검증
                 run_project_tests 결과를 Reviewer에 전달 (이미 구현)

Phase 2 (다음):  테스트 실패 → Developer 자동 피드백 → Rework 재실행
                 기존 Rework 루프에 test 결과를 연결하는 것
                 새 아키텍처 불필요 — Rework 프롬프트에 test output 포함

Phase 3:         git branch 자동 관리 + PR 생성
                 Developer 완료 → git commit → git push → PR 생성
                 로컬 git 연동 (tunaFlow 내부)

Phase 4:         GitHub/GitLab CI 연동 + PR 코멘트 파싱
                 외부 CI 결과 폴링 → 실패 시 자동 수정 루프
                 Optio 패턴 본격 적용
```

**Phase 2가 가장 현실적인 다음 단계**이며, 기존 코드에 ~30�� 추가로 가능:

```typescript
// DevProgressView.tsx — Rework 프롬프트에 test output 포함
const reworkPrompt = [
  `### 🔄 Rework`,
  ``,
  `**실패 사유**: ${verdict.findings.join(", ")}`,
  testOutput ? `**테스트 실패 결과**:\n\`\`\`\n${testOutput}\n\`\`\`` : "",
  ``,
  `위 사항을 수정하고 완료 시 \`<!-- tunaflow:impl-complete -->\`를 포함하세요.`,
].join("\n");
```

---

## 4. tunaMeta와의 역할 분리

### 분리 원칙

```
tunaFlow:  "이번 작업을 어떻게 할까?" — 단일 작업 오케스트레이션
tunaMeta:  "이 프로젝트를 어떻게 진행할까?" — 프로젝트 레벨 메타 관리
```

### CI 루프의 소속

| 결정 | tunaFlow | tunaMeta |
|------|---------|---------|
| "CI 실패했으니 자동 수정 시도" | ✅ | ❌ |
| "3번 실패했으니 Human에게 보고" | ✅ (Doom Loop) | ❌ |
| "PR을 생성할까?" | ✅ | ❌ |
| "이 코드를 어떻게 고칠까?" | ✅ | ❌ |
| "다음에 어떤 작업을 할까?" | ❌ | ✅ |
| "이 모델이 이 프로젝트에 적합한가?" | ❌ | ✅ |
| "지난 10개 작업에서 패턴이 있는가?" | ❌ | ✅ |
| "Developer가 3번 연속 실패. 모델 변경?" | ❌ | ✅ |
| "이번 주 토큰 사용량 최적화" | ❌ | ✅ |

**CI 피드백 루프 자체는 tunaFlow** (단일 작업 내 반복). **프로젝트 레벨 최적화는 tunaMeta** (메타 레이어).

### Artifacts 분석과의 겹침

`artifactsTabDesignReviewIdea.md`의 "10개 트리거 → 패턴 분석 → 개인화"는 사실상 tunaMeta의 프로토타입. tunaFlow 안에서 시작하되, 나중에 tunaMeta로 분리 가능한 인터페이스로 설계해야 함.

```
현재 (tunaFlow):
  Artifacts 10개 → 분석 에이전트 → 패턴 리포트 → Artifact 저장

나중 (tunaMeta):
  tunaMeta가 Artifacts + trace_log + plan_events를 종합 분석
  → 프로젝트 레벨 인사이트
  → 작업 우선순위 제안
  → 모델/에이전트 최적화
```

---

## 5. Optio에서 참고할 패턴 (소스 분석 2026-04-05 보강)

> 소스: `_research/_util/optio/` (TypeScript, Fastify + BullMQ + PostgreSQL)

### 적용할 것

| 패턴 | 설명 | tunaFlow 적용 |
|------|------|--------------|
| **CI 결과 → 에이전트 피드백** | 테스트 실패 output을 에이전트에게 전달 | Phase 2: Rework 프롬프트에 test output 포함 |
| **자동 커밋 + PR** | 구현 완료 → git commit → PR 생성 | Phase 3: 로컬 git 연동 |
| **반복 제한** | 최대 N회 시도 후 중단 | Doom Loop 패턴으로 이미 구현 |

### 신규 — Optio 소스에서 발견한 추가 패턴 (3개)

**5.1 Auto-Resume 카운터 리셋 패턴**

Optio는 "마지막 수동 개입 이후의 자동 재시도 횟수"를 셉니다. 사용자가 수동으로 retry/restart하면 카운터가 **리셋**.

```sql
-- Optio: 마지막 수동 개입 이후의 auto_resume 횟수만 카운트
SELECT count(*) FROM task_events
WHERE task_id = ? AND trigger LIKE 'auto_resume_%'
AND created_at > COALESCE(
  (SELECT MAX(created_at) FROM task_events
   WHERE task_id = ? AND trigger IN ('force_restart', 'user_resume', 'user_retry')),
  '1970-01-01'
)
```

tunaFlow 적용:
```sql
-- plan_events에서 마지막 revision_requested 이후의 review_failed만 카운트
SELECT COUNT(*) FROM plan_events
WHERE plan_id = ? AND event_type = 'review_failed'
AND created_at > COALESCE(
  (SELECT MAX(created_at) FROM plan_events
   WHERE plan_id = ? AND event_type = 'revision_requested'),
  0
)
```

현재 tunaFlow의 `processReviewVerdict()`에서 `failCount >= 2` 체크가 Plan revision 이후에도 리셋되는지 확인 필요. 리셋되지 않으면 수정된 Plan인데도 즉시 에스컬레이션 트리거.

**5.2 Error Classification (에러 분류 테이블)**

Optio는 에러 메시지를 패턴 매칭으로 분류하여 **재시도 가능 여부를 자동 판단**:

```typescript
// Optio: error-classifier.ts
[
  { pattern: /context.?length.*exceeded/i, retryable: false, category: "agent" },
  { pattern: /rate.?limit|429/i, retryable: true, category: "network" },
  { pattern: /timeout|ETIMEDOUT/i, retryable: true, category: "timeout" },
  { pattern: /OOMKilled/i, retryable: true, category: "resource" },
]
```

tunaFlow에서 에이전트 실패 시 모든 에러를 동일하게 처리. context overflow(재시도 무의미)와 rate limit(재시도 가능)을 구분하지 않음.

적용 위치: `finalize_engine_run()` 에러 경로에서 에러 메시지 패턴 매칭 → `plan_events`에 분류 결과 저장 → Rework 시 재시도 가능 여부 표시.

**5.3 Resume vs Fresh Session 선택**

```
Optio:
  resumeSessionId 있으면 → 기존 대화 이어서 (컨텍스트 유지)
  resumeSessionId 없으면 → 새 세션으로 fresh start
```

tunaFlow의 Rework는 항상 기존 Implementation Branch에서 이어감. 에이전트가 잘못된 방향으로 깊이 빠졌을 때 **fresh session으로 다시 시작하는 옵션이 없음**.

적용: Rework UI에 "이어서 수정" (기존 Branch) vs "처음부터 다시" (새 Branch) 선택지 제공. 3회 실패 시 "처음부터 다시"를 권장.

### 적용하지 않을 것

| 패턴 | 이유 |
|------|------|
| **GitHub Actions 직접 트리거** | tunaFlow는 로컬 퍼스트. 외부 CI 의존은 Phase 4 |
| **PR 코멘트 자동 파싱** | `gh` CLI로 직접 가능. 별도 API 연동 불필요 |
| **자동 머지** | Human 승인 없는 머지는 tunaFlow 철학 위반 |
| **Kubernetes pod-per-repo** | tunaFlow는 데스크톱 앱. 컨테이너 격리 불필요 |
| **PostgreSQL + Redis** | SQLite WAL로 충분 |
| **Notion/Linear/Jira 연동** | 티켓 시스템 연동 불필요 |
| **GitHub App + credential helper** | `gh auth`로 충분 |

---

## 6. 구현 우선순위

| Phase | 내용 | 시점 | 규모 |
|-------|------|------|------|
| **Phase 2** | Rework 프롬프트에 test output 포함 | 워크플로우 안정화 후 | ~30줄 FE |
| **Phase 3** | git commit + branch + PR 생성 | Phase 2 검증 후 | ~200줄 BE + FE |
| **Phase 4** | 외부 CI 연동 + PR 코멘트 파싱 | 필요 시 | ~500줄 BE + FE |

Phase 2는 기존 Rework 루프에 test output을 연결하는 것으로, 새 아키텍처가 아닌 기존 프롬프트 확장.

---

## 참고

- Optio 소스: `_research/_util/optio/` (TypeScript monorepo)
  - PR watcher: `apps/api/src/workers/pr-watcher-worker.ts` (670줄)
  - Task worker: `apps/api/src/workers/task-worker.ts` (210줄)
  - Error classifier: `packages/shared/src/error-classifier.ts`
  - State machine: `packages/shared/src/utils/state-machine.ts`
  - Agent adapters: `packages/agent-adapters/src/`
- Optio GitHub: https://github.com/jonwiggins/optio
- tunaFlow Rework 루프: `src/components/tunaflow/context-panel/DevProgressView.tsx`
- tunaFlow test runner: `src-tauri/src/commands/project_tools.rs` (`run_project_tests`)
- Doom Loop 감지: plan_events 기반 카운터 (세션 7 구현)
- Artifacts 분석: `docs/ideas/artifactsTabDesignReviewIdea.md`
- tunaMeta: 예정 (로컬 LLM 기반 메타 에이전트)
