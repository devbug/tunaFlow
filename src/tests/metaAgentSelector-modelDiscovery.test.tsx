// MetaAgentSelector — dropdown source unification test (T5 of
// metaAgentModelDiscoveryUnificationPlan_2026-05-20). Validates:
//   - CLI engines (claude/codex/gemini) pull their dropdown options
//     from useChatStore().engineModels, not from a hardcoded list.
//   - HTTP engines (ollama/lmstudio) keep using detection.models from
//     the live probe.
//   - When the store is hydrated for the engine but missing entries,
//     the "empty" placeholder renders.
//   - When the store is empty entirely, `loadEngineModels` is invoked.
//   - Default model preselects the "recommended" entry when present.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MetaAgentSelector } from "@/components/tunaflow/MetaAgentSelector";
import type { EngineModel } from "@/types";

// react-i18next: identity mock so we assert on key strings.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "ko", changeLanguage: () => Promise.resolve() },
  }),
}));

const mockInvoke = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => mockInvoke(...a) }));

// chatStore mock — only the slices MetaAgentSelector reads.
const mockLoadEngineModels = vi.fn<() => Promise<void>>(() => Promise.resolve());
let mockEngineModels: EngineModel[] = [];
vi.mock("@/stores/chatStore", () => ({
  useChatStore: <T,>(selector: (s: { engineModels: EngineModel[]; loadEngineModels: () => Promise<void> }) => T): T =>
    selector({ engineModels: mockEngineModels, loadEngineModels: mockLoadEngineModels }),
}));

type Detection = {
  engine: string;
  kind: "cli" | "http";
  installed: boolean;
  version?: string | null;
  path?: string | null;
  endpoint?: string | null;
  models: string[];
  note?: string | null;
};

const renderWith = (detections: Detection[]) => {
  mockInvoke.mockImplementation((...args: unknown[]) => {
    const cmd = args[0] as string;
    if (cmd === "detect_available_agents") return Promise.resolve(detections);
    return Promise.resolve(null);
  });
  return render(
    <MetaAgentSelector
      onProceed={() => {}}
      onSkip={() => {}}
      projectName="demo"
    />,
  );
};

beforeEach(() => {
  mockInvoke.mockReset();
  mockLoadEngineModels.mockClear();
  mockEngineModels = [];
});

describe("MetaAgentSelector — engineModels store integration", () => {
  it("CLI engine dropdown sources options from engineModels store (not a hardcoded fallback)", async () => {
    mockEngineModels = [
      { id: "claude-opus-4-7", label: "Opus 4.7", engine: "claude", recommended: true, source: "binary" },
      { id: "claude-sonnet-4-7", label: "Sonnet 4.7", engine: "claude", recommended: false, source: "binary" },
      { id: "gpt-5.1-codex", label: "GPT-5.1 Codex", engine: "codex", recommended: true, source: "cache" },
      { id: "gemini-3-pro", label: "Gemini 3 Pro", engine: "gemini", recommended: true, source: "npm" },
    ];
    renderWith([
      { engine: "claude", kind: "cli", installed: true, models: [] },
      { engine: "codex", kind: "cli", installed: true, models: [] },
      { engine: "gemini", kind: "cli", installed: true, models: [] },
    ]);

    const claudeDropdown = await screen.findByTestId("meta-agent-model-claude") as HTMLSelectElement;
    const claudeOptions = Array.from(claudeDropdown.querySelectorAll("option")).map((o) => o.value);
    expect(claudeOptions).toEqual(["claude-opus-4-7", "claude-sonnet-4-7"]);

    const codexDropdown = (await screen.findByTestId("meta-agent-model-codex")) as HTMLSelectElement;
    expect(Array.from(codexDropdown.querySelectorAll("option")).map((o) => o.value)).toEqual([
      "gpt-5.1-codex",
    ]);

    const geminiDropdown = (await screen.findByTestId("meta-agent-model-gemini")) as HTMLSelectElement;
    expect(Array.from(geminiDropdown.querySelectorAll("option")).map((o) => o.value)).toEqual([
      "gemini-3-pro",
    ]);

    // Hardcoded fallback ids that used to leak to the dropdown must not appear.
    expect(claudeOptions).not.toContain("claude-opus-4-6");
    expect(claudeOptions).not.toContain("claude-haiku-4-5");
  });

  it("preselects the recommended model when present (AgentsSection parity)", async () => {
    mockEngineModels = [
      { id: "claude-haiku-4-7", label: "Haiku 4.7", engine: "claude", recommended: false, source: "binary" },
      { id: "claude-opus-4-7", label: "Opus 4.7", engine: "claude", recommended: true, source: "binary" },
    ];
    renderWith([
      { engine: "claude", kind: "cli", installed: true, models: [] },
    ]);

    const dropdown = (await screen.findByTestId("meta-agent-model-claude")) as HTMLSelectElement;
    await waitFor(() => expect(dropdown.value).toBe("claude-opus-4-7"));
  });

  it("HTTP engine (ollama) keeps using detection.models from the live probe, ignoring engineModels store", async () => {
    mockEngineModels = [
      // Store has stale / unrelated entries — should NOT leak into HTTP dropdown.
      { id: "ollama-stale-from-store", label: "stale", engine: "ollama", recommended: false, source: "fallback" },
    ];
    renderWith([
      { engine: "ollama", kind: "http", installed: true, models: ["llama3.2:3b", "qwen3:8b"], endpoint: "http://localhost:11434" },
    ]);

    const dropdown = (await screen.findByTestId("meta-agent-model-ollama")) as HTMLSelectElement;
    const opts = Array.from(dropdown.querySelectorAll("option")).map((o) => o.value);
    expect(opts).toEqual(["llama3.2:3b", "qwen3:8b"]);
    expect(opts).not.toContain("ollama-stale-from-store");
  });

  it("invokes loadEngineModels when the store is empty on mount", async () => {
    mockEngineModels = [];
    renderWith([
      { engine: "claude", kind: "cli", installed: true, models: [] },
    ]);
    await waitFor(() => expect(mockLoadEngineModels).toHaveBeenCalledTimes(1));
  });

  it("shows the 'loading' empty-state placeholder for CLI engines while the store is empty", async () => {
    mockEngineModels = [];
    renderWith([
      { engine: "claude", kind: "cli", installed: true, models: [] },
    ]);

    const placeholder = await screen.findByTestId("meta-agent-model-empty-claude");
    expect(placeholder.getAttribute("data-empty-state")).toBe("loading");
    // The "select" dropdown must NOT render in parallel with the empty state.
    expect(screen.queryByTestId("meta-agent-model-claude")).toBeNull();
  });

  it("shows the 'empty' placeholder when the store is hydrated but has no entry for the engine", async () => {
    // Store has other engines but nothing for codex.
    mockEngineModels = [
      { id: "claude-opus-4-7", label: "Opus 4.7", engine: "claude", recommended: true, source: "binary" },
    ];
    renderWith([
      { engine: "codex", kind: "cli", installed: true, models: [] },
    ]);

    const placeholder = await screen.findByTestId("meta-agent-model-empty-codex");
    expect(placeholder.getAttribute("data-empty-state")).toBe("empty");
  });
});
