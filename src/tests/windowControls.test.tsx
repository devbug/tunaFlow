// WindowControls — Windows custom window controls (T-WT-2 of
// windowsTitlebarUnificationPlan_2026-04-29). Verifies the three buttons
// render with proper ARIA labels, dispatch the right Tauri window APIs,
// and toggle the maximize/restore icon based on `isMaximized`.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const minimize = vi.fn(() => Promise.resolve());
const toggleMaximize = vi.fn(() => Promise.resolve());
const close = vi.fn(() => Promise.resolve());
const isMaximized = vi.fn(() => Promise.resolve(false));
const onResized = vi.fn(() => Promise.resolve(() => {}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize,
    toggleMaximize,
    close,
    isMaximized,
    onResized,
  }),
}));

import { WindowControls } from "@/components/tunaflow/WindowControls";

beforeEach(() => {
  minimize.mockClear();
  toggleMaximize.mockClear();
  close.mockClear();
  isMaximized.mockClear().mockResolvedValue(false);
  onResized.mockClear().mockResolvedValue(() => {});
});

describe("WindowControls", () => {
  it("renders Min / Max / Close buttons with correct ARIA labels", () => {
    render(<WindowControls />);
    expect(screen.getByRole("button", { name: "Minimize" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Maximize" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("dispatches minimize() when Minimize is clicked", async () => {
    render(<WindowControls />);
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    await waitFor(() => expect(minimize).toHaveBeenCalledTimes(1));
  });

  it("dispatches toggleMaximize() when Maximize is clicked", async () => {
    render(<WindowControls />);
    fireEvent.click(screen.getByRole("button", { name: "Maximize" }));
    await waitFor(() => expect(toggleMaximize).toHaveBeenCalledTimes(1));
  });

  it("dispatches close() when Close is clicked", async () => {
    render(<WindowControls />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });

  it("renders Restore label when initially maximized", async () => {
    isMaximized.mockResolvedValue(true);
    render(<WindowControls />);
    await screen.findByRole("button", { name: "Restore" });
    expect(screen.queryByRole("button", { name: "Maximize" })).toBeNull();
  });

  it("button mousedown stops propagation so a parent React handler does not fire", () => {
    // Issue #264 회귀 (architect dev 검증, 2026-05-07): parent TitleBar 의
    // `data-tauri-drag-region` 이 button 의 mousedown 을 drag 로 가로채면
    // onClick 이 fire 안 한다. WindowControls 의 각 button 은 mousedown 단계
    // 에서 React synthetic event 의 propagation 을 멈춰 click 이 살아남는다.
    // 검증: WindowControls 를 감싼 wrapper 의 React onMouseDown 이 *호출되지
    // 않는지* 직접 본다 (Gemini code review 제안 패턴, PR #269).
    let parentBubbled = false;
    render(
      <div onMouseDown={() => { parentBubbled = true; }}>
        <WindowControls />
      </div>
    );
    fireEvent.mouseDown(screen.getByRole("button", { name: "Minimize" }));
    expect(parentBubbled).toBe(false);
    fireEvent.mouseDown(screen.getByRole("button", { name: "Close" }));
    expect(parentBubbled).toBe(false);
  });
});
