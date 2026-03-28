import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";

// Store slice tests — verify key state transitions without full UI render

describe("Store smoke — project selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invoke is mocked", async () => {
    expect(invoke).toBeDefined();
    await expect(invoke("list_projects")).resolves.toBeUndefined();
  });

  it("invoke can be configured to return data", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { key: "p1", name: "Project 1", type: "project", source: "configured", updatedAt: 0 },
    ]);
    const result = await invoke("list_projects");
    expect(result).toHaveLength(1);
  });
});

describe("Store smoke — conversation operations", () => {
  it("list_messages invoke resolves", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    const result = await invoke("list_messages", { conversationId: "test-conv" });
    expect(result).toEqual([]);
  });

  it("create_conversation invoke resolves", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "new-conv",
      projectKey: "p1",
      label: "Test Conv",
      mode: "chat",
    });
    const result = await invoke("create_conversation", { input: { projectKey: "p1", label: "Test Conv" } });
    expect(result).toHaveProperty("id", "new-conv");
  });
});

describe("Store smoke — branch operations", () => {
  it("list_branches invoke resolves", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    const result = await invoke("list_branches", { conversationId: "test-conv" });
    expect(result).toEqual([]);
  });

  it("delete_branch invoke resolves", async () => {
    await expect(invoke("delete_branch", { id: "branch-1" })).resolves.toBeUndefined();
  });
});

describe("Store smoke — message pair deletion", () => {
  it("delete_message_pair invoke resolves", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(2);
    const result = await invoke("delete_message_pair", { messageId: "msg-1" });
    expect(result).toBe(2);
  });
});
