import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RoundtableView } from "@/components/tunaflow/RoundtableView";
import type { Message } from "@/types";

function makeMsg(overrides: Partial<Message> & { id: string }): Message {
  return {
    conversationId: "conv-1",
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    status: "done",
    ...overrides,
  };
}

describe("RoundtableView — round topic display", () => {
  it("shows 'Topic' label when single round", () => {
    const messages: Message[] = [
      makeMsg({ id: "u1", role: "user", content: "API 설계 비교" }),
      makeMsg({ id: "h1", engine: "system", content: "--- Round 1 · Sequential · Claude ---" }),
      makeMsg({ id: "a1", engine: "claude-code", persona: "Claude", content: "Here is my analysis..." }),
    ];
    render(<RoundtableView messages={messages} />);
    expect(screen.getByText("Topic")).toBeTruthy();
    expect(screen.getByText("API 설계 비교")).toBeTruthy();
  });

  it("shows 'Original Topic' when multiple rounds", () => {
    const messages: Message[] = [
      makeMsg({ id: "u1", role: "user", content: "API 설계 비교" }),
      makeMsg({ id: "h1", engine: "system", content: "--- Round 1 · Sequential · Claude ---" }),
      makeMsg({ id: "a1", engine: "claude-code", persona: "Claude", content: "Analysis..." }),
      makeMsg({ id: "u2", role: "user", content: "지금까지 요약해줘" }),
      makeMsg({ id: "h2", engine: "system", content: "--- Round 2 · Sequential · Claude ---" }),
      makeMsg({ id: "a2", engine: "claude-code", persona: "Claude", content: "Summary..." }),
    ];
    render(<RoundtableView messages={messages} />);
    expect(screen.getByText("Original Topic")).toBeTruthy();
    expect(screen.getByText("API 설계 비교")).toBeTruthy();
  });

  it("shows round intent for follow-up rounds", () => {
    const messages: Message[] = [
      makeMsg({ id: "u1", role: "user", content: "API 설계 비교" }),
      makeMsg({ id: "h1", engine: "system", content: "--- Round 1 · Sequential · Claude ---" }),
      makeMsg({ id: "a1", engine: "claude-code", persona: "Claude", content: "Analysis..." }),
      makeMsg({ id: "u2", role: "user", content: "Codex 의견만 재질문" }),
      makeMsg({ id: "h2", engine: "system", content: "--- Round 2 · Sequential · Codex ---" }),
      makeMsg({ id: "a2", engine: "codex", persona: "Codex", content: "My take..." }),
    ];
    render(<RoundtableView messages={messages} />);
    expect(screen.getByText("Intent")).toBeTruthy();
    expect(screen.getByText("Codex 의견만 재질문")).toBeTruthy();
  });

  it("renders round dividers with correct numbers", () => {
    const messages: Message[] = [
      makeMsg({ id: "u1", role: "user", content: "Topic" }),
      makeMsg({ id: "h1", engine: "system", content: "--- Round 1 · Sequential · A, B ---" }),
      makeMsg({ id: "a1", engine: "claude-code", persona: "A", content: "..." }),
      makeMsg({ id: "a2", engine: "gemini", persona: "B", content: "..." }),
    ];
    render(<RoundtableView messages={messages} />);
    expect(screen.getByText("Round 1")).toBeTruthy();
  });
});
