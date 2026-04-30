// convEngineMap profile-sync — assetSlice's `saveProfiles` sync helper.
// Verifies that an agent profile's `model` change propagates to matching
// "profile-derived" conversation entries while leaving user-explicit
// (and legacy untagged) entries alone — the regression that motivated the
// fix in user environment 2026-04-30 (architect-claude 4-6 stale stuck on
// 8 conversations after profile bumped to 4-7).

import { describe, it, expect } from "vitest";
import {
  syncConvMapForProfileChanges,
  type ConversationEngineState,
} from "@/stores/slices/assetSlice";
import type { AgentProfile } from "@/types";

const profile = (id: string, engine: string, model?: string): AgentProfile => ({
  id,
  label: id,
  engine,
  model,
  defaultSkills: [],
});

describe("syncConvMapForProfileChanges", () => {
  it("updates profile-derived entries to the new model", () => {
    const prev = [profile("architect-claude", "claude", "claude-opus-4-6")];
    const next = [profile("architect-claude", "claude", "claude-opus-4-7")];
    const map: Record<string, ConversationEngineState> = {
      conv1: { profileId: "architect-claude", engine: "claude", model: "claude-opus-4-6", source: "profile-derived" },
      conv2: { profileId: "architect-claude", engine: "claude", model: "claude-opus-4-6", source: "profile-derived" },
    };
    const { nextMap, changed } = syncConvMapForProfileChanges(prev, next, map);
    expect(changed).toBe(true);
    expect(nextMap.conv1.model).toBe("claude-opus-4-7");
    expect(nextMap.conv2.model).toBe("claude-opus-4-7");
  });

  it("protects user-explicit entries", () => {
    const prev = [profile("architect-claude", "claude", "claude-opus-4-6")];
    const next = [profile("architect-claude", "claude", "claude-opus-4-7")];
    const map: Record<string, ConversationEngineState> = {
      explicit: { profileId: "architect-claude", engine: "claude", model: "claude-sonnet-4-5", source: "user-explicit" },
    };
    const { nextMap, changed } = syncConvMapForProfileChanges(prev, next, map);
    expect(changed).toBe(false);
    expect(nextMap.explicit.model).toBe("claude-sonnet-4-5");
  });

  it("treats legacy entries without `source` as user-explicit (skipped)", () => {
    const prev = [profile("architect-claude", "claude", "claude-opus-4-6")];
    const next = [profile("architect-claude", "claude", "claude-opus-4-7")];
    const map: Record<string, ConversationEngineState> = {
      legacy: { profileId: "architect-claude", engine: "claude", model: "claude-opus-4-6" },
    };
    const { nextMap, changed } = syncConvMapForProfileChanges(prev, next, map);
    expect(changed).toBe(false);
    expect(nextMap.legacy.model).toBe("claude-opus-4-6");
    expect(nextMap.legacy.source).toBeUndefined();
  });

  it("ignores entries whose profileId does not match a changed profile", () => {
    const prev = [
      profile("architect-claude", "claude", "claude-opus-4-6"),
      profile("reviewer-codex", "codex", "gpt-5-codex"),
    ];
    const next = [
      profile("architect-claude", "claude", "claude-opus-4-7"),
      profile("reviewer-codex", "codex", "gpt-5-codex"),
    ];
    const map: Record<string, ConversationEngineState> = {
      reviewer: { profileId: "reviewer-codex", engine: "codex", model: "gpt-5-codex", source: "profile-derived" },
    };
    const { nextMap, changed } = syncConvMapForProfileChanges(prev, next, map);
    expect(changed).toBe(false);
    expect(nextMap.reviewer.model).toBe("gpt-5-codex");
  });

  it("ignores entries with profileId=null (free-form selection)", () => {
    const prev = [profile("architect-claude", "claude", "claude-opus-4-6")];
    const next = [profile("architect-claude", "claude", "claude-opus-4-7")];
    const map: Record<string, ConversationEngineState> = {
      freeform: { profileId: null, engine: "claude", model: "claude-opus-4-6", source: "profile-derived" },
    };
    const { nextMap, changed } = syncConvMapForProfileChanges(prev, next, map);
    expect(changed).toBe(false);
    expect(nextMap.freeform.model).toBe("claude-opus-4-6");
  });

  it("returns unchanged map when no profile model changed", () => {
    const prev = [profile("architect-claude", "claude", "claude-opus-4-7")];
    const next = [profile("architect-claude", "claude", "claude-opus-4-7", )];
    const map: Record<string, ConversationEngineState> = {
      conv1: { profileId: "architect-claude", engine: "claude", model: "claude-opus-4-7", source: "profile-derived" },
    };
    const { nextMap, changed } = syncConvMapForProfileChanges(prev, next, map);
    expect(changed).toBe(false);
    expect(nextMap).toBe(map);
  });

  it("reproduces the user-environment regression (8-conv architect-claude 4-6 → 4-7)", () => {
    // Original symptom: agentProfiles.architect-claude.model = 4-7, UI 표시 4-7,
    // but send time used stale 4-6 because convEngineMap entries were never updated.
    const prev = [profile("architect-claude", "claude", "claude-opus-4-6")];
    const next = [profile("architect-claude", "claude", "claude-opus-4-7")];
    const map: Record<string, ConversationEngineState> = {};
    for (let i = 0; i < 8; i++) {
      map[`conv-${i}`] = { profileId: "architect-claude", engine: "claude", model: "claude-opus-4-6", source: "profile-derived" };
    }
    const { nextMap, changed } = syncConvMapForProfileChanges(prev, next, map);
    expect(changed).toBe(true);
    for (const conv of Object.values(nextMap)) {
      expect(conv.model).toBe("claude-opus-4-7");
    }
  });
});
