---
title: Ollama / LM Studio base URL override UI (Issue #175 MVP)
status: ready-to-implement
priority: P1 (첫 외부 이슈 대응)
created_at: 2026-04-24
related:
  - https://github.com/hang-in/tunaFlow/issues/175
  - docs/plans/postBetaBacklogPlan_2026-04-24.md  # B-18
canonical: true
owners:
  - architect (본 문서 작성)
  - developer (구현)
---

# 개요

첫 외부 GitHub 이슈 [#175](https://github.com/hang-in/tunaFlow/issues/175) (batmania52) 대응. 백엔드 `stream_run_with_base` 는 이미 임의 URL 을 받도록 돼 있으나 **UI / settings 경로가 없음** → 원격 Ollama (Tailscale / NAS) + 대체 LM Studio 포트 + 커스텀 OpenAI-compat 엔드포인트 모두 설정 불가.

**MVP 범위**: Ollama / LM Studio 용 base URL override 를 Settings UI 에서 설정 → `appStore` 영속 → Tauri 명령 호출 시 전달 → `agents.rs` 라우팅에서 적용.

**스코프 외** (Extended, 별도 이슈로 분리): 임의 label 의 커스텀 엔드포인트 등록 (vLLM / Groq / Together AI / OpenRouter), API key per endpoint.

# 사실 확인 (Architect 검증 완료)

| 지점 | 현재 상태 | 수정 필요 |
|---|---|---|
| `src-tauri/src/agents/openai_compat.rs:88` | `stream_run_with_base(input, base, ...)` — 임의 URL 수용 | ❌ 변경 없음 |
| `src-tauri/src/agents/openai_compat.rs:18` | `ollama_base_url()` = `OLLAMA_HOST` env → `http://localhost:11434` | ❌ 변경 없음 (fallback 유지) |
| `src-tauri/src/agents/openai_compat.rs:83` | `lmstudio_base_url()` = `LMSTUDIO_ENDPOINT` env → `http://localhost:1234` | ❌ 변경 없음 |
| `src-tauri/src/commands/agents.rs:479` | 하드코딩 분기 `if is_lmstudio { lmstudio_base_url() } else { OLLAMA_HOST or default }` | ✅ RunInput 에 `custom_base_url` Option 있으면 우선, 없으면 현재 로직 |
| `src-tauri/src/agents/claude.rs` `RunInput` | (확인 필요 — Developer 가 실제 필드 추가할 위치) | ✅ `custom_base_url: Option<String>` 필드 추가 |
| `src/lib/engineConfig.ts` `ENGINE_CONFIGS` | 5 entry 하드코드 | ❌ 변경 없음 (MVP 범위 외) |
| `src/components/tunaflow/settings/AgentsSection.tsx` | 엔진 선택 UI 만 있음 (라인 301-302) | ✅ ollama/lmstudio 선택 시 URL override input 노출 |
| `src/lib/appStore.ts` | `getSetting<T>(key, fallback)` / `setSetting<T>(key, value)` 제공 | ❌ 변경 없음 |

Settings 키 네이밍 컨벤션 확인: 기존 키 `convEngineMap`, `agentProfiles`, `notificationSound`, `activeSkills:{pk}`, `skillDetectionDismissed:{pk}` — **camelCase + 콜론 구분자** 패턴.

제안 키:
- `engineEndpoint:ollama` — string (optional base URL, 빈 문자열/null 이면 env/default fallback)
- `engineEndpoint:lmstudio` — string (동일)

# 설계

## (1) RunInput 에 `custom_base_url` 필드 추가

파일: `src-tauri/src/agents/claude.rs` (또는 `RunInput` 정의 위치)

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct RunInput {
    // ...기존 필드들...
    #[serde(default)]
    pub custom_base_url: Option<String>,
}
```

- `#[serde(default)]` 로 프론트에서 생략 가능
- Option<String> — None 이면 기존 env/default 폴백 경로 유지
- 빈 문자열 ("") 은 None 으로 취급 (UI 에서 "빈 입력 = 기본값 사용" UX)

## (2) 라우팅에서 override 적용

파일: `src-tauri/src/commands/agents.rs:479`

```rust
// 현재
let base_url = if is_lmstudio {
    openai_compat::lmstudio_base_url()
} else {
    std::env::var("OLLAMA_HOST").unwrap_or_else(|_| "http://localhost:11434".into())
};

// 수정 후
let base_url = input.custom_base_url
    .as_ref()
    .filter(|s| !s.trim().is_empty())
    .cloned()
    .unwrap_or_else(|| {
        if is_lmstudio {
            openai_compat::lmstudio_base_url()
        } else {
            std::env::var("OLLAMA_HOST")
                .unwrap_or_else(|_| "http://localhost:11434".into())
        }
    });
```

우선순위: **UI 설정값 → env var → 하드코드 기본값**. env var 사용자는 영향 없음 (UI 설정을 비워두면 env 그대로 동작).

## (3) 모델 discovery 에도 override 반영 (선택)

현재 `openai_compat::discover_models()` 은 `ollama list` CLI 호출이라 base URL 무관. **하지만** 원격 Ollama (다른 머신) 사용 시 CLI discovery 가 의미 없어짐.

**MVP 범위에서는 그대로 두고**, 설명 tooltip 에 "Remote 서버의 모델은 free-text 입력 필요 (현재는 로컬 `ollama list` 기준)" 안내만. Extended 범위에서 `GET {base}/v1/models` HTTP discovery 로 확장.

## (4) Settings UI — `AgentsSection.tsx` 에 URL override 필드 추가

파일: `src/components/tunaflow/settings/AgentsSection.tsx`

위치: 엔진 `<select>` (라인 301 근처) 아래. 선택된 profile 의 engine 이 ollama 또는 lmstudio 일 때만 렌더.

구조 제안 (코드 스케치):

```tsx
{/* 엔진 <select> 아래 조건부 렌더 */}
{(selected.engine === "ollama" || selected.engine === "lmstudio") && (
  <div className="mt-2">
    <label className="text-tf-caption text-muted-foreground">
      {t("agents.endpoint.label")} {/* "Base URL (비우면 기본값 사용)" */}
    </label>
    <input
      type="text"
      value={endpointOverride[selected.engine] ?? ""}
      onChange={(e) => handleEndpointChange(selected.engine, e.target.value)}
      placeholder={
        selected.engine === "ollama"
          ? "http://localhost:11434"
          : "http://localhost:1234"
      }
      className="..."
    />
    <p className="text-tf-caption text-muted-foreground mt-1">
      {t("agents.endpoint.hint")}
      {/* "원격 Ollama (Tailscale/NAS) 또는 LM Studio 다른 포트용. 빈 값이면
          OLLAMA_HOST / LMSTUDIO_ENDPOINT 환경변수 → 기본값 순으로 사용." */}
    </p>
  </div>
)}
```

state hook:
```tsx
const [endpointOverride, setEndpointOverride] = useState<Record<"ollama" | "lmstudio", string>>({
  ollama: "",
  lmstudio: "",
});

useEffect(() => {
  (async () => {
    const [ol, ls] = await Promise.all([
      getSetting<string>("engineEndpoint:ollama", ""),
      getSetting<string>("engineEndpoint:lmstudio", ""),
    ]);
    setEndpointOverride({ ollama: ol, lmstudio: ls });
  })();
}, []);

const handleEndpointChange = async (engine: "ollama" | "lmstudio", value: string) => {
  const trimmed = value.trim();
  setEndpointOverride((prev) => ({ ...prev, [engine]: trimmed }));
  await setSetting(`engineEndpoint:${engine}`, trimmed);
};
```

## (5) 호출 시점 — override 를 RunInput 에 주입

파일: `src/lib/runtimeSend.ts` 또는 `src/stores/slices/runtimeSlice.ts` (sendWithEngine 함수 근처)

Tauri 명령 호출 직전에 ollama / lmstudio 엔진일 때 설정값을 RunInput 에 합쳐서 넘긴다.

```ts
const extra: Record<string, unknown> = {};
if (engine === "ollama" || engine === "lmstudio") {
  const override = await getSetting<string>(`engineEndpoint:${engine}`, "");
  if (override.trim()) {
    extra.customBaseUrl = override.trim();
  }
}
// 기존 invoke 호출에 ...extra 병합 (engineConfig.ts 의 command / hasChunkEvent 사용 경로)
```

**정확한 위치**: Developer 가 `ENGINE_CONFIGS[engine].command` 로 invoke 하는 지점 (grep 으로 바로 찾을 수 있음 — `runtimeSlice.sendWithEngine()` 의 `invoke(config.command, ...)` 근처).

RunInput 쪽 Rust 필드명이 snake_case (`custom_base_url`) 이므로 serde rename 또는 TypeScript 쪽에서 snake_case 로 넘길지 결정. 프로젝트 컨벤션 확인 후 맞춰서 — 기존 RunInput 필드들 보면 대부분 camelCase (serde(rename_all = "camelCase") 가 기본). 그대로 따라가면 `customBaseUrl` TS → `custom_base_url` Rust 자동 매핑.

## (6) i18n 키 추가

파일:
- `src/locales/ko/settings.json`
- `src/locales/en/settings.json`

추가 키 (경로 예시):
```json
"agents": {
  "endpoint": {
    "label": "Base URL (비우면 기본값 사용)",
    "hint": "원격 Ollama (Tailscale / NAS) 또는 LM Studio 대체 포트용. 빈 값이면 OLLAMA_HOST / LMSTUDIO_ENDPOINT 환경변수 → 기본값 순으로 사용합니다.",
    "placeholder_ollama": "http://localhost:11434",
    "placeholder_lmstudio": "http://localhost:1234"
  }
}
```

영어 버전도 동일 키 구조로.

## (7) 테스트

### Rust (cargo test --lib)

- `src-tauri/src/commands/agents.rs` 에 단위 테스트 추가 어렵다면 skip — routing 테스트 없음
- **대신** `src-tauri/src/agents/openai_compat.rs` 에 `stream_run_with_base` 가 임의 URL 에 대해 성공/실패 분기하는지 기존 테스트 있으면 재확인 (없으면 MVP 범위 외 — 수동 smoke 로 충분)

### FE (vitest)

- `AgentsSection.test.tsx` 가 있으면 endpoint override 입력 저장/로드 케이스 추가
- 없으면 스킵 (MVP 수동 smoke 로 검증 — 본 plan 시점 grep 해보면 테스트 파일 존재 여부 확인 가능)

### 수동 smoke

1. Settings → Agents → Ollama 선택 → base URL `http://remote-nas:11434` 입력 → 자동 저장 확인 (appStore)
2. 메시지 전송 → 실제로 remote-nas 로 요청 가는지 네트워크 패널 / 로그 확인 (`[openai-compat] engine=... model=...` eprintln + reqwest 로그)
3. Base URL 빈 값으로 리셋 → 로컬 기본값 (`localhost:11434`) 로 돌아가는지 확인
4. `OLLAMA_HOST=http://x.y.z:11434 npm run tauri dev` 로 실행 후 UI 값 빈 상태 → env var 그대로 먹는지 확인
5. LM Studio 도 동일 3 단계

# Developer 핸드오프 프롬프트

> 새 세션에 아래 blob 을 통째로 붙여넣기.

```
[작업] Ollama / LM Studio base URL override UI (GitHub Issue #175 MVP)

[SSOT] docs/plans/customEndpointConfigPlan_2026-04-24.md 먼저 읽기

[배경]
- 첫 외부 기여자 이슈 (batmania52 님, secall 에서도 여러 이슈 주신 분).
- 백엔드 stream_run_with_base 는 이미 임의 URL 수용. UI/settings gap 만 존재.
- 제보자가 정확히 src-tauri/src/commands/agents.rs:479 하드코딩 지점까지 짚어줬음.

[수정 범위]

1) RunInput 에 custom_base_url 필드 추가
   - 위치: src-tauri/src/agents/claude.rs (또는 RunInput 정의 위치 — `rg "pub struct RunInput"` 로 확인)
   - 필드: #[serde(default)] pub custom_base_url: Option<String>
   - 기존 호출자들은 serde default 덕에 코드 수정 불요

2) src-tauri/src/commands/agents.rs:479 분기 수정
   - 현재: let base_url = if is_lmstudio { lmstudio_base_url() } else { OLLAMA_HOST or default }
   - 변경: input.custom_base_url (빈 문자열 제외) 있으면 우선 사용, 없으면 현재 로직
   - 정확한 스니펫은 plan §(2) 참고

3) Settings UI — src/components/tunaflow/settings/AgentsSection.tsx
   - 엔진 <select> (라인 301 근처) 아래 조건부 렌더 (engine === "ollama" | "lmstudio")
   - base URL input + placeholder (각 엔진 기본값 표시) + hint 텍스트
   - state: useState + useEffect 로 appStore 값 로드
   - onChange: trim + setSetting(`engineEndpoint:${engine}`, trimmed)
   - 코드 스케치는 plan §(4) 참고

4) 호출 시점 주입 — src/stores/slices/runtimeSlice.ts 의 sendWithEngine 함수
   - invoke(config.command, args) 직전에 engine === "ollama"|"lmstudio" 면 getSetting 으로 override 읽어 args 에 customBaseUrl 필드 병합
   - TypeScript camelCase → Rust snake_case 자동 매핑 (기존 프로젝트 컨벤션 확인)
   - 정확한 위치: `rg "config.command" src/stores/slices/` 로 확인

5) i18n — src/locales/{ko,en}/settings.json
   - agents.endpoint.{label, hint, placeholder_ollama, placeholder_lmstudio} 키 추가
   - plan §(6) 참고

[스코프 외 (명시적 제외)]
- 임의 label 의 커스텀 엔드포인트 등록 (vLLM/Groq/Together AI) — Extended 범위, 별도 이슈
- API key per-endpoint 필드 — Extended 범위
- GET {base}/v1/models HTTP discovery — Extended 범위
- ENGINE_CONFIGS 동적화 — Extended 범위
- 모델 free-text 입력 (현재 ModelPicker 에서 할지 후속 판단)

[검증]
- npx tsc --noEmit: 0 에러
- npx vitest run: 전량 pass
- cd src-tauri && cargo check --all-targets: 0 에러
- cd src-tauri && cargo test --lib: 전량 pass
- 수동 smoke (5 단계, plan §(7) 참고):
  1. Ollama URL override 저장 → 전송 시 반영
  2. 빈 값 리셋 → 로컬 기본값 복귀
  3. OLLAMA_HOST env var 세팅 → UI 빈 값일 때 env 값 반영
  4. LM Studio 동일 3 단계

[커밋]
- feat(openai-compat): accept custom_base_url in RunInput (Issue #175 MVP)
- feat(settings): add Ollama/LM Studio base URL override UI
- feat(runtime): inject custom base URL into sendWithEngine invoke args
- chore(i18n): add agents.endpoint keys (ko/en)

각 커밋 trailer 에 Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

[PR 제목]
feat(openai-compat): UI override for Ollama / LM Studio base URL (#175)

[PR body 요약]
- Closes #175 MVP 범위
- Extended 범위 (커스텀 엔드포인트 등록, API key, HTTP model discovery) 는 피드백 받아가며 별도 이슈로 분리
- 수동 smoke 5 단계 통과 스크린샷 1장 첨부

[주의]
- Issue #175 batmania52 님이 secall 에서도 고급 제보 많이 주신 분 — PR 머지 후 이슈에 댓글로 알려드리기
- git stash drop/clear 금지
- env var 폴백 경로 (OLLAMA_HOST / LMSTUDIO_ENDPOINT) 반드시 유지 — 기존 사용자 깨지면 안 됨
- 우선순위 순: 설정값 → env var → 하드코드 기본값 (plan §(2) 참고)
- Settings 키 `engineEndpoint:ollama` / `engineEndpoint:lmstudio` — 기존 키 네이밍 컨벤션 (kebab/camel + 콜론 구분자) 준수
```

# Invariants

- **[INV-1]** 기존 `OLLAMA_HOST` / `LMSTUDIO_ENDPOINT` env var 사용자는 **UI 설정값이 비어있을 때** 영향을 받지 않는다. 우선순위는 UI → env → hardcoded default 순.
- **[INV-2]** UI input 이 빈 문자열일 때 override 미적용으로 취급 (null 과 동일). Rust 쪽에서 `filter(|s| !s.trim().is_empty())` 로 보장.
- **[INV-3]** 백엔드 `stream_run_with_base(input, base, ...)` 시그니처는 **변경하지 않는다**. 이미 임의 URL 을 받도록 돼 있고 기존 다른 호출자 (테스트 등) 가 있을 수 있음.
- **[INV-4]** Settings 키 `engineEndpoint:ollama` / `engineEndpoint:lmstudio` 형식 고정. 향후 Extended (커스텀 엔드포인트) 도입 시 `engineEndpoint:custom:{label}` 형태로 자연 확장.
- **[INV-5]** i18n 키 추가 시 ko/en 동시 업데이트. 누락 시 tsc 통과하지만 런타임 키 fallback 으로 사용자에게 키 이름 노출됨.

# Rationale

## 왜 RunInput 확장이지 새 커맨드가 아닌가
- 새 Tauri 커맨드 추가는 dispatch 경로 이중화 → 유지보수 부담
- RunInput 은 이미 flexible 한 구조체 (엔진별 optional 필드 다수)
- `#[serde(default)]` 로 기존 호출자 breaking change 없음

## 왜 UI 에서 직접 읽지 않고 RunInput 으로 넘기나
- Rust 쪽에서 `getSetting` 에 해당하는 DB read 를 호출할 수도 있으나 → 매 send 마다 추가 query
- FE 는 이미 appStore 에 값 캐시된 상태 → 호출 시 zero-cost
- 또한 **UI 와 값 매핑이 명확** (사용자가 Settings 에 입력한 그 값이 그대로 RunInput 에 실림)

## 왜 Extended 스코프 (커스텀 엔드포인트) 를 미루나
- MVP 1 일, Extended 2~3 일. 첫 외부 이슈니까 빠른 응답 우선.
- Extended 는 UX 디자인 (엔진 목록 동적화, API key 보관 위치, 엔진 추가/삭제 flow) 이 더 큰 작업.
- 베타 피드백 받아가며 어느 엔드포인트를 실제로 원하는지 데이터 수집 후 설계하는 편이 낫다.

## 왜 모델 discovery 를 HTTP 로 바꾸지 않나
- 현재 `ollama list` CLI discovery 는 로컬 설치 감지용. 원격 서버로 기본 전환 시 로컬 사용자들은 오히려 리그레션 가능성.
- Extended 에서 "UI 에서 HTTP discovery 할지 토글" 로 풀어야 함.
- MVP 에서는 hint 문구로 "원격 서버 모델은 free-text 입력" 안내만.

## 왜 `engineEndpoint:` 콜론 네이밍인가
기존 `activeSkills:{pk}`, `skillDetectionDismissed:{pk}` 와 동일 패턴. 향후 `engineEndpoint:custom:my-vllm` 같은 중첩 확장이 자연스러움.

# 후속 작업

MVP 머지 후:
1. Issue #175 에 MVP 완료 + PR 링크 댓글. Extended 범위는 별도 이슈로 유도.
2. `docs/plans/postBetaBacklogPlan_2026-04-24.md` 에 **B-18. 커스텀 OpenAI-compat 엔드포인트 등록** 항목 추가 (P2, feedback 대기).
3. 이 plan 파일 status: `completed` + superseded_by 없음.

## 관련 문서

- `docs/plans/postBetaBacklogPlan_2026-04-24.md` — 베타 이후 백로그. B-18 등재 예정.
- 이슈 링크: https://github.com/hang-in/tunaFlow/issues/175
- 현장 검증 파일:
  - `src-tauri/src/agents/openai_compat.rs`
  - `src-tauri/src/commands/agents.rs:479`
  - `src/components/tunaflow/settings/AgentsSection.tsx`
  - `src/stores/slices/runtimeSlice.ts`
  - `src/lib/engineConfig.ts`
