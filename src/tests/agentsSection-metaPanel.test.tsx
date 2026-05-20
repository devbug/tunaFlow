/**
 * MetaAnalysisPanel (Tier 2) — dropdown source / empty state coverage.
 * Plan: docs/plans/tier2MetaAgentProfileSourcePlan_2026-05-20.md §3 T5
 *
 * 검증:
 * - 메타 profile 0 개 → dropdown disabled + no_profile_hint 노출, option 은 off + auto
 * - 메타 profile N 개 → option N+2 + 그 label 표시
 * - non-meta profile (다른 personaId) 는 dropdown 옵션에서 제외
 * - 기존 legacy literal (`claude-haiku`) 저장 → mount 직후 migration 으로 매칭 profile id
 *   또는 auto 로 normalize 되어 select value 반영
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "ko", changeLanguage: () => Promise.resolve() },
  }),
}));

// appStore in-memory stub — saved metaAnalysisConfig 를 test 별로 주입.
const settingsStore = new Map<string, unknown>();
vi.mock("@/lib/appStore", () => ({
  getSetting: vi.fn(<T,>(key: string, fallback: T): Promise<T> =>
    Promise.resolve((settingsStore.has(key) ? (settingsStore.get(key) as T) : fallback)),
  ),
  setSetting: vi.fn(<T,>(key: string, value: T): Promise<void> => {
    settingsStore.set(key, value);
    return Promise.resolve();
  }),
}));

import { MetaAnalysisPanel } from "@/components/tunaflow/settings/AgentsSection";
import type { AgentProfile } from "@/types";

const profile = (over: Partial<AgentProfile>): AgentProfile => ({
  id: over.id ?? "agent-1",
  label: over.label ?? "Agent",
  engine: over.engine ?? "claude",
  model: over.model,
  personaId: over.personaId,
  defaultSkills: over.defaultSkills ?? [],
});

beforeEach(() => {
  settingsStore.clear();
});

describe("MetaAnalysisPanel — dropdown source", () => {
  it("renders only off + auto options when no meta profiles exist", async () => {
    render(<MetaAnalysisPanel agentProfiles={[]} />);

    // panel mount 후 loadMetaConfig resolve 까지 대기
    await waitFor(() => {
      expect(screen.getByTestId("meta-no-profile-hint")).toBeTruthy();
    });

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["off", "auto"]);
  });

  it("renders N+2 options when N meta profiles exist", async () => {
    const profiles: AgentProfile[] = [
      profile({ id: "meta-a", label: "Meta Alpha", engine: "claude", model: "claude-haiku-4-5", personaId: "persona_meta" }),
      profile({ id: "meta-b", label: "Meta Beta", engine: "gemini", model: "gemini-2.5-flash", personaId: "persona_meta" }),
    ];
    render(<MetaAnalysisPanel agentProfiles={profiles} />);

    await waitFor(() => {
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      expect(select.options.length).toBe(4); // off + auto + 2 meta
    });

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["off", "auto", "meta-a", "meta-b"]);
    // no_profile_hint 는 표시 안 됨
    expect(screen.queryByTestId("meta-no-profile-hint")).toBeNull();
  });

  it("excludes non-meta personas from the dropdown", async () => {
    const profiles: AgentProfile[] = [
      profile({ id: "meta-a", personaId: "persona_meta" }),
      profile({ id: "arch", personaId: "persona_architect" }),
      profile({ id: "dev", personaId: "persona_developer" }),
      profile({ id: "no-persona" }),
    ];
    render(<MetaAnalysisPanel agentProfiles={profiles} />);

    await waitFor(() => {
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      expect(select.options.length).toBe(3); // off + auto + 1 meta
    });

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["off", "auto", "meta-a"]);
  });
});

describe("MetaAnalysisPanel — legacy migration on mount", () => {
  it("migrates legacy `claude-haiku` to matching meta profile id", async () => {
    settingsStore.set("metaAnalysisConfig", {
      engine: "claude-haiku",
      autoTrigger: true,
      thresholds: { reviewPassedCount: 10, reviewFailedCount: 5, artifactCount: 10, idleDays: 7 },
    });

    const profiles: AgentProfile[] = [
      profile({ id: "meta-c", engine: "claude", model: "claude-haiku-4-5", personaId: "persona_meta" }),
    ];
    render(<MetaAnalysisPanel agentProfiles={profiles} />);

    await waitFor(() => {
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      expect(select.value).toBe("meta-c");
    });
  });

  it("falls back to `auto` when legacy literal has no matching meta profile", async () => {
    settingsStore.set("metaAnalysisConfig", {
      engine: "gemini-flash",
      autoTrigger: true,
      thresholds: { reviewPassedCount: 10, reviewFailedCount: 5, artifactCount: 10, idleDays: 7 },
    });

    render(<MetaAnalysisPanel agentProfiles={[]} />);

    await waitFor(() => {
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      expect(select.value).toBe("auto");
    });
  });

  it("normalizes stale profile id (deleted profile) to `auto`", async () => {
    settingsStore.set("metaAnalysisConfig", {
      engine: "meta-deleted",
      autoTrigger: true,
      thresholds: { reviewPassedCount: 10, reviewFailedCount: 5, artifactCount: 10, idleDays: 7 },
    });

    render(<MetaAnalysisPanel agentProfiles={[]} />);

    await waitFor(() => {
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      expect(select.value).toBe("auto");
    });
  });
});
