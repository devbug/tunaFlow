/**
 * Review-branch reuse judgement.
 *
 * Extracted from `workflow/helpers.ts:getOrCreateReviewBranch` so the
 * rule itself is a pure function (easy to test) and the branch-creation
 * side effect remains at the call site. Reuse is only safe when:
 *   - The plan already points to a review branch.
 *   - That branch still exists (wasn't deleted or archived).
 *   - Its `mode` matches what the new round wants (chat↔roundtable
 *     mismatches force a fresh branch so participants / config don't
 *     leak across modes).
 */
import type { Branch, Plan } from "@/types";

export interface ReviewBranchReuseDecision {
  reuse: boolean;
  branchId?: string;
}

export function shouldReuseReviewBranch(
  plan: Pick<Plan, "reviewBranchId">,
  branches: readonly Pick<Branch, "id" | "mode" | "status">[],
  mode: "chat" | "roundtable",
): ReviewBranchReuseDecision {
  if (!plan.reviewBranchId) return { reuse: false };
  const existing = branches.find((b) => b.id === plan.reviewBranchId);
  if (!existing) return { reuse: false };
  if (existing.status === "archived" || existing.status === "discarded") {
    return { reuse: false };
  }
  if (existing.mode !== mode) return { reuse: false };
  return { reuse: true, branchId: existing.id };
}
