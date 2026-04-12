/**
 * Meta conversation utilities — manages the singleton Meta conversation per project.
 *
 * Each project has exactly one Meta conversation (type = "meta").
 * getOrCreateMetaConversation() returns the existing ID or creates a new one.
 * A Map cache prevents duplicate creation from concurrent calls.
 */

import { invoke } from "@tauri-apps/api/core";
import type { Conversation } from "@/types";

// Per-project cache: prevents duplicate creation from rapid concurrent calls
const _inFlight = new Map<string, Promise<string>>();

export async function getOrCreateMetaConversation(projectKey: string): Promise<string> {
  const cached = _inFlight.get(projectKey);
  if (cached) return cached;

  const promise = _doGetOrCreate(projectKey);
  _inFlight.set(projectKey, promise);
  promise.finally(() => _inFlight.delete(projectKey));
  return promise;
}

async function _doGetOrCreate(projectKey: string): Promise<string> {
  const conversations = await invoke<Conversation[]>("list_conversations", { projectKey });
  const existing = conversations.find((c) => c.type === "meta");
  if (existing) return existing.id;

  const created = await invoke<Conversation>("create_conversation", {
    input: {
      projectKey,
      label: "Meta",
      type: "meta",
      mode: "chat",
      engine: "claude",
      persona: "persona_meta",
    },
  });
  return created.id;
}
