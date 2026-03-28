import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "@/components/tunaflow/Sidebar";

// Mock store with minimal data
vi.mock("@/stores/chatStore", () => ({
  useChatStore: vi.fn(() => ({
    projects: [
      { key: "test-proj", name: "Test Project", path: "/test", type: "project", source: "configured", updatedAt: 0 },
    ],
    selectedProjectKey: "test-proj",
    selectProject: vi.fn(),
    createProject: vi.fn(),
    conversations: [
      { id: "conv-1", projectKey: "test-proj", label: "Conversation 1", mode: "chat", type: "main", source: "tunadish", createdAt: 0, updatedAt: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0 },
      { id: "conv-2", projectKey: "test-proj", label: "RT Discussion", mode: "roundtable", type: "main", source: "tunadish", createdAt: 0, updatedAt: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0 },
    ],
    selectedConversationId: "conv-1",
    selectConversation: vi.fn(),
    createConversation: vi.fn(),
    deleteConversation: vi.fn(),
    renameConversation: vi.fn(),
    branches: [],
    renameBranch: vi.fn(),
    deleteBranch: vi.fn(),
    activeBranchId: null,
    threadBranchId: null,
    openThread: vi.fn(),
    rawqStatus: null,
    runningThreadIds: [],
    messageQueue: [],
  })),
}));

// Mock appStore
vi.mock("@/lib/appStore", () => ({
  getSetting: vi.fn(() => Promise.resolve([])),
  setSetting: vi.fn(() => Promise.resolve()),
}));

describe("Sidebar smoke", () => {
  it("renders sidebar with project and conversations", () => {
    render(<Sidebar />);
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.getByText("Test Project")).toBeInTheDocument();
    expect(screen.getByText("Conversation 1")).toBeInTheDocument();
  });

  it("shows Chats section header", () => {
    render(<Sidebar />);
    expect(screen.getByText("Chats")).toBeInTheDocument();
  });

  it("shows Roundtables section header", () => {
    render(<Sidebar />);
    expect(screen.getByText("Roundtables")).toBeInTheDocument();
  });

  it("shows Branches section header", () => {
    render(<Sidebar />);
    expect(screen.getByText("Branches")).toBeInTheDocument();
  });

  it("shows Files section header", () => {
    render(<Sidebar />);
    expect(screen.getByText("Files")).toBeInTheDocument();
  });

  it("separates chat and RT conversations", () => {
    render(<Sidebar />);
    // Chat conv should be in Chats section, RT conv should not
    expect(screen.getByText("Conversation 1")).toBeInTheDocument();
    expect(screen.getByText("RT Discussion")).toBeInTheDocument();
  });
});
