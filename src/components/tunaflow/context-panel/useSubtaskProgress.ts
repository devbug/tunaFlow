import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useChatStore } from "@/stores/chatStore";
import type { Plan, PlanSubtask, Message } from "@/types";
import * as planApi from "@/lib/api/plans";
import { scanCompletedSubtasks, hasImplComplete, hasReviewVerdict, extractReviewVerdict } from "@/lib/planProposalParser";
import { runProjectTests, type TestRunResult } from "@/lib/api/testRunner";
import type { ParsedReviewVerdict } from "@/lib/planProposalParser";

export function useSubtaskProgress(plan: Plan) {
  const [subtasks, setSubtasks] = useState<PlanSubtask[]>([]);
  const [completedNums, setCompletedNums] = useState<Set<number>>(new Set());
  const [implComplete, setImplComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testResult, setTestResult] = useState<TestRunResult | null>(null);
  const [testRunning, setTestRunning] = useState(false);
  const [reviewVerdict, setReviewVerdict] = useState<ParsedReviewVerdict | null>(null);
  const [designReviewSuggested, setDesignReviewSuggested] = useState(false);

  const scanBranchState = async (cancelled: { current: boolean }) => {
    if (!plan.implementationBranchId) return;
    try {
      const shadowConvId = `branch:${plan.implementationBranchId}`;
      const msgs = await invoke<Message[]>("list_messages", { conversationId: shadowConvId });
      if (cancelled.current) return;
      const scanned = scanCompletedSubtasks(msgs);
      const complete = msgs.some((m) => m.role === "assistant" && hasImplComplete(m.content));
      if (complete && scanned.size === 0) {
        setCompletedNums(new Set(Array.from({ length: 50 }, (_, i) => i + 1)));
      } else {
        setCompletedNums(scanned);
      }
      setImplComplete(complete);

      if (complete && !testResult && !testRunning && !cancelled.current) {
        try {
          const projectKey = useChatStore.getState().selectedProjectKey;
          if (projectKey) {
            const project = await invoke("get_project", { key: projectKey }) as { path?: string };
            if (project?.path) {
              setTestRunning(true);
              const result = await runProjectTests(project.path);
              if (!cancelled.current) {
                setTestResult(result);
                setTestRunning(false);
              }
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
          for (const msg of reviewMsgs) {
            if (msg.role === "assistant" && hasReviewVerdict(msg.content)) {
              const v = extractReviewVerdict(msg.content);
              if (v && !cancelled.current) setReviewVerdict(v);
              break;
            }
          }
        } catch (e) { console.warn("[tunaflow]", e); }
      }

      if (plan.phase === "rework") {
        planApi.listPlanEvents(plan.id).then((events) => {
          if (!cancelled.current) {
            setDesignReviewSuggested(events.some((e) => e.eventType === "design_review_suggested"));
          }
        }).catch(() => {});
      }

      setLoading(false);
    })();

    const interval = setInterval(() => {
      if (plan.phase === "implementation" || plan.phase === "rework") {
        scanBranchState(cancelled);
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
  };
}
