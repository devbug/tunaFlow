/**
 * Shared PTY types and engine configuration.
 */
import type { Message } from "./types";

/** Engine-specific JSONL poll/list commands */
export function getPtyPollConfig(engine: string) {
  switch (engine) {
    case "codex": return { pollCmd: "pty_poll_codex", listCmd: "pty_list_codex_files" };
    case "gemini": return { pollCmd: "pty_poll_gemini", listCmd: "pty_list_gemini_files" };
    default: return { pollCmd: "pty_poll_jsonl", listCmd: "pty_list_jsonl_files" };
  }
}

export interface PtySendOptions {
  /** Which message array to update in the store */
  messageTarget: "messages" | "threadMessages";
  /** Guard: only update UI when this returns true */
  isActiveCheck: () => boolean;
  /**
   * Called after successful DB save, before _endRun.
   * Return true if you handle _endRun yourself (e.g. for tool-request follow-ups).
   */
  onCompleted?: (savedMsg: Message, text: string) => Promise<boolean>;
  /** Profile/persona label — stored in message.persona for header display */
  personaLabel?: string;
}
