export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

import type { RoundtableParticipant } from "../types";

export const ROUNDTABLE_PARTICIPANTS: RoundtableParticipant[] = [
  { name: "Haiku", engine: "claude", model: "claude-haiku-4-5-20251001" },
  { name: "Codex", engine: "codex" },
  { name: "Gemini", engine: "gemini", model: "gemini-2.5-pro" },
  // { name: "OpenCode", engine: "opencode" },
];
