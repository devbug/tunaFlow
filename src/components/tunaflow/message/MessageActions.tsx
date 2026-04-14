import { useState, useRef, useEffect } from "react";
import { copyToClipboard } from "@/lib/clipboard";
import { GitBranch, Copy, Check, Bookmark, BookmarkCheck, Users, Forward, Trash2, FileText, FileCheck } from "lucide-react";

const FOLLOWUP_ENGINES = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "gemini", label: "Gemini" },
  { id: "ollama", label: "Ollama" },
];

interface MessageActionsProps {
  messageId: string;
  messageContent: string;
  isUser: boolean;
  onBranch?: (messageId: string) => void;
  onBranchRT?: (messageId: string) => void;
  onMemo?: (messageId: string) => void;
  onFollowup?: (engine: string, content: string) => void;
  onDeletePair?: (messageId: string) => void;
  onSaveArtifact?: (content: string) => void;
}

function useFlash(duration = 1500) {
  const [active, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function flash() {
    if (timer.current) clearTimeout(timer.current);
    setActive(true);
    timer.current = setTimeout(() => setActive(false), duration);
  }
  return [active, flash] as const;
}

export function MessageActions({ messageId, messageContent, isUser, onBranch, onBranchRT, onMemo, onFollowup, onDeletePair, onSaveArtifact }: MessageActionsProps) {
  const [showFollowupMenu, setShowFollowupMenu] = useState(false);
  const followupRef = useRef<HTMLDivElement>(null);
  const [copied, flashCopy] = useFlash();
  const [memoed, flashMemo] = useFlash();
  const [saved, flashSave] = useFlash();

  useEffect(() => {
    if (!showFollowupMenu) return;
    const handle = (e: MouseEvent) => {
      if (followupRef.current && !followupRef.current.contains(e.target as Node)) {
        setShowFollowupMenu(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [showFollowupMenu]);

  // Horizontal pill toolbar — absolute overlay at top-right of message bubble
  return (
    <div className="flex flex-row gap-px px-0.5 py-0.5 rounded-md bg-card border border-border/30 shadow-sm opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-data-[state=open]:opacity-100 group-data-[state=open]:pointer-events-auto transition-opacity duration-100">
      {onBranch && !isUser && (
        <button onClick={() => onBranch(messageId)} title="Thread"
          className="p-1 rounded hover:bg-accent hover:text-foreground text-muted-foreground/50 transition-colors">
          <GitBranch className="w-3.5 h-3.5" />
        </button>
      )}
      {onBranchRT && !isUser && (
        <button onClick={() => onBranchRT(messageId)} title="Roundtable"
          className="p-1 rounded hover:bg-agent-gemini/10 hover:text-agent-gemini text-muted-foreground/50 transition-colors">
          <Users className="w-3.5 h-3.5" />
        </button>
      )}
      {onMemo && (
        <button
          onClick={() => { onMemo(messageId); flashMemo(); }}
          title="Memo"
          className={`p-1 rounded transition-colors ${memoed ? "text-yellow-400 bg-yellow-400/10" : "text-muted-foreground/50 hover:bg-accent hover:text-foreground"}`}
        >
          {memoed ? <BookmarkCheck className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
        </button>
      )}
      {onSaveArtifact && !isUser && (
        <button
          onClick={() => { onSaveArtifact(messageContent); flashSave(); }}
          title="Save as Artifact"
          className={`p-1 rounded transition-colors ${saved ? "text-primary bg-primary/10" : "text-muted-foreground/50 hover:bg-primary/10 hover:text-primary"}`}
        >
          {saved ? <FileCheck className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
        </button>
      )}
      {onFollowup && !isUser && (
        <div className="relative" ref={followupRef}>
          <button onClick={() => setShowFollowupMenu((v) => !v)} title="Forward"
            className="p-1 rounded hover:bg-accent hover:text-foreground text-muted-foreground/50 transition-colors">
            <Forward className="w-3.5 h-3.5" />
          </button>
          {showFollowupMenu && (
            // pop downward from the button
            <div className="absolute right-0 top-full mt-1 bg-popover border border-border/40 rounded-md shadow-lg p-0.5 min-w-[100px] z-50">
              {FOLLOWUP_ENGINES.map((eng) => (
                <button key={eng.id}
                  onClick={() => { onFollowup(eng.id, messageContent); setShowFollowupMenu(false); }}
                  className="w-full text-left px-2 py-1 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  → {eng.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <button
        onClick={() => { copyToClipboard(messageContent); flashCopy(); }}
        title="Copy"
        className={`p-1 rounded transition-colors ${copied ? "text-emerald-400 bg-emerald-400/10" : "text-muted-foreground/50 hover:bg-accent hover:text-foreground"}`}
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      {onDeletePair && (
        <button onClick={async () => {
          const { ask } = await import("@tauri-apps/plugin-dialog");
          if (await ask("이 메시지를 삭제하시겠습니까?", { title: "메시지 삭제", kind: "warning" })) onDeletePair(messageId);
        }} title="Delete"
          className="p-1 rounded hover:bg-destructive/15 hover:text-destructive text-muted-foreground/50 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
