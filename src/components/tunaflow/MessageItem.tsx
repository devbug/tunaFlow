import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn, AGENT_COLORS, AGENT_DOT_COLORS, AGENT_DISPLAY_NAMES, formatTimestamp, isKnownEngine } from "@/lib/utils";
import type { Message, Branch } from "@/types";
import { GitBranch, Copy, Bookmark, User, Users, MessageSquareText, Forward } from "lucide-react";
import { markdownComponents } from "./chat/MarkdownComponents";

const FOLLOWUP_ENGINES = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "gemini", label: "Gemini" },
];

interface MessageItemProps {
  message: Message;
  onBranch?: (messageId: string) => void;
  onBranchRT?: (messageId: string) => void;
  onMemo?: (messageId: string) => void;
  onFollowup?: (engine: string, content: string) => void;
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

function MarkdownBody({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("prose prose-sm prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** Plain-text progress block for streaming state. Shows last N lines rolling. */
function ProgressBlock({ content, maxLines = 8 }: { content: string; maxLines?: number }) {
  const lines = content.split("\n");
  const visible = lines.slice(-maxLines);
  const truncated = lines.length > maxLines;
  return (
    <div className="font-mono text-[12px] text-muted-foreground leading-relaxed">
      {truncated && (
        <div className="text-[10px] text-muted-foreground/40 mb-1">… {lines.length - maxLines} lines above</div>
      )}
      {visible.map((line, i) => (
        <div key={i} className={cn(i === visible.length - 1 && "text-foreground/80")}>
          {line || "\u00A0"}
        </div>
      ))}
    </div>
  );
}

/** Collapsed progress summary for completed messages. Shows last 3 lines. */
function ProgressSummary({ content }: { content: string }) {
  const lines = content.split("\n").filter(Boolean);
  const last3 = lines.slice(-3);
  if (last3.length === 0) return null;
  return (
    <details className="mb-2 group">
      <summary className="cursor-pointer text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors">
        {lines.length} steps — click to expand
      </summary>
      <div className="mt-1 font-mono text-[11px] text-muted-foreground/60 leading-relaxed pl-2 border-l border-border/30">
        {lines.map((line, i) => <div key={i}>{line}</div>)}
      </div>
    </details>
  );
}

export function MessageItem({ message, onBranch, onBranchRT, onMemo, onFollowup, threadBranches, onOpenThread, showActions = true, variant = "default" }: MessageItemProps) {
  const [showFollowupMenu, setShowFollowupMenu] = useState(false);
  const [hovered, setHovered] = useState(false);
  const isUser = message.role === "user";
  const isStreaming = message.status === "streaming";
  const isCompact = variant === "compact";

  const engine = isKnownEngine(message.engine) ? message.engine : null;
  const displayName = message.persona ?? (engine ? AGENT_DISPLAY_NAMES[engine] : "Assistant");
  const agentColorClass = engine ? AGENT_COLORS[engine] : "text-muted-foreground border-border bg-accent";
  const dotColorClass = engine ? AGENT_DOT_COLORS[engine] : "bg-muted-foreground";


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

        {/* Body — progress-first streaming */}
        <div className={cn("text-foreground leading-relaxed", isCompact && "text-xs")}>
          {isStreaming && message.content === "" && !message.progressContent ? (
            <TypingIndicator />
          ) : isStreaming ? (
            /* Streaming: show plain-text progress only, no Markdown */
            <ProgressBlock content={message.progressContent || message.content} />
          ) : isUser ? (
            <p className={cn(isCompact && "line-clamp-3")}>{message.content}</p>
          ) : (
            /* Done: progress summary + final Markdown answer */
            <>
              {message.progressContent && <ProgressSummary content={message.progressContent} />}
              <MarkdownBody
                content={message.content}
                className={cn(isCompact && "line-clamp-3")}
              />
            </>
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
              Thread
            </button>
          )}
          {onBranchRT && (
            <button
              onClick={() => onBranchRT(message.id)}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-muted-foreground hover:text-agent-gemini hover:bg-agent-gemini/10 transition-colors border border-border"
            >
              <Users className="w-3 h-3" />
              RT 분기
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
          {onFollowup && !isUser && (
            <div className="relative">
              <button
                onClick={() => setShowFollowupMenu((v) => !v)}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors border border-border"
              >
                <Forward className="w-3 h-3" />
                Forward
              </button>
              {showFollowupMenu && (
                <div className="absolute right-0 top-full mt-1 bg-popover border border-border rounded-lg shadow-xl p-1 min-w-[120px] z-50">
                  {FOLLOWUP_ENGINES.map((eng) => (
                    <button
                      key={eng.id}
                      onClick={() => { onFollowup(eng.id, message.content); setShowFollowupMenu(false); }}
                      className="w-full text-left px-2.5 py-1.5 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    >
                      Ask {eng.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
