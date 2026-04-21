import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useChatStore } from "@/stores/chatStore";
import type { Plan, PlanSubtask, Message } from "@/types";
import * as planApi from "@/lib/api/plans";
import {
  detectCompletedSubtasks,
  syncSubtaskCompletion,
  extractLatestReviewVerdict,
  computeDoomLoopState,
} from "@/lib/workflow/services";
import { runProjectTests, type TestRunResult } from "@/lib/api/testRunner";
import type { ParsedReviewVerdict } from "@/lib/planProposalParser";

// Module-level cache: prevents re-running tests on tab switch (component remount)
const testResultCache = new Map<string, TestRunResult>();

export function useSubtaskProgress(plan: Plan) {
  const [subtasks, setSubtasks] = useState<PlanSubtask[]>([]);
  const [completedNums, setCompletedNums] = useState<Set<number>>(new Set());
  const [implComplete, setImplComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testResult, setTestResult] = useState<TestRunResult | null>(() => testResultCache.get(plan.id) ?? null);
  const [testRunning, setTestRunning] = useState(false);
  // Ref to prevent stale closure re-triggering tests in polling interval
  const testRanRef = useRef(testResultCache.has(plan.id));
  const [reviewVerdict, setReviewVerdict] = useState<ParsedReviewVerdict | null>(null);
  const [designReviewSuggested, setDesignReviewSuggested] = useState(false);
  const [failCount, setFailCount] = useState(0);
  const [doomLoopEscalated, setDoomLoopEscalated] = useState(false);

  const scanBranchState = async (cancelled: { current: boolean }) => {
    if (!plan.implementationBranchId) return;
    try {
      const shadowConvId = `branch:${plan.implementationBranchId}`;
      const msgs = await invoke<Message[]>("list_messages", { conversationId: shadowConvId });
      if (cancelled.current) return;

      // Pull DB subtasks + compute completion snapshot via the shared
      // service. `detectCompletedSubtasks` gives us the same
      // completedNums / allComplete view that branchSync uses, so UI and
      // background sync can't disagree.
      let dbSubtasks: PlanSubtask[] = [];
      try {
        dbSubtasks = await planApi.listSubtasks(plan.id);
      } catch { /* empty list is fine below */ }
      const state = detectCompletedSubtasks(msgs, dbSubtasks);

      // Fire-and-forget DB sync — writes any markers that the DB hasn't
      // caught up to yet, plus cascades impl-complete to all subtasks.
      syncSubtaskCompletion(plan.id, dbSubtasks, msgs).catch((e) =>
        console.debug("[subtask-sync]", e),
      );

      setCompletedNums(state.completedNums);

      // Fallback: all subtasks done + agent not running → infer impl-complete
      // even without the marker. DB state is authoritative.
      const notRunning = !useChatStore
        .getState()
        .runningThreadIds.includes(shadowConvId);
      const effectiveComplete =
        state.hasImplCompleteMarker || (state.allComplete && notRunning);
      setImplComplete(effectiveComplete);

      if (effectiveComplete && !testRanRef.current && !cancelled.current) {
        testRanRef.current = true;
        try {
          const projectKey = useChatStore.getState().selectedProjectKey;
          if (projectKey) {
            const project = await invoke("get_project", { key: projectKey }) as { path?: string };
            if (project?.path) {
              setTestRunning(true);
              const result = await runProjectTests(project.path);
              // Always cache + update state — even if cancelled (user switched tabs
              // while test was running). Without this, test re-runs on every tab switch.
              testResultCache.set(plan.id, result);
              setTestResult(result);
              setTestRunning(false);
            }
          }
        } catch (e) {
          console.warn("[tunaflow] test run failed:", e);
          setTestRunning(false);
        }
      }
    } catch (e) { console.warn("[tunaflow]", e); }
  };

  useEffect(() => {
    const cancelled = { current: false };
    setLoading(true);

    (async () => {
      const sts = await planApi.listSubtasks(plan.id).catch(() => [] as PlanSubtask[]);
      if (cancelled.current) return;
      setSubtasks(sts);

      await scanBranchState(cancelled);

      if (plan.reviewBranchId && (plan.phase === "rework" || plan.phase === "review")) {
        try {
          const reviewShadow = `branch:${plan.reviewBranchId}`;
          const reviewMsgs = await invoke<Message[]>("list_messages", { conversationId: reviewShadow });
          const latestVerdict = extractLatestReviewVerdict(reviewMsgs);
          if (latestVerdict && !cancelled.current) setReviewVerdict(latestVerdict);
        } catch (e) { console.warn("[tunaflow]", e); }
      }

      if (plan.phase === "rework" || plan.phase === "subtask_review") {
        planApi.listPlanEvents(plan.id).then((events) => {
          if (cancelled.current) return;
          // `computeDoomLoopState` already scopes the window to "since
          // last escalation" — UI and the DB-writer in reviewWorkflow
          // share the same threshold/window rules.
          const doom = computeDoomLoopState(events);
          setDesignReviewSuggested(doom.designReviewSuggested);
          setFailCount(doom.failCount);
          setDoomLoopEscalated(doom.escalated);
        }).catch((e) => console.debug("[plan-events]", e));
      }

      setLoading(false);
    })();

    const interval = setInterval(() => {
      if (plan.phase === "implementation" || plan.phase === "rework") {
        scanBranchState(cancelled);
      }
      // Also poll for verdict during review phase (safety net for auto-detect)
      if (plan.phase === "review" && plan.reviewBranchId) {
        const reviewShadow = `branch:${plan.reviewBranchId}`;
        invoke<Message[]>("list_messages", { conversationId: reviewShadow }).then((reviewMsgs) => {
          if (cancelled.current) return;
          const latest = extractLatestReviewVerdict(reviewMsgs);
          if (latest) setReviewVerdict(latest);
        }).catch((e) => console.debug("[verdict-poll]", e));
      }
    }, 5000);

    return () => { cancelled.current = true; clearInterval(interval); };
  }, [plan.id, plan.implementationBranchId, plan.phase]);

  return {
    subtasks,
    completedNums,
    implComplete,
    loading,
    testResult,
    testRunning,
    reviewVerdict,
    designReviewSuggested,
    failCount,
    doomLoopEscalated,
  };
}
