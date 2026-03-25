"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Message } from "@/lib/tunaflow-types";
import { AGENT_COLORS, AGENT_DOT_COLORS } from "@/lib/tunaflow-types";
import {
  GitBranch,
  Copy,
  ThumbsUp,
  ThumbsDown,
  Bookmark,
  MoreHorizontal,
  User,
  Lightbulb,
} from "lucide-react";

interface MessageItemProps {
  message: Message;
  onBranch?: (messageId: string) => void;
  showRound?: boolean;
  prevAgent?: string;
  variant?: "default" | "compact";
}

function AgentBadge({ message }: { message: Message }) {
  if (!message.agent) return null;
  const colors = AGENT_COLORS[message.agent.engine];
  const dotColor = AGENT_DOT_COLORS[message.agent.engine];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border",
        colors
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", dotColor)} />
      {message.agent.name}
      <span className="text-muted-foreground font-mono text-[10px]">
        {message.agent.model}
      </span>
    </span>
  );
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
  // Simple bold parsing
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

export function MessageItem({ message, onBranch, showRound, prevAgent, variant = "default" }: MessageItemProps) {
  const [hovered, setHovered] = useState(false);
  const isUser = message.role === "user";
  const isNewRound = showRound && message.roundtableRound;
  const isCompact = variant === "compact";

  const paragraphs = message.content.split("\n\n").filter(Boolean);

  return (
    <div>
      {isNewRound && prevAgent !== message.agent?.id && message.roundtableRound && (
        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-border" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground bg-background px-2">
            Round {message.roundtableRound}
          </span>
          <div className="flex-1 h-px bg-border" />
        </div>
      )}

      <div
        className={cn(
          "group relative flex gap-3 px-4 py-3 rounded-lg transition-colors",
          isCompact && "px-3 py-2",
          isUser ? "bg-transparent" : "hover:bg-accent/30",
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
            <div
              className={cn(
                "rounded-full flex items-center justify-center border",
                isCompact ? "w-5 h-5 text-[10px]" : "w-7 h-7 text-[11px] font-bold",
                message.agent && AGENT_COLORS[message.agent.engine]
              )}
            >
              {message.agent?.name.charAt(0)}
            </div>
          )}
        </div>

        {/* Content */}
        <div className={cn("flex-1 min-w-0", isCompact && "space-y-1")}>
          {/* Header */}
          <div className={cn(
            "flex items-center gap-2 mb-1.5",
            isCompact && "mb-1 text-[10px]"
          )}>
            {isUser ? (
              <span className={cn("font-semibold text-foreground", isCompact ? "text-[10px]" : "text-xs")}>You</span>
            ) : (
              <AgentBadge message={message} />
            )}
            <span className={cn("text-muted-foreground font-mono", isCompact ? "text-[9px]" : "text-[10px]")}>
              {message.timestamp}
            </span>
            {message.isStreaming && (
              <span className={cn("text-primary/70 font-mono animate-pulse", isCompact ? "text-[9px]" : "text-[10px]")}>
                streaming...
              </span>
            )}
          </div>

          {/* Body */}
          <div className={cn("text-foreground leading-relaxed space-y-2", isCompact && "text-xs space-y-1")}>
            {message.isStreaming && message.content === "" ? (
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
                  <p key={i} className={cn(isLast && message.isStreaming && "stream-cursor", isCompact && "line-clamp-2")}>
                    {parseMarkdown(para)}
                  </p>
                );
              })
            )}
          </div>

          {/* Badge Row - Branches & Memos */}
          {(message.branchCount !== undefined || message.memoCount !== undefined) && (
            <div className="flex flex-wrap items-center gap-2 mt-3 pt-2 border-t border-border/30">
              {message.branchCount !== undefined && message.branchCount > 0 && (
                <button className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium text-primary bg-primary/10 border border-primary/30 hover:bg-primary/15 transition-colors">
                  <GitBranch className="w-3 h-3" />
                  <span>{message.branchCount} {message.branchCount === 1 ? "branch" : "branches"}</span>
                </button>
              )}
              {message.memoCount !== undefined && message.memoCount > 0 && (
                <button className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium text-agent-gemini bg-agent-gemini/10 border border-agent-gemini/30 hover:bg-agent-gemini/15 transition-colors">
                  <Lightbulb className="w-3 h-3" />
                  <span>{message.memoCount} {message.memoCount === 1 ? "memo" : "memos"}</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Hover Actions */}
        <div
          className={cn(
            "absolute right-3 top-2.5 flex items-center gap-1 transition-opacity duration-150",
            hovered ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
        >
          <button
            onClick={() => onBranch?.(message.id)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border border-border"
          >
            <GitBranch className="w-3 h-3" />
            Create Branch
          </button>
          <button className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <Bookmark className="w-3.5 h-3.5" />
          </button>
          <button className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <ThumbsUp className="w-3.5 h-3.5" />
          </button>
          <button className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <ThumbsDown className="w-3.5 h-3.5" />
          </button>
          <button className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
