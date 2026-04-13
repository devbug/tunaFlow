import { describe, it, expect, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

describe("Jobs smoke", () => {
  it("list_active_jobs invoke resolves", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    const result = await invoke("list_active_jobs");
    expect(result).toEqual([]);
  });

  it("cleanup_stale_jobs invoke resolves with count", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(0);
    const result = await invoke("cleanup_stale_jobs");
    expect(result).toBe(0);
  });

  it("start_claude_stream returns messageId", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ messageId: "msg-123" });
    const result = await invoke("start_claude_stream", { input: {} });
    expect(result).toEqual({ messageId: "msg-123" });
  });

  it("start_gemini_stream returns messageId", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ messageId: "msg-456" });
    const result = await invoke("start_gemini_stream", { input: {} });
    expect(result).toEqual({ messageId: "msg-456" });
  });

  it("start_roundtable_run returns messageId", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ messageId: "msg-rt-1" });
    const result = await invoke("start_roundtable_run", { input: {} });
    expect(result).toEqual({ messageId: "msg-rt-1" });
  });

  it("on_run_completed resolves without error", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);
    const result = await invoke("on_run_completed", { conversationId: "conv-123" });
    expect(result).toBeNull();
    expect(invoke).toHaveBeenCalledWith("on_run_completed", { conversationId: "conv-123" });
  });

  it("on_run_completed is called with correct conversationId shape", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);
    await invoke("on_run_completed", { conversationId: "branch:abc-def" });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith(
      "on_run_completed",
      expect.objectContaining({ conversationId: expect.any(String) }),
    );
  });
});
