/**
 * Meta Analysis — Tier 2 엔진 선택 + 자동 분석 트리거.
 *
 * **원칙**: 사용자가 Agents 패널에서 정의한 메타 페르소나 profile
 * (`personaId === "persona_meta"`) 자체가 Tier 2 분석 엔진 source.
 *
 * 이전 (v0.1.8-beta-3 까지) 에는 `claude-haiku` / `gemini-flash` literal 2 종을
 * 하드코딩했으나 (`MetaAnalysisEngine` literal union), v0.1.8-beta-4 부터는
 * agentProfiles 의 메타 profile id 를 그대로 engine 값으로 저장한다.
 *
 * 저장 가능한 engine 값:
 * - `"off"` — Tier 2 자동 분석 비활성화
 * - `"auto"` — agentProfiles 의 첫 메타 profile 자동 선택 (없으면 graceful off)
 * - `<profile id>` — agentProfiles.find(p => p.id === id && p.personaId === "persona_meta")
 *
 * 기존 literal (`claude-haiku` / `gemini-flash`) 저장 사용자는 `migrateMetaConfig()`
 * 가 agentProfiles 에서 engine+model heuristic 으로 매칭 profile 검색 → 있으면
 * 그 id, 없으면 `auto` 로 fallback.
 */
import { getSetting, setSetting } from "@/lib/appStore";
import type { AgentProfile } from "@/types";

/** `"off"` / `"auto"` 두 sentinel + 그 외 모든 string = agentProfile id.
 *  literal union 으로 좁히지 않는 이유: profile id 가 런타임 동적이기 때문. */
export type MetaAnalysisEngine = "off" | "auto" | (string & {});

/** Legacy literal 값 — `migrateMetaConfig` 가 새 profile id 또는 `auto` 로 변환. */
export const LEGACY_ENGINE_VALUES = ["claude-haiku", "gemini-flash"] as const;
export type LegacyMetaAnalysisEngine = (typeof LEGACY_ENGINE_VALUES)[number];

export interface MetaAnalysisConfig {
  /** 메타 profile id, 또는 `"off"` / `"auto"` sentinel. */
  engine: MetaAnalysisEngine;
  /** 자동 트리거 on/off */
  autoTrigger: boolean;
  /** Tier 2 트리거 임계값 */
  thresholds: {
    reviewPassedCount: number;  // 누적 N 건 도달 시 주간 요약
    reviewFailedCount: number;  // 누적 N 건 도달 시 실패 패턴 분석
    artifactCount: number;       // 누적 N 건 도달 시 artifacts 요약
    idleDays: number;            // N 일 경과 시 "다음 우선순위" 제안
  };
}

export const DEFAULT_CONFIG: MetaAnalysisConfig = {
  engine: "auto",
  autoTrigger: true,
  thresholds: {
    reviewPassedCount: 10,
    reviewFailedCount: 5,
    artifactCount: 10,
    idleDays: 7,
  },
};

export async function loadMetaConfig(): Promise<MetaAnalysisConfig> {
  const saved = await getSetting<MetaAnalysisConfig | null>("metaAnalysisConfig", null);
  if (!saved) return DEFAULT_CONFIG;
  return {
    ...DEFAULT_CONFIG,
    ...saved,
    thresholds: { ...DEFAULT_CONFIG.thresholds, ...(saved.thresholds ?? {}) },
  };
}

export async function saveMetaConfig(config: MetaAnalysisConfig): Promise<void> {
  await setSetting("metaAnalysisConfig", config);
}

function isLegacyEngine(v: unknown): v is LegacyMetaAnalysisEngine {
  return typeof v === "string" && (LEGACY_ENGINE_VALUES as readonly string[]).includes(v);
}

/** Legacy literal → backend engine + model heuristic 매핑.
 *  현 agentProfiles 에서 engine+model 가 거의 일치하는 profile 을 찾는 데 사용. */
function legacyToBackend(legacy: LegacyMetaAnalysisEngine): { engine: string; modelHint: string } {
  switch (legacy) {
    case "claude-haiku":
      return { engine: "claude", modelHint: "haiku" };
    case "gemini-flash":
      return { engine: "gemini", modelHint: "flash" };
  }
}

/** agentProfiles 에서 메타 persona profile 만 필터. */
export function listMetaProfiles(agentProfiles: AgentProfile[]): AgentProfile[] {
  return agentProfiles.filter((p) => p.personaId === "persona_meta");
}

/**
 * 저장된 engine 값을 현재 agentProfiles 기준으로 normalize.
 *
 * 변환 규칙:
 * - `"off"` → `"off"` 유지
 * - `"auto"` → `"auto"` 유지
 * - legacy literal (`claude-haiku` / `gemini-flash`) → metaProfiles 에서 engine + model
 *   heuristic 매칭. 매칭 profile 있으면 그 id, 없으면 `"auto"` fallback
 * - 메타 profile id 와 매칭되면 그 id 유지
 * - 매칭 안 되면 (profile 삭제 등) `"auto"` fallback
 */
export function migrateEngineValue(
  engine: MetaAnalysisEngine,
  agentProfiles: AgentProfile[],
): MetaAnalysisEngine {
  if (engine === "off" || engine === "auto") return engine;

  const metaProfiles = listMetaProfiles(agentProfiles);

  if (isLegacyEngine(engine)) {
    const { engine: targetEngine, modelHint } = legacyToBackend(engine);
    const match = metaProfiles.find(
      (p) =>
        p.engine === targetEngine &&
        (p.model ?? "").toLowerCase().includes(modelHint),
    );
    if (match) return match.id;
    // engine 만 일치하는 profile 이라도 매칭
    const engineMatch = metaProfiles.find((p) => p.engine === targetEngine);
    if (engineMatch) return engineMatch.id;
    return "auto";
  }

  // engine 값이 profile id 인 경우 — 존재 확인
  const found = metaProfiles.find((p) => p.id === engine);
  return found ? engine : "auto";
}

/** Config 전체 migration. UI load 시 사용. */
export function migrateMetaConfig(
  config: MetaAnalysisConfig,
  agentProfiles: AgentProfile[],
): MetaAnalysisConfig {
  const migratedEngine = migrateEngineValue(config.engine, agentProfiles);
  if (migratedEngine === config.engine) return config;
  return { ...config, engine: migratedEngine };
}

/**
 * exec time engine resolution — Tier 2 분석 실행 직전에 engine 값을 backend
 * engine/model 로 풀어준다.
 *
 * - `"off"` → `null` (분석 실행 안 함)
 * - `"auto"` → metaProfiles 중 첫 profile. 없으면 `null` (graceful off)
 * - profile id → `agentProfiles.find()` 으로 engine/model 추출. 매칭 실패 → `null`
 */
export function resolveMetaEngine(
  engine: MetaAnalysisEngine,
  agentProfiles: AgentProfile[],
): { engine: string; model?: string } | null {
  if (engine === "off") return null;

  const metaProfiles = listMetaProfiles(agentProfiles);

  if (engine === "auto") {
    const first = metaProfiles[0];
    if (!first) return null;
    return { engine: first.engine, model: first.model };
  }

  // 동적 profile id 또는 legacy literal — legacy 면 한 번 더 migrate 후 재귀.
  if (isLegacyEngine(engine)) {
    const migrated = migrateEngineValue(engine, agentProfiles);
    if (migrated === engine) return null; // 무한 재귀 방지 (이론상 도달 불가)
    return resolveMetaEngine(migrated, agentProfiles);
  }

  const profile = metaProfiles.find((p) => p.id === engine);
  if (!profile) return null;
  return { engine: profile.engine, model: profile.model };
}
