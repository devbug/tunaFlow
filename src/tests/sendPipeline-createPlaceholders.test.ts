import { describe, it, expect } from "vitest";
import { createPlaceholders } from "@/lib/sendPipeline/createPlaceholders";

const NOW = 1_700_000_000_000;

describe("createPlaceholders", () => {
  it("main variant — user prompt + plain thinking placeholder (no progressContent)", () => {
    const [first, thinking] = createPlaceholders({
      convId: "conv-1",
      prompt: "hello",
      engineKey: "claude",
      model: "sonnet-4-6",
      persona: "Reviewer",
      now: NOW,
    });
    expect(first).toMatchObject({
      id: `temp-user-${NOW}`,
      conversationId: "conv-1",
      role: "user",
      content: "hello",
      status: "done",
    });
    expect(thinking).toMatchObject({
      id: `temp-thinking-${NOW}`,
      conversationId: "conv-1",
      role: "assistant",
      content: "",
      status: "streaming",
      engine: "claude",
      model: "sonnet-4-6",
      persona: "Reviewer",
    });
    expect(thinking.progressContent).toBeUndefined();
  });

  it("branch variant — progressContent carries the engine display label", () => {
    const [, thinking] = createPlaceholders({
      convId: "branch:abc",
      prompt: "review this",
      engineKey: "codex",
      progressLabel: "Codex (GPT-5)",
      now: NOW,
    });
    expect(thinking.progressContent).toBe("Codex (GPT-5)");
    expect(thinking.engine).toBe("codex");
  });

  it("system-followup — uses the pre-persisted id and role=system", () => {
    const [first] = createPlaceholders({
      convId: "conv-1",
      prompt: "[tool-request:...]",
      engineKey: "claude",
      userMessageId: "msg-sys-001",
      now: NOW,
    });
    expect(first.id).toBe("msg-sys-001");
    expect(first.role).toBe("system");
    expect(first.content).toBe("[tool-request:...]");
  });

  it("omits persona and progressContent when not provided", () => {
    const [, thinking] = createPlaceholders({
      convId: "conv-1",
      prompt: "q",
      engineKey: "claude",
      now: NOW,
    });
    expect(thinking.persona).toBeUndefined();
    expect(thinking.progressContent).toBeUndefined();
  });
});
