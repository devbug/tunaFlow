import { useState } from "react";
import { cn, AGENT_COLORS, AGENT_DOT_COLORS, AGENT_DISPLAY_NAMES, formatTimestamp, isKnownEngine } from "@/lib/utils";
import type { Message, Branch } from "@/types";
import { GitBranch, Copy, Bookmark, User, MessageSquareText } from "lucide-react";

interface MessageItemProps {
  message: Message;
  onBranch?: (messageId: string) => void;
  onMemo?: (messageId: string) => void;
  /** Branches anchored to this message (checkpointId === message.id) */
  threadBranches?: Branch[];
  /** Callback when user clicks "Open thread" on a branch */
  onOpenThread?: (branchId: string) => void;
  showActions?: boolean;
  variant?: "default" | "compact";
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 py-1">
      <span className="typing-dot w-1.5 h-1.5 rounded-full bg-muted-foreground" />
      <span className="typing-dot w-1.5 h-1.5 rounded-full bg-muted-foreground" />
      <span className="typing-dot w-1.5 h-1.5 rounded-full bg-muted-foreground" />
    </div>
  );
}

function parseMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

export function MessageItem({ message, onBranch, onMemo, threadBranches, onOpenThread, showActions = true, variant = "default" }: MessageItemProps) {
  const [hovered, setHovered] = useState(false);
  const isUser = message.role === "user";
  const isStreaming = message.status === "streaming";
  const isCompact = variant === "compact";

  const engine = isKnownEngine(message.engine) ? message.engine : null;
  const displayName = message.persona ?? (engine ? AGENT_DISPLAY_NAMES[engine] : "Assistant");
  const agentColorClass = engine ? AGENT_COLORS[engine] : "text-muted-foreground border-border bg-accent";
  const dotColorClass = engine ? AGENT_DOT_COLORS[engine] : "bg-muted-foreground";

  const paragraphs = message.content.split("\n\n").filter(Boolean);

  return (
    <div
      className={cn(
        "group relative flex gap-3 px-4 py-3 rounded-lg transition-colors",
        isCompact && "px-3 py-2",
        !isUser && "hover:bg-accent/30",
        hovered && !isUser && "bg-accent/30"
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Avatar */}
      <div className={cn("shrink-0", !isCompact && "mt-0.5")}>
        {isUser ? (
          <div className={cn(
            "rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center",
            isCompact ? "w-5 h-5" : "w-7 h-7"
          )}>
            <User className={cn("text-primary", isCompact ? "w-3 h-3" : "w-3.5 h-3.5")} />
          </div>
        ) : (
          <div className={cn(
            "rounded-full flex items-center justify-center border",
            isCompact ? "w-5 h-5 text-[10px]" : "w-7 h-7 text-[11px] font-bold",
            agentColorClass
          )}>
            {displayName.charAt(0)}
          </div>
        )}
      </div>

      {/* Content */}
      <div className={cn("flex-1 min-w-0", isCompact && "space-y-1")}>
        {/* Header */}
        <div className={cn("flex items-center gap-2 mb-1.5", isCompact && "mb-1")}>
          {isUser ? (
            <span className={cn("font-semibold text-foreground", isCompact ? "text-[10px]" : "text-xs")}>You</span>
          ) : (
            <span className={cn(
              "inline-flex items-center gap-1.5 font-medium px-2 py-0.5 rounded-full border",
              isCompact ? "text-[10px]" : "text-[11px]",
              agentColorClass
            )}>
              <span className={cn("w-1.5 h-1.5 rounded-full", dotColorClass)} />
              {displayName}
              {message.model && (
                <span className="text-muted-foreground font-mono text-[10px]">{message.model}</span>
              )}
            </span>
          )}
          <span className={cn("text-muted-foreground font-mono", isCompact ? "text-[9px]" : "text-[10px]")}>
            {formatTimestamp(message.timestamp)}
          </span>
          {isStreaming && (
            <span className={cn("text-primary/70 font-mono animate-pulse", isCompact ? "text-[9px]" : "text-[10px]")}>
              streaming...
            </span>
          )}
          {message.status === "error" && (
            <span className="text-destructive font-mono text-[10px]">error</span>
          )}
        </div>

        {/* Body */}
        <div className={cn("text-foreground leading-relaxed space-y-2", isCompact && "text-xs space-y-1")}>
          {isStreaming && message.content === "" ? (
            <TypingIndicator />
          ) : (
            paragraphs.map((para, i) => {
              const isLast = i === paragraphs.length - 1;
              const isList = para.startsWith("- ");
              if (isList) {
                const items = para.split("\n").filter(Boolean);
                return (
                  <ul key={i} className={cn("space-y-1 pl-0", isCompact && "space-y-0.5")}>
                    {items.map((item, j) => (
                      <li key={j} className="flex gap-2">
                        <span className="text-muted-foreground mt-1 shrink-0">•</span>
                        <span>{parseMarkdown(item.replace(/^- /, ""))}</span>
                      </li>
                    ))}
                  </ul>
                );
              }
              return (
                <p key={i} className={cn(isLast && isStreaming && "stream-cursor", isCompact && "line-clamp-3")}>
                  {parseMarkdown(para)}
                </p>
              );
            })
          )}
        </div>
      </div>

      {/* Thread summary row — branches anchored to this message */}
      {threadBranches && threadBranches.length > 0 && !isCompact && (
        <div className="mt-2 space-y-1">
          {threadBranches.map((branch) => (
            <button
              key={branch.id}
              onClick={() => onOpenThread?.(branch.id)}
              className={cn(
                "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors",
                "border border-primary/20 bg-primary/5 hover:bg-primary/10"
              )}
            >
              <MessageSquareText className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-[11px] font-medium text-primary flex-1 truncate">
                {branch.customLabel ?? branch.label}
              </span>
              <span className={cn(
                "text-[9px] font-semibold uppercase tracking-wide px-1 rounded",
                branch.status === "active" && "text-primary bg-primary/10",
                branch.status === "adopted" && "text-status-approved bg-status-approved/10",
              )}>
                {branch.status}
              </span>
              <span className="text-[10px] text-muted-foreground">Open thread →</span>
            </button>
          ))}
        </div>
      )}

      {/* Hover Actions */}
      {showActions && (
        <div className={cn(
          "absolute right-3 top-2.5 flex items-center gap-1 transition-opacity duration-150",
          hovered ? "opacity-100" : "opacity-0 pointer-events-none"
        )}>
          {onBranch && (
            <button
              onClick={() => onBranch(message.id)}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors border border-border"
            >
              <GitBranch className="w-3 h-3" />
              Start thread
            </button>
          )}
          {onMemo && !isUser && (
            <button
              onClick={() => onMemo(message.id)}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-muted-foreground hover:text-agent-gemini hover:bg-agent-gemini/10 transition-colors border border-border"
            >
              <Bookmark className="w-3 h-3" />
              Memo
            </button>
          )}
          <button
            onClick={() => navigator.clipboard.writeText(message.content)}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
