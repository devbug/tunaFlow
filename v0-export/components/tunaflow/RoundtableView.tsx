"use client";

import { cn } from "@/lib/utils";
import type { RoundtableParticipant, Message } from "@/lib/tunaflow-types";
import { AGENT_COLORS, AGENT_DOT_COLORS } from "@/lib/tunaflow-types";
import type { AgentEngine } from "@/lib/tunaflow-types";
import { GitBranch, Copy, Lightbulb } from "lucide-react";
import { useState } from "react";

interface RoundtableViewProps {
  participants: RoundtableParticipant[];
}

// Group messages into rounds
function groupByRound(participants: RoundtableParticipant[]) {
  const rounds: Map<number, { participant: RoundtableParticipant; message: Message }[]> = new Map();
  for (const participant of participants) {
    for (const message of participant.messages) {
      const round = message.roundtableRound ?? 1;
      if (!rounds.has(round)) rounds.set(round, []);
      rounds.get(round)!.push({ participant, message });
    }
  }
  return Array.from(rounds.entries()).sort(([a], [b]) => a - b);
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

function RoundtableMessage({
  participant,
  message,
  isLast,
  respondingTo,
}: {
  participant: RoundtableParticipant;
  message: Message;
  isLast: boolean;
  respondingTo?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const { agent } = participant;
  const dotColor = AGENT_DOT_COLORS[agent.engine as AgentEngine];
  const badgeColor = AGENT_COLORS[agent.engine as AgentEngine];

  const paragraphs = message.content.split("\n\n").filter(Boolean);

  return (
    <div className="relative flex gap-4">
      {/* Connector line */}
      {!isLast && (
        <div className="absolute left-[13px] top-8 bottom-0 w-px bg-border/40" />
      )}

      {/* Avatar */}
      <div className="relative z-10 shrink-0">
        <div
          className={cn(
            "w-7 h-7 rounded-full border flex items-center justify-center text-[11px] font-bold shadow-sm",
            badgeColor
          )}
        >
          {agent.name.charAt(0)}
        </div>
      </div>

      {/* Message card */}
      <div
        className={cn(
          "flex-1 mb-4 rounded-xl border bg-card p-4 transition-all relative",
          hovered && "border-primary/40 bg-card/80 shadow-md"
        )}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* "Responding to" indicator */}
        {respondingTo && (
          <div className="text-[9px] text-muted-foreground italic mb-2 pb-2 border-b border-border/30">
            → responding to previous point
          </div>
        )}

        {/* Card header */}
        <div className="flex items-center gap-2 mb-2.5">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border",
              badgeColor
            )}
          >
            <span className={cn("w-1.5 h-1.5 rounded-full", dotColor)} />
            {agent.name}
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {agent.engine}
          </span>
          <span className="ml-auto text-[10px] text-muted-foreground font-mono">
            {message.timestamp}
          </span>
        </div>

        {/* Message body */}
        <div className="text-sm text-foreground leading-relaxed space-y-2">
          {paragraphs.map((para, i) => {
            const isList = para.startsWith("- ");
            if (isList) {
              const items = para.split("\n").filter(Boolean);
              return (
                <ul key={i} className="space-y-1">
                  {items.map((item, j) => (
                    <li key={j} className="flex gap-2">
                      <span className="text-muted-foreground mt-1 shrink-0">•</span>
                      <span>{parseMarkdown(item.replace(/^- /, ""))}</span>
                    </li>
                  ))}
                </ul>
              );
            }
            return <p key={i}>{parseMarkdown(para)}</p>;
          })}
        </div>

        {/* Badge Row - Branches & Memos */}
        {(message.branchCount !== undefined || message.memoCount !== undefined) && (
          <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-border/30">
            {message.branchCount !== undefined && message.branchCount > 0 && (
              <button className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[9px] font-medium text-primary bg-primary/10 border border-primary/30 hover:bg-primary/15 transition-colors">
                <GitBranch className="w-3 h-3" />
                <span>{message.branchCount} {message.branchCount === 1 ? "branch" : "branches"}</span>
              </button>
            )}
            {message.memoCount !== undefined && message.memoCount > 0 && (
              <button className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[9px] font-medium text-agent-gemini bg-agent-gemini/10 border border-agent-gemini/30 hover:bg-agent-gemini/15 transition-colors">
                <Lightbulb className="w-3 h-3" />
                <span>{message.memoCount} {message.memoCount === 1 ? "memo" : "memos"}</span>
              </button>
            )}
          </div>
        )}

        {/* Card actions on hover */}
        <div
          className={cn(
            "absolute right-3 bottom-3 flex items-center gap-1 transition-opacity",
            hovered ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
        >
          <button className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-muted-foreground hover:text-primary hover:bg-primary/10 border border-border transition-colors font-medium">
            <GitBranch className="w-3 h-3" />
            Create Branch
          </button>
          <button className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent border border-border transition-colors">
            <Copy className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function RoundtableView({ participants }: RoundtableViewProps) {
  const rounds = groupByRound(participants);

  return (
    <div className="px-6 py-4 max-w-3xl mx-auto w-full">
      {/* Participants row */}
      <div className="flex items-center gap-2 mb-6 pb-4 border-b border-border">
        <span className="text-xs text-muted-foreground font-medium">Participants:</span>
        {participants.map(({ agent }) => {
          const dotColor = AGENT_DOT_COLORS[agent.engine as AgentEngine];
          const badgeColor = AGENT_COLORS[agent.engine as AgentEngine];
          return (
            <span
              key={agent.id}
              className={cn(
                "inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border",
                badgeColor
              )}
            >
              <span className={cn("w-1.5 h-1.5 rounded-full", dotColor)} />
              {agent.name}
            </span>
          );
        })}
      </div>

      {/* Rounds */}
      {rounds.map(([round, entries]) => (
        <div key={round} className="mb-8">
          {/* Round divider */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-border/50" />
            <div className="flex flex-col items-center gap-1">
              <span className="text-[11px] font-bold uppercase tracking-widest text-primary bg-primary/10 px-3 py-1 rounded-full border border-primary/20">
                Round {round}
              </span>
              {round > 1 && (
                <span className="text-[9px] text-muted-foreground italic">(based on Round {round - 1})</span>
              )}
            </div>
            <div className="flex-1 h-px bg-border/50" />
          </div>

          {/* Messages in round */}
          <div>
            {entries.map((entry, i) => (
              <RoundtableMessage
                key={entry.message.id}
                participant={entry.participant}
                message={entry.message}
                isLast={i === entries.length - 1}
                respondingTo={i > 0 && round > 1 ? entries[i - 1].participant.agent.name : undefined}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
