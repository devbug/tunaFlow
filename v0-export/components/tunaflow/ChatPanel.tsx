"use client";

import { useRef, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { MessageItem } from "./MessageItem";
import { MessageInput } from "./MessageInput";
import { RoundtableView } from "./RoundtableView";
import { MOCK_MESSAGES, MOCK_ROUNDTABLE_PARTICIPANTS } from "@/lib/tunaflow-data";
import { AGENTS } from "@/lib/tunaflow-types";
import type { Message } from "@/lib/tunaflow-types";
import { StatusBar } from "./StatusBar";
import { Users, MessageSquare } from "lucide-react";

interface ChatPanelProps {
  conversationId: string;
  conversationType: "chat" | "roundtable";
  activeBranch: { id: string; label: string } | null;
  onBranchClick: (branchId: string, label: string) => void;
}

const STREAMING_MESSAGE: Message = {
  id: "streaming",
  role: "agent",
  agent: AGENTS.opencode,
  content: "",
  timestamp: "14:07",
  isStreaming: true,
};

export function ChatPanel({
  conversationId,
  conversationType,
  activeBranch,
  onBranchClick,
}: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<"stream" | "roundtable">(
    conversationType === "roundtable" ? "roundtable" : "stream"
  );
  const [messages, setMessages] = useState<Message[]>(MOCK_MESSAGES);
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  const handleSend = (text: string) => {
    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);

    // Simulate streaming response
    setTimeout(() => {
      const agentMsg: Message = {
        id: `msg-${Date.now()}-resp`,
        role: "agent",
        agent: AGENTS.claude,
        content: "That's a great follow-up question. Based on the discussion so far, I'd recommend focusing on the **hybrid model** with a usage floor to ensure minimum revenue per customer. This balances the predictability that finance teams need with the alignment to customer success that usage-based provides.",
        timestamp: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, agentMsg]);
      setIsStreaming(false);
    }, 2000);
  };

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full bg-background">
      {/* Status Bar */}
      <StatusBar
        mode={conversationType}
        branch={activeBranch}
        agentCount={4}
        activeSkills={2}
        activeIntegrations={1}
        roundCount={2}
      />

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          {conversationType === "roundtable" ? (
            <Users className="w-4 h-4 text-agent-gemini" />
          ) : (
            <MessageSquare className="w-4 h-4 text-muted-foreground" />
          )}
          <h2 className="text-sm font-semibold text-foreground">
            Pricing Model Debate
          </h2>
          <span className="text-[10px] font-medium text-agent-gemini bg-agent-gemini/10 border border-agent-gemini/20 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
            {conversationType === "roundtable" ? "Roundtable" : "Chat"}
          </span>
        </div>

        {/* View toggle */}
        <div className="ml-auto flex items-center gap-1 bg-accent rounded-lg p-0.5">
          <button
            onClick={() => setView("stream")}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
              view === "stream"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <MessageSquare className="w-3 h-3" />
            Stream
          </button>
          <button
            onClick={() => setView("roundtable")}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
              view === "roundtable"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Users className="w-3 h-3" />
            Roundtable
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {view === "roundtable" ? (
          <RoundtableView participants={MOCK_ROUNDTABLE_PARTICIPANTS} />
        ) : (
          <div className="py-3 space-y-0.5">
            {messages.map((msg, i) => (
              <MessageItem
                key={msg.id}
                message={msg}
                onBranch={(msgId) => {
                  // Simulate creating a branch from this message
                  onBranchClick("b_temp", "Quick Branch from Message");
                }}
                showRound={conversationType === "roundtable"}
                prevAgent={i > 0 ? messages[i - 1].agent?.id : undefined}
              />
            ))}
            {isStreaming && (
              <MessageItem message={STREAMING_MESSAGE} showRound={false} />
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <MessageInput
        mode={conversationType}
        onSend={handleSend}
        activeBranch={activeBranch}
      />
    </div>
  );
}
