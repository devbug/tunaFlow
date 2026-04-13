# 개발자 베타 공개 준비 계획

> Status: draft
> Created: 2026-04-13
> 목표: 1주일 이내 개발자 베타 (v0.1.0-beta.1) 도달
> 타겟: 시니어 개발자 / AI 파워유저 (CLI 직접 설치 가능한 사용자)

---

## 1. 진짜 BLOCKER (반드시 해결)

### 1.1 RT prompt.rs unwrap → 안전 처리 (2-3시간)

**위험**: RT 실행 중 `.find("Your Identity").unwrap()`이 특정 문자열 없으면 패닉 → 앱 크래시.

```
파일: src-tauri/src/commands/roundtable_helpers/prompt.rs
위치: 9곳의 .find(...).unwrap()
수정: .unwrap() → .unwrap_or(0) 또는 ? 연산자로 에러 반환
검증: cargo test --lib + RT 실행 테스트
```

### 1.2 HTTP API unwrap → ? 처리 (반나절)

**위험**: API 핸들러에서 unwrap 실패 시 500 에러. axum task 단위 패닉이라 앱 전체 크래시는 아니지만, 클라이언트에 에러 응답 없이 연결 끊김.

```
파일: src-tauri/src/http_api/*.rs
위치: 13곳의 .unwrap()
수정: .unwrap() → ? + 적절한 에러 응답 (400/404/500)
검증: curl 테스트
```

### 1.3 CORS 미들웨어 추가 (30분)

**위험**: 모바일 웹/PWA에서 API 호출 시 브라우저 CORS 차단.

```
파일: src-tauri/src/http_api/mod.rs
추가: tower_http::cors::CorsLayer (localhost:* + tunaflow.d9ng.site)
검증: 모바일 브라우저에서 API 호출 성공
```

---

## 2. 중요 (베타 품질 향상)

### 2.1 중요 경로 silent catch → toast (1-2일)

74곳 중 **합리적 fallback이 아닌 것만** 수정:

| 경로 | 파일 | 위험도 |
|------|------|--------|
| 에이전트 실행 실패 | `ptyMessageSender.ts` | 높음 — 사용자가 실패를 모름 |
| 프로젝트 저장 실패 | `projectSlice.ts` | 높음 — 상태 불일치 |
| Plan 상태 전환 실패 | `workflowOrchestration.ts` | 높음 — 워크플로우 멈춤 |
| 메시지 전송 실패 | `runtimeSlice.ts`, `threadSlice.ts` | 높음 |

**수정 안 해도 되는 것** (합리적 fallback):
- `pty_get_screen().catch(() => "")` — 빈 문자열 fallback, 정당
- `pty_is_alive().catch(() => false)` — false fallback, 정당
- `save_progress_content().catch(() => {})` — 보조 기능

**수정 방법**: `console.error` + `toast.error("에이전트 실행에 실패했습니다")` 추가.

### 2.2 깨진 테스트 수정 (1-2시간)

```
smoke-workspace.test.tsx — "Results" 탭 라벨이 변경됐는데 테스트 미갱신
수정: 테스트의 탭 라벨을 현재 UI에 맞춤
```

### 2.3 DB 마이그레이션 전 백업 (2-3시간)

```
파일: src-tauri/src/db/mod.rs — init() 함수
추가: 마이그레이션 실행 전 .db → .db.bak 복사 (1줄)
  let backup_path = db_path.with_extension("db.bak");
  std::fs::copy(&db_path, &backup_path).ok(); // 실패해도 진행
검증: 마이그레이션 후 .bak 파일 존재 확인
```

---

## 3. 권장 (베타 후 점진 개선)

| 항목 | 우선순위 | 시점 |
|------|---------|------|
| CLI 설치 감지 + 안내 UI | P1 | 온보딩 메타에이전트와 함께 |
| API 토큰 → OS Keychain | P1 | 모바일 본격 사용 시 |
| rawq 크로스 플랫폼 빌드 | P1 | Linux/Windows 사용자 생기면 |
| 입력 검증 (Zod schema) | P2 | HTTP API 안정화 후 |
| E2E 워크플로우 테스트 | P2 | HTTP API 활용 |
| Rust unwrap 나머지 (정규식 등) | P2 | 컴파일 타임 안전한 것은 후순위 |

---

## 4. 실행 순서

```
Day 1:
  □ 1.1 RT prompt.rs unwrap 수정 (2-3시간)
  □ 1.3 CORS 미들웨어 추가 (30분)
  □ 2.2 깨진 테스트 수정 (1-2시간)

Day 2:
  □ 1.2 HTTP API unwrap → ? 처리 (반나절)
  □ 2.3 DB 백업 추가 (2-3시간)

Day 3-4:
  □ 2.1 중요 경로 silent catch → toast (1-2일)
    - ptyMessageSender.ts
    - projectSlice.ts
    - workflow 관련
    - runtimeSlice.ts, threadSlice.ts

Day 5:
  □ 전체 검증 (cargo test + vitest + 수동 풀사이클)
  □ README 업데이트 (설치 요구사항 명확화)
  □ v0.1.0-beta.1 태그

```

---

## 5. 베타 공개 체크리스트

```
BLOCKER (Day 1-2):
  [ ] RT prompt.rs — 0 unwrap in hot path
  [ ] HTTP API — 0 unwrap in handlers, 에러 응답 반환
  [ ] CORS — 모바일 브라우저 API 호출 성공

품질 (Day 3-4):
  [ ] 중요 경로 silent catch → toast 또는 console.error
  [ ] 테스트 전체 통과 (0 failures)
  [ ] DB 마이그레이션 전 백업 동작

검증 (Day 5):
  [ ] cargo check — 에러 0
  [ ] cargo test --lib — 전체 통과
  [ ] npx tsc --noEmit — 에러 0
  [ ] npx vitest run — 전체 통과
  [ ] 수동 테스트: Plan→Dev→Review 풀사이클 1회
  [ ] 수동 테스트: RT 2-agent 토론 1회
  [ ] 수동 테스트: Branch 생성/adopt 1회
  [ ] 모바일: tunaflow.d9ng.site 접속 성공

릴리즈:
  [ ] README 설치 요구사항 업데이트
  [ ] git tag v0.1.0-beta.1
  [ ] GitHub Release 생성 (macOS 바이너리)
```

---

## 6. 베타 이후 로드맵

```
v0.1.0-beta.1 → 개발자 피드백 수집 (1-2주)
  ↓
v0.1.0-beta.2 → 피드백 기반 버그 수정 + CLI 감지 UI
  ↓
v0.1.0-beta.3 → 온보딩 메타에이전트 + 모바일 PWA
  ↓
v0.1.0 → 공개 릴리즈
```

---

## 참고

- 코더 Opus 베타 준비 평가: 이 세션에서 수행
- 시니어 리뷰 지적사항: silent catch, unwrap, 테스트 갭
- RT prompt 패닉 경로: `src-tauri/src/commands/roundtable_helpers/prompt.rs`
- HTTP API: `src-tauri/src/http_api/`
- 모바일: `docs/ideas/mobileArchitectureIdea.md`
- 온보딩: `docs/ideas/onboardingMetaAgentIdea.md`
