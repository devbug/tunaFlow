# 커스텀 타이틀바 + 우클릭 컨텍스트 메뉴

> Status: idea
> Created: 2026-04-03

---

## 1. 현재 상태

- **타이틀바**: Tauri 기본 네이티브 타이틀바. 앱 이름만 표시. 커스텀 기능 없음.
- **우클릭**: Tauri 기본 컨텍스트 메뉴 (dev: Reload/Inspect Element, prod: 없거나 빈 메뉴).
- **메시지 액션**: hover toolbar (`MessageActions.tsx`) — 마우스 올려야 보임.

---

## 2. 커스텀 타이틀바

### 2.1 Tauri 설정

```json
// tauri.conf.json > windows
{
  "decorations": false,
  "titleBarStyle": "overlay"  // macOS: traffic light 유지 + 투명 타이틀바
}
```

- `decorations: false` — 네이티브 타이틀바 제거
- `titleBarStyle: "overlay"` — macOS traffic light(빨/노/초) 유지하면서 앱 영역 위에 오버레이
- Windows/Linux에서는 창 제어 버튼을 직접 구현

### 2.2 레이아웃

```
macOS:
┌─[● ○ ○]──── 🐟 tunaFlow ── ProjectName ──────────────────┐
│  traffic     로고    앱이름    프로젝트명                    │
│  lights                                                    │
│  (네이티브)                                                 │

Windows/Linux:
┌── 🐟 tunaFlow ── ProjectName ──────────── [─] [□] [×] ───┐
│   로고    앱이름    프로젝트명                창 컨트롤      │
```

### 2.3 기본 기능

| 기능 | 구현 방법 |
|------|----------|
| 창 드래그 | `data-tauri-drag-region` 속성 |
| 창 닫기 | `appWindow.close()` (Tauri API) |
| 최소화 | `appWindow.minimize()` |
| 최대화/복원 | `appWindow.toggleMaximize()` |
| 더블클릭 최대화 | `data-tauri-drag-region`이 자동 처리 |
| 로고 + 앱이름 | 정적 표시 (좌측) |
| 프로젝트 이름 | `useChatStore((s) => s.selectedProjectKey)` 기반 |

### 2.4 커스텀 기능 (후보, 점진 추가)

| 기능 | 위치 | 우선순위 |
|------|------|---------|
| 프로젝트 전환 드롭다운 | 프로젝트명 클릭 | 높음 — 사이드바 진입 없이 전환 |
| 빠른 검색 (Cmd+K) | 타이틀바 중앙 | 중간 — cmdk 연동 |
| rawq 상태 인디케이터 | 우측 | 낮음 — RuntimeStatusBar에 이미 있음 |
| 에이전트 실행 상태 dot | 우측 | 낮음 — 사이드바에 이미 있음 |
| 세션 비용 표시 | 우측 | 낮음 — SDK 전환 후 정확한 비용 가능 시 |

초기에는 기본 기능(드래그, 창 제어, 로고, 프로젝트명)만 구현하고, 커스텀 기능은 하나씩 추가.

### 2.5 macOS / Windows 분기

```typescript
import { platform } from "@tauri-apps/plugin-os";

const isMac = platform() === "macos";

// TitleBar 컴포넌트
function TitleBar() {
  return (
    <div data-tauri-drag-region className="h-10 flex items-center px-3 select-none">
      {/* macOS: traffic light 영역 확보 (약 70px) */}
      {isMac && <div className="w-[70px] shrink-0" />}

      {/* 로고 + 앱 이름 */}
      <div className="flex items-center gap-2">
        <img src="/tuna.png" className="w-4 h-4" />
        <span className="text-xs font-medium text-foreground/60">tunaFlow</span>
      </div>

      {/* 프로젝트 이름 */}
      <span className="ml-3 text-xs text-foreground/40">{projectName}</span>

      <div className="flex-1" />

      {/* Windows/Linux: 창 제어 버튼 */}
      {!isMac && <WindowControls />}
    </div>
  );
}
```

### 2.6 기존 레이아웃 영향

커스텀 타이틀바 높이(~40px)가 추가되므로:
- `AppShell` 최상단에 `TitleBar` 삽입
- 메인 컨텐츠 영역이 40px 줄어듦
- macOS `titleBarStyle: "overlay"`면 타이틀바가 앱 위에 겹침 → 사이드바 상단에 패딩 필요

```
현재:
┌─────────────────────────────────┐
│ [네이티브 타이틀바]              │ ← OS가 관리
├──────────┬──────────────────────┤
│ Sidebar  │ CenterPanel          │
│          │                      │

변경 후:
┌─────────────────────────────────┐
│ [커스텀 타이틀바]                │ ← 앱이 관리
├──────────┬──────────────────────┤
│ Sidebar  │ CenterPanel          │
│          │                      │
```

macOS overlay 모드에서는 사이드바 최상단에 traffic light과 겹치지 않도록 `pt-[40px]` 또는 `pt-10` 추가.

---

## 3. 우클릭 컨텍스트 메뉴

### 3.1 Tauri 기본 메뉴 비활성화

```rust
// lib.rs 또는 tauri.conf.json
// Tauri 2에서는 기본적으로 dev 모드에서만 Inspect Element 표시
// 프로덕션에서는 자동 비활성화
```

프론트엔드에서 `onContextMenu` preventDefault + 커스텀 메뉴 표시:

```typescript
// 전역 기본 차단
document.addEventListener("contextmenu", (e) => e.preventDefault());

// 컴포넌트별 커스텀 메뉴
<div onContextMenu={(e) => {
  e.preventDefault();
  openContextMenu(e.clientX, e.clientY, menuItems);
}}>
```

### 3.2 위치별 메뉴 항목

| 우클릭 위치 | 메뉴 항목 |
|------------|----------|
| **assistant 메시지** | 복사, Branch 분기, RT 분기, Memo 저장, Artifact 저장, Forward, 구분선, 삭제 |
| **user 메시지** | 복사, 편집(재전송), 구분선, 삭제 |
| **코드블록** | 코드 복사, Artifact로 저장, 구분선, 전체 메시지 복사 |
| **인라인 코드 (파일 경로)** | 파일 열기 (FileViewer), 경로 복사 |
| **사이드바 — 대화** | 이름 변경, Branch 생성, RT 생성, 구분선, 삭제 |
| **사이드바 — Branch** | 열기, Adopt, Archive, 구분선, 삭제 |
| **사이드바 — 프로젝트** | 프로젝트 설정, 폴더 열기, 구분선, 숨기기 |
| **입력 영역** | 붙여넣기, 전체 선택, 히스토리 |
| **빈 영역** | 새 대화, 구분선, 스크롤 맨 위/아래 |

### 3.3 hover toolbar과의 관계

| | hover toolbar | 우클릭 메뉴 |
|---|---|---|
| **접근** | 마우스 호버 | 마우스 우클릭 |
| **항목 수** | 3-5개 (자주 쓰는 것) | 전체 액션 |
| **표시** | 항상 (호버 시) | 요청 시 |
| **역할** | 빠른 접근 | 전체 접근 |

hover toolbar을 **제거하지 않는다**. 보완 관계. 자주 쓰는 액션(복사, Branch)은 hover에서 바로, 나머지(Artifact 저장, Forward, 삭제)는 우클릭으로.

### 3.4 UI 컴포넌트 선택

| 옵션 | 장점 | 단점 |
|------|------|------|
| **Radix ContextMenu** | 접근성, 키보드 지원, 서브메뉴 | 의존성 추가 |
| **직접 구현** (Portal + position) | 의존성 없음 | 접근성/키보드/서브메뉴 직접 구현 |
| **cmdk 확장** | 이미 의존성 있음 | cmdk는 커맨드 팔레트용, 컨텍스트 메뉴와 UX 다름 |

**권장**: Radix ContextMenu. Tauri 앱에서 접근성은 덜 중요하지만, 서브메뉴/키보드/포커스 관리를 직접 구현하면 버그가 많다. `@radix-ui/react-context-menu`는 ~15KB.

### 3.5 구현 구조

```typescript
// components/tunaflow/ContextMenu.tsx

interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;        // "⌘C", "⌘B" 등
  action: () => void;
  disabled?: boolean;
  destructive?: boolean;    // 빨간색 표시
  separator?: boolean;      // 구분선
}

interface ContextMenuConfig {
  target: "message" | "codeblock" | "filepath" | "sidebar-chat" | "sidebar-branch" | "input" | "empty";
  data?: {
    messageId?: string;
    content?: string;
    filePath?: string;
    branchId?: string;
    conversationId?: string;
  };
}

function getMenuItems(config: ContextMenuConfig): ContextMenuItem[] {
  switch (config.target) {
    case "message":
      return config.data?.isUser
        ? [/* user 메시지 메뉴 */]
        : [/* assistant 메시지 메뉴 */];
    case "codeblock":
      return [/* 코드블록 메뉴 */];
    // ...
  }
}
```

### 3.6 dev 모드 Inspect Element 유지

개발 편의를 위해 dev 모드에서는 우클릭 메뉴 하단에 "Inspect Element" 항목 추가:

```typescript
if (import.meta.env.DEV) {
  items.push({ separator: true });
  items.push({
    label: "Inspect Element",
    action: () => invoke("open_devtools"),
  });
}
```

---

## 4. 구현 순서

### Phase 1: 커스텀 타이틀바

```
1-1. tauri.conf.json: decorations: false, titleBarStyle 설정
1-2. TitleBar 컴포넌트: 드래그, 창 제어, 로고, 프로젝트명
1-3. macOS/Windows 분기: traffic light 영역 확보 vs 창 버튼
1-4. AppShell 레이아웃 조정: 타이틀바 높이 반영
1-5. window-state 호환 확인: 창 위치/크기 저장 동작 유지
```

**리스크**: `decorations: false`가 window-state 플러그인과 충돌할 수 있음. 확인 필요.

### Phase 2: 우클릭 컨텍스트 메뉴

```
2-1. 의존성: @radix-ui/react-context-menu 추가
2-2. 기본 메뉴 차단: document contextmenu preventDefault
2-3. ContextMenu 컴포넌트: target별 메뉴 항목 분기
2-4. MessageItem 연동: assistant/user 메시지 메뉴
2-5. 코드블록 연동: MarkdownComponents.tsx 코드블록 메뉴
2-6. 사이드바 연동: TreeRow, ChatsSection 등
2-7. dev 모드: Inspect Element 유지
```

### Phase 3: 커스텀 기능 추가 (점진)

```
3-1. 프로젝트 전환 드롭다운 (타이틀바)
3-2. Cmd+K 빠른 검색 (타이틀바, cmdk 연동)
3-3. 코드블록 → 파일 저장 (우클릭 메뉴)
3-4. 메시지 편집/재전송 (우클릭 메뉴)
```

---

## 5. 변경 범위 예측

### Phase 1 (타이틀바)

| 파일 | 변경 |
|------|------|
| `tauri.conf.json` | `decorations`, `titleBarStyle` |
| 새 파일: `TitleBar.tsx` | ~80줄 |
| `AppShell.tsx` (또는 메인 레이아웃) | TitleBar 삽입 + 패딩 조정 |
| `package.json` | `@tauri-apps/plugin-os` (이미 있을 수 있음) |

### Phase 2 (우클릭)

| 파일 | 변경 |
|------|------|
| `package.json` | `@radix-ui/react-context-menu` 추가 |
| 새 파일: `ContextMenu.tsx` | ~150줄 (메뉴 정의 + 렌더링) |
| `MessageItem.tsx` | `onContextMenu` 래핑 |
| `MarkdownComponents.tsx` | 코드블록 `onContextMenu` |
| 사이드바 컴포넌트 (3-4파일) | `onContextMenu` 래핑 |
| `App.tsx` 또는 `index.tsx` | 전역 contextmenu preventDefault |

---

## 참고

- Tauri 2 Window Customization: `decorations`, `titleBarStyle`, `data-tauri-drag-region`
- Tauri 2 Window API: `@tauri-apps/api/window` (close, minimize, toggleMaximize)
- Radix Context Menu: `@radix-ui/react-context-menu`
- 현재 hover toolbar: `src/components/tunaflow/message/MessageActions.tsx`
- 현재 앱 레이아웃: `src/App.tsx` 또는 메인 shell 컴포넌트
- 현재 window-state: `tauri-plugin-window-state` (이미 사용 중)
