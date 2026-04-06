import { invoke } from "@tauri-apps/api/core";
import type { FailureLesson } from "@/types";

export interface CreateFailureLessonInput {
  projectKey: string;
  planId?: string;
  filePath?: string;
  pattern?: string;
  finding: string;
}

export async function createFailureLesson(
  input: CreateFailureLessonInput,
): Promise<FailureLesson> {
  return invoke<FailureLesson>("create_failure_lesson", { input });
}

export async function createFailureLessonsBatch(
  inputs: CreateFailureLessonInput[],
): Promise<FailureLesson[]> {
  return invoke<FailureLesson[]>("create_failure_lessons_batch", { inputs });
}

export async function listFailureLessons(
  projectKey: string,
): Promise<FailureLesson[]> {
  return invoke<FailureLesson[]>("list_failure_lessons", { projectKey });
}

export async function searchSimilarFailures(
  projectKey: string,
  query: string,
  filePaths: string[],
  limit?: number,
): Promise<FailureLesson[]> {
  return invoke<FailureLesson[]>("search_similar_failures", {
    projectKey,
    query,
    filePaths,
    limit: limit ?? 5,
  });
}

export async function resolveFailureLesson(
  id: string,
  resolution: string,
): Promise<void> {
  return invoke("resolve_failure_lesson", { id, resolution });
}

export async function resolveFailureLessonsByPlan(
  planId: string,
  resolution: string,
): Promise<number> {
  return invoke<number>("resolve_failure_lessons_by_plan", { planId, resolution });
}

export async function deleteFailureLesson(id: string): Promise<void> {
  return invoke("delete_failure_lesson", { id });
}
