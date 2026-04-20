import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { getSetting } from "@/lib/appStore";
import { buildSendInput } from "@/lib/sendPipeline/buildSendInput";

vi.mock("@/lib/appStore", () => ({
  getSetting: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedGetSetting = vi.mocked(getSetting);

beforeEach(() => {
  mockedInvoke.mockReset();
  mockedGetSetting.mockReset();
  // Default: no plan phase, auto budget, no user profile.
  mockedInvoke.mockImplementation(async () => null);
  mockedGetSetting.mockImplementation(async <T,>(key: string, fallback: T): Promise<T> => {
    if (key === "contextBudgetConfig") return { mode: "auto", totalCap: 60000 } as T;
    return fallback;
  });
});

describe("buildSendInput", () => {
  it("includes engine and systemPrompt only when caller passes them (main variant)", async () => {
    const input = await buildSendInput({
      projectKey: "proj",
      conversationId: "c1",
      prompt: "q",
      engine: "claude",
      model: "sonnet-4-6",
      systemPrompt: "be terse",
      getEffectiveSkills: () => ["s1", "s2"],
    });
    expect(input.engine).toBe("claude");
    expect(input.systemPrompt).toBe("be terse");
    expect(input.activeSkills).toEqual(["s1", "s2"]);
    // auto + default cap → both overrides unset
    expect(input.contextModeOverride).toBeUndefined();
    expect(input.contextBudgetCap).toBeUndefined();
  });

  it("omits engine/systemPrompt for the branch variant", async () => {
    const input = await buildSendInput({
      projectKey: "proj",
      conversationId: "branch:x",
      prompt: "q",
      model: "sonnet-4-6",
      getEffectiveSkills: () => [],
    });
    expect("engine" in input).toBe(false);
    expect("systemPrompt" in input).toBe(false);
  });

  it("passes plan phase into getEffectiveSkills", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) =>
      cmd === "get_active_plan_phase" ? "review" : null,
    );
    const spy = vi.fn(() => ["dev-skill"]);
    const input = await buildSendInput({
      projectKey: "proj",
      conversationId: "c1",
      prompt: "ship it",
      model: "sonnet-4-6",
      getEffectiveSkills: spy,
    });
    expect(spy).toHaveBeenCalledWith("review", "ship it");
    expect(input.activeSkills).toEqual(["dev-skill"]);
  });
});
