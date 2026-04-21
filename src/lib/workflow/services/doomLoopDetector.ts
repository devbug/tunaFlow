/**
 * Doom-loop detector.
 *
 * Encodes the "review keeps failing → warn → escalate" heuristic that
 * was duplicated across `reviewWorkflow.processReviewVerdict`
 * (DB-writer) and `useSubtaskProgress` (UI reader). Both callers now
 * use the same pure function and cannot disagree on fail counts or
 * thresholds.
 *
 * Thresholds match the originals in `reviewWorkflow.ts` (session 37):
 *   - `fail ≥ 3` → "warn" (design review recommended)
 *   - `fail ≥ 5` → "escalate" (architect redesign forced)
 * Counts are scoped to the window **since** the last escalation event
 * so a fresh round after `architect_redesign_requested` or
 * `doom_loop_escalated` starts the counter at zero.
 */
import type { PlanEvent } from "@/types";

export interface DoomLoopState {
  /** Review failures since the last escalation event in this window. */
  failCount: number;
  /** `design_review_suggested` was already logged in this window. */
  designReviewSuggested: boolean;
  /** `doom_loop_escalated` was already logged in this window. */
  escalated: boolean;
  /**
   * Coarse recommendation:
   *   - `ok`       → nothing to do
   *   - `warn`     → log `doom_loop_warning` / show UI banner
   *   - `escalate` → log `doom_loop_escalated`, force architect redesign
   */
  recommendation: "ok" | "warn" | "escalate";
  /** Events belonging to this window — useful for overlap analysis. */
  windowEvents: PlanEvent[];
}

export function computeDoomLoopState(events: readonly PlanEvent[]): DoomLoopState {
  let lastEscIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const t = events[i].eventType;
    if (t === "doom_loop_escalated" || t === "architect_redesign_requested") {
      lastEscIdx = i;
      break;
    }
  }
  const windowEvents = lastEscIdx >= 0 ? events.slice(lastEscIdx + 1) : [...events];
  const failCount = windowEvents.filter((e) => e.eventType === "review_failed").length;
  const designReviewSuggested = windowEvents.some(
    (e) => e.eventType === "design_review_suggested",
  );
  const escalated = windowEvents.some((e) => e.eventType === "doom_loop_escalated");
  let recommendation: DoomLoopState["recommendation"] = "ok";
  if (failCount >= 5) recommendation = "escalate";
  else if (failCount >= 3) recommendation = "warn";
  return { failCount, designReviewSuggested, escalated, recommendation, windowEvents };
}

export interface FindingOverlap {
  /** Ratio of current findings' file paths that also appeared in the previous round. */
  fileOverlapRatio: number;
  /** Ratio of current findings whose text fuzzy-matches a previous finding. */
  textOverlapRatio: number;
}

/**
 * File + text overlap between two rounds' `findings[]`. Used to decide
 * whether to log `design_review_suggested` (same files/texts keep
 * failing → likely a design problem, not an impl one).
 *
 * File detection regex matches `src/foo.ts:42` style — anything that
 * ends in `.<ext>` is treated as a path. Text overlap uses a lenient
 * 30-char window to survive minor phrasing changes.
 */
export function computeFindingOverlap(
  prevFindings: readonly string[],
  currFindings: readonly string[],
): FindingOverlap {
  const extractFiles = (fs: readonly string[]): Set<string> =>
    new Set(
      fs
        .map((f) => f.match(/([a-zA-Z0-9_./-]+\.[a-zA-Z]+)/)?.[1])
        .filter((x): x is string => Boolean(x)),
    );
  const prevFiles = extractFiles(prevFindings);
  const currFiles = extractFiles(currFindings);
  const fileHits = [...currFiles].filter((f) => prevFiles.has(f)).length;
  const fileOverlapRatio = currFiles.size > 0 ? fileHits / currFiles.size : 0;

  const prevTexts = prevFindings.map((f) => f.slice(0, 60).toLowerCase());
  const currTexts = currFindings.map((f) => f.slice(0, 60).toLowerCase());
  const textHits = currTexts.filter((cf) =>
    prevTexts.some((pf) => cf.includes(pf.slice(0, 30)) || pf.includes(cf.slice(0, 30))),
  ).length;
  const textOverlapRatio = currTexts.length > 0 ? textHits / currTexts.length : 0;

  return { fileOverlapRatio, textOverlapRatio };
}
