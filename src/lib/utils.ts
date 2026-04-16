import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type AgentEngine = "claude" | "codex" | "gemini" | "ollama" | "lmstudio";

export const AGENT_COLORS: Record<AgentEngine, string> = {
  claude: "text-agent-claude border-agent-claude/30 bg-agent-claude/10",
  codex: "text-agent-codex border-agent-codex/30 bg-agent-codex/10",
  gemini: "text-agent-gemini border-agent-gemini/30 bg-agent-gemini/10",
  ollama: "text-agent-ollama border-agent-ollama/30 bg-agent-ollama/10",
  lmstudio: "text-agent-lmstudio border-agent-lmstudio/30 bg-agent-lmstudio/10",
};

export const AGENT_DOT_COLORS: Record<AgentEngine, string> = {
  claude: "bg-agent-claude",
  codex: "bg-agent-codex",
  gemini: "bg-agent-gemini",
  ollama: "bg-agent-ollama",
  lmstudio: "bg-agent-lmstudio",
};

export const AGENT_DISPLAY_NAMES: Record<AgentEngine, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  ollama: "Ollama",
  lmstudio: "LM Studio",
};

export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Normalize engine string to known engine ID. "claude-code" → "claude" etc. */
export function normalizeEngine(s: string | undefined): AgentEngine | null {
  if (!s) return null;
  if (s === "claude" || s === "claude-code") return "claude";
  if (s === "codex") return "codex";
  if (s === "gemini") return "gemini";
  if (s === "ollama" || s === "openai-compat") return "ollama";
  if (s === "lmstudio") return "lmstudio";
  return null;
}

export function isKnownEngine(s: string | undefined): s is AgentEngine {
  return normalizeEngine(s) !== null;
}

/**
 * Extract a human-readable message from a Tauri IPC error.
 * Handles both structured `{ code, message }` objects and plain strings.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

/** Agent name text color classes */
export const AGENT_TEXT_COLORS: Record<AgentEngine, string> = {
  claude: "text-agent-claude",
  codex: "text-agent-codex",
  gemini: "text-agent-gemini",
  ollama: "text-agent-ollama",
  lmstudio: "text-agent-lmstudio",
};
