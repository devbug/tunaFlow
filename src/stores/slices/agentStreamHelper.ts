/**
 * Shared agent streaming helpers — extracted from runtimeSlice + threadSlice
 * to eliminate event-listener duplication.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useToolStepsStore } from "@/stores/toolStepsStore";
import { serializeSteps } from "@/lib/toolSteps";
import type { Message } from "@/types";

// ─── Placeholder messages ──────────────────────────────────────────────

export function createPlaceholders(
  conversationId: string,
  prompt: string,
  engineKey: string,
  model?: string,
): [user: Message, thinking: Message] {
  const now = Date.now();
  return [
    { id: `temp-user-${now}`, conversationId, role: "user", content: prompt, timestamp: now, status: "done" },
    { id: `temp-thinking-${now}`, conversationId, role: "assistant", content: "", timestamp: now, status: "streaming", engine: engineKey, model: model ?? undefined },
  ];
}

// ─── Event listener setup ──────────────────────────────────────────────

export interface StreamListenerConfig {
  conversationId: string;
  engineKey: string;
  hasChunkEvent: boolean;
  /** Check whether this conversation is still active in UI */
  isActive: () => boolean;
  /** Apply a message update to the store */
  updateMessage: (messageId: string, field: "content" | "progressContent", text: string) => void;
  /** Replace placeholder with real message */
  swapPlaceholder: (messageId: string, engineKey: string, model?: string) => void;
}

export interface StreamListenerHandle {
  cleanup: () => void;
  /** Call before cleanup to discard pending throttled chunk */
  discardPending: () => void;
}

export async function setupStreamListeners(config: StreamListenerConfig): Promise<StreamListenerHandle> {
  const { conversationId, engineKey, hasChunkEvent, isActive, updateMessage, swapPlaceholder } = config;
  const progressEvent = `${engineKey}:progress`;
  const chunkEvent = `${engineKey}:chunk`;

  // Throttled chunk state
  let pendingChunk: { messageId: string; text: string } | null = null;
  let chunkTimer: ReturnType<typeof setTimeout> | null = null;
  const flushChunk = () => {
    if (pendingChunk && isActive()) {
      updateMessage(pendingChunk.messageId, "content", pendingChunk.text);
    }
    pendingChunk = null;
    chunkTimer = null;
  };

  const ulP = await listen<{ messageId: string; conversationId: string; text: string }>(progressEvent, (e) => {
    if (e.payload.conversationId !== conversationId) return;
    useToolStepsStore.getState().handleProgress(e.payload.messageId, e.payload.text);
    if (!isActive()) return;
    swapPlaceholder(e.payload.messageId, engineKey);
  });

  const ulC = hasChunkEvent
    ? await listen<{ messageId: string; conversationId: string; text: string }>(chunkEvent, (e) => {
        if (e.payload.conversationId !== conversationId) return;
        pendingChunk = e.payload;
        if (!chunkTimer) chunkTimer = setTimeout(flushChunk, 200);
      })
    : () => {};

  return {
    cleanup: () => {
      if (chunkTimer) { clearTimeout(chunkTimer); chunkTimer = null; }
      flushChunk();
      ulP(); ulC();
    },
    discardPending: () => { pendingChunk = null; },
  };
}

// ─── Completion handler ────────────────────────────────────────────────

export async function saveToolSteps(messageId: string): Promise<void> {
  const tsStore = useToolStepsStore.getState();
  const steps = tsStore.getSteps(messageId);
  if (steps.length > 0) {
    invoke("save_progress_content", { messageId, progressContent: serializeSteps(steps) })
      .catch((e) => console.debug("[save-steps]", e));
    tsStore.clear(messageId);
  }
}

export async function handleToolRequests(
  message: Message | undefined,
): Promise<string | null> {
  if (!message || message.role !== "assistant") return null;
  try {
    const { extractToolRequests } = await import("@/lib/planProposalParser");
    const requests = extractToolRequests(message.content);
    if (requests.length > 0) {
      const { executeToolRequests } = await import("@/lib/toolRequestHandler");
      return executeToolRequests(requests);
    }
  } catch (err) {
    console.warn("[tool-request]", err);
  }
  return null;
}

export async function reloadMessages(conversationId: string): Promise<Message[]> {
  return invoke<Message[]>("list_messages", { conversationId });
}
