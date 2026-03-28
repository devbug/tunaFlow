# Skills Runtime Snapshot 운영 규칙

## 경로 구분

| 역할 | 경로 | 설명 |
|---|---|---|
| **Source of truth** | `_research/_skills/` | 공용 스킬 원본 저장소. vendor별 묶음 |
| **Runtime snapshot** | `~/.tunaflow/skills/` | tunaFlow가 실제로 읽는 복사본 |
| **Publisher** | `scripts/publish-skills.sh` | 원본 → snapshot 발행 스크립트 |

## 핵심 규칙

### 1. `~/.tunaflow/skills`는 snapshot publish 결과물이다

이 디렉터리는 `scripts/publish-skills.sh`가 생성한다.
수동으로 만든 디렉터리가 아니며, publish 결과만 들어 있어야 한다.

### 2. 수동 편집/수동 파일 추가를 권장하지 않는다

publish 시 기존 snapshot은 **삭제 후 재생성**된다.
수동으로 추가한 파일은 다음 publish에서 유실된다.

### 3. 스킬 수정은 원본에서 한다

스킬 내용을 바꾸고 싶으면:

1. `_research/_skills/` 원본을 수정
2. `scripts/publish-skills.sh` 재실행
3. runtime snapshot이 갱신됨

runtime에서 직접 수정하면 원본과 차이가 생기고 추적이 불가능해진다.

### 4. 로컬 커스텀 스킬

현재 tunaFlow는 `~/.tunaflow/skills/` 단일 경로만 스캔한다.
로컬 전용 커스텀 스킬을 두고 싶다면:

- 원본 저장소에 추가 후 publish하거나
- 별도 경로 지원이 추가될 때까지 `~/.tunaflow/skills/`에 직접 두되, publish 시 유실될 수 있음을 인지할 것

향후 다중 루트(system + user) 지원은 검토 대상이나 현재는 미구현.

### 5. Snapshot 메타데이터

publish 후 생성되는 파일:

- `~/.tunaflow/skills/_snapshot.json` — 발행 시각, 총 스킬 수, source 경로
- 각 스킬 폴더의 `_meta.json` — vendor, source_path, published_at

이 파일들로 "현재 snapshot이 언제, 어디서 왔는지" 확인할 수 있다.

## 발행 방법

```bash
# 전체 vendor snapshot 발행
./scripts/publish-skills.sh

# 커스텀 source 경로 지정
SKILLS_SRC=/path/to/skills ./scripts/publish-skills.sh
```

## 확인 방법

```bash
# snapshot manifest 확인
cat ~/.tunaflow/skills/_snapshot.json

# 특정 스킬 source 추적
cat ~/.tunaflow/skills/anthropic-pdf/_meta.json

# 총 스킬 수
ls -d ~/.tunaflow/skills/*/ | wc -l
```
