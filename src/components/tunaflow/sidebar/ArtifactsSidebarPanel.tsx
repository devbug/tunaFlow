import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import {
  FileText, Clock, CheckCircle2, XCircle,
  ClipboardCheck, FileSearch, Gavel, TestTube,
} from "lucide-react";

const STATUS_ICON: Record<string, React.ReactNode> = {
  draft: <Clock className="w-2.5 h-2.5" />,
  approved: <CheckCircle2 className="w-2.5 h-2.5" />,
  rejected: <XCircle className="w-2.5 h-2.5" />,
};

const STATUS_CLS: Record<string, string> = {
  draft: "text-muted-foreground/50",
  approved: "text-status-approved/60",
  rejected: "text-status-rejected/60",
};

const TYPE_ICON: Record<string, React.ReactNode> = {
  "task-brief": <ClipboardCheck className="w-3 h-3 text-primary/50" />,
  "review-findings": <FileSearch className="w-3 h-3 text-status-draft/60" />,
  "architect-decision": <Gavel className="w-3 h-3 text-status-approved/60" />,
  "test-report": <TestTube className="w-3 h-3 text-agent-codex/50" />,
};

export function ArtifactsSidebarPanel() {
  const artifacts = useChatStore((s) => s.artifacts);
  const updateArtifactStatus = useChatStore((s) => s.updateArtifactStatus);

  if (artifacts.length === 0) {
    return (
      <div className="px-3 py-2 text-[10px] text-sidebar-foreground/25 italic">
        No artifacts
      </div>
    );
  }

  return (
    <div className="space-y-0.5 px-1">
      {artifacts.map((a) => (
        <div
          key={a.id}
          className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-white/[0.04] transition-colors group"
        >
          <span className="shrink-0">
            {TYPE_ICON[a.type] ?? <FileText className="w-3 h-3 text-sidebar-foreground/30" />}
          </span>
          <span className="flex-1 min-w-0 text-[10px] text-sidebar-foreground/70 truncate">
            {a.title}
          </span>
          <span className={cn("shrink-0", STATUS_CLS[a.status] ?? "text-muted-foreground/40")}>
            {STATUS_ICON[a.status] ?? STATUS_ICON.draft}
          </span>
          {/* Quick approve/reject on hover */}
          <span className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {a.status !== "approved" && (
              <button
                onClick={() => updateArtifactStatus(a.id, "approved")}
                className="p-0.5 rounded text-status-approved/40 hover:text-status-approved transition-colors"
                title="Approve"
              >
                <CheckCircle2 className="w-2.5 h-2.5" />
              </button>
            )}
            {a.status !== "rejected" && (
              <button
                onClick={() => updateArtifactStatus(a.id, "rejected")}
                className="p-0.5 rounded text-status-rejected/40 hover:text-status-rejected transition-colors"
                title="Reject"
              >
                <XCircle className="w-2.5 h-2.5" />
              </button>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
