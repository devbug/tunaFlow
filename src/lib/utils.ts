import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type AgentEngine = "claude" | "codex" | "gemini" | "opencode";

export const AGENT_COLORS: Record<AgentEngine, string> = {
  claude: "text-agent-claude border-agent-claude/30 bg-agent-claude/10",
  codex: "text-agent-codex border-agent-codex/30 bg-agent-codex/10",
  gemini: "text-agent-gemini border-agent-gemini/30 bg-agent-gemini/10",
  opencode: "text-agent-opencode border-agent-opencode/30 bg-agent-opencode/10",
};

export const AGENT_DOT_COLORS: Record<AgentEngine, string> = {
  claude: "bg-agent-claude",
  codex: "bg-agent-codex",
  gemini: "bg-agent-gemini",
  opencode: "bg-agent-opencode",
};

export const AGENT_DISPLAY_NAMES: Record<AgentEngine, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  opencode: "OpenCode",
};

export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function isKnownEngine(s: string | undefined): s is AgentEngine {
  return s === "claude" || s === "codex" || s === "gemini" || s === "opencode";
}
