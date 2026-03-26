import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import * as memoApi from "@/lib/api/memos";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("memos API layer", () => {
  it("listMemosByConversation", async () => {
    mockInvoke.mockResolvedValue([]);
    await memoApi.listMemosByConversation("conv-1");
    expect(mockInvoke).toHaveBeenCalledWith("list_memos_by_conversation", {
      conversationId: "conv-1",
    });
  });

  it("createMemo passes full input", async () => {
    mockInvoke.mockResolvedValue({ id: "m1" });
    await memoApi.createMemo({
      messageId: "msg-1",
      conversationId: "conv-1",
      projectKey: "p1",
      content: "note",
    });
    expect(mockInvoke).toHaveBeenCalledWith("create_memo", {
      input: {
        messageId: "msg-1",
        conversationId: "conv-1",
        projectKey: "p1",
        content: "note",
      },
    });
  });

  it("deleteMemo", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await memoApi.deleteMemo("m1");
    expect(mockInvoke).toHaveBeenCalledWith("delete_memo", { id: "m1" });
  });
});
