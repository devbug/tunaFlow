import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "@/components/tunaflow/Sidebar";

// Mock store with minimal data
const sidebarState = {
  projects: [
    { key: "test-proj", name: "Test Project", path: "/test", type: "project", source: "configured", updatedAt: 0 },
  ],
  selectedProjectKey: "test-proj",
  selectProject: vi.fn(),
  createProject: vi.fn(),
  hideProject: vi.fn(),
  conversations: [
    { id: "conv-1", projectKey: "test-proj", label: "Main", mode: "chat", type: "main", source: "tunadish", createdAt: 0, updatedAt: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0 },
  ],
  selectedConversationId: "conv-1",
  selectConversation: vi.fn(),
  deleteConversation: vi.fn(),
  renameConversation: vi.fn(),
  branches: [],
  renameBranch: vi.fn(),
  deleteBranch: vi.fn(),
  activeBranchId: null,
  threadBranchId: null,
  openThread: vi.fn(),
  runningThreadIds: [],
  messageQueue: [],
  activeSkills: [],
};

vi.mock("@/stores/chatStore", () => ({
  useChatStore: Object.assign(
    vi.fn((selector?: any) => selector ? selector(sidebarState) : sidebarState),
    { getState: () => sidebarState },
  ),
}));

// Mock appStore
vi.mock("@/lib/appStore", () => ({
  getSetting: vi.fn(() => Promise.resolve([])),
  setSetting: vi.fn(() => Promise.resolve()),
}));

// Mock tauri dialog
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(() => Promise.resolve(false)),
}));

describe("Sidebar smoke", () => {
  it("renders sidebar", () => {
    render(<Sidebar />);
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    // Logo moved to TitleBar — sidebar no longer contains "tunaFlow" text
  });

  it("shows project selector with current project", () => {
    render(<Sidebar />);
    expect(screen.getByText("Test Project")).toBeInTheDocument();
  });

  it("shows Chat as tree root (renamed from Main)", () => {
    render(<Sidebar />);
    expect(screen.getByText("Chat")).toBeInTheDocument();
  });

  it("shows Files section header", () => {
    render(<Sidebar />);
    expect(screen.getByText("Files")).toBeInTheDocument();
  });
});
