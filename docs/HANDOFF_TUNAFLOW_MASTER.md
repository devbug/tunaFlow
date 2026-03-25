# HANDOFF_TUNAFLOW_MASTER.md — tunaFlow 핸드오프 문서

> **최종 갱신**: 2025-03-25 (코드 기준 검증 완료)
> **이 문서는 새 작업자가 가장 먼저 읽는 문서다.**

---

## 1. 프로젝트 한줄 정의

**tunaFlow는 Tauri 2 + React + Rust + SQLite 기반의 3패널 멀티에이전트 오케스트레이션 IDE다.**

로컬 CLI 에이전트(Claude Code, Codex, Gemini CLI, OpenCode)를 동시에 관리하며,
대화 분기(Branch), 원탁회의(Roundtable), 메모/아티팩트, 스킬 시스템을 제공한다.

---

## 2. 절대 원칙

1. **src-tauri 변경 최소화** — 백엔드 수정은 반드시 근거 확인 후, 명확한 목적이 있을 때만 한다.
2. **DB 스키마 변경 = 마이그레이션** — `src-tauri/src/db/schema.rs`에 새 버전으로 추가. 기존 테이블 직접 수정 금지.
3. **단일 Store** — 프론트엔드 상태는 `src/stores/chatStore.ts` 하나로 관리 (Zustand v5).
4. **ContextPack은 runtime-only** — DB에 영속화하지 않음. 매 요청마다 동적 조립.
5. **DB lock 패턴** — 에이전트 subprocess 실행 중에는 반드시 DB 락 해제. `lock → data load → unlock → subprocess → lock → persist` 순서.

---

## 3. 현재 구현 완료 범위

### 백엔드 (src-tauri)
- **4개 CLI 에이전트**: Claude (one-shot + streaming), Codex (stdin), Gemini (node 직접), OpenCode
- **ContextPack 조립 (Claude: full 5단계)**: Agent prompt → Skills → rawq → Cross-session → Conversation context (guardrail 적용). Codex/Gemini/OpenCode는 lite context(최근 4메시지 prompt prefix)만 지원. (`commands/agents.rs`)
- **Roundtable**: 다중 라운드(1-3), 다중 엔진, follow-up, transcript 아카이브
- **Branch**: 생성, 목록, shadow conversation, adopt (placeholder summary)
- **Memo/Artifact CRUD**: 전체 구현
- **Skill**: `~/.tunaflow/skills/{name}/SKILL.md` 로딩
- **Guardrail**: 섹션별 truncation, 전체 60K 제한, stderr 로깅
- **ResumeToken**: Claude 전용, conversations 테이블 인라인 저장

### 프론트엔드 (src)
- **3패널 레이아웃**: Sidebar(224px) + ChatPanel(flex) + ContextPanel(256px)
- **Tailwind CSS v4** 다크 테마 적용 (v0 UI 병합 완료)
- **에이전트별 색상 배지**: Claude/Codex/Gemini/OpenCode
- **Stream/Roundtable 뷰 토글** (RT 대화에서만)
- **ContextPanel 5탭**: Branch, Artifacts, Memos, Skills, Cross-session
- **MessageInput**: 엔진 선택, RT rounds(1-3), follow-up 버튼
- **대화 삭제**: confirm 다이얼로그 + cascade 삭제

---

## 4. 아직 부족한 부분

| 영역 | 상태 | 비고 |
|------|------|------|
| Branch adopt summary 실제 생성 | 미구현 | 현재 placeholder 텍스트만 삽입 |
| ~~Branch → thread 슬라이딩 패널 UI~~ | **구현 완료** | `BranchThreadPanel.tsx` — Peek 모드로 오버레이 패널 |
| Roundtable synthesis | 미구현 | 참가자 응답 종합 결과물 생성 없음 |
| FTS 검색 | 미구현 | 스키마만 존재 (messages_fts) |
| trace_log 기록 | 미구현 | 테이블만 존재 |
| Workspace 스캔 | 미구현 | DATA_MODEL에 정의되어 있으나 코드 없음 |
| Branch-git 연동 | 미구현 | |
| Soft delete (30일 보관) | 미구현 | 사용자 요청 있었으나 미착수 |
| 에이전트 정의 관리 UI | 없음 | loader.rs가 파일을 읽지만 UI 없음 |
| rawq 실제 연동 | 부분 | 기본 keyword 포함 검색만. regex/AST 파싱 없음. 3자이상 키워드 5개, 파일 300개 제한 (`agents/rawq.rs`) |
| ~~Codex/Gemini/OpenCode ContextPack~~ | **lite context 구현** | 최근 4메시지 prompt prefix 주입 (`commands/agents.rs:build_lite_context_prompt`) |
| RT 라운드 구분 | **개선 완료** | system header 인식 + persona fallback 2단계 전략 (`RoundtableView.tsx:groupIntoRounds`) |

---

## 5. UI/UX 최우선 개선 과제

1. ~~Branch를 thread처럼 보이게~~: **구현 완료** — Peek 버튼으로 슬라이딩 오버레이 패널 열림. Open(대화교체)도 유지.
2. **메시지별 메타데이터 가시성**: 엔진, 모델, 토큰 수, 비용 등을 메시지 카드에 표시.
3. ~~Roundtable 라운드 구분 불안정~~: **개선 완료** — system header(`engine='system'`, `"--- Round"` 패턴) 우선 인식 + persona 반복 fallback 2단계 전략.
4. **에러 표시 개선**: 현재 상단 배너 한 줄. 메시지 단위 인라인 에러 표시 필요.
5. ~~레거시 컴포넌트 정리~~: **삭제 완료** (2025-03-25). 6개 파일 + `src/pages/` 디렉토리 제거됨.

---

## 6. 주요 문서 링크

| 문서 | 경로 | 역할 |
|------|------|------|
| **이 문서** | `docs/HANDOFF_TUNAFLOW_MASTER.md` | 최상위 진입점 |
| 도메인 모델 SSOT | `docs/reference/DATA_MODEL_REVISED.md` | 엔티티 정의 기준 |
| 구현 상태 | `docs/reference/IMPLEMENTATION_STATUS.md` | 기능별 구현 상태표 |
| 프론트엔드 아키텍처 | `docs/reference/FRONTEND_ARCHITECTURE.md` | UI 구조, 컴포넌트 트리 |
| 작업 규칙 | `docs/reference/WORKING_RULES_FOR_AGENTS.md` | 수정 시 주의사항 |
| RT 수정 이력 | `docs/RT_FIX_CHANGELOG.md` | CLI 에이전트 구조적 문제 해결 기록 |
| 다음 단계 개요 | `docs/reference/NEXT_PHASES_OVERVIEW.md` | 향후 작업 로드맵 |

---

## 7. 코드 구조 빠른 진입점

```
tunaFlow/
├── src/                          ← 프론트엔드 (React + Vite + Tailwind v4)
│   ├── main.tsx                  ← React 부트스트랩 + CSS import
│   ├── App.tsx                   ← AppShell 래퍼
│   ├── index.css                 ← Tailwind v4 CSS 변수 (다크 테마)
│   ├── stores/chatStore.ts       ← Zustand 단일 Store (모든 상태)
│   ├── types/index.ts            ← TS 타입 정의 (도메인 모델)
│   ├── lib/
│   │   ├── constants.ts          ← DEFAULT_MODEL, ROUNDTABLE_PARTICIPANTS
│   │   └── utils.ts              ← cn(), AGENT_COLORS, formatTimestamp
│   ├── components/tunaflow/      ← 현재 사용 중인 UI 컴포넌트
│   │   ├── AppShell.tsx          ← 3패널 레이아웃 + 초기화
│   │   ├── Sidebar.tsx           ← 좌측 패널 (프로젝트/대화)
│   │   ├── ChatPanel.tsx         ← 중앙 패널 (메시지 + 입력)
│   │   ├── MessageItem.tsx       ← 개별 메시지 렌더링
│   │   ├── NewMessageInput.tsx   ← 메시지 입력 (엔진 선택, RT)
│   │   ├── RoundtableView.tsx    ← RT 카드 뷰 (라운드 자동 감지)
│   │   ├── ContextPanel.tsx      ← 우측 패널 (5탭)
│   │   └── StatusBar.tsx         ← 상단 상태 배지
│   └── (레거시 파일 6개 삭제 완료 — 2025-03-25)
│
├── src-tauri/src/                ← 백엔드 (Rust + Tauri 2)
│   ├── lib.rs                    ← Tauri 앱 진입, 커맨드 등록
│   ├── errors.rs                 ← AppError enum
│   ├── guardrail.rs              ← 프롬프트 크기 제한, 로깅
│   ├── db/
│   │   ├── mod.rs                ← init(), DbState
│   │   ├── schema.rs             ← V1 + V2 DDL
│   │   ├── migrations.rs         ← 마이그레이션 적용
│   │   └── models.rs             ← Rust 구조체 (Project, Conversation, ...)
│   ├── commands/                  ← Tauri 커맨드 (invoke 대상)
│   │   ├── agents.rs             ← send_with_claude/codex/gemini/opencode + stream_with_claude
│   │   ├── roundtable.rs         ← roundtable_run, roundtable_followup
│   │   ├── conversations.rs      ← CRUD + delete cascade
│   │   ├── branches.rs           ← create, list, open_stream, adopt
│   │   ├── messages.rs           ← list, create_user, append_assistant, update_status
│   │   ├── memos.rs              ← CRUD
│   │   ├── artifacts.rs          ← CRUD
│   │   ├── skills.rs             ← list, get (파일시스템 기반)
│   │   └── projects.rs           ← CRUD
│   └── agents/                    ← CLI 에이전트 래퍼
│       ├── claude.rs             ← run() + stream_run()
│       ├── codex.rs              ← run() (stdin 모드)
│       ├── gemini.rs             ← run() (node 직접 호출)
│       ├── opencode.rs           ← run()
│       ├── loader.rs             ← Agent 정의 파일 로드
│       └── rawq.rs               ← 코드 키워드 검색
│
├── docs/                          ← 프로젝트 문서
├── v0-export/                     ← v0 생성 원본 (참고용, 사용 안 함)
├── vite.config.ts                 ← Vite + Tailwind v4 + @/ alias
├── tsconfig.json                  ← TS 설정 + @/* paths
└── package.json                   ← 의존성
```

---

## 8. Claude Code / Codex / v0 작업 시 주의사항

- **src-tauri 수정 금지** (문서화 대상에서 "수정 금지"가 기본 원칙).
- v0 UI 병합은 완료됨. `v0-export/`는 참고용으로만 유지.
- 레거시 파일 6개 + `src/pages/` 디렉토리는 삭제 완료 (2025-03-25).
- DB 스키마 변경 시 `V3_SCHEMA`를 `schema.rs`에 추가하고 `migrations.rs`에서 적용.
- 모든 에이전트 subprocess는 `std::env::temp_dir()`을 cwd로 사용 (코딩 모드 진입 방지).
- Windows 환경: Codex는 stdin 모드, Gemini는 `node index.js` 직접 호출 (`.cmd` 래퍼 불가).
