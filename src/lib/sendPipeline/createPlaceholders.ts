/**
 * Optimistic message pair appended to the UI while the agent is still
 * running. One entry represents the user prompt (or the system-followup
 * marker for auto tool-request replies), the other is the assistant
 * thinking placeholder that later gets swapped with the real messageId
 * on the first `*:progress` event.
 *
 * Shared between the main-chat and branch-drawer send paths. The branch
 * variant passes `progressLabel` (engine display name) so the spinner UI
 * renders it while the main path leaves progress blank.
 */
import type { Message } from "@/types";

export interface PlaceholderParams {
  convId: string;
  prompt: string;
  engineKey: string;
  model?: string;
  /** Shown under the assistant bubble; only the main path stores persona here. */
  persona?: string;
  /** Optional spinner label (branch drawer uses the engine display name). */
  progressLabel?: string;
  /**
   * When present, this send is a system-followup (tool-request auto-reply).
   * Backend has already persisted the system message with this id, so we
   * render it with `role: "system"` and the real id instead of a temp id.
   */
  userMessageId?: string;
  /** Injected for deterministic testing. */
  now?: number;
}

export function createPlaceholders(p: PlaceholderParams): [Message, Message] {
  const now = p.now ?? Date.now();
  const isSystemFollowup = !!p.userMessageId;
  const first: Message = isSystemFollowup
    ? {
        id: p.userMessageId!,
        conversationId: p.convId,
        role: "system",
        content: p.prompt,
        timestamp: now,
        status: "done",
      }
    : {
        id: `temp-user-${now}`,
        conversationId: p.convId,
        role: "user",
        content: p.prompt,
        timestamp: now,
        status: "done",
      };
  const thinking: Message = {
    id: `temp-thinking-${now}`,
    conversationId: p.convId,
    role: "assistant",
    content: "",
    ...(p.progressLabel ? { progressContent: p.progressLabel } : {}),
    timestamp: now,
    status: "streaming",
    engine: p.engineKey,
    model: p.model,
    ...(p.persona ? { persona: p.persona } : {}),
  };
  return [first, thinking];
}
