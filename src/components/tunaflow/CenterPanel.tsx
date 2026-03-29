import { useState } from "react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import { MessageSquare, ClipboardList, FileSearch, TestTube, GitBranch, Users, Loader2, Search } from "lucide-react";

import { ChatPanel } from "./ChatPanel";
import { PlansPanel } from "./context-panel/PlansPanel";
import { HarnessSummary } from "./context-panel/HarnessSummary";
import { ReviewPanel } from "./context-panel/ReviewPanel";
import { TestPanel } from "./context-panel/TestPanel";
import { InlineRename } from "./InlineRename";

type CenterTab = "chat" | "plan" | "review" | "test";

const TABS: { id: CenterTab; label: string; icon: React.ReactNode }[] = [
  { id: "chat", label: "Chat", icon: <MessageSquare className="w-3.5 h-3.5" /> },
  { id: "plan", label: "Plan", icon: <ClipboardList className="w-3.5 h-3.5" /> },
  { id: "review", label: "Review", icon: <FileSearch className="w-3.5 h-3.5" /> },
  { id: "test", label: "Test", icon: <TestTube className="w-3.5 h-3.5" /> },
];

export function CenterPanel() {
  const [activeTab, setActiveTab] = useState<CenterTab>("chat");
  const artifacts = useChatStore((s) => s.artifacts);
  const selectedConversationId = useChatStore((s) => s.selectedConversationId);
  const conversations = useChatStore((s) => s.conversations);
  const branches = useChatStore((s) => s.branches);
  const activeBranchId = useChatStore((s) => s.activeBranchId);
  const parentConversationId = useChatStore((s) => s.parentConversationId);
  const threadBranchId = useChatStore((s) => s.threadBranchId);
  const threadBranchLabel = useChatStore((s) => s.threadBranchLabel);
  const runningThreadIds = useChatStore((s) => s.runningThreadIds);
  const messageQueue = useChatStore((s) => s.messageQueue);
  const renameConversation = useChatStore((s) => s.renameConversation);

  const canonicalConvId = activeBranchId && parentConversationId
    ? parentConversationId
    : selectedConversationId;

  const currentConv = conversations.find((c) => c.id === selectedConversationId);
  const isRoundtable = currentConv?.mode === "roundtable";

  const reviewCount = artifacts.filter((a) => a.type === "review-findings" || a.type === "architect-decision").length;
  const testCount = artifacts.filter((a) => a.type === "test-report").length;

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      {/* ── Toolbar: tabs | path (center) | search ── */}
      <div className="flex items-center px-3 pt-1.5 pb-1 shrink-0">
        {/* Left: tab pills */}
        <div className="flex items-center gap-1 shrink-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors",
                activeTab === tab.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground/50 hover:text-foreground/80 hover:bg-background/50"
              )}
            >
              {tab.icon}
              {tab.label}
              {tab.id === "review" && reviewCount > 0 && (
                <span className="text-[8px] bg-status-draft/10 text-status-draft/70 px-1 rounded">
                  {reviewCount}
                </span>
              )}
              {tab.id === "test" && testCount > 0 && (
                <span className="text-[8px] bg-agent-codex/10 text-agent-codex/70 px-1 rounded">
                  {testCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Center: path (centered between tabs and search) */}
        <div className="flex-1 flex items-center justify-center gap-1.5 min-w-0 px-3">
          {activeTab === "chat" && selectedConversationId && (
            <>
              <span className={cn(
                "text-[8px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0",
                isRoundtable ? "text-agent-gemini/80 bg-agent-gemini/10" : "text-muted-foreground/40 bg-background/60"
              )}>
                {isRoundtable ? "RT" : "Chat"}
              </span>
              <span className="text-[11px] text-foreground/70 font-medium truncate max-w-[180px]">
                {currentConv ? (
                  <InlineRename
                    value={currentConv.customLabel ?? currentConv.label}
                    onSave={(v) => renameConversation(selectedConversationId, v)}
                  />
                ) : "Conversation"}
              </span>

              {(threadBranchId || activeBranchId) && (() => {
                const branchId = activeBranchId || threadBranchId;
                const branch = branchId ? branches.find((b) => b.id === branchId) : null;
                const label = branch?.customLabel ?? branch?.label ?? threadBranchLabel;
                const isBranchRT = branch?.mode === "roundtable";
                if (!label) return null;
                return (
                  <span className="flex items-center gap-1 text-muted-foreground/40 shrink-0">
                    <span className="text-[10px]">—</span>
                    {isBranchRT
                      ? <Users className="w-3 h-3 text-agent-gemini/40" />
                      : <GitBranch className="w-3 h-3" />}
                    <span className="text-[10px] truncate max-w-[120px]">{label}</span>
                  </span>
                );
              })()}

              {runningThreadIds.includes(selectedConversationId) && (
                <Loader2 className="w-3 h-3 animate-spin text-primary/60 shrink-0" />
              )}
            </>
          )}
        </div>

        {/* Right: search (placeholder) */}
        <div className="shrink-0 w-[220px]">
          <div className="flex items-center gap-2 bg-background/50 hover:bg-background/70 border border-border/30 rounded-md px-2.5 py-1.5 transition-colors cursor-text">
            <Search className="w-3.5 h-3.5 text-muted-foreground/40" />
            <span className="text-[11px] text-muted-foreground/40">Search…</span>
          </div>
        </div>
      </div>

      {/* ── Content zone — bordered, elevated ── */}
      <div className="flex-1 min-h-0 rounded-xl border-[0.5px] border-border bg-background overflow-hidden flex flex-col mx-1.5 mb-1.5">
        {activeTab === "chat" && <ChatPanel />}

        {activeTab === "plan" && (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="max-w-4xl mx-auto">
              {canonicalConvId && <HarnessSummary conversationId={canonicalConvId} />}
              <h3 className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest mb-3">Plans</h3>
              <PlansPanel />
            </div>
          </div>
        )}

        {activeTab === "review" && (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="max-w-4xl mx-auto">
              <h3 className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest mb-3">Review</h3>
              <ReviewPanel />
            </div>
          </div>
        )}

        {activeTab === "test" && (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="max-w-4xl mx-auto">
              <h3 className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest mb-3">Test</h3>
              <TestPanel />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
