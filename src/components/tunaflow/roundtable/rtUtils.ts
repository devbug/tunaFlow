import type { Message, RoundtableParticipant } from "@/types";

// ─── Prompt source metadata ──────────────────────────────────────────────────

export interface PromptSources {
  round: number;
  totalRounds: number;
  mode: string;
  priorRoundRefs: string[];
  currentRoundRefs: string[];
}

export function parsePromptSources(msg: Message): PromptSources | null {
  if (!msg.progressContent) return null;
  try { return JSON.parse(msg.progressContent) as PromptSources; } catch { return null; }
}

// ─── Grouping helpers ───────────────────────────────────────────────────────

export function groupIntoRounds(messages: Message[]): Message[][] {
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

export function getParticipants(messages: Message[]): { name: string; engine: string }[] {
  const seen = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role !== "assistant" || msg.engine === "system") continue;
    const name = msg.persona ?? msg.engine ?? "Agent";
    const engine = msg.engine ?? "claude";
    if (!seen.has(name)) seen.set(name, engine);
  }
  return Array.from(seen.entries()).map(([name, engine]) => ({ name, engine }));
}
