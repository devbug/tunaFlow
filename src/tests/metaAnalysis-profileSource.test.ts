/**
 * Tier 2 meta agent profile source — `src/lib/metaAnalysis.ts` 의 migration /
 * resolution / filter 동작 단위 테스트.
 *
 * 검증 대상 (plan §3 T5):
 * - listMetaProfiles — `personaId === "persona_meta"` 필터
 * - migrateEngineValue — legacy literal (`claude-haiku` / `gemini-flash`)
 *   → 매칭 profile id 또는 `auto` fallback. stale profile id → `auto` fallback.
 *   `off` / `auto` sentinel 유지
 * - resolveMetaEngine — exec time engine/model resolution. `off` / 매칭 실패 →
 *   `null` (graceful)
 */
import { describe, it, expect } from "vitest";
import {
  listMetaProfiles,
  migrateEngineValue,
  resolveMetaEngine,
} from "@/lib/metaAnalysis";
import type { AgentProfile } from "@/types";

const profile = (over: Partial<AgentProfile>): AgentProfile => ({
  id: over.id ?? "agent-1",
  label: over.label ?? "Agent",
  engine: over.engine ?? "claude",
  model: over.model,
  personaId: over.personaId,
  defaultSkills: over.defaultSkills ?? [],
});

describe("listMetaProfiles", () => {
  it("returns only persona_meta profiles", () => {
    const profiles: AgentProfile[] = [
      profile({ id: "a", personaId: "persona_meta" }),
      profile({ id: "b", personaId: "persona_architect" }),
      profile({ id: "c" }), // no persona
      profile({ id: "d", personaId: "persona_meta" }),
    ];
    const result = listMetaProfiles(profiles);
    expect(result.map((p) => p.id)).toEqual(["a", "d"]);
  });

  it("returns empty array when no profiles", () => {
    expect(listMetaProfiles([])).toEqual([]);
  });
});

describe("migrateEngineValue", () => {
  it("keeps `off` sentinel", () => {
    expect(migrateEngineValue("off", [])).toBe("off");
  });

  it("keeps `auto` sentinel", () => {
    expect(migrateEngineValue("auto", [])).toBe("auto");
  });

  it("legacy `claude-haiku` → matching meta profile id", () => {
    const profiles: AgentProfile[] = [
      profile({ id: "meta-1", engine: "claude", model: "claude-haiku-4-5", personaId: "persona_meta" }),
    ];
    expect(migrateEngineValue("claude-haiku", profiles)).toBe("meta-1");
  });

  it("legacy `gemini-flash` → matching meta profile id (model contains 'flash')", () => {
    const profiles: AgentProfile[] = [
      profile({ id: "meta-g", engine: "gemini", model: "gemini-2.5-flash", personaId: "persona_meta" }),
      profile({ id: "meta-c", engine: "claude", model: "claude-haiku-4-5", personaId: "persona_meta" }),
    ];
    expect(migrateEngineValue("gemini-flash", profiles)).toBe("meta-g");
  });

  it("legacy literal → engine-only match when no model-hint match", () => {
    const profiles: AgentProfile[] = [
      profile({ id: "meta-c", engine: "claude", model: "claude-sonnet-4-5", personaId: "persona_meta" }),
    ];
    // model 에 "haiku" 없지만 engine 만 매칭. fallback engineMatch 로 흡수
    expect(migrateEngineValue("claude-haiku", profiles)).toBe("meta-c");
  });

  it("legacy literal → `auto` when no matching meta profile", () => {
    expect(migrateEngineValue("claude-haiku", [])).toBe("auto");
    expect(migrateEngineValue("gemini-flash", [])).toBe("auto");
  });

  it("legacy literal ignores non-meta profile (different personaId)", () => {
    const profiles: AgentProfile[] = [
      profile({ id: "arch", engine: "claude", model: "claude-haiku-4-5", personaId: "persona_architect" }),
    ];
    expect(migrateEngineValue("claude-haiku", profiles)).toBe("auto");
  });

  it("valid profile id stays valid", () => {
    const profiles: AgentProfile[] = [
      profile({ id: "meta-1", engine: "claude", personaId: "persona_meta" }),
    ];
    expect(migrateEngineValue("meta-1", profiles)).toBe("meta-1");
  });

  it("stale profile id (deleted) → `auto` fallback", () => {
    expect(migrateEngineValue("meta-deleted", [])).toBe("auto");
  });
});

describe("resolveMetaEngine", () => {
  it("`off` → null", () => {
    expect(resolveMetaEngine("off", [])).toBeNull();
  });

  it("`auto` with no meta profile → null (graceful off)", () => {
    expect(resolveMetaEngine("auto", [])).toBeNull();
  });

  it("`auto` picks the first meta profile", () => {
    const profiles: AgentProfile[] = [
      profile({ id: "meta-a", engine: "claude", model: "claude-haiku-4-5", personaId: "persona_meta" }),
      profile({ id: "meta-b", engine: "gemini", model: "gemini-2.5-flash", personaId: "persona_meta" }),
    ];
    expect(resolveMetaEngine("auto", profiles)).toEqual({
      engine: "claude",
      model: "claude-haiku-4-5",
    });
  });

  it("profile id → engine/model from matching profile", () => {
    const profiles: AgentProfile[] = [
      profile({ id: "meta-g", engine: "gemini", model: "gemini-2.5-flash", personaId: "persona_meta" }),
    ];
    expect(resolveMetaEngine("meta-g", profiles)).toEqual({
      engine: "gemini",
      model: "gemini-2.5-flash",
    });
  });

  it("profile id with no model → engine only", () => {
    const profiles: AgentProfile[] = [
      profile({ id: "meta-c", engine: "claude", model: undefined, personaId: "persona_meta" }),
    ];
    expect(resolveMetaEngine("meta-c", profiles)).toEqual({
      engine: "claude",
      model: undefined,
    });
  });

  it("non-existent profile id → null", () => {
    expect(resolveMetaEngine("nonexistent", [])).toBeNull();
  });

  it("legacy literal `claude-haiku` resolves via migration when matching profile exists", () => {
    const profiles: AgentProfile[] = [
      profile({ id: "meta-c", engine: "claude", model: "claude-haiku-4-5", personaId: "persona_meta" }),
    ];
    expect(resolveMetaEngine("claude-haiku", profiles)).toEqual({
      engine: "claude",
      model: "claude-haiku-4-5",
    });
  });

  it("legacy literal `gemini-flash` with no matching profile → null", () => {
    expect(resolveMetaEngine("gemini-flash", [])).toBeNull();
  });
});
