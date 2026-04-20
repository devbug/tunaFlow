/**
 * Shared model-fallback logic. When a caller invokes `sendWithEngine` /
 * `sendThreadMessage` without passing `model`, we resolve one to avoid
 * reaching the backend with `model=None` (which breaks codex app-server
 * with a 400 and silently falls back to a stale default on other engines).
 *
 * Resolution order:
 *   1. `_convEngineMap[convId]` — last-used engine/model remembered for this
 *      conversation (only used when the saved engine matches the requested
 *      `engine`; otherwise the pair is meaningless).
 *   2. First entry in `agentProfiles` that matches `engine` and has a model.
 *
 * Returns `undefined` when nothing resolves — the caller should log a warning
 * and still forward the original (undefined) model.
 */
import type { AgentProfile } from "@/types";

export interface ResolveModelState {
  _convEngineMap: Record<string, { engine: string; model?: string } | undefined>;
  agentProfiles: AgentProfile[];
}

export function resolveModel(
  state: ResolveModelState,
  convId: string,
  engine: string,
): string | undefined {
  const saved = state._convEngineMap[convId];
  if (saved?.engine === engine && saved?.model) {
    return saved.model;
  }
  const prof = state.agentProfiles.find((p) => p.engine === engine && p.model);
  return prof?.model;
}
