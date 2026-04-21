/**
 * Review verdict service.
 *
 * Centralises the "scan messages → pick one effective verdict" logic
 * that used to live inline in three places
 * (`branchSync.autoDetectReviewVerdict`, `reviewWorkflow.scanMessagesForMarkers`,
 * `useSubtaskProgress`). Multi-reviewer rounds are aggregated here so
 * callers see a single `EffectiveVerdict` shape regardless of whether
 * one or many reviewers participated.
 */
import type { Message } from "@/types";
import {
  scanAllReviewerVerdicts,
  hasReviewVerdict,
  extractReviewVerdict,
  type ParsedReviewVerdict,
} from "@/lib/planProposalParser";
import { aggregateReviewVerdicts } from "@/lib/aggregateReviewVerdicts";

/**
 * Scan assistant messages for the latest review-verdict marker. When
 * `sinceTs` (ms) is provided, messages older than that are ignored —
 * used to fence off earlier review rounds when a single review branch
 * is reused across rounds.
 */
export function extractLatestReviewVerdict(
  messages: Message[],
  sinceTs?: number,
): ParsedReviewVerdict | null {
  let latest: ParsedReviewVerdict | null = null;
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    if (sinceTs !== undefined && msg.timestamp < sinceTs) continue;
    if (hasReviewVerdict(msg.content)) {
      const v = extractReviewVerdict(msg.content);
      if (v) latest = v;
    }
  }
  return latest;
}

export interface EffectiveVerdict {
  verdict: "pass" | "fail" | "conditional";
  rubric?: {
    planCoverage: number;
    codeQuality: number;
    testCoverage: number;
    docQuality: number;
    convention: number;
  };
  findings: string[];
  recommendations: string[];
  failedSubtaskIds: number[];
  raw: string;
  reviewerCount: number;
  /** Present only when the verdict was aggregated from multiple reviewers. */
  votes?: { pass: number; fail: number; conditional: number };
}

/**
 * Return a single `EffectiveVerdict` summarising the review round.
 *   - ≥2 reviewer markers → `aggregateReviewVerdicts` consensus.
 *   - 1 or 0 markers → fall back to the single-latest verdict.
 *   - 0 markers → `null`.
 *
 * Rubric means are flattened so downstream callers can treat single-
 * and multi-reviewer rounds uniformly.
 */
export function collectAndAggregateVerdicts(
  messages: Message[],
  sinceTs?: number,
): EffectiveVerdict | null {
  const all = scanAllReviewerVerdicts(messages, sinceTs);
  if (all.length >= 2) {
    const agg = aggregateReviewVerdicts(all);
    if (!agg) return null;
    return {
      verdict: agg.verdict,
      rubric: agg.rubric
        ? {
            planCoverage: agg.rubric.planCoverage.mean,
            codeQuality: agg.rubric.codeQuality.mean,
            testCoverage: agg.rubric.testCoverage.mean,
            docQuality: agg.rubric.docQuality.mean,
            convention: agg.rubric.convention.mean,
          }
        : undefined,
      findings: agg.findings,
      recommendations: agg.recommendations,
      failedSubtaskIds: agg.failedSubtaskIds,
      raw: `aggregated from ${agg.reviewerCount} reviewers (pass=${agg.votes.pass}, fail=${agg.votes.fail}, conditional=${agg.votes.conditional})`,
      reviewerCount: agg.reviewerCount,
      votes: agg.votes,
    };
  }
  const single = extractLatestReviewVerdict(messages, sinceTs);
  if (!single) return null;
  return {
    verdict: single.verdict,
    rubric: single.rubric,
    findings: single.findings,
    recommendations: single.recommendations,
    failedSubtaskIds: single.failedSubtaskIds,
    raw: single.raw,
    reviewerCount: 1,
  };
}
