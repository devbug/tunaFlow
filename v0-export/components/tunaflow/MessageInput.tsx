"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { AGENTS } from "@/lib/tunaflow-types";
import type { AgentEngine } from "@/lib/tunaflow-types";
import { AGENT_DOT_COLORS } from "@/lib/tunaflow-types";
import {
  SendHorizonal,
  Paperclip,
  Zap,
  ChevronDown,
  Users,
  MessageSquare,
} from "lucide-react";

const AGENT_LIST = Object.values(AGENTS);

interface MessageInputProps {
  mode: "chat" | "roundtable";
  onSend?: (text: string) => void;
  activeBranch?: { id: string; label: string } | null;
}

export function MessageInput({ mode, onSend, activeBranch }: MessageInputProps) {
  const [text, setText] = useState("");
  const [activeAgents, setActiveAgents] = useState<string[]>(["claude", "codex", "gemini"]);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const toggleAgent = (id: string) => {
    setActiveAgents((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  const handleSend = () => {
    if (!text.trim()) return;
    onSend?.(text);
    setText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  return (
    <div className="px-4 pb-4 pt-2 shrink-0">
      {activeBranch && (
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground bg-primary/10 border border-primary/20 rounded-md px-3 py-1.5">
          <span className="text-primary font-mono text-[10px]">BRANCH</span>
          <span className="font-medium text-foreground">{activeBranch.label}</span>
          <button className="ml-auto text-muted-foreground hover:text-foreground text-xs">
            ← Back to main
          </button>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card focus-within:border-ring/50 transition-colors">
        {/* Mode bar */}
        <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 border-b border-border/50">
          <button
            className={cn(
              "flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md transition-colors font-medium",
              mode === "chat"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
          >
            <MessageSquare className="w-3 h-3" />
            Chat
          </button>
          <button
            className={cn(
              "flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md transition-colors font-medium",
              mode === "roundtable"
                ? "bg-agent-gemini/15 text-agent-gemini"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
          >
            <Users className="w-3 h-3" />
            Roundtable
          </button>

          <div className="h-4 w-px bg-border mx-1" />

          {/* Agent selector */}
          <div className="relative">
            <button
              onClick={() => setShowAgentPicker(!showAgentPicker)}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-accent"
            >
              <div className="flex -space-x-1">
                {AGENT_LIST.filter((a) => activeAgents.includes(a.id)).map((a) => (
                  <span
                    key={a.id}
                    className={cn(
                      "w-3.5 h-3.5 rounded-full border border-background",
                      AGENT_DOT_COLORS[a.engine as AgentEngine]
                    )}
                  />
                ))}
              </div>
              <span>{activeAgents.length} agents</span>
              <ChevronDown className="w-3 h-3" />
            </button>

            {showAgentPicker && (
              <div className="absolute bottom-full left-0 mb-2 bg-popover border border-border rounded-lg shadow-xl p-2 min-w-[180px] z-50">
                {AGENT_LIST.map((agent) => {
                  const isActive = activeAgents.includes(agent.id);
                  const dotColor = AGENT_DOT_COLORS[agent.engine as AgentEngine];
                  return (
                    <button
                      key={agent.id}
                      onClick={() => toggleAgent(agent.id)}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs transition-colors",
                        isActive
                          ? "text-foreground bg-accent"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent"
                      )}
                    >
                      <span
                        className={cn(
                          "w-2 h-2 rounded-full shrink-0",
                          isActive ? dotColor : "bg-muted"
                        )}
                      />
                      <span className="flex-1 text-left font-medium">{agent.name}</span>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {agent.model}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            mode === "roundtable"
              ? "Start a roundtable discussion..."
              : "Ask anything... (⌘↵ to send)"
          }
          rows={1}
          className="w-full px-3 py-2.5 text-sm bg-transparent resize-none outline-none text-foreground placeholder:text-muted-foreground leading-relaxed"
        />

        {/* Action bar */}
        <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
          <button className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-accent">
            <Paperclip className="w-4 h-4" />
          </button>
          <button className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-accent">
            <Zap className="w-4 h-4" />
          </button>
          <span className="ml-auto text-[10px] text-muted-foreground font-mono">
            ⌘↵ send
          </span>
          <button
            onClick={handleSend}
            disabled={!text.trim()}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              text.trim()
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            <SendHorizonal className="w-3.5 h-3.5" />
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
