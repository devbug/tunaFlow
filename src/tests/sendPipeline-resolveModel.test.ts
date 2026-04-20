import { describe, it, expect } from "vitest";
import { resolveModel, type ResolveModelState } from "@/lib/sendPipeline/resolveModel";
import type { AgentProfile } from "@/types";

const profile = (engine: string, model?: string): AgentProfile => ({
  id: `p-${engine}`,
  label: engine,
  engine,
  model,
  defaultSkills: [],
});

describe("resolveModel", () => {
  it("uses _convEngineMap when the saved engine matches the request", () => {
    const state: ResolveModelState = {
      _convEngineMap: { c1: { engine: "claude", model: "sonnet-4-6" } },
      agentProfiles: [profile("claude", "sonnet-4-5")],
    };
    expect(resolveModel(state, "c1", "claude")).toBe("sonnet-4-6");
  });

  it("ignores _convEngineMap when the saved engine differs", () => {
    const state: ResolveModelState = {
      _convEngineMap: { c1: { engine: "codex", model: "gpt-5-codex" } },
      agentProfiles: [profile("claude", "sonnet-4-6")],
    };
    expect(resolveModel(state, "c1", "claude")).toBe("sonnet-4-6");
  });

  it("falls back to the first matching agent profile with a model", () => {
    const state: ResolveModelState = {
      _convEngineMap: {},
      agentProfiles: [profile("claude"), profile("claude", "sonnet-4-6"), profile("claude", "sonnet-4-5")],
    };
    expect(resolveModel(state, "c1", "claude")).toBe("sonnet-4-6");
  });

  it("returns undefined when no state resolves", () => {
    const state: ResolveModelState = {
      _convEngineMap: {},
      agentProfiles: [profile("codex", "gpt-5-codex")],
    };
    expect(resolveModel(state, "c1", "claude")).toBeUndefined();
  });

  it("returns undefined when _convEngineMap has the engine but no model", () => {
    const state: ResolveModelState = {
      _convEngineMap: { c1: { engine: "claude" } },
      agentProfiles: [profile("claude")],
    };
    expect(resolveModel(state, "c1", "claude")).toBeUndefined();
  });
});
