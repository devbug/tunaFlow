import { invoke } from "@tauri-apps/api/core";
import type { Artifact, CreateArtifactInput } from "@/types";

export async function listArtifacts(conversationId: string): Promise<Artifact[]> {
  return invoke<Artifact[]>("list_artifacts", { conversationId });
}

export async function createArtifact(input: CreateArtifactInput): Promise<Artifact> {
  return invoke<Artifact>("create_artifact", { input });
}

export async function updateArtifactStatus(
  id: string,
  status: "draft" | "approved" | "rejected",
): Promise<void> {
  return invoke("update_artifact_status", { input: { id, status } });
}

export async function linkArtifactToSubtask(
  artifactId: string,
  subtaskId: string,
): Promise<void> {
  return invoke("link_artifact_to_subtask", { artifactId, subtaskId });
}

export async function deleteArtifact(id: string): Promise<void> {
  return invoke("delete_artifact", { id });
}
