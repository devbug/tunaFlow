# Model Discovery 구현 노트

최종 갱신: 2026-03-27

## 현재 구현

`src-tauri/src/commands/model_discovery.rs`

### Codex — 로컬 캐시 읽기 ✅
- **소스**: `~/.codex/models_cache.json`
- **생성 주체**: Codex CLI가 사용 시 자동 생성/갱신
- **파싱**: `models[].slug` 추출, `visibility: "hide"` 제외
- **결과**: 실제 사용 가능한 최신 모델 목록 (gpt-5.4, gpt-5.4-mini 등)
- **상태**: 정상 동작 확인 (2026-03-27)

### Gemini — npm 패키지 상수 추출 ✅
- **소스**: `@google/gemini-cli-core` npm 패키지의 JavaScript export
- **방법**: `node -e` 스크립트로 `GEMINI` + `MODEL` 키워드 상수 수집
- **필터**: `gemini-`로 시작, `lite`/`customtools`/`embedding` 제외
- **결과**: 설치된 Gemini CLI 버전의 지원 모델 목록
- **상태**: 정상 동작 확인 (2026-03-27)

### Claude — static fallback ⚠️
- **소스**: 하드코딩 (discovery 없음)
- **이유**: Claude Code는 OAuth 기반, 로컬에 모델 캐시 파일 없음
- **현재 목록**: opus-4-6, sonnet-4-6, haiku-4-5 + alias 3개
- **상태**: 동작하지만 새 모델 출시 시 수동 업데이트 필요

### OpenCode — static fallback
- **소스**: 하드코딩
- **현재 목록**: anthropic:claude-sonnet-4-6, openai:gpt-4.1

## Claude Discovery 조사 결과 (2026-03-27)

### 시도한 방법

1. **`claude --help`** — `--model` 옵션은 있지만 모델 목록 조회 명령 없음
2. **`~/.claude/` 디렉토리** — settings.json, history 등은 있지만 모델 캐시 없음
3. **바이너리 분석** — Bun 번들 (227MB), strings 추출 실패 (압축/인코딩)
4. **GitHub 소스** — 공개 소스에서 모델 정의 파일 찾지 못함
5. **`/model` 명령** — 런타임에서만 동작, CLI 외부에서 호출 불가

### 결론

- Claude Code의 `/model` 명령은 **런타임에 서버 API를 호출**하는 것으로 추정
- 외부에서 프로그래밍적으로 모델 목록을 가져올 수 있는 경로 없음
- Anthropic API `GET /v1/models`는 API key 필요 — Claude Code는 OAuth이라 key 없음

### 향후 가능한 방법

1. **Anthropic API key가 있는 경우**: `GET https://api.anthropic.com/v1/models` 호출
2. **Claude Code CLI 업데이트**: `claude models list` 같은 명령이 추가되면 파싱 가능
3. **현재 권장**: static fallback 유지 + 사용자 커스텀 모델 입력 허용

## 공통 구조

```
list_engine_models() 호출
  → 각 엔진별:
      cache hit (1시간 TTL) → 즉시 반환
      cache miss → discover_*() 시도
        → 성공 → source: "discovered", 캐시에 저장
        → 실패 → fallback_models() → source: "fallback"

!models --refresh
  → 캐시 전체 invalidate → 강제 re-discover

결과 필드: { id, label, engine, recommended, source }
```

## 참고

- tunaPi의 `engine_models.py`에서 구조 이식
- fallback registry는 discovery 실패 시에만 사용
- Codex/Gemini는 discovery 성공률이 높아 fallback이 거의 쓰이지 않음
