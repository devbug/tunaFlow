/**
 * Shared streaming utilities for runtimeSlice and threadSlice.
 *
 * Both slices implement identical patterns for:
 * 1. RT chunk batching (Map-based throttle for roundtable:chunk events)
 * 2. Single-message chunk throttle (for sendWithEngine streaming)
 */

// ─── RT chunk batcher ────────────────────────────────────────────────────────

/**
 * Creates a throttled handler for `roundtable:chunk` events using Map-based batching.
 * Multiple chunks arriving within `intervalMs` are coalesced into a single batch flush,
 * preventing excessive re-renders during parallel RT participant streaming.
 *
 * Usage:
 *   const rtBatcher = createRtChunkBatcher(convId, isActive, (batch) => {
 *     set((state) => ({ messages: state.messages.map((m) => {
 *       const text = batch.get(m.id);
 *       return text !== undefined ? { ...m, content: text } : m;
 *     }) }));
 *   });
 *   const ulChunk = await listen("roundtable:chunk", rtBatcher.handleChunk);
 *   // In cleanup: rtBatcher.cleanup(); ulChunk();
 */
export function createRtChunkBatcher(
  convId: string,
  isActive: () => boolean,
  applyBatch: (batch: Map<string, string>) => void,
  intervalMs = 200,
): {
  handleChunk: (e: { payload: { messageId: string; conversationId: string; text: string } }) => void;
  cleanup: () => void;
} {
  let pending: Map<string, string> = new Map();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    if (!isActive() || pending.size === 0) { pending.clear(); return; }
    const batch = new Map(pending);
    pending.clear();
    applyBatch(batch);
  };

  const handleChunk = (e: { payload: { messageId: string; conversationId: string; text: string } }) => {
    if (e.payload.conversationId !== convId) return;
    pending.set(e.payload.messageId, e.payload.text);
    if (!timer) timer = setTimeout(flush, intervalMs);
  };

  const cleanup = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    pending.clear();
  };

  return { handleChunk, cleanup };
}

// ─── Single-message chunk throttle ──────────────────────────────────────────

/**
 * Creates a throttled chunk handler for single-message streaming (sendWithEngine path).
 * Coalesces rapid chunk events into batched UI updates at `intervalMs` intervals.
 *
 * Usage:
 *   const throttle = createSingleChunkThrottler(isActive, (messageId, text) => {
 *     replaceOrUpdate(messageId, text);
 *   });
 *   const unlistenChunk = await listen("claude:chunk", (e) => throttle.handleChunk(e.payload));
 *   // In cleanup: throttle.cleanup(); unlistenChunk();
 */
export function createSingleChunkThrottler(
  isActive: () => boolean,
  onFlush: (messageId: string, text: string) => void,
  intervalMs = 200,
): {
  handleChunk: (payload: { messageId: string; conversationId: string; text: string }) => void;
  cleanup: () => void;
} {
  let pending: { messageId: string; text: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (pending && isActive()) { onFlush(pending.messageId, pending.text); }
    pending = null;
    timer = null;
  };

  const handleChunk = (payload: { messageId: string; conversationId: string; text: string }) => {
    pending = payload;
    if (!timer) timer = setTimeout(flush, intervalMs);
  };

  const cleanup = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    pending = null;
  };

  return { handleChunk, cleanup };
}
