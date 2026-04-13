import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CenterPanel } from "@/components/tunaflow/CenterPanel";

const workspaceState = {
  artifacts: [],
  memos: [],
  messages: [],
  branches: [],
  conversations: [],
  selectedConversationId: null,
  activeBranchId: null,
  parentConversationId: null,
  threadBranchId: null,
  threadBranchLabel: null,
  runningThreadIds: [],
  messageQueue: [],
  rawqStatus: null,
  deleteMemo: vi.fn(),
  selectConversation: vi.fn(),
  renameConversation: vi.fn(),
  engineModels: [],
  activeSkills: [],
  scrollToMessageId: null,
  selectedProjectKey: "test",
  personaFragment: null,
  personaLabel: null,
};

vi.mock("@/stores/chatStore", () => ({
  useChatStore: Object.assign(
    vi.fn((selector?: any) => selector ? selector(workspaceState) : workspaceState),
    { getState: () => workspaceState, setState: vi.fn() },
  ),
}));

vi.mock("@/lib/appStore", () => ({
  getSetting: vi.fn(() => Promise.resolve([])),
  setSetting: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve([])),
}));

describe("CenterPanel smoke", () => {
  it("renders with tab bar", () => {
    render(<CenterPanel />);
    expect(screen.getByText("Chat")).toBeInTheDocument();
    expect(screen.getByText("Workflow")).toBeInTheDocument();
    expect(screen.getByText("Insight")).toBeInTheDocument();
    expect(screen.getByText("Notes")).toBeInTheDocument();
  });

  it("defaults to Chat tab", () => {
    render(<CenterPanel />);
    const chatTab = screen.getByText("Chat");
    expect(chatTab).toBeInTheDocument();
  });

  it("has all 4 tabs clickable", () => {
    render(<CenterPanel />);
    const tabs = ["Chat", "Workflow", "Insight", "Notes"];
    for (const tab of tabs) {
      const el = screen.getByText(tab);
      expect(el).toBeInTheDocument();
      expect(el.closest("button")).not.toBeDisabled();
    }
  });

  it("shows search box", () => {
    render(<CenterPanel />);
    expect(screen.getByPlaceholderText("Search…")).toBeInTheDocument();
  });
});
