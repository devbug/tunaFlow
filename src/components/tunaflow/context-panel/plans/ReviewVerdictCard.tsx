import { useState } from "react";
import { cn, errorMessage } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import type { Plan, PlanPhase, PlanStatus } from "@/types";
import type { ParsedReviewVerdict } from "@/lib/planProposalParser";
import { processReviewVerdict, approveAndStartImplementation } from "@/lib/workflowOrchestration";
import * as planApi from "@/lib/api/plans";
import { toast } from "sonner";

export function ReviewVerdictCard({
  verdict,
  plan,
  onPlanUpdate,
}: {
  verdict: ParsedReviewVerdict;
  plan: Plan;
  onPlanUpdate: (update: Partial<Plan>) => void;
}) {
  const [busy, setBusy] = useState(false);

  const handleApprove = async () => {
    setBusy(true);
    try {
      await processReviewVerdict(plan, { ...verdict, verdict: "pass" });
      onPlanUpdate({ phase: "done" as PlanPhase, status: "done" as PlanStatus });
    } catch (e) {
      console.error("[ReviewVerdictCard] approve failed:", e);
      toast.error("완료 처리 실패: " + errorMessage(e));
    }
    setBusy(false);
  };

  const handleRework = async () => {
    setBusy(true);
    try {
      await processReviewVerdict(plan, { ...verdict, verdict: "fail" });
      onPlanUpdate({ phase: "rework" as PlanPhase });
    } catch (e) {
      console.error("[ReviewVerdictCard] rework failed:", e);
      toast.error("Rework 처리 실패: " + errorMessage(e));
    }
    setBusy(false);
  };

  // Conditional-specific: record verdict and send findings to Developer immediately
  const handleSendToDevDirect = async () => {
    if (!plan.implementationBranchId) return;
    setBusy(true);
    try {
      // Record as conditional, then immediately transition to implementation
      await processReviewVerdict(plan, verdict);
      await import("@/lib/api/plans").then((api) => api.updatePlanPhase(plan.id, "implementation"));
      await import("@/lib/api/plans").then((api) => api.createPlanEvent(plan.id, "rework_requested", "user"));
      onPlanUpdate({ phase: "implementation" as PlanPhase });

      const { openThread, sendThreadMessage, getConversationEngine } = useChatStore.getState();
      await openThread(plan.implementationBranchId);
      const saved = getConversationEngine(`branch:${plan.implementationBranchId}`);
      const findings = verdict.findings.length > 0 ? `\n- ${verdict.findings.join("\n- ")}` : " (세부 findings 없음 — Review Branch를 직접 확인하세요)";
      const recs = verdict.recommendations.length > 0 ? `\n- ${verdict.recommendations.join("\n- ")}` : "";
      const prompt = [
        `[Conditional Review] 리뷰어가 일부 수정을 요청했습니다.`,
        ``,
        `**Findings (수정 필요):${findings}`,
        recs ? `**Recommendations:${recs}` : "",
        ``,
        `수정 후 impl-complete 마커를 출력해 주세요.`,
      ].filter(Boolean).join("\n");
      await sendThreadMessage(prompt, saved?.engine ?? "claude", saved?.model ?? undefined);
      toast.success("DEV에게 conditional findings를 전달했습니다");
    } catch (e) {
      console.error("[ReviewVerdictCard] sendToDevDirect failed:", e);
      toast.error("DEV 전달 실패: " + errorMessage(e));
    }
    setBusy(false);
  };

  // Fresh Session: kill current context, create new Implementation Branch from scratch
  const handleFreshRestart = async () => {
    setBusy(true);
    try {
      // Record failure verdict first
      await processReviewVerdict(plan, { ...verdict, verdict: "fail" });
      await planApi.createPlanEvent(plan.id, "fresh_restart", "user", "컨텍스트 오염 — fresh session으로 재시작");

      // Reset all subtasks to pending
      const { invoke } = await import("@tauri-apps/api/core");
      const subtasks = await invoke<{ id: string }[]>("list_subtasks", { planId: plan.id });
      for (const st of subtasks) {
        await invoke("update_subtask_status", { id: st.id, status: "pending" }).catch(() => {});
      }

      // Create new Implementation Branch with fresh start
      const { openThread, loadBranches, sendThreadMessage, saveConversationEngine } = useChatStore.getState();
      const profiles = useChatStore.getState().agentProfiles;
      const devProfile = profiles.find((p) => p.label?.toLowerCase().includes("dev")) ?? profiles[0];
      const engine = devProfile?.engine ?? "claude";

      const { branch, prompt } = await approveAndStartImplementation(plan, engine);
      onPlanUpdate({ phase: "implementation" as PlanPhase, implementationBranchId: branch.id });
      await loadBranches(plan.conversationId);

      const shadowConvId = `branch:${branch.id}`;
      saveConversationEngine(shadowConvId, { profileId: devProfile?.id ?? "", engine, model: devProfile?.model });

      await openThread(branch.id);
      await sendThreadMessage(prompt, engine, devProfile?.model);
      toast.success("Fresh session으로 재시작합니다");
    } catch (e) {
      console.error("[ReviewVerdictCard] fresh restart failed:", e);
      toast.error("Fresh restart 실패: " + errorMessage(e));
    }
    setBusy(false);
  };

  const verdictColors = {
    pass: "text-status-approved border-status-approved/30 bg-status-approved/5",
    fail: "text-status-rejected border-status-rejected/30 bg-status-rejected/5",
    conditional: "text-agent-gemini border-agent-gemini/30 bg-agent-gemini/5",
  };

  const verdictLabels = {
    pass: "PASS",
    fail: "FAIL",
    conditional: "CONDITIONAL",
  };

  return (
    <div className={cn("mt-2 rounded-md border p-2.5 space-y-2", verdictColors[verdict.verdict])}>
      {/* Verdict header */}
      <div className="text-[10px] font-medium uppercase">
        Reviewer Verdict: {verdictLabels[verdict.verdict]}
      </div>

      {/* Rubric scores */}
      {verdict.rubric && (
        <div className="flex items-center gap-3 text-[9px]">
          {[
            { label: "Plan", score: verdict.rubric.planCoverage },
            { label: "Code", score: verdict.rubric.codeQuality },
            { label: "Test", score: verdict.rubric.testCoverage },
            { label: "Doc", score: verdict.rubric.docQuality },
            { label: "Conv", score: verdict.rubric.convention },
          ].map(({ label, score }) => (
            <span key={label} className="flex items-center gap-0.5">
              <span className="text-muted-foreground/50">{label}</span>
              <span className={cn(
                "font-medium",
                score >= 4 ? "text-status-approved" : score >= 3 ? "text-foreground" : "text-status-rejected"
              )}>{score}/5</span>
            </span>
          ))}
        </div>
      )}

      {/* Findings */}
      {verdict.findings.length > 0 && (
        <div>
          <div className="text-[9px] text-muted-foreground/60 mb-0.5">Findings:</div>
          <ul className="space-y-0.5 text-[10px]">
            {verdict.findings.map((f, i) => (
              <li key={i} className="pl-2">- {f.slice(0, 200)}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommendations */}
      {verdict.recommendations.length > 0 && (
        <div className="text-[9px] text-muted-foreground/60">
          Recommendations: {verdict.recommendations.map((r) => r.slice(0, 100)).join("; ")}
        </div>
      )}

      {/* User decision — only show when plan is still in review/rework phase */}
      {plan.phase !== "done" && (
        <div className="flex items-center gap-2 pt-1 border-t border-current/10 flex-wrap">
          <span className="text-[9px] text-muted-foreground/50">사용자 판단:</span>
          <button onClick={handleApprove} disabled={busy}
            className="px-2.5 py-1 rounded-md text-[10px] font-medium bg-status-approved/10 text-status-approved hover:bg-status-approved/20 disabled:opacity-50 transition-colors">
            완료 → Done
          </button>
          {verdict.verdict === "conditional" && plan.implementationBranchId ? (
            <button onClick={handleSendToDevDirect} disabled={busy}
              className="px-2.5 py-1 rounded-md text-[10px] font-medium bg-agent-gemini/10 text-agent-gemini hover:bg-agent-gemini/20 disabled:opacity-50 transition-colors"
              title="Findings를 DEV에 전달하고 바로 구현 단계로 전환">
              DEV에 전달
            </button>
          ) : (
            <button onClick={handleRework} disabled={busy}
              className="px-2.5 py-1 rounded-md text-[10px] font-medium bg-status-rejected/10 text-status-rejected hover:bg-status-rejected/20 disabled:opacity-50 transition-colors">
              이어서 수정
            </button>
          )}
          <button onClick={handleFreshRestart} disabled={busy}
            className="px-2.5 py-1 rounded-md text-[10px] font-medium bg-muted/30 text-muted-foreground hover:bg-muted/50 disabled:opacity-50 transition-colors"
            title="컨텍스트를 버리고 새 Branch에서 처음부터 다시 구현">
            처음부터 다시
          </button>
        </div>
      )}
      {plan.phase === "done" && (
        <div className="pt-1 border-t border-current/10 text-[9px] text-muted-foreground/50">
          자동 처리 완료
        </div>
      )}
    </div>
  );
}
