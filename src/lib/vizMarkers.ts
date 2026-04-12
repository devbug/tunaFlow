/**
 * vizMarkers — strip tunaFlow workflow markers from message content before display.
 * Markers are for the pipeline only; users should never see them.
 *
 * Rules:
 * - Full blocks (review-verdict, impl-plan) → removed entirely
 * - All other single markers EXCEPT plan-proposal → removed (plan-proposal is rendered as PlanProposalCard)
 * - Meta mode: strip ALL markers including plan-proposal (Meta chat never renders plan cards)
 */

/** Standard mode: preserves plan-proposal markers (rendered as PlanProposalCard). */
export function vizMarkers(text: string): string {
  return text
    .replace(/<!-- ?tunaflow:review-verdict ?-->[\s\S]*?<!-- ?\/?tunaflow:review-verdict ?-->/g, "")
    .replace(/<!-- ?tunaflow:impl-plan ?-->[\s\S]*?<!-- ?\/?tunaflow:impl-plan ?-->/g, "")
    .replace(/<!-- ?\/?(?:tunaflow:(?!plan-proposal)[a-z_-]+(?::[^>]*)?|subtask-done:\d+|impl-complete) ?-->/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

/** Meta mode: strip all markers including plan-proposal (Meta never renders plan cards). */
export function vizMarkersAll(text: string): string {
  return text
    .replace(/<!-- ?tunaflow:[a-z_-]+ ?-->[\s\S]*?<!-- ?\/?tunaflow:[a-z_-]+ ?-->/g, "")
    .replace(/<!--[^>]*tunaflow:[^>]*-->/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
