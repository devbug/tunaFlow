import { cn, AGENT_COLORS, AGENT_DOT_COLORS, formatTimestamp, isKnownEngine } from "@/lib/utils";
import type { Message } from "@/types";
import { Copy, Users, Info } from "lucide-react";
import { useState } from "react";

interface RoundtableViewProps {
  messages: Message[];
  onBranch?: (messageId: string) => void;
}

// ─── Prompt source metadata (matches backend PromptSources) ─────────────────

interface PromptSources {
  round: number;
  totalRounds: number;
  /** "independent" | "sequential" | "deliberative" */
  mode: string;
  priorRoundRefs: string[];
  currentRoundRefs: string[];
}

const RT_MODE_LABELS: Record<string, string> = {
  independent: "Independent",
  sequential: "Sequential debate",
  deliberative: "Deliberative rounds",
};

function parsePromptSources(msg: Message): PromptSources | null {
  if (!msg.progressContent) return null;
  try {
    return JSON.parse(msg.progressContent) as PromptSources;
  } catch {
    return null;
  }
}

function ReferenceBadge({ sources }: { sources: PromptSources }) {
  const hasPrior = sources.priorRoundRefs.length > 0;
  const hasCurrent = sources.currentRoundRefs.length > 0;

  if (!hasPrior && !hasCurrent) {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full border border-border bg-accent text-muted-foreground">
        Independent
      </span>
    );
  }

  const refs: string[] = [];
  if (hasPrior) {
    if (sources.priorRoundRefs.length <= 2) {
      refs.push(...sources.priorRoundRefs.map((n) => `Ref: ${n}`));
    } else {
      refs.push(`Ref: Round ${sources.round - 1} all`);
    }
  }
  if (hasCurrent) {
    refs.push(...sources.currentRoundRefs.map((n) => `Ref: ${n}`));
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {refs.map((ref, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full border border-primary/20 bg-primary/5 text-primary"
        >
          {ref}
        </span>
      ))}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

function groupIntoRounds(messages: Message[]): Message[][] {
  const assistantMsgs = messages.filter((m) => m.role === "assistant");

  const hasSystemHeaders = assistantMsgs.some(
    (m) => m.engine === "system" && /^---\s*Round\s+\d+/.test(m.content)
  );

  if (hasSystemHeaders) {
    const rounds: Message[][] = [];
    let currentRound: Message[] = [];
    for (const msg of assistantMsgs) {
      if (msg.engine === "system" && /^---\s*Round\s+\d+/.test(msg.content)) {
        if (currentRound.length > 0) rounds.push(currentRound);
        currentRound = [];
      } else {
        currentRound.push(msg);
      }
    }
    if (currentRound.length > 0) rounds.push(currentRound);
    return rounds;
  }

  // Fallback: persona repetition
  const rounds: Message[][] = [];
  let currentRound: Message[] = [];
  const seenPersonas = new Set<string>();
  for (const msg of assistantMsgs) {
    if (msg.engine === "system") continue;
    const persona = msg.persona ?? msg.engine ?? "agent";
    if (seenPersonas.has(persona) && currentRound.length > 0) {
      rounds.push(currentRound);
      currentRound = [msg];
      seenPersonas.clear();
      seenPersonas.add(persona);
    } else {
      currentRound.push(msg);
      seenPersonas.add(persona);
    }
  }
  if (currentRound.length > 0) rounds.push(currentRound);
  return rounds;
}

function getParticipants(messages: Message[]): { name: string; engine: string }[] {
  const seen = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role !== "assistant" || msg.engine === "system") continue;
    const name = msg.persona ?? msg.engine ?? "Agent";
    const engine = msg.engine ?? "claude";
    if (!seen.has(name)) seen.set(name, engine);
  }
  return Array.from(seen.entries()).map(([name, engine]) => ({ name, engine }));
}

// ─── Components ──────────────────────────────────────────────────────────────

function RoundtableMessage({ message, isLast }: { message: Message; isLast: boolean }) {
  const [hovered, setHovered] = useState(false);
  const name = message.persona ?? message.engine ?? "Agent";
  const engine = message.engine ?? "";
  const knownEngine = isKnownEngine(engine) ? engine : null;
  const badgeColor = knownEngine ? AGENT_COLORS[knownEngine] : "text-muted-foreground border-border bg-accent";
  const dotColor = knownEngine ? AGENT_DOT_COLORS[knownEngine] : "bg-muted-foreground";
  const paragraphs = message.content.split("\n\n").filter(Boolean);
  const sources = parsePromptSources(message);

  return (
    <div className="relative flex gap-4">
      {!isLast && (
        <div className="absolute left-[13px] top-8 bottom-0 w-px bg-border/40" />
      )}
      <div className="relative z-10 shrink-0">
        <div className={cn("w-7 h-7 rounded-full border flex items-center justify-center text-[11px] font-bold shadow-sm", badgeColor)}>
          {name.charAt(0)}
        </div>
      </div>
      <div
        className={cn("flex-1 mb-4 rounded-xl border bg-card p-4 transition-all relative", hovered && "border-primary/40 shadow-md")}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Header: agent badge + reference badges */}
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border", badgeColor)}>
            <span className={cn("w-1.5 h-1.5 rounded-full", dotColor)} />
            {name}
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {formatTimestamp(message.timestamp)}
          </span>
        </div>

        {/* Reference badges — based on actual prompt inclusion */}
        {sources && (
          <div className="mb-2.5">
            <ReferenceBadge sources={sources} />
          </div>
        )}

        {/* Body */}
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

        {/* Copy action */}
        <div className={cn("absolute right-3 bottom-3 flex items-center gap-1 transition-opacity", hovered ? "opacity-100" : "opacity-0 pointer-events-none")}>
          <button
            onClick={() => navigator.clipboard.writeText(message.content)}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent border border-border transition-colors"
          >
            <Copy className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main View ───────────────────────────────────────────────────────────────

export function RoundtableView({ messages }: RoundtableViewProps) {
  const participants = getParticipants(messages);
  const rounds = groupIntoRounds(messages);

  // Extract topic from first user message
  const userMessages = messages.filter((m) => m.role === "user");
  const topic = userMessages.length > 0 ? userMessages[userMessages.length - 1].content : null;

  // Derive total rounds + mode from first message's prompt sources
  const firstRtMsg = messages.find((m) => m.role === "assistant" && m.engine !== "system" && m.progressContent);
  const firstSources = firstRtMsg ? parsePromptSources(firstRtMsg) : null;
  const totalRounds = firstSources?.totalRounds ?? rounds.length;
  const rtMode = firstSources?.mode ?? "sequential";

  if (rounds.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No roundtable messages yet
      </div>
    );
  }

  return (
    <div className="px-6 py-4 max-w-3xl mx-auto w-full">
      {/* ── Topic + session info header ── */}
      <div className="mb-6 pb-4 border-b border-border space-y-3">
        {/* Topic */}
        {topic && (
          <div className="rounded-lg bg-accent/50 border border-border p-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Topic</p>
            <p className="text-sm text-foreground leading-relaxed">{topic}</p>
          </div>
        )}

        {/* Session meta: participants + rounds + mode */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground font-medium">
              {participants.length} participants
            </span>
          </div>
          <span className="w-px h-3 bg-border" />
          <span className="text-[11px] text-muted-foreground">
            {totalRounds} round{totalRounds > 1 ? "s" : ""}
          </span>
          <span className="w-px h-3 bg-border" />
          <span className="text-[11px] text-muted-foreground">
            {RT_MODE_LABELS[rtMode] ?? rtMode}
          </span>
        </div>

        {/* Participant badges */}
        <div className="flex items-center gap-2 flex-wrap">
          {participants.map(({ name, engine }) => {
            const knownEngine = isKnownEngine(engine) ? engine : null;
            const badgeColor = knownEngine ? AGENT_COLORS[knownEngine] : "text-muted-foreground border-border bg-accent";
            const dotColor = knownEngine ? AGENT_DOT_COLORS[knownEngine] : "bg-muted-foreground";
            return (
              <span key={name} className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border", badgeColor)}>
                <span className={cn("w-1.5 h-1.5 rounded-full", dotColor)} />
                {name}
              </span>
            );
          })}
        </div>
      </div>

      {/* ── Rounds ── */}
      {rounds.map((round, roundIdx) => (
        <div key={roundIdx} className="mb-8">
          {/* Round divider */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-border/50" />
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-widest text-primary bg-primary/10 px-3 py-1 rounded-full border border-primary/20">
                Round {roundIdx + 1}
              </span>
              {roundIdx === 0 && rounds.length === 1 && (
                <span className="text-[9px] text-muted-foreground">(single round)</span>
              )}
              {roundIdx === 0 && rounds.length > 1 && rtMode === "deliberative" && (
                <span className="text-[9px] text-muted-foreground italic">independent</span>
              )}
              {roundIdx > 0 && rtMode === "sequential" && (
                <span className="text-[9px] text-muted-foreground italic">
                  builds on Round {roundIdx} + prior agents
                </span>
              )}
              {roundIdx > 0 && rtMode === "deliberative" && (
                <span className="text-[9px] text-muted-foreground italic">
                  reflects on Round {roundIdx}
                </span>
              )}
            </div>
            <div className="flex-1 h-px bg-border/50" />
          </div>

          {/* Messages */}
          <div>
            {round.map((msg, i) => (
              <RoundtableMessage key={msg.id} message={msg} isLast={i === round.length - 1} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
