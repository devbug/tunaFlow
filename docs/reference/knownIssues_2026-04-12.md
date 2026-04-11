# Known Issues — 2026-04-12

## P0: ContextPack CLAUDE.md 무한 누적 (PTY 모드)

**발견**: 세션 21, seCall 프로젝트에서 CLAUDE.md 9061줄 (정상: 106줄)
**영향**: PTY 모드를 사용하는 모든 프로젝트
**상태**: 수정 완료

### 원인

`pty_update_claude_md` (pty.rs:609)가 `## tunaFlow Context` 섹션을 교체할 때:
- `marker_end = "\n## "` 로 다음 h2 헤더까지를 교체 범위로 설정
- 하지만 ContextPack 내부에 `## tunaFlow Workflow Rules` 등 h2 헤더가 포함
- ContextPack의 첫 h2에서 section boundary가 끊김 → 이후 내용이 잔존
- 다음 턴에서 새 ContextPack이 잔존 내용 뒤에 append
- 턴마다 ~300줄씩 누적, 33턴 = 9000줄

### 증상

- Autocompact thrashing (3턴 이내 컨텍스트 재압축 반복)
- 에이전트가 파일을 읽을 수 없음 (컨텍스트 부족)
- CLAUDE.md가 수천 줄로 비대해짐

### 수정

1. **pty.rs**: `\n## ` 패턴 → `<!-- tunaflow:context-start/end -->` 명시적 HTML 마커
2. **레거시 호환**: 기존 `## tunaFlow Context` 마커 발견 시 EOF까지 strip
3. **Developer 규칙**: PLATFORM_TIER0에 "200줄+ 파일은 offset/limit 읽기" 추가

### 영향 받는 프로젝트 정리

PTY 모드를 사용한 프로젝트의 CLAUDE.md를 확인해야 함:
```bash
# 확인 명령
wc -l PROJECT_PATH/CLAUDE.md
# 비정상: 프로젝트 원본 대비 수백~수천 줄 증가
# 정리: `## tunaFlow Context` 이후를 모두 삭제
```

## P1: PTY 시작 타임아웃 조정

**이전**: 30초 (JSONL 변화 기준)
**변경**: 90초 (screen + JSONL 활동 감지)

에이전트가 thinking/tool_use 중이면 JSONL에 새 항목이 늦게 나타남.
pty:screen의 ⏺/✻ 기호를 activity 신호로 포함하여 false timeout 방지.
