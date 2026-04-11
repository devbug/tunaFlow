# Dependency Recommendations

> updated_at: 2026-03-31
> type: reference
> canonical: true

---

## 현재 설치된 의존성

### Rust (Cargo.toml)

| Crate | 버전 | 용도 |
|-------|------|------|
| tauri | 2 | Desktop shell |
| tauri-plugin-dialog | 2 | 파일/폴더 선택 |
| tauri-plugin-fs | 2.4.5 | 파일 시스템 접근 + watch |
| tauri-plugin-notification | 2 | 에이전트 완료 알림 |
| tauri-plugin-store | 2 | appStore 설정 영속화 |
| tauri-plugin-window-state | 2 | 창 위치/크기 복원 |
| rusqlite | 0.31 (bundled) | SQLite DB |
| serde / serde_json | 1 | 직렬화 |
| uuid | 1 (v4) | ID 생성 |
| tempfile | 3 | Claude system prompt temp file |
| thiserror | 1 | 에러 타입 |
| lazy_static | 1 | 모델 캐시 |
| dirs | 5 | 홈 디렉토리 탐색 |

### Frontend (package.json)

| 패키지 | 용도 |
|--------|------|
| react 18 + react-dom | UI |
| zustand 5 | State management |
| tailwindcss 4 + tw-animate-css | 스타일 |
| react-markdown + remark-gfm | 마크다운 렌더링 |
| react-syntax-highlighter | 코드 하이라이팅 |
| lucide-react | 아이콘 |
| @tauri-apps/api + plugins | Tauri IPC |

---

## 추천: Tauri 플러그인

### P0 — 즉시 도입 권장

| 플러그인 | 용도 | 이유 |
|----------|------|------|
| **tauri-plugin-clipboard-manager** | 클립보드 읽기/쓰기 | 현재 `navigator.clipboard`는 포커스 없을 때 실패. 코드 블록 복사, RT 결과 복사에 안정적 |
| **tauri-plugin-shell** | 외부 프로세스 관리 | 현재 `std::process::Command` 직접 사용. shell 플러그인은 sidecar 관리, 환경변수 상속, 프로세스 그룹 종료를 더 안전하게 처리. rawq daemon + CLI agents 관리 개선 |

### P1 — 다음 마일스톤

| 플러그인 | 용도 | 이유 |
|----------|------|------|
| **tauri-plugin-opener** | URL/파일 열기 | 메시지 내 파일 경로 클릭 → OS 기본 앱으로 열기. FileViewer 연동 |
| **tauri-plugin-process** | 앱 프로세스 제어 | graceful restart, exit code 관리 |

### P2 — 배포/운영 단계

| 플러그인 | 용도 | 이유 |
|----------|------|------|
| **tauri-plugin-updater** | 자동 업데이트 | 배포 시 필수 |
| **tauri-plugin-global-shortcut** | 전역 단축키 | 빠른 채팅 열기, 에이전트 전환 |
| **tauri-plugin-log** | 구조화된 로깅 | 현재 `eprintln!` 사용 → 파일 로깅 + 레벨 필터링 |
| **tauri-plugin-http** | HTTP 클라이언트 | context-hub REST API 직접 호출 시 |

---

## 추천: Rust Crates

### P0 — 즉시 도입 권장

| Crate | 용도 | 이유 |
|-------|------|------|
| **tokio** (features: rt-multi-thread, sync) | async runtime | 현재 `std::thread::spawn` + `mpsc::channel`. tokio로 전환하면 async/await, 타임아웃, cancellation token 등 에이전트 실행 제어가 근본적으로 개선. Tauri 2는 tokio 기반 |
| **chrono** | 날짜/시간 | 현재 `now_epoch()` 수동 구현. 타임존, 포맷팅, 비교 필요 (문서 날짜, trace 시간표시) |

### P1 — multi-agent 고도화

| Crate | 용도 | 이유 |
|-------|------|------|
| **reqwest** | HTTP 클라이언트 | context-hub API 호출, 향후 LLM API 직접 호출 (CLI 우회) |
| **regex** | 정규식 | 현재 `contains()` 기반 키워드 매칭. 코드 패턴 감지, 스킬 매칭, FTS 쿼리 빌더에 필요 |
| **dashmap** | 동시성 HashMap | 현재 `Mutex<HashMap>` 사용 (MODEL_CACHE 등). lock contention 감소 |
| **once_cell** | lazy 초기화 | `lazy_static` 대체. Rust 표준 경로에 더 가까움 |

### P2 — Vector DB / 의미 검색

| Crate | 용도 | 이유 |
|-------|------|------|
| **sqlite-vec** 또는 **zerocopy-vec** | SQLite vector extension | rawq embedding을 활용한 메시지 의미 검색. 기존 SQLite에 vector 컬럼 추가 |
| **candle-core** (Hugging Face) | 로컬 임베딩 | rawq가 불가능한 경우 자체 embedding 생성 |
| **tiktoken-rs** | 토큰 카운팅 | 정확한 context budget 계산. 현재 char 기반 근사치 사용 |

### P3 — 운영/품질

| Crate | 용도 | 이유 |
|-------|------|------|
| **tracing + tracing-subscriber** | 구조화 로깅 | `eprintln!` → span 기반 로깅. 성능 프로파일링, 에러 추적 |
| **anyhow** | 에러 컨텍스트 | `AppError` 보완. 에러 체인에 context 추가 |
| **tower** | 미들웨어 패턴 | 에이전트 실행 파이프라인에 retry, timeout, rate limit 미들웨어 적용 |

---

## 추천: Frontend 라이브러리

### P0

| 패키지 | 용도 | 이유 |
|--------|------|------|
| **react-virtuoso** | 가상 스크롤 | 200+ 메시지 대화 성능. 현재 전체 map 렌더 |
| **cmdk** 또는 **kbar** | 커맨드 팔레트 | 빠른 에이전트 전환, 프로젝트 검색, 대화 이동 |

### P1

| 패키지 | 용도 | 이유 |
|--------|------|------|
| **shiki** (via shikiji) | 코드 하이라이팅 | react-syntax-highlighter 대체. 더 정확한 구문 강조, VS Code 테마 호환 |
| **sonner** | 토스트 알림 | scaffold 알림, 에러 표시. 현재 시스템 메시지로 대체하는 중 |
| **@dnd-kit/core** | 드래그앤드롭 | 사이드바 프로젝트/대화 순서 정렬 |

### P2

| 패키지 | 용도 | 이유 |
|--------|------|------|
| **tiptap** 또는 **lexical** | 리치 텍스트 에디터 | 입력창 고도화: 멘션(@agent), 파일 참조, 마크다운 미리보기 |
| **recharts** 또는 **nivo** | 차트 | evaluation 결과 시각화, 비용 통계 |
| **framer-motion** | 애니메이션 | 드로어 전환, 메시지 입장 애니메이션 |

---

## 도입 우선순위 요약

### 바로 설치 (이번 세션 또는 다음)

```bash
# Tauri plugins
cargo add tauri-plugin-clipboard-manager tauri-plugin-shell tauri-plugin-opener
npm install @tauri-apps/plugin-clipboard-manager @tauri-apps/plugin-shell @tauri-apps/plugin-opener

# Rust crates
cargo add tokio --features rt-multi-thread,sync
cargo add chrono --features serde

# Frontend
npm install react-virtuoso cmdk sonner
```

### 다음 마일스톤

```bash
cargo add reqwest --features json,rustls-tls
cargo add regex dashmap once_cell
npm install shikiji
```

### Vector DB 도입 시

```bash
cargo add tiktoken-rs
# sqlite-vec는 별도 빌드 필요
```
