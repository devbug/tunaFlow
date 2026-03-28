import { useChatStore } from "@/stores/chatStore";
import { ChevronRight, Loader2 } from "lucide-react";

/**
 * Breadcrumb path bar — shows: Project > Chat/RT > Branch
 */
export function StatusBar() {
  const projects = useChatStore((s) => s.projects);
  const selectedProjectKey = useChatStore((s) => s.selectedProjectKey);
  const conversations = useChatStore((s) => s.conversations);
  const selectedConversationId = useChatStore((s) => s.selectedConversationId);
  const activeBranchId = useChatStore((s) => s.activeBranchId);
  const branches = useChatStore((s) => s.branches);
  const threadBranchId = useChatStore((s) => s.threadBranchId);
  const threadBranchLabel = useChatStore((s) => s.threadBranchLabel);
  const runningThreadIds = useChatStore((s) => s.runningThreadIds);
  const messageQueue = useChatStore((s) => s.messageQueue);

  const project = projects.find((p) => p.key === selectedProjectKey);
  const conv = conversations.find((c) => c.id === selectedConversationId);
  const isRT = conv?.mode === "roundtable";

  // Active branch (full view) or thread drawer branch
  const branchId = activeBranchId || threadBranchId;
  const branch = branchId ? branches.find((b) => b.id === branchId) : null;
  const branchLabel = branch?.customLabel ?? branch?.label ?? threadBranchLabel;

  const isBranchRT = branch?.mode === "roundtable";

  const crumbs: { label: string; muted?: boolean }[] = [];

  if (project) {
    crumbs.push({ label: project.name });
  }
  if (conv) {
    const convLabel = conv.customLabel ?? conv.label;
    crumbs.push({ label: isRT ? `${convLabel} (RT)` : convLabel });
  }
  if (branchLabel) {
    crumbs.push({ label: isBranchRT ? `${branchLabel} (RT branch)` : branchLabel });
  }

  if (crumbs.length === 0) return null;

  return (
    <div className="flex items-center gap-1 px-4 h-6 bg-card/30 border-b border-border/30 text-[10px] text-sidebar-foreground/40 shrink-0 overflow-hidden">
      {crumbs.map((crumb, i) => (
        <span key={i} className="flex items-center gap-1 min-w-0">
          {i > 0 && <ChevronRight className="w-2.5 h-2.5 text-sidebar-foreground/20 shrink-0" />}
          <span className="truncate max-w-[120px]">{crumb.label}</span>
        </span>
      ))}
      {/* Running/queued indicator */}
      {runningThreadIds.length > 0 && (
        <span className="ml-auto flex items-center gap-1 text-[9px] text-primary/60 shrink-0">
          <Loader2 className="w-2.5 h-2.5 animate-spin" />
          {runningThreadIds.length} running
          {messageQueue.length > 0 && <span className="text-muted-foreground/40">+{messageQueue.length}q</span>}
        </span>
      )}
    </div>
  );
}
