import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ClipboardList, Check, RotateCcw, X, Merge } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import type { ParsedPlanProposal } from "@/lib/planProposalParser";
import type { Plan } from "@/types";
import * as planApi from "@/lib/api/plans";

interface PlanProposalCardProps {
  proposal: ParsedPlanProposal;
  conversationId: string;
}

export function PlanProposalCard({ proposal, conversationId }: PlanProposalCardProps) {
  const [status, setStatus] = useState<"idle" | "promoting" | "promoted" | "merged" | "dismissed" | "revising">("idle");
  const [revisionInput, setRevisionInput] = useState("");
  const [existingPlans, setExistingPlans] = useState<Plan[]>([]);
  const activeBranchId = useChatStore((s) => s.activeBranchId);
  const sendWithEngine = useChatStore((s) => s.sendWithEngine);
  const closeThread = useChatStore((s) => s.closeThread);
  const loadBranches = useChatStore((s) => s.loadBranches);

  // Check for existing plans in this conversation that could be updated
  useEffect(() => {
    const canonicalId = conversationId.startsWith("branch:") ? undefined : conversationId;
    if (!canonicalId) return;
    planApi.listPlansByConversation(canonicalId)
      .then((plans) => setExistingPlans(plans.filter((p) => p.status !== "abandoned" && p.status !== "done")))
      .catch(() => {});
  }, [conversationId]);

  const handlePromote = async () => {
    setStatus("promoting");
    try {
      const plan = await planApi.createPlan({
        conversationId,
        branchId: activeBranchId ?? undefined,
        title: proposal.title,
        description: proposal.description || undefined,
        expectedOutcome: proposal.expectedOutcome || undefined,
        subtasks: proposal.subtasks.map((s) => ({
          title: s.title,
          details: s.details,
        })),
      });
      // Transition to approval phase + log event
      await planApi.updatePlanPhase(plan.id, "approval");
      await planApi.createPlanEvent(plan.id, "promoted", "user", `Promoted from chat`);
      setStatus("promoted");
    } catch {
      setStatus("idle");
    }
  };

  const handleMergeInto = async (targetPlan: Plan) => {
    setStatus("promoting");
    try {
      // Replace subtasks (revision auto-increments in backend)
      await planApi.replacePlanSubtasks(targetPlan.id, proposal.subtasks.map((s) => ({
        title: s.title,
        details: s.details,
      })));
      await planApi.createPlanEvent(targetPlan.id, "review_merged", "user", `Plan revised from chat (rev.${targetPlan.revision + 1})`);

      // Archive old implementation branch if it exists
      if (targetPlan.implementationBranchId) {
        await invoke("delete_branch", { id: targetPlan.implementationBranchId }).catch(() => {});
        await planApi.linkPlanBranch(targetPlan.id, "implementation", null);
        closeThread();
        await loadBranches(targetPlan.conversationId);
      }

      // Reset phase to approval for re-review
      await planApi.updatePlanPhase(targetPlan.id, "approval");

      setStatus("merged");
    } catch {
      setStatus("idle");
    }
  };

  if (status === "dismissed") return null;

  if (status === "merged") {
    return (
      <div className="my-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-xs text-primary flex items-center gap-2">
        <Merge className="w-3.5 h-3.5" />
        <span>Plan &quot;{proposal.title}&quot; — 기존 Plan에 병합됨 (재승인 필요)</span>
      </div>
    );
  }

  if (status === "promoted") {
    return (
      <div className="my-2 rounded-lg border border-status-approved/30 bg-status-approved/5 px-4 py-2.5 text-xs text-status-approved flex items-center gap-2">
        <Check className="w-3.5 h-3.5" />
        <span>Plan &quot;{proposal.title}&quot; — Plan 탭에 등록됨</span>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-lg border border-primary/20 bg-card/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 border-b border-primary/10">
        <ClipboardList className="w-4 h-4 text-primary/70" />
        <span className="text-xs font-medium text-foreground/90">
          Plan Proposal: {proposal.title}
        </span>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2.5 text-xs text-foreground/80">
        {proposal.description && (
          <div>
            <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-0.5">Description</div>
            <p>{proposal.description}</p>
          </div>
        )}

        {proposal.expectedOutcome && (
          <div>
            <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-0.5">Expected Outcome</div>
            <p>{proposal.expectedOutcome}</p>
          </div>
        )}

        {proposal.subtasks.length > 0 && (
          <div>
            <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-1">
              Subtasks ({proposal.subtasks.length})
            </div>
            <ul className="space-y-0.5">
              {proposal.subtasks.map((st, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-muted-foreground/40 shrink-0 w-4 text-right">{i + 1}.</span>
                  <span>
                    {st.title}
                    {st.details && (
                      <span className="text-muted-foreground/50"> — {st.details}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {proposal.constraints.length > 0 && (
          <div>
            <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-0.5">Constraints</div>
            <ul className="space-y-0.5">
              {proposal.constraints.map((c, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-muted-foreground/40">-</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {proposal.nonGoals.length > 0 && (
          <div>
            <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-0.5">Non-goals</div>
            <ul className="space-y-0.5">
              {proposal.nonGoals.map((ng, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-muted-foreground/40">-</span>
                  <span>{ng}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Revision input */}
      {status === "revising" && (
        <div className="px-4 py-2 border-t border-border/10 space-y-1.5">
          <textarea
            value={revisionInput}
            onChange={(e) => setRevisionInput(e.target.value)}
            placeholder="수정 요청 내용을 입력하세요..."
            rows={2}
            className="w-full bg-input rounded-md px-2.5 py-1.5 text-xs outline-none text-foreground placeholder:text-muted-foreground border border-border focus:border-ring/50 resize-none"
            autoFocus
          />
          <div className="flex gap-1.5">
            <button
              onClick={async () => {
                if (!revisionInput.trim()) return;
                const feedback = `[Plan 수정 요청: ${proposal.title}]\n\n${revisionInput.trim()}\n\n위 피드백을 반영하여 Plan을 수정하고 \`<!-- tunaflow:plan-proposal -->\` 형식으로 다시 제안하세요.`;
                setStatus("idle");
                setRevisionInput("");
                await sendWithEngine("claude", feedback);
              }}
              className="px-2.5 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              전송
            </button>
            <button
              onClick={() => { setStatus("idle"); setRevisionInput(""); }}
              className="px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      {status !== "revising" && (
        <div className="flex items-center gap-2 px-4 py-2 border-t border-border/10 bg-white/[0.02] flex-wrap">
          {/* Merge into existing plan — shown when matching plans exist */}
          {existingPlans.length > 0 && (
            existingPlans.length === 1 ? (
              <button
                onClick={() => handleMergeInto(existingPlans[0])}
                disabled={status === "promoting"}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors",
                  "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20",
                  status === "promoting" && "opacity-50 cursor-wait",
                )}
              >
                <Merge className="w-3 h-3" />
                기존 Plan에 병합
              </button>
            ) : (
              existingPlans.slice(0, 3).map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleMergeInto(p)}
                  disabled={status === "promoting"}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-amber-600/80 hover:bg-amber-500/10 transition-colors"
                >
                  <Merge className="w-3 h-3" />
                  {p.title.slice(0, 20)}에 병합
                </button>
              ))
            )
          )}
          <button
            onClick={handlePromote}
            disabled={status === "promoting"}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors",
              "bg-primary/10 text-primary hover:bg-primary/20",
              status === "promoting" && "opacity-50 cursor-wait",
            )}
          >
            <Check className="w-3 h-3" />
            {status === "promoting" ? "처리 중..." : "새 Plan 생성"}
          </button>
          <button
            onClick={() => setStatus("revising")}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            수정 요청
          </button>
          <button
            onClick={() => setStatus("dismissed")}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
          >
            <X className="w-3 h-3" />
            무시
          </button>
        </div>
      )}
    </div>
  );
}
