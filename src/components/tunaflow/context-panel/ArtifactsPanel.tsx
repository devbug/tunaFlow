import { useState } from "react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import { FileText, Clock, CheckCircle2, XCircle, Plus, Forward } from "lucide-react";
import type { Artifact } from "@/types";

const FORWARD_ENGINES = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "gemini", label: "Gemini" },
];

type ArtifactStatus = "draft" | "approved" | "rejected";

const STATUS_CONFIG: Record<ArtifactStatus, { icon: React.ReactNode; class: string; label: string }> = {
  draft: {
    icon: <Clock className="w-3 h-3" />,
    class: "text-status-draft bg-status-draft/10 border-status-draft/30",
    label: "draft",
  },
  approved: {
    icon: <CheckCircle2 className="w-3 h-3" />,
    class: "text-status-approved bg-status-approved/10 border-status-approved/30",
    label: "approved",
  },
  rejected: {
    icon: <XCircle className="w-3 h-3" />,
    class: "text-status-rejected bg-status-rejected/10 border-status-rejected/30",
    label: "rejected",
  },
};

function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const { updateArtifactStatus, deleteArtifact, sendFollowup, setHandoffSource } = useChatStore();
  const status = STATUS_CONFIG[artifact.status];
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="rounded-lg border border-border bg-card p-3 hover:border-border/80 transition-colors cursor-pointer group"
      onClick={() => {
        const next = !expanded;
        setExpanded(next);
        setHandoffSource(next ? { type: "artifact", content: `[${artifact.title}] ${artifact.content}` } : null);
      }}
    >
      <div className="flex items-start gap-2 mb-1.5">
        <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-foreground leading-snug">{artifact.title}</span>
          {["task-brief", "test-report", "review-findings", "architect-decision"].includes(artifact.type) && (
            <span className="ml-1.5 text-[8px] font-semibold text-primary/60 bg-primary/10 border border-primary/20 px-1 py-0 rounded">
              {artifact.type}
            </span>
          )}
        </div>
        <span className={cn("inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border shrink-0", status.class)}>
          {status.icon}
          {status.label}
        </span>
      </div>
      {!expanded && (
        <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2 ml-5">
          {artifact.content.slice(0, 100)}
        </p>
      )}
      {expanded && (
        <div className="ml-5 mt-2 space-y-2">
          <p className="text-[11px] text-foreground leading-relaxed whitespace-pre-wrap">{artifact.content}</p>
          <div className="flex gap-2 pt-1 border-t border-border/30">
            {artifact.status !== "approved" && (
              <button
                onClick={(e) => { e.stopPropagation(); updateArtifactStatus(artifact.id, "approved"); }}
                className="text-[10px] text-status-approved hover:underline"
              >
                Approve
              </button>
            )}
            {artifact.status !== "rejected" && (
              <button
                onClick={(e) => { e.stopPropagation(); updateArtifactStatus(artifact.id, "rejected"); }}
                className="text-[10px] text-status-rejected hover:underline"
              >
                Reject
              </button>
            )}
            {artifact.status !== "draft" && (
              <button
                onClick={(e) => { e.stopPropagation(); updateArtifactStatus(artifact.id, "draft"); }}
                className="text-[10px] text-status-draft hover:underline"
              >
                Draft
              </button>
            )}
            <span className="ml-auto flex items-center gap-2">
              {FORWARD_ENGINES.map((eng) => (
                <button
                  key={eng.id}
                  onClick={(e) => { e.stopPropagation(); sendFollowup(eng.id, "artifact", `[${artifact.title}] ${artifact.content}`); }}
                  className="text-[10px] text-primary/70 hover:text-primary hover:underline"
                >
                  → {eng.label}
                </button>
              ))}
              <button
                onClick={(e) => { e.stopPropagation(); deleteArtifact(artifact.id); }}
                className="text-[10px] text-destructive hover:underline"
              >
                Delete
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function ArtifactsPanel() {
  const { artifacts, selectedConversationId, createArtifact } = useChatStore();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [artType, setArtType] = useState("note");

  const handleCreate = async () => {
    if (!title.trim() || !content.trim() || !selectedConversationId) return;
    await createArtifact({ conversationId: selectedConversationId, type: artType, title: title.trim(), content: content.trim() });
    setTitle(""); setContent(""); setShowForm(false);
  };

  return (
    <div className="space-y-2">
      {artifacts.map((a) => <ArtifactCard key={a.id} artifact={a} />)}
      {showForm && (
        <div className="rounded-lg border border-border bg-card p-3 space-y-2">
          <select
            value={artType}
            onChange={(e) => setArtType(e.target.value)}
            className="w-full bg-input rounded-md px-2.5 py-1.5 text-xs outline-none text-foreground border border-border focus:border-ring/50"
          >
            <option value="note">Note</option>
            <option value="code">Code</option>
            <option value="spec">Spec</option>
            <option value="plan">Plan</option>
            <optgroup label="Harness">
              <option value="task-brief">Task Brief</option>
              <option value="test-report">Test Report</option>
              <option value="review-findings">Review Findings</option>
              <option value="architect-decision">Architect Decision</option>
            </optgroup>
          </select>
          <input
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-input rounded-md px-2.5 py-1.5 text-xs outline-none text-foreground placeholder:text-muted-foreground border border-border focus:border-ring/50"
          />
          <textarea
            placeholder="Content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            className="w-full bg-input rounded-md px-2.5 py-1.5 text-xs outline-none text-foreground placeholder:text-muted-foreground border border-border focus:border-ring/50 resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              className="flex-1 px-2 py-1.5 rounded-md bg-primary/15 text-primary text-xs hover:bg-primary/25 transition-colors"
            >
              Create
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-2 py-1.5 rounded-md text-muted-foreground text-xs hover:bg-accent transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New artifact
        </button>
      )}
    </div>
  );
}
