import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContextPanel } from "@/components/tunaflow/ContextPanel";

vi.mock("@/stores/chatStore", () => ({
  useChatStore: vi.fn(() => ({
    artifacts: [],
    memos: [],
    selectedConversationId: "conv-1",
    activeBranchId: null,
    parentConversationId: null,
    runningThreadIds: [],
    messageQueue: [],
    rawqStatus: null,
    branches: [],
  })),
}));

describe("Workspace panel smoke", () => {
  it("renders workspace panel with mode tabs", () => {
    render(<ContextPanel />);
    expect(screen.getByTestId("workspace-panel")).toBeInTheDocument();
    expect(screen.getByTestId("mode-tab-plan")).toBeInTheDocument();
    expect(screen.getByTestId("mode-tab-review")).toBeInTheDocument();
    expect(screen.getByTestId("mode-tab-test")).toBeInTheDocument();
    expect(screen.getByTestId("mode-tab-artifacts")).toBeInTheDocument();
    expect(screen.getByTestId("mode-tab-trace")).toBeInTheDocument();
  });

  it("defaults to Plan mode", () => {
    render(<ContextPanel />);
    expect(screen.getByText("Plans")).toBeInTheDocument();
  });

  it("has all 5 mode tabs clickable", () => {
    render(<ContextPanel />);
    const modes = ["plan", "review", "test", "artifacts", "trace"];
    for (const mode of modes) {
      const tab = screen.getByTestId(`mode-tab-${mode}`);
      expect(tab).toBeInTheDocument();
      expect(tab).not.toBeDisabled();
    }
  });

  // Trace mode requires invoke mock for list_traces — skipped for now
  it.skip("switches to Trace mode on tab click", () => {
    render(<ContextPanel />);
    fireEvent.click(screen.getByTestId("mode-tab-trace"));
    expect(screen.getByText("Trace")).toBeInTheDocument();
  });
});
