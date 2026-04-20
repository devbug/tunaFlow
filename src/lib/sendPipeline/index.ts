/**
 * Shared send-pipeline primitives — Step 1 of the runtime/thread send-path
 * consolidation described in `docs/plans/refactorRoadmap_2026-04-20.md` §1-3.
 *
 * Current scope: pure helpers + input builder. The streaming lifecycle
 * (event listeners, DB reload, tool-request follow-up) is still handled
 * in each slice; Step 2 will pull that out too.
 */
export { resolveModel } from "./resolveModel";
export type { ResolveModelState } from "./resolveModel";
export { createPlaceholders } from "./createPlaceholders";
export type { PlaceholderParams } from "./createPlaceholders";
export { buildSendInput } from "./buildSendInput";
export type { BuildSendInputParams } from "./buildSendInput";
