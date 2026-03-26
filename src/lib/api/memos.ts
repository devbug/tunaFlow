import { invoke } from "@tauri-apps/api/core";
import type { Memo, CreateMemoInput } from "@/types";

export async function listMemosByConversation(conversationId: string): Promise<Memo[]> {
  return invoke<Memo[]>("list_memos_by_conversation", { conversationId });
}

export async function createMemo(input: CreateMemoInput): Promise<Memo> {
  return invoke<Memo>("create_memo", { input });
}

export async function deleteMemo(id: string): Promise<void> {
  return invoke("delete_memo", { id });
}
