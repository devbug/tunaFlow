/**
 * planWorkflowService — data-loading orchestration extracted from PlanCard.
 *
 * PlanCard should handle rendering + event delegation only.
 * All data-fetching and business-logic inference belongs here.
 */
import { invoke } from "@tauri-apps/api/core";
import type { Plan, PlanSubtask, Message } from "@/types";
import * as planApi from "../api/plans";
import { getPlanSlug } from "./helpers";
import { scanMessagesForMarkers } from "./reviewWorkflow";
import type { ParsedReviewVerdict } from "../planProposalParser";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PlanLoadResult {
  subtasks: PlanSubtask[];
  implComplete: boolean;
  reviewVerdict: ParsedReviewVerdict | null;
  taskFileTitles: Record<number, string>;
}

// ─── Subtask auto-recovery from docs/ ────────────────────────────────────────

/**
 * Attempt to recover subtasks from docs/plans/{slug}-task-*.md files.
 * Returns the recovered subtasks or null if nothing was found.
 */
export async function autoRecoverSubtasks(
  plan: Plan,
  projectKey: string
): Promise<PlanSubtask[] | null> {
  const slug = getPlanSlug(plan);
  if (!slug) return null;

  const project = await invoke<{ path?: string }>("get_project", { key: projectKey });
  if (!project?.path) return null;

  const entries = await invoke<{ name: string; path: string; isDir: boolean }[]>(
    "list_directory", { path: `${project.path}/docs/plans` }
  ).catch(() => [] as { name: string; path: string; isDir: boolean }[]);

  const taskFiles = entries
    .filter((e) => !e.isDir && e.name.match(new RegExp(`^${slug}-task-\\d+\\.md$`)))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (taskFiles.length === 0) return null;

  const titles: string[] = [];
  for (const f of taskFiles) {
    const content = await invoke<string>("read_file_content", { path: f.path }).catch(() => "");
    const heading = content.match(/^#{1,2}\s+(.+)/m)?.[1]
      ?.replace(/^(Task\s+\d+[:.]\s*)/i, "").trim()
      ?? f.name.replace(/\.md$/, "");
    titles.push(heading);
  }

  const recovered = await planApi.replacePlanSubtasks(
    plan.id,
    titles.map((title) => ({ title, details: undefined }))
  );
  await planApi.createPlanEvent(
    plan.id, "review_merged", "system",
    `Auto-recovered ${recovered.length} subtasks from docs`
  );
  console.log(`[planWorkflowService] auto-recovered ${recovered.length} subtasks from docs/${slug}-task-*.md`);
  return recovered;
}

// ─── Branch marker scanning ───────────────────────────────────────────────────

/**
 * Scan the implementation branch for impl-complete marker and fallback heuristic.
 */
export async function checkImplComplete(
  plan: Plan,
  tasks: PlanSubtask[],
  runningThreadIds: string[]
): Promise<boolean> {
  if (!plan.implementationBranchId) return false;
  if (plan.phase !== "implementation" && plan.phase !== "review") return false;

  try {
    const shadowConvId = `branch:${plan.implementationBranchId}`;
    const msgs = await invoke<Message[]>("list_messages", { conversationId: shadowConvId });
    const markers = scanMessagesForMarkers(msgs);
    if (markers.implComplete) return true;

    // Fallback: all subtasks done in DB + agent not running
    if (tasks.length > 0) {
      const allDone = tasks.every((st) => st.status === "done");
      const notRunning = !runningThreadIds.includes(shadowConvId);
      if (allDone && notRunning) return true;
    }
  } catch { /* branch may not exist yet */ }

  return false;
}

/**
 * Scan the review branch for a verdict marker.
 */
export async function checkReviewVerdict(plan: Plan): Promise<ParsedReviewVerdict | null> {
  if (!plan.reviewBranchId || plan.phase !== "review") return null;

  try {
    const shadowConvId = `branch:${plan.reviewBranchId}`;
    const msgs = await invoke<Message[]>("list_messages", { conversationId: shadowConvId });
    const markers = scanMessagesForMarkers(msgs);
    return markers.reviewVerdict ?? null;
  } catch { /* branch may not exist yet */ }

  return null;
}

// ─── Task file title loading ───────────────────────────────────────────────────

/**
 * Load heading from each docs/plans/{slug}-task-NN.md file.
 * Returns a map from 1-based task index to title.
 */
export async function loadTaskFileTitles(
  plan: Plan,
  projectKey: string,
  taskCount: number
): Promise<Record<number, string>> {
  const slug = getPlanSlug(plan);
  if (!slug || taskCount === 0) return {};

  const project = await invoke("get_project", { key: projectKey }) as { path?: string };
  if (!project?.path) return {};

  const titles: Record<number, string> = {};
  for (let i = 1; i <= taskCount; i++) {
    const taskPath = `${project.path}/docs/plans/${slug}-task-${String(i).padStart(2, "0")}.md`;
    try {
      const content = await invoke<{ content: string }>("read_text_file", {
        filePath: taskPath,
        projectPath: project.path,
      });
      const m = content.content.match(/^#\s+(.+)$/m);
      if (m) titles[i] = m[1].trim();
    } catch { /* file doesn't exist */ }
  }
  return titles;
}

// ─── Combined plan expand loader ──────────────────────────────────────────────

/**
 * Load all plan data on expand: subtasks, events, markers, task file titles.
 * Auto-recovers subtasks from docs if the plan has none.
 */
export async function loadPlanExpandData(
  plan: Plan,
  projectKey: string | null,
  runningThreadIds: string[]
): Promise<PlanLoadResult> {
  const [tasks, events] = await Promise.all([
    planApi.listSubtasks(plan.id),
    planApi.listPlanEvents(plan.id),
  ]);

  let resolvedTasks = tasks;

  // Auto-recover subtasks from docs if plan has none
  if (tasks.length === 0 && projectKey) {
    try {
      const recovered = await autoRecoverSubtasks(plan, projectKey);
      if (recovered) resolvedTasks = recovered;
    } catch (e) {
      console.debug("[planWorkflowService] auto-recover subtasks:", e);
    }
  }

  // Marker scanning (parallel)
  const [implComplete, reviewVerdict, taskFileTitles] = await Promise.all([
    checkImplComplete(plan, resolvedTasks, runningThreadIds),
    checkReviewVerdict(plan),
    projectKey ? loadTaskFileTitles(plan, projectKey, resolvedTasks.length) : Promise.resolve<Record<number, string>>({}),
  ]);

  return { subtasks: resolvedTasks, implComplete, reviewVerdict, taskFileTitles };
}

export { scanMessagesForMarkers };
export type { ParsedReviewVerdict };
