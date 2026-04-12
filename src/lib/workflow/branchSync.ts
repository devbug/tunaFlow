/**
 * Branch sync helpers — called after agent:completed on implementation/review branches.
 * Extracted from threadSlice to keep store slice lean.
 */
import type { Message } from "@/types";

// ─── Auto-sync implementation completion from completed branch ─────────────
// Called after agent:completed on implementation branches.
// Syncs subtask-done markers to DB AND detects impl-complete structurally
// (all subtasks done) even when the agent doesn't emit the marker.

export async function autoSyncImplCompletion(shadowConvId: string, messages: Message[]): Promise<void> {
  if (!shadowConvId.startsWith("branch:")) return;
  const branchId = shadowConvId.slice("branch:".length);

  try {
    const { findPlanByBranch, listSubtasks, updateSubtaskStatus } = await import("@/lib/api/plans");
    const plan = await findPlanByBranch(branchId);
    if (!plan || plan.implementationBranchId !== branchId) return;
    if (plan.phase !== "implementation" && plan.phase !== "rework") return;

    const { scanCompletedSubtasks, hasImplComplete } = await import("@/lib/planProposalParser");
    const subtasks = await listSubtasks(plan.id);
    if (subtasks.length === 0) return;

    // 1. Sync marker-detected subtask completions to DB
    const markerNums = scanCompletedSubtasks(messages);
    const hasMarker = messages.some((m) => m.role === "assistant" && hasImplComplete(m.content));

    for (const num of markerNums) {
      const st = subtasks.find((s) => s.idx === num - 1); // markers are 1-based, idx is 0-based
      if (st && st.status !== "done") {
        await updateSubtaskStatus(st.id, "done").catch((e) => console.debug("[subtask-sync]", e));
      }
    }

    // 2. If impl-complete marker exists, mark all subtasks done
    if (hasMarker) {
      for (const st of subtasks) {
        if (st.status !== "done") {
          await updateSubtaskStatus(st.id, "done").catch((e) => console.debug("[subtask-sync]", e));
        }
      }
      return; // marker present, no need for structural detection
    }

    // 3. Structural detection: check if agent's final message indicates completion
    //    Look for completion signals in the last assistant message
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return;

    // Check if all subtasks are now done (after marker sync above)
    const refreshed = await listSubtasks(plan.id);
    const allDone = refreshed.every((st) => st.status === "done");

    if (!allDone) {
      // Heuristic: if the message mentions all tasks being complete, mark remaining subtasks done
      const content = lastAssistant.content.toLowerCase();
      const completionSignals = [
        "모든 task", "모든 태스크", "전체 완료", "구현이 완료", "구현 완료",
        "all tasks", "all subtasks", "implementation complete", "completed all",
      ];
      const looksComplete = completionSignals.some((s) => content.includes(s));
      if (looksComplete) {
        for (const st of refreshed) {
          if (st.status !== "done") {
            await updateSubtaskStatus(st.id, "done").catch((e) => console.debug("[subtask-sync]", e));
          }
        }
      }
    }
  } catch (e) {
    console.warn("[impl-sync]", e);
  }
}

// ─── Auto-detect review verdict from completed branch ──────────────────────
// Called after agent:completed in both single-agent and RT review flows.
// Extracts branchId from shadow conversation ID, finds linked plan,
// and auto-processes verdict if found.

export async function autoDetectReviewVerdict(shadowConvId: string, messages: Message[]): Promise<void> {
  if (!shadowConvId.startsWith("branch:")) return;
  const branchId = shadowConvId.slice("branch:".length);

  try {
    const { findPlanByBranch } = await import("@/lib/api/plans");
    const plan = await findPlanByBranch(branchId);
    if (!plan || plan.reviewBranchId !== branchId) return;
    if (plan.phase !== "review") return;

    const { scanMessagesForMarkers, processReviewVerdict } = await import("@/lib/workflowOrchestration");
    const markers = scanMessagesForMarkers(messages);
    if (!markers.reviewVerdict) return;

    const { toast } = await import("sonner");
    const verdict = markers.reviewVerdict.verdict;
    await processReviewVerdict(plan, markers.reviewVerdict);

    if (verdict === "pass") {
      toast.success("Review 통과 — Plan 완료 처리됨");
    } else if (verdict === "fail") {
      toast.warning("Review 실패 — Rework 단계로 전환됨");
    } else {
      toast.info("Review 조건부 통과 — 사용자 판단 필요");
    }
  } catch (e) {
    console.warn("[verdict-autodetect]", e);
  }
}
