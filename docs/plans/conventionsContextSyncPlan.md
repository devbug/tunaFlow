---
name: ContextPack 정적 레이어 → conventions 파일 sync (Phase 1)
status: in_progress
created_at: 2026-04-15
branch: feat/conventions-context-sync
canonical: true
---

# 목적

ContextPack의 **정적 레이어**(매 turn 거의 변하지 않는 정보)를 각 엔진의 conventions 파일(`CLAUDE.md`/`AGENTS.md`/`GEMINI.md`)에 영속화해, ContextPack 본문에서 매 turn 송신하지 않도록 한다. 토큰 총량 자체는 비슷하지만 **prompt cache 효과로 비용 ~10배 절감** 가능 (Anthropic prompt cache 기준).

## 배경

기존 ContextPack은 매 turn 다음을 user message로 새로 조립:
- platform / project meta
- agent_role_doc (페르소나 역할 지시)
- persona_fragment
- user_profile
- plan/findings/artifacts (정적 — 자주 안 변함)
- compressed_memory (반정적)
- recent context (동적)
- retrieval / cross-session (동적)

문제:
- user message 영역은 cache 안 됨 → 매 turn 풀 비용
- 정적 레이어가 매 turn 5–10k 토큰 차지 → 누적 비용 큼
- minimal mode로 생략하면 에이전트가 역할/맥락 잊음 (안전 X)

해결: 정적 레이어를 conventions 파일에 두면 system prompt prefix로 자동 prepended → cache hit → 비용 1/10.

# 분류 — 어떤 레이어를 옮길지

## A. 파일 sync 대상 (정적, 거의 안 변함)
| 레이어 | 변동성 | 참고 |
|---|---|---|
| platform / project meta | 거의 정적 (프로젝트 path, 언어, 빌드 명령어 등) | 프로젝트 변경 시만 |
| agent_role_doc | 정적 (프로젝트별 1회 작성) | 페르소나 변경 시만 |
| persona_fragment | persona 선택 시 변경 | persona 전환마다 |
| user_profile | 사용자 설정 변경 시만 | 사용자 명시 변경 |

## B. ContextPack 잔류 (동적, turn마다 변함)
| 레이어 | 변동성 |
|---|---|
| recent context (current_messages) | 매 turn |
| compressed_memory | conv 압축 시점마다 |
| plan/findings/artifacts | 작업 진행 따라 변함 (현재 상태 snapshot) |
| retrieval (vector search) | prompt 따라 매 turn |
| cross-session | 사용자 명시 attach마다 |
| participants meta | RT 진행 따라 |

# 설계

## 1. DB 스키마

기존 `projects` 테이블에 컬럼 추가하지 않고 별도 테이블 (격리/확장성):

```sql
CREATE TABLE project_conventions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key TEXT NOT NULL,
  -- "platform" | "agent_role" | "persona" | "user_profile"
  layer TEXT NOT NULL,
  -- persona_label (NULL = 모든 페르소나 공통)
  persona_label TEXT,
  content TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(project_key, layer, persona_label)
);
```

이유:
- 레이어별 분리 → 사용자가 layer별로 편집/삭제 가능
- persona별 분리 (persona_label IS NULL = 공통, 특정 persona는 그 페르소나 활성화 시만)

## 2. 파일 sync 메커니즘

### 마커 컨벤션
```markdown
<!-- tunaflow:managed:start -->
{auto-generated content from DB}
<!-- tunaflow:managed:end -->

[사용자 영역 — tunaflow가 절대 건드리지 않음]
```

마커 사이에만 우리가 갱신. 마커 없으면 파일 끝에 추가. 사용자 영역은 read-only.

### Engine별 파일명 매핑
| 엔진 | 파일 |
|---|---|
| claude | `CLAUDE.md` |
| codex | `AGENTS.md` |
| gemini | `GEMINI.md` |
| opencode | `AGENTS.md` 추정 (확인 필요) |

여러 엔진이 같은 파일(`AGENTS.md`)을 공유하는 경우, 마커 안에 engine별 섹션으로 분리:
```markdown
<!-- tunaflow:managed:start -->
## Project context (managed by tunaFlow)
{platform/agent_role/...}
<!-- tunaflow:managed:end -->
```

### Sync 트리거
1. **명시적 (사용자 액션)**: Settings에서 user_profile/persona/agent_role 변경 → 즉시 sync
2. **lazy (send 직전)**: send 시점에 DB와 파일 마지막 갱신 시각 비교, 다르면 sync
3. **persona 전환 시**: persona가 바뀌면 그 persona용 content로 갱신

## 3. ContextPack 변경

`assemble_prompt`에서 sync 활성화 conv는 정적 레이어 생략:

```rust
let conventions_synced = is_conventions_synced(project_key);
if !conventions_synced {
    // 기존 동작: 모든 레이어 ContextPack에 포함
    sections.push(platform_section);
    sections.push(agent_role_section);
    ...
} else {
    // 정적 레이어 생략 — conventions 파일에 있음
    // 동적 레이어만 포함
    sections.push(recent_context);
    sections.push(plan_section);
    sections.push(findings_section);
    ...
}
```

설정으로 on/off 가능 (실험 단계라 default off, 사용자가 명시 활성화).

## 4. 새 함수/모듈

### `src-tauri/src/commands/conventions_sync.rs` (신규)
- `pub fn sync_conventions(project_path: &Path, project_key: &str, persona_label: Option<&str>) -> Result<(), AppError>`
  - DB에서 layer 조회 (projects + persona별)
  - engine별 파일에 마커 영역 갱신
- `pub fn read_managed_section(file_path: &Path) -> Option<String>`
  - 파일에서 마커 사이 영역 추출
- `pub fn write_managed_section(file_path: &Path, content: &str) -> Result<()>`
  - 마커 사이 영역만 교체 (사용자 영역 보존)

### `src-tauri/src/db/migrations.rs`
- migration v32: project_conventions 테이블 + 인덱스

### `src-tauri/src/commands/conventions.rs` (신규 — Tauri commands)
- `set_convention(project_key, layer, persona_label, content)` — UI에서 호출
- `get_conventions(project_key, persona_label)` — UI에서 표시
- `delete_convention(project_key, layer, persona_label)` — UI에서 삭제

### `src-tauri/src/commands/agents_helpers/send_common/persistence.rs`
- `prepare_engine_run`에 conventions sync 호출 (lazy trigger)
- 또는 별도 함수 `ensure_conventions_synced`

### `src-tauri/src/commands/agents_helpers/send_common/prompt_assembly.rs`
- `assemble_prompt`에 `conventions_synced` 분기

# Phase 1 범위 (이번 브랜치)

1. ✅ DB schema migration (project_conventions 테이블)
2. ✅ conventions_sync 모듈 (DB 읽기 → 파일 write, 마커 처리)
3. ✅ Tauri commands (set/get/delete)
4. ✅ ContextPack 분기 (생략 vs 기존)
5. ✅ Settings UI (사용자가 layer/persona별로 편집 가능)
6. ✅ 단위 테스트
7. ✅ 사용자 활성화 토글 (`TUNAFLOW_CONVENTIONS_SYNC=1` 또는 설정 UI)

# Phase 2 (이후, 별도 작업)

- 자동 마이그레이션 (기존 ContextPack의 정적 레이어 → DB 자동 추출)
- engine별 파일 충돌 처리 (codex + opencode 같은 AGENTS.md 공유)
- prompt cache 비용 측정 (실측 후 효과 확인)
- minimal mode와 통합 (정적은 파일, 동적은 ContextPack, minimal은 동적도 생략)

# 위험/고려사항

1. **사용자 영역 보호** — 마커 잘못 읽거나 사용자가 마커 손으로 지우면 파일 손상 위험. 백업 + 마커 누락 시 안전 fallback (파일 끝에 추가) 필요
2. **Race condition** — sync 도중 에이전트가 파일 read하면 일관성 문제. atomic write (temp file → rename)
3. **Persona 전환 race** — UI에서 persona 바꾸자마자 send하면 sync 완료 전에 send 시작. lazy sync는 send 직전 await
4. **Engine별 파일명 충돌** — codex와 opencode가 둘 다 AGENTS.md 사용 시 한 파일을 두 엔진이 공유 → 별도 섹션 또는 통합 결정
5. **Cache 효과 검증** — prompt cache가 실제로 우리 use case에 효과 있는지 측정 필요 (Anthropic API 사용 시만 — Claude API 호출 비용 trace 비교)
6. **Multi-project** — 한 머신에 여러 프로젝트 → 각 프로젝트의 CLAUDE.md 따로 관리. project_key 기반으로 격리

# 실행 순서

1. plan 문서 (이 파일) 작성 — 사용자 confirm
2. DB migration v32
3. conventions_sync 모듈 (테스트 포함)
4. ContextPack 분기 (env flag 기반)
5. Tauri commands
6. Settings UI (간단한 textarea 기반)
7. 사용자 수동 활성화 + 검증
8. 결과 확인 후 main 머지 결정
