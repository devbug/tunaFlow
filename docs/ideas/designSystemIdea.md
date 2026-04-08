# tunaFlow 디자인 시스템 — Toss Seed 참고 + 라이트 모드 추가

> Status: idea → **in_progress (Phase 1)**
> Created: 2026-04-08
> Updated: 2026-04-08 (코드 검토 반영)
> 레퍼런스: `_research/_util/styleseed/seeds/toss/` (CLAUDE.md + DESIGN-LANGUAGE.md)
> 원칙: **채팅 가독성 최우선. 배경 위 텍스트 대비가 약한 조합 절대 금지.**
> 목표: VS Code / Cursor / Linear 수준의 시각적 정돈감

### 현재 코드베이스 진단

| 문제 | 수치 |
|------|------|
| 임의 폰트 크기 | **8단계** (7px~15px), 650+곳 |
| opacity 텍스트 색상 | **15가지+** (/20~/90), 600+곳 |
| 근본 원인 | 한 화면에 너무 많은 크기/색상 → 시선 분산 → 정돈되지 않은 느낌 |

---

## 0. 최우선 원칙: 가독성

tunaFlow는 채팅이 핵심 UI입니다. 모든 색상/타이포그래피 결정에서 **가독성이 미학보다 우선**합니다.

### 금지 사항

```
❌ 흰 바탕 + 밝은 핑크/옐로우/라벤더 텍스트
❌ 다크 배경 + 낮은 opacity 텍스트 (text-foreground/50 이하)
❌ 밝은 배경 + 회색 코드블록 (대비 3:1 미만)
❌ 인라인 코드가 본문과 구분 안 되는 배색
❌ 에이전트 색상이 배경에 묻히는 조합
```

### WCAG AA 기준 (필수)

| 용도 | 최소 대비 |
|------|----------|
| 본문 텍스트 (14px+) | **4.5:1** |
| 대형 텍스트 (18px+ bold 또는 24px+) | **3:1** |
| UI 요소 (아이콘, 테두리) | **3:1** |
| 비활성/disabled 텍스트 | 예외 허용, 단 3:1 권장 |

---

## 1. 타이포그래피 스케일 정리

### 현재 문제

tunaFlow에서 `text-[13px]`, `text-[12px]`, `text-[10px]`, `text-[9px]` 같은 임의 값이 30+ 곳에서 사용됩니다. 일관성 없음.

### Toss Seed 기반 스케일 (14단계 → tunaFlow 10단계로 축소)

tunaFlow는 대시보드가 아니라 채팅 앱이므로 Display/Hero 크기는 불필요. 10단계로 축소:

```css
/* index.css — 타이포그래피 스케일 토큰 (7단계) */
:root {
  --text-micro: 9px;    /* 마이크로: 뱃지 status, blind 태그 (현행 유지) */
  --text-xs: 10px;      /* 최소: 뱃지 숫자, 타임스탬프, 모델명 */
  --text-sm: 11px;      /* 라벨: 메타데이터, 시간, 상태 텍스트 */
  --text-caption: 13px; /* 캡션: 메시지 이름, 날짜 */
  --text-base: 14px;    /* 본문: 채팅 메시지, 기본 UI */
  --text-lg: 18px;      /* 섹션 제목: 패널 헤더 */
  --text-xl: 24px;      /* 대제목: (거의 미사용) */
}
```

**축소 원칙**: 8단계(7~15px) → 7단계. 7px/8px/12px/15px/16px/20px는 제거하고 가장 가까운 단계로 통합.

### 적용 매핑

| 현재 | 변경 | 용도 |
|------|------|------|
| `text-[7px]` | `text-micro` (9px) | 올림 — 7px은 가독성 문제 |
| `text-[8px]` | `text-micro` (9px) | 올림 |
| `text-[9px]` | `text-micro` (9px) | 유지 |
| `text-[10px]` | `text-xs` (10px) | 유지 |
| `text-[11px]` | `text-sm` (11px) | 유지 |
| `text-[12px]` | `text-sm` (11px) | 내림 — 12px 단계 제거 |
| `text-[13px]` | `text-caption` (13px) | 유지 |
| `text-[14px]`/`text-sm` | `text-base` (14px) | 본문 통합 |

### 행간 규칙 (Toss 패턴 채택)

| 텍스트 크기 | 행간 | Tailwind | 이유 |
|------------|------|---------|------|
| 20-24px (제목) | 1.35 | `leading-snug` | 제목은 약간 타이트 |
| 14-16px (본문) | 1.5-1.7 | `leading-normal` ~ `leading-relaxed` | 채팅 가독성 |
| 10-13px (캡션) | 1.5-1.65 | `leading-normal` ~ `leading-relaxed` | 작은 텍스트는 여유 필요 |

### 자간 규칙

| 텍스트 크기 | 자간 | 이유 |
|------------|------|------|
| 20px+ (제목) | `-0.01em` | 큰 글자는 타이트 |
| 14-16px (본문) | `0em` (기본) | — |
| 10-13px uppercase | `0.05em` | 대문자 라벨은 넓게 |

---

## 2. 텍스트 계층 — opacity가 아닌 명시적 색상

### 현재 문제

```tsx
// 현재: opacity 기반 (배경에 따라 가독성 달라짐)
text-foreground/90       // 본문
text-foreground/80       // 보조
text-muted-foreground/70 // 캡션
text-muted-foreground/50 // 비활성
```

opacity는 배경색에 따라 실제 대비가 달라집니다. 다크 배경에서 `/50`이면 거의 안 보임.

### 변경: 5단계 명시적 색상 (`prose-*` 계열)

기존 `text-primary`(accent 용도)와 충돌을 피해 `prose-*` 네이밍 사용.

**다크 모드:**

```css
:root {
  --prose-strong: oklch(0.95 0.02 280);    /* 가장 강조: 제목, 메트릭 */
  --prose-base: oklch(0.88 0.03 280);      /* 본문 기본: 채팅 메시지 */
  --prose-muted: oklch(0.68 0.04 280);     /* 보조: 라벨, 캡션 */
  --prose-faint: oklch(0.55 0.03 280);     /* 부가: 날짜, 부제목 */
  --prose-disabled: oklch(0.42 0.02 280);  /* 비활성: placeholder, disabled */
}
```

**라이트 모드:**

```css
.light {
  --prose-strong: oklch(0.15 0.02 280);    /* 가장 강조 */
  --prose-base: oklch(0.28 0.02 280);      /* 본문 기본 */
  --prose-muted: oklch(0.45 0.02 280);     /* 보조 */
  --prose-faint: oklch(0.52 0.02 280);     /* 부가 */
  --prose-disabled: oklch(0.62 0.02 280);  /* 비활성 */
}
```

oklch 통일: L값(밝기)만 반전시키면 다크↔라이트 전환이 직관적.

### 적용 매핑

| 현재 (15가지+) | 변경 (5단계) | 대비 (다크 기준) |
|------|------|----------------|
| `text-foreground` | `text-prose-base` | 15:1+ ✅ |
| `text-foreground/90`, `/80` | `text-prose-base` | 통합 |
| `text-foreground/70`, `/60` | `text-prose-muted` | 7:1+ ✅ |
| `text-muted-foreground/70`, `/60` | `text-prose-muted` | 통합 |
| `text-muted-foreground/50` | `text-prose-faint` | 4.5:1+ ✅ |
| `text-muted-foreground/40`, `/30`, `/20` | `text-prose-disabled` | 3:1 (AA 대형만) |
| `text-sidebar-foreground/*` | 동일 5단계 적용 | — |

---

## 3. 간격 6px 그리드

### 현재 문제

```tsx
// 혼재된 간격
py-0.5 (2px), py-1 (4px), py-1.5 (6px), py-2 (8px), gap-2.5 (10px)
```

### 변경: 6px 배수 권장

```
6px  → p-1.5, gap-1.5
12px → p-3, gap-3
18px → p-4.5 (또는 p-5 근사)
24px → p-6, gap-6
```

| 용도 | 간격 | Tailwind |
|------|------|---------|
| 인라인 요소 사이 | 6px | `gap-1.5` |
| 카드 내부 패딩 | 12px | `p-3` |
| 섹션 사이 | 24px | `space-y-6` |
| 메시지 사이 (기본) | 12px | `py-3` |
| 메시지 사이 (그룹) | 6px | `py-1.5` |

**예외**: `py-0.5`(2px) 같은 극소 간격은 6px 그리드에 안 맞지만, 그룹 메시지의 밀도를 위해 허용.

---

## 4. 모션 토큰

### 현재 문제

```tsx
// 모션 토큰 없이 임의 사용
transition-colors              // 기본 Tailwind (150ms)
transition-all duration-300    // 명시적이지만 비일관
```

### 변경: 3단계 모션 토큰 (Toss 참고)

```css
:root {
  --duration-fast: 100ms;      /* 호버, 색상 변경, 포커스 */
  --duration-normal: 200ms;    /* 진입, 확장, 드로워 열림 */
  --duration-slow: 350ms;      /* 페이지 전환, 드로워 슬라이드 */
  --ease-default: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);  /* 탄성 마이크로 인터랙션 */
}
```

### 적용 규칙

| 인터랙션 | 토큰 | 예시 |
|---------|------|------|
| 호버 (배경색, 텍스트색) | `--duration-fast` | 메시지 호버, 버튼 호버 |
| UI 요소 출현 | `--duration-normal` | 토스트, 드롭다운, 툴팁 |
| 패널 전환 | `--duration-slow` | 드로워 슬라이드, 탭 전환 |

```tsx
// 사용 예시
className="transition-colors duration-[var(--duration-fast)]"
className="transition-all duration-[var(--duration-normal)] ease-[var(--ease-default)]"
```

### 접근성: reduced motion 자동 비활성화

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 5. data-slot 컴포넌트 마킹

### Toss 패턴

```tsx
<div data-slot="stat-card" className={cn("...", className)} {...props} />
```

### tunaFlow 적용

```tsx
// 새 컴포넌트 작성 시 필수
<div data-slot="message-item" ...>
<div data-slot="plan-card" ...>
<div data-slot="trace-panel" ...>
```

**이점**:
- DevTools에서 컴포넌트 즉시 식별
- CSS 셀렉터로 컴포넌트별 스타일 오버라이드 가능
- 테스트에서 컴포넌트 선택 용이

**기존 컴포넌트 일괄 적용은 하지 않음**. 새로 작성하거나 수정하는 컴포넌트부터 적용.

---

## 6. 라이트 모드 추가

### 현재 상태

다크 모드만 존재. `index.css`에 `:root`에 다크 색상만 정의.

### 구현 방식

`.dark` 클래스 전략 (Toss와 동일):

```css
@custom-variant dark (&:is(.dark *));  /* 이미 있음 */
```

현재 `:root`에 있는 다크 색상을 `.dark` 블록으로 이동하고, `:root`에 라이트 색상을 넣는 방식:

```css
/* 라이트 모드 (기본) — oklch 통일 */
:root {
  --background: oklch(0.97 0.005 280);    /* 약간 따뜻한 흰색 (#FAFAFA 상당) */
  --foreground: oklch(0.15 0.02 280);     /* 거의 검정 */
  --card: oklch(1.00 0 0);               /* 순백 */
  --card-foreground: oklch(0.28 0.02 280);
  --muted: oklch(0.94 0.005 280);
  --muted-foreground: oklch(0.45 0.02 280);
  --accent: oklch(0.96 0.005 280);
  --accent-foreground: oklch(0.28 0.02 280);
  --border: oklch(0.88 0.005 280);
  --sidebar: oklch(0.96 0.005 280);
  --sidebar-foreground: oklch(0.28 0.02 280);
  /* ... */
}

/* 다크 모드 (현재 :root 값 이동, lch → oklch 전환) */
.dark {
  --background: oklch(0.18 0.02 280);
  --foreground: oklch(0.90 0.03 280);
  --card: oklch(0.21 0.02 280);
  /* ... 현재 값 oklch 변환 */
}
```

### 라이트 모드 색상 원칙

**가독성 최우선. Toss 참고하되 채팅 앱에 맞게 조정.**

```
배경:
  Page: #FAFAFA (Toss)     → 순백이 아닌 약간 따뜻한 회색. 눈 피로 감소
  Card: #FFFFFF             → 카드만 순백으로 구분
  Sidebar: #F5F5F5          → 배경보다 약간 어둡게

텍스트 (oklch — prose-* 변수 참조):
  prose-strong:   oklch(0.15) → 제목 (대비 16:1) ✅
  prose-base:     oklch(0.28) → 본문 (대비 10:1) ✅
  prose-muted:    oklch(0.45) → 라벨 (대비 5.2:1) ✅
  prose-faint:    oklch(0.52) → 부가 (대비 4.5:1) ✅ AA
  prose-disabled: oklch(0.62) → 비활성 (대비 2.8:1) ⚠️ 대형만

인라인 코드:
  배경: #F0F0F0             → 본문과 명확 구분 (다크의 bg-accent/60 대응)
  텍스트: #3C3C3C           → 본문과 동일 (가독성 유지)

코드블록:
  배경: #1E1E1E (다크 유지) → 코드블록은 라이트/다크 모두 다크 배경
  테두리: rgba(0,0,0,0.08)  → 미묘한 구분
```

### 에이전트 색상 (라이트 모드)

```css
:root {
  --agent-claude: #7C3AED;     /* 보라 — 흰 배경에서 선명 */
  --agent-codex: #2563EB;      /* 파랑 */
  --agent-gemini: #D97706;     /* 주황 */
  --agent-opencode: #059669;   /* 초록 */
}
```

다크 모드의 oklch 값과 시각적으로 유사하되, 라이트 배경에서 대비 확보.

### 모드 전환 UI

```
Settings > Appearance > Theme: [System] [Light] [Dark]
```

System은 `prefers-color-scheme` 미디어 쿼리 따름. appStore에 영속.

---

## 7. 구현 계획

### Phase 1: 토큰 정리 (다크 모드만, 기존 개선)

```
1-1. index.css에 타이포그래피 스케일 CSS 변수 추가
1-2. 텍스트 계층 5단계 CSS 변수 추가
1-3. 모션 토큰 3단계 CSS 변수 추가
1-4. reduced motion 미디어 쿼리 추가
```

**기존 컴포넌트의 `text-[13px]`, `text-foreground/90` 등은 점진적으로 교체**. 일괄 변경 아님.

### Phase 2: 라이트 모드 추가

```
2-1. :root → 라이트 색상, .dark → 기존 다크 색상 이동
2-2. 에이전트 색상 라이트 버전 정의
2-3. Settings > Appearance 토글 UI
2-4. appStore에 theme 영속 (system/light/dark)
2-5. 코드블록은 라이트/다크 모두 다크 배경 유지 (oneDark 테마)
```

### Phase 3: 컴포넌트 점진 적용

```
3-1. 새 컴포넌트에 data-slot 적용
3-2. 수정하는 컴포넌트에서 text-[Npx] → 스케일 토큰 교체
3-3. opacity 기반 텍스트 → 명시적 계층 색상 교체
3-4. 간격 6px 그리드 정리
```

---

## 8. Toss Seed에서 채택하지 않는 것

| 항목 | 이유 |
|------|------|
| `#721FE5` 브랜드 색상 | tunaFlow는 `oklch(0.65 0.18 270)` 보라 유지 |
| 모바일 레이아웃 (430px) | 데스크톱 앱 |
| StatCard, HeroCard 등 대시보드 컴포넌트 | 채팅 앱에 불필요 |
| BottomNav | 데스크톱 앱 |
| Safe area 패딩 | 데스크톱 앱 |
| 단일 키 컬러 원칙 | tunaFlow는 에이전트별 색상 필요 (Claude 보라, Gemini 주황 등) |
| 상태 인디케이터 dot 규칙 | tunaFlow에 이미 다른 패턴 존재 |
| Pill toggle 선택 규칙 | tunaFlow 탭 UI와 충돌 |

---

## 9. 변경 범위 예측

| Phase | 파일 | 규모 |
|-------|------|------|
| Phase 1 | `index.css` | ~40줄 추가 (변수 정의) |
| Phase 2 | `index.css` + Settings + appStore | ~100줄 CSS + ~50줄 FE |
| Phase 3 | 각 컴포넌트 수정 시 | 점진적 (~2줄/컴포넌트) |

---

## 참고

- Toss Seed: `_research/_util/styleseed/seeds/toss/CLAUDE.md`
- Toss Design Language: `_research/_util/styleseed/seeds/toss/DESIGN-LANGUAGE.md`
- tunaFlow 현재 CSS: `src/index.css`
- 채팅 가독성 개선: `docs/ideas/chatReadabilityImprovementIdea.md` (Phase 1-2 구현 완료)
- WCAG 대비 기준: https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html
