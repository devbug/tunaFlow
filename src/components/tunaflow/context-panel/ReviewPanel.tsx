import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import { FileSearch, Gavel, CheckCircle2, Clock, XCircle } from "lucide-react";
import type { Artifact } from "@/types";

const STATUS_ICON: Record<string, React.ReactNode> = {
  draft: <Clock className="w-2.5 h-2.5" />,
  approved: <CheckCircle2 className="w-2.5 h-2.5" />,
  rejected: <XCircle className="w-2.5 h-2.5" />,
};

const STATUS_CLS: Record<string, string> = {
  draft: "text-muted-foreground/60 bg-muted",
  approved: "text-status-approved/70 bg-status-approved/8",
  rejected: "text-status-rejected/70 bg-status-rejected/8",
};

function ReviewCard({ artifact, icon, typeLabel }: { artifact: Artifact; icon: React.ReactNode; typeLabel: string }) {
  const { updateArtifactStatus, sendFollowup } = useChatStore();
  return (
    <div className="rounded-md border border-border/30 bg-card/60 p-2.5 space-y-1.5">
      <div className="flex items-start gap-2">
        <span className="shrink-0 mt-0.5">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-foreground truncate">{artifact.title}</span>
            <span className="text-[7px] font-medium px-1 rounded bg-white/5 text-sidebar-foreground/40">{typeLabel}</span>
          </div>
          <span className={cn("inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded mt-0.5", STATUS_CLS[artifact.status])}>
            {STATUS_ICON[artifact.status]} {artifact.status}
          </span>
        </div>
      </div>
      <p className="text-[11px] text-foreground/80 leading-relaxed whitespace-pre-wrap line-clamp-6">
        {artifact.content}
      </p>
      <div className="flex items-center gap-2 pt-1 border-t border-border/20 text-[9px]">
        {artifact.status !== "approved" && (
          <button onClick={() => updateArtifactStatus(artifact.id, "approved")} className="text-status-approved/70 hover:underline">Approve</button>
        )}
        {artifact.status !== "rejected" && (
          <button onClick={() => updateArtifactStatus(artifact.id, "rejected")} className="text-status-rejected/70 hover:underline">Reject</button>
        )}
        <span className="flex-1" />
        <button onClick={() => sendFollowup("claude", "artifact", `[${artifact.title}] ${artifact.content}`)} className="text-primary/60 hover:text-primary hover:underline">→ Claude</button>
      </div>
    </div>
  );
}

export function ReviewPanel() {
  const { artifacts } = useChatStore();

  const reviewFindings = artifacts
    .filter((a) => a.type === "review-findings")
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const decisions = artifacts
    .filter((a) => a.type === "architect-decision")
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const hasContent = reviewFindings.length > 0 || decisions.length > 0;

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      {hasContent && (
        <div className="flex items-center gap-3 text-[9px] text-sidebar-foreground/50">
          {reviewFindings.length > 0 && (
            <span className="flex items-center gap-1">
              <FileSearch className="w-3 h-3 text-status-draft/60" />
              {reviewFindings.length} finding{reviewFindings.length > 1 ? "s" : ""}
            </span>
          )}
          {decisions.length > 0 && (
            <span className="flex items-center gap-1">
              <Gavel className="w-3 h-3 text-status-approved/60" />
              {decisions.length} decision{decisions.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {/* Decisions — most important first */}
      {decisions.length > 0 && (
        <div>
          <h4 className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-widest mb-2">Decisions</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {decisions.map((a) => (
              <ReviewCard key={a.id} artifact={a} icon={<Gavel className="w-3.5 h-3.5 text-status-approved/60" />} typeLabel="Decision" />
            ))}
          </div>
        </div>
      )}

      {/* Review findings */}
      {reviewFindings.length > 0 && (
        <div>
          <h4 className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-widest mb-2">Findings</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {reviewFindings.map((a) => (
              <ReviewCard key={a.id} artifact={a} icon={<FileSearch className="w-3.5 h-3.5 text-status-draft/60" />} typeLabel="Review" />
            ))}
          </div>
        </div>
      )}

      {!hasContent && (
        <div className="text-center py-6">
          <FileSearch className="w-5 h-5 text-muted-foreground/20 mx-auto mb-2" />
          <p className="text-[11px] text-muted-foreground/40">No review findings or decisions yet</p>
        </div>
      )}
    </div>
  );
}
