import { useState } from "react";
import { cn, errorMessage } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import type { Plan, PlanPhase, PlanStatus } from "@/types";
import type { ParsedReviewVerdict } from "@/lib/planProposalParser";
import { processReviewVerdict, approveAndStartImplementation } from "@/lib/workflowOrchestration";
import * as planApi from "@/lib/api/plans";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";

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
  // Done 확인 단계 — fail/conditional 판정일 때 한 번 더 확인
  const [doneConfirm, setDoneConfirm] = useState(false);

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

  // 처음부터 재설계: 원안 폐기(abandoned) → Architect에게 findings 전달 → rev.2 작성
  const handleRedesign = async () => {
    setBusy(true);
    try {
      // 1. 리뷰 판정 기록
      await processReviewVerdict(plan, { ...verdict, verdict: "fail" });

      // 2. 현재 플랜 폐기 (원안 abandoned)
      await planApi.updatePlanPhase(plan.id, "done");
      await planApi.updatePlanStatus(plan.id, "abandoned");
      await planApi.createPlanEvent(plan.id, "abandoned", "user", "리뷰 실패 — 원안 폐기, 재설계 요청");

      // 3. 서브태스크 전부 pending 리셋
      const subtasks = await invoke<{ id: string }[]>("list_subtasks", { planId: plan.id });
      for (const st of subtasks) {
        await invoke("update_subtask_status", { id: st.id, status: "pending" }).catch(() => {});
      }

      // 4. Architect에게 findings 포함 재설계 요청 전송
      const { sendWithEngine, getConversationEngine } = useChatStore.getState();
      const convId = plan.conversationId;
      const saved = getConversationEngine(convId);
      const engine = saved?.engine ?? "claude";

      const findingsText = verdict.findings.length > 0
        ? verdict.findings.map((f) => `- ${f}`).join("\n")
        : "- (세부 findings 없음 — Review Branch를 참고하세요)";
      const recsText = verdict.recommendations.length > 0
        ? verdict.recommendations.map((r) => `- ${r}`).join("\n")
        : "";

      const prompt = [
        `[Plan 개정 요청] "${plan.title}" (rev.${plan.revision})이 리뷰 실패로 폐기되었습니다.`,
        ``,
        `**리뷰어 판정**: ${verdict.verdict.toUpperCase()}`,
        ``,
        `**Findings (실패 원인)**:`,
        findingsText,
        recsText ? `\n**Recommendations**:\n${recsText}` : "",
        ``,
        `위 findings를 분석하여 실패한 서브태스크를 수정한 rev.${(plan.revision ?? 1) + 1} Plan을 \`<!-- tunaflow:plan-proposal -->\` 형식으로 제안해 주세요.`,
        `성공한 서브태스크는 유지하고, 실패 원인이 된 부분만 수정하세요.`,
      ].filter(Boolean).join("\n");

      await sendWithEngine(engine, prompt);

      onPlanUpdate({ phase: "done" as PlanPhase, status: "abandoned" as PlanStatus });
      toast.success("원안이 폐기되었습니다. Architect가 재설계를 시작합니다.");
    } catch (e) {
      console.error("[ReviewVerdictCard] redesign failed:", e);
      toast.error("재설계 전환 실패: " + errorMessage(e));
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
        <div className="pt-1 border-t border-current/10">
          {doneConfirm ? (
            /* 완료 확인 단계 — 다른 버튼 없이 단독 표시 */
            <div className="space-y-1.5">
              <p className="text-[9px] text-status-rejected/80 leading-snug">
                리뷰어 판정이 <strong>{verdict.verdict === "fail" ? "실패" : "조건부"}</strong>입니다.
                이대로 완료 시 기대 동작을 하지 않을 수 있습니다.
              </p>
              <div className="flex items-center gap-1.5">
                <button onClick={handleApprove} disabled={busy}
                  className="px-2 py-1 rounded text-[10px] font-medium bg-status-approved/10 text-status-approved hover:bg-status-approved/20 disabled:opacity-50 transition-colors">
                  그래도 완료
                </button>
                <button onClick={() => setDoneConfirm(false)} disabled={busy}
                  className="px-2 py-1 rounded text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors">
                  돌아가기
                </button>
              </div>
            </div>
          ) : (
            /* 기본 액션 */
            <div className="flex items-center justify-between gap-1.5 flex-wrap">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[9px] text-muted-foreground/50">수정:</span>
                {verdict.verdict === "conditional" && plan.implementationBranchId ? (
                  <button onClick={handleSendToDevDirect} disabled={busy}
                    className="px-2 py-1 rounded text-[10px] font-medium bg-muted/40 text-muted-foreground hover:bg-muted/60 disabled:opacity-50 transition-colors"
                    title="Findings를 DEV에 전달하고 바로 구현 단계로 전환">
                    코드 재작성
                  </button>
                ) : (
                  <button onClick={handleRework} disabled={busy}
                    className="px-2 py-1 rounded text-[10px] font-medium bg-muted/40 text-muted-foreground hover:bg-muted/60 disabled:opacity-50 transition-colors">
                    코드 재작성
                  </button>
                )}
                <button onClick={handleRedesign} disabled={busy}
                  className="px-2 py-1 rounded text-[10px] font-medium bg-muted/40 text-muted-foreground hover:bg-muted/60 disabled:opacity-50 transition-colors"
                  title="Plan 단계로 복귀 — Architect가 처음부터 재설계">
                  처음부터 재설계
                </button>
              </div>
              <button
                onClick={verdict.verdict === "pass" ? handleApprove : () => setDoneConfirm(true)}
                disabled={busy}
                className="px-2.5 py-1 rounded text-[10px] font-medium bg-status-approved/10 text-status-approved hover:bg-status-approved/20 disabled:opacity-50 transition-colors">
                완료-{">"} Done
              </button>
            </div>
          )}
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
