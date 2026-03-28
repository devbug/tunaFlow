export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

import type { RoundtableParticipant } from "../types";

export const ROUNDTABLE_PARTICIPANTS: RoundtableParticipant[] = [
  { name: "Claude", engine: "claude" },
  { name: "Codex", engine: "codex" },
  { name: "Gemini", engine: "gemini" },
];
