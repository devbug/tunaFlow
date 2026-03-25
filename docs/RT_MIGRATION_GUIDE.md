# tunadish RT → tunaFlow RT 마이그레이션 가이드

## 1. tunadish RT 핵심 구조

### 1.1 프롬프트 구성 (`_build_round_prompt`)

tunadish RT의 핵심은 프롬프트 조립 방식이다.

**첫 번째 참가자 (컨텍스트 없음)**:
```
{topic}
```

**같은 라운드 후속 참가자**:
```
이번 라운드 다른 에이전트 답변:

**[claude]**:
{응답 (최대 4000자)}

---

위 의견들을 참고하여 답변해주세요: {topic}
```

**2라운드 이상 + 같은 라운드 선행 응답 있을 때**:
```
이전 라운드 응답:

**[claude]**:
{이전 라운드 전체 응답}

**[gemini]**:
{...}

---

이번 라운드 다른 에이전트 답변:

**[claude]**:
{같은 라운드 선행 응답}

---

위 의견들을 참고하여 답변해주세요: {topic}
```

핵심 차이점:
- **시스템 프롬프트 없음** — 모든 지시가 user prompt 안에 포함
- 별도 "지시문" 섹션 없음 — `위 의견들을 참고하여 답변해주세요:` 한 줄이 전부
- `**[engine]**:` 마크다운 볼드 형식 사용
- 응답 길이 상한 4000자 (`_MAX_ANSWER_LENGTH`)

### 1.2 엔진 라우팅

```python
resolved = runtime.resolve_runner(engine_override=engine_id)
```

- `resolve_runner()` 가 엔진별 Runner 인스턴스를 반환
- 실패 시 에러 메시지 전송하고 `continue` (다음 참가자로)
- 모든 엔진이 동일한 `handle_message(runner, prompt)` 인터페이스 사용

### 1.3 다중 라운드

```python
for round_num in range(1, session.total_rounds + 1):
    round_transcript = await _run_single_round(...)
    session.transcript.extend(round_transcript)
```

- `session.transcript`: 전체 라운드 누적 `list[(engine, answer)]`
- `round_transcript`: 현재 라운드 내 선행 응답 `list[(engine, answer)]`
- 두 개의 분리된 컨텍스트를 `_build_round_prompt`에 전달

### 1.4 후속 토론 (`!rt follow`)

- 완료된 세션을 재활성화
- 새 토픽으로 추가 라운드 실행
- 이전 transcript 전체가 컨텍스트로 유지
- 특정 엔진만 필터링 가능

### 1.5 오류 처리

- 엔진 해석 실패: 에러 메시지 표시 + `continue`
- 응답 생성 실패: 에러 메시지 표시 + `continue`
- 취소: `cancel_event.set()` → 루프 `break`

---

## 2. tunaFlow 현재 RT 구현 상태

### 2.1 현재 작동하는 것

| 항목 | 상태 |
|------|------|
| 순차 실행 (claude, codex, gemini) | ✅ |
| 선행 응답 누적 전달 | ✅ |
| 엔진 라우팅 (claude/codex/gemini/opencode) | ✅ |
| 에러 시 계속 진행 | ✅ |
| 공통 시스템 프롬프트 | ✅ |

### 2.2 tunadish 대비 부족한 부분

| 항목 | tunadish | tunaFlow | 갭 |
|------|----------|----------|-----|
| 프롬프트 형식 | `**[engine]**: 응답` + 접미사 한 줄 | 별도 INSTRUCTION + 별도 SYSTEM_PROMPT | **구조 차이** |
| 시스템 프롬프트 | 없음 (prompt-only) | 이중 주입 (INSTRUCTION + SYSTEM_PROMPT) | **과잉 지시** |
| 첫 참가자 프롬프트 | topic만 전달 | INSTRUCTION + --- + topic | **불필요한 프리앰블** |
| 응답 길이 제한 | 4000자 truncation | 없음 | **누락** |
| 다중 라운드 | `--rounds N` (최대 3) | 미구현 | **누락** |
| 후속 토론 | `!rt follow [engine] "topic"` | 미구현 | **누락** |
| 취소 | `!rt close` / cancel_event | 미구현 | **누락** |
| 컨텍스트 분리 | 이전 라운드 / 같은 라운드 분리 | 단일 누적 리스트 | **구조 차이** |
| 아카이브 | 저널 + 프로젝트 메모리 저장 | 없음 | **누락** |

---

## 3. 근본 문제: 프롬프트 과잉 지시

### 3.1 현재 tunaFlow 구조 (문제)

tunaFlow는 **세 겹의 지시**를 동시에 주입한다:

1. **ROUNDTABLE_SYSTEM_PROMPT** (`system_prompt` → `--append-system-prompt`):
   ```
   너는 다중 에이전트 토론 참가자다.
   주어진 주제에 대해 100자 이내로 직접 의견을 제시하라. ...
   ```

2. **ROUNDTABLE_INSTRUCTION** (user prompt 앞):
   ```
   너는 다중 에이전트 토론에 참여 중이다.
   사용자 요청에 답하라. 이전 참가자 응답이 있으면 검토하고 ...
   ```

3. **prior_section** (user prompt 중간):
   ```
   ## Other participants responses
   [Haiku] ...
   ```

결과적으로 Codex/Gemini가 받는 프롬프트:
```
(지시문 1: 토론 참가 지시)
(지시문 2: 이전 응답 참조 지시)

## Other participants responses
[Haiku] ...

---

실제 토론 주제
```

이 구조의 문제:
- **지시가 두 번 반복** — 메타 지시로 읽히기 쉬움
- **토론 주제가 프롬프트 맨 끝에 배치** — 에이전트가 주제보다 지시에 반응
- **Codex/Gemini에게 system_prompt 무효** — `ROUNDTABLE_SYSTEM_PROMPT`가 codex/gemini에선 무시됨
- **첫 참가자도 불필요한 프리앰블을 받음** — tunadish는 첫 참가자에게 topic만 전달

### 3.2 tunadish 방식 (정답)

```
**[claude]**:
{이전 응답}

---

위 의견들을 참고하여 답변해주세요: {topic}
```

- 시스템 프롬프트 없음
- 지시는 `위 의견들을 참고하여 답변해주세요:` 한 줄
- 첫 참가자는 `{topic}` 만 수신
- 이전 응답이 마크다운 볼드 형식으로 자연스럽게 포함

---

## 4. 마이그레이션 계획

### Phase 1: 프롬프트 정규화 (즉시)

**목표**: tunadish `_build_round_prompt` 패턴으로 교체

변경 파일: `src-tauri/src/commands/roundtable.rs`

1. `ROUNDTABLE_INSTRUCTION` 제거
2. `ROUNDTABLE_SYSTEM_PROMPT` 제거 → `system_prompt: None`
3. `_build_round_prompt` 로직 포팅:

```rust
fn build_round_prompt(
    topic: &str,
    prior_responses: &[(String, String)],  // (name, content)
) -> String {
    if prior_responses.is_empty() {
        return topic.to_string();
    }

    let mut sections = Vec::new();
    for (name, content) in prior_responses {
        let trimmed = truncate_str(content, 4000);
        sections.push(format!("**[{}]**:\n{}", name, trimmed));
    }

    format!(
        "{}\n\n---\n\n위 의견들을 참고하여 답변해주세요: {}",
        sections.join("\n\n"),
        topic
    )
}
```

4. 루프 내 프롬프트 조립:

```rust
let prior: Vec<(String, String)> = results
    .iter()
    .filter(|r| r.status == "done")
    .map(|r| (r.name.clone(), r.content.clone()))
    .collect();

let augmented_prompt = build_round_prompt(&input.prompt, &prior);
```

### Phase 2: 다중 라운드 (다음)

변경 파일: `roundtable.rs`, `types/index.ts`, `chatStore.ts`

1. `RoundtableRunInput`에 `rounds: Option<u32>` 추가 (기본 1, 최대 3)
2. 바깥 `for round_num in 1..=rounds` 루프 추가
3. `transcript` (이전 라운드 전체)와 `round_transcript` (현재 라운드 내) 분리
4. `build_round_prompt`에 두 인자 전달:

```rust
fn build_round_prompt(
    topic: &str,
    transcript: &[(String, String)],        // 이전 라운드
    current_round: &[(String, String)],     // 같은 라운드 선행
) -> String
```

### Phase 3: 후속 토론 (이후)

1. RT 세션 상태를 메모리에 유지 (또는 DB에 transcript 저장)
2. `rt_followup` 커맨드 추가: 기존 세션 transcript를 로드하고 새 topic으로 추가 라운드
3. UI에 "Follow-up" 버튼 추가

### Phase 4: 응답 길이 제한 + 아카이브 (이후)

1. `_MAX_ANSWER_LENGTH = 4000` 상수 도입
2. `truncate_str` 적용
3. RT 완료 시 transcript를 별도 저장 (future: 저널 연동)

---

## 5. 즉시 적용 체크리스트 (Phase 1)

- [ ] `ROUNDTABLE_INSTRUCTION` 상수 제거
- [ ] `ROUNDTABLE_SYSTEM_PROMPT` 상수 제거
- [ ] `system_prompt: None` 으로 변경
- [ ] `build_round_prompt(topic, prior_responses)` 함수 추가
- [ ] 첫 참가자: `topic` 만 전달
- [ ] 후속 참가자: `**[name]**:\n{응답}\n\n---\n\n위 의견들을 참고하여 답변해주세요: {topic}`
- [ ] 응답 4000자 제한 적용
- [ ] 디버그 로그 제거 (`eprintln!`)
- [ ] 빌드 경고 제거 (unused `system_prompt` field)
