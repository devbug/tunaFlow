/**
 * Branch sync helpers — called after agent:completed on implementation/
 * review branches. Domain rules live in `./services/*`; this file keeps
 * only the orchestration (DB fetches + toast + delegation).
 */
import type { Message } from "@/types";
import {
  syncSubtaskCompletion,
  detectCompletedSubtasks,
  collectAndAggregateVerdicts,
} from "./services";

// ─── Auto-sync implementation completion from completed branch ─────────────

/**
 * Called after agent:completed on an implementation branch. Delegates
 * marker → DB sync to `syncSubtaskCompletion`, then falls back to a
 * prose heuristic if the agent forgot to emit per-subtask markers.
 */
export async function autoSyncImplCompletion(
  shadowConvId: string,
  messages: Message[],
): Promise<void> {
  if (!shadowConvId.startsWith("branch:")) return;
  const branchId = shadowConvId.slice("branch:".length);

  try {
    const { findPlanByBranch, listSubtasks, updateSubtaskStatus } = await import("@/lib/api/plans");
    const plan = await findPlanByBranch(branchId);
    if (!plan || plan.implementationBranchId !== branchId) return;
    if (plan.phase !== "implementation" && plan.phase !== "rework") return;

    const subtasks = await listSubtasks(plan.id);
    if (subtasks.length === 0) return;

    // Primary path: marker-driven + impl-complete cascade.
    await syncSubtaskCompletion(plan.id, subtasks, messages);

    // Heuristic fallback: agent wrote "모든 task 완료" but emitted no
    // structured markers. Only triggers when we aren't already all-done.
    const refreshed = await listSubtasks(plan.id);
    const state = detectCompletedSubtasks(messages, refreshed);
    if (state.allComplete) return;

    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return;
    const content = lastAssistant.content.toLowerCase();
    const completionSignals = [
      "모든 task", "모든 태스크", "전체 완료", "구현이 완료", "구현 완료",
      "all tasks", "all subtasks", "implementation complete", "completed all",
    ];
    if (!completionSignals.some((s) => content.includes(s))) return;
    for (const st of refreshed) {
      if (st.status !== "done") {
        await updateSubtaskStatus(st.id, "done").catch((e) => console.debug("[subtask-sync]", e));
      }
    }
  } catch (e) {
    console.warn("[impl-sync]", e);
  }
}

// ─── Auto-detect review verdict from completed branch ──────────────────────

/**
 * Called after agent:completed in both single-agent and RT review
 * flows. Pulls the effective verdict via `collectAndAggregateVerdicts`
 * (single- and multi-reviewer paths share one shape), forwards it to
 * `processReviewVerdict`, and surfaces a toast.
 */
export async function autoDetectReviewVerdict(
  shadowConvId: string,
  messages: Message[],
): Promise<void> {
  if (!shadowConvId.startsWith("branch:")) return;
  const branchId = shadowConvId.slice("branch:".length);

  try {
    const { findPlanByBranch, listPlanEvents } = await import("@/lib/api/plans");
    const { processReviewVerdict } = await import("@/lib/workflowOrchestration");
    const plan = await findPlanByBranch(branchId);
    if (!plan || plan.reviewBranchId !== branchId) return;
    if (plan.phase !== "review") return;

    // Review branch reuse guard: only verdicts emitted AFTER the most
    // recent `review_started` belong to this round. plan_events.createdAt
    // is in seconds; messages.timestamp is ms — normalise.
    const events = await listPlanEvents(plan.id).catch(() => []);
    const lastReviewStart = [...events].reverse().find((e) => e.eventType === "review_started");
    const sinceTs = lastReviewStart
      ? lastReviewStart.createdAt < 10_000_000_000
        ? lastReviewStart.createdAt * 1000
        : lastReviewStart.createdAt
      : undefined;

    const effective = collectAndAggregateVerdicts(messages, sinceTs);
    if (!effective) return;

    await processReviewVerdict(plan, {
      verdict: effective.verdict,
      rubric: effective.rubric,
      findings: effective.findings,
      recommendations: effective.recommendations,
      failedSubtaskIds: effective.failedSubtaskIds,
      raw: effective.raw,
    });

    const { toast } = await import("sonner");
    const multi = effective.reviewerCount >= 2;
    if (effective.verdict === "pass") {
      toast.success(
        multi ? `Review 통과 — 만장일치 (${effective.reviewerCount} reviewers)` : "Review 통과 — Plan 완료 처리됨",
      );
    } else if (effective.verdict === "fail") {
      toast.warning(
        multi ? `Review 실패 — ${effective.reviewerCount}명 중 fail 투표 있음 (Rework)` : "Review 실패 — Rework 단계로 전환됨",
      );
    } else {
      toast.info("Review 조건부 통과 — 사용자 판단 필요");
    }
  } catch (e) {
    console.warn("[verdict-autodetect]", e);
  }
}
