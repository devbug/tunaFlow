/**
 * Shared workflow helpers — slug, project path, branch creation, artifacts.
 */
import { invoke } from "@tauri-apps/api/core";
import type { Branch, Plan } from "@/types";
import * as planApi from "../api/plans";
import * as artifactApi from "../api/artifacts";
import * as failureLessonsApi from "../api/failureLessons";
import type { ParsedReviewVerdict } from "../planProposalParser";

// ─── Slug utilities ────────────────────────────────────────────────────────

/** Generate ASCII-only slug from plan title for file paths.
 *  DEPRECATED for direct use — prefer plan.slug from DB (unique, collision-free).
 *  This function is kept as fallback when plan.slug is not available.
 */
export function slugifyPlanTitle(title: string): string {
  const slug = title
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return slug || "plan";
}

/** Get the effective slug for a plan — prefers DB slug, falls back to title slugify */
export function getPlanSlug(plan: { slug?: string | null; title: string }): string {
  return plan.slug || slugifyPlanTitle(plan.title);
}

// ─── Project path ──────────────────────────────────────────────────────────

/** Resolve current project path. Returns null if unavailable. */
export async function getProjectPath(): Promise<string | null> {
  try {
    const { useChatStore } = await import("@/stores/chatStore");
    const projectKey = useChatStore.getState().selectedProjectKey;
    if (!projectKey) return null;
    const project = await invoke("get_project", { key: projectKey }) as { path?: string };
    return project?.path ?? null;
  } catch { return null; }
}

// ─── Plan content builder ──────────────────────────────────────────────────

export async function buildPlanContext(plan: Plan): Promise<string> {
  const subtasks = await planApi.listSubtasks(plan.id);
  const subtaskList = subtasks
    .map((st, i) => `${i + 1}. ${st.title}${st.details ? ` — ${st.details}` : ""}`)
    .join("\n");

  return [
    `## Plan: ${plan.title}`,
    plan.description ? `\n### Description\n${plan.description}` : "",
    plan.expectedOutcome ? `\n### Expected Outcome\n${plan.expectedOutcome}` : "",
    `\n### Subtasks\n${subtaskList || "(none)"}`,
  ].filter(Boolean).join("\n");
}

// ─── Branch creation ───────────────────────────────────────────────────────

export interface CreateBranchResult {
  branch: Branch;
  shadowConvId: string;
}

export async function createAndLinkBranch(
  plan: Plan,
  branchType: "implementation" | "review",
  label: string,
  mode: "chat" | "roundtable" = "chat",
): Promise<CreateBranchResult> {
  // Add round number for review branches (2nd review → "Review RT: ... (2차)")
  let finalLabel = label;
  if (branchType === "review") {
    const events = await planApi.listPlanEvents(plan.id);
    const reviewCount = events.filter(
      (e) => e.eventType === "review_requested" || e.eventType === "impl_completed"
    ).length;
    if (reviewCount > 1) {
      finalLabel = `${label} (${reviewCount}차)`;
    }
  }

  const input = {
    conversationId: plan.conversationId,
    label: finalLabel,
    mode,
    parentBranchId: plan.branchId ?? undefined,
  };
  const branch = await invoke<Branch>("create_branch", { input });
  const shadowConvId = await invoke<string>("open_branch_stream", { branchId: branch.id });

  await planApi.linkPlanBranch(plan.id, branchType, branch.id);

  return { branch, shadowConvId };
}

// ─── Failure learning ──────────────────────────────────────────────────────

/** Extract file path from a finding string (best-effort). */
export function extractFilePath(finding: string): string | undefined {
  for (const word of finding.split(/\s+/)) {
    const clean = word.replace(/[`'"(),]/g, "");
    if (clean.includes("/") && clean.includes(".") && clean.length > 4 && !clean.startsWith("http")) {
      return clean;
    }
  }
  return undefined;
}

/** Save failure lessons from review findings (fire-and-forget). */
export async function saveFailureLessons(plan: Plan, findings: string[]): Promise<void> {
  if (findings.length === 0) return;
  try {
    const { useChatStore } = await import("@/stores/chatStore");
    const projectKey = useChatStore.getState().selectedProjectKey;
    if (!projectKey) return;
    const inputs = findings.map((finding) => ({
      projectKey,
      planId: plan.id,
      filePath: extractFilePath(finding),
      pattern: finding.length > 80 ? finding.slice(0, 80).trim() + "..." : finding.trim(),
      finding,
    }));
    await failureLessonsApi.createFailureLessonsBatch(inputs);
  } catch (e) { console.warn("[failure-learning] save failed:", e); }
}

// ─── Artifact creation ─────────────────────────────────────────────────────

/** Create review-findings artifact from verdict (fire-and-forget). */
export async function createVerdictArtifact(plan: Plan, verdict: ParsedReviewVerdict): Promise<void> {
  try {
    const lines: string[] = [];
    lines.push(`## Review Verdict: ${verdict.verdict.toUpperCase()}`);
    lines.push("");
    if (verdict.findings.length > 0) {
      lines.push("### Findings");
      for (const f of verdict.findings) lines.push(`- ${f}`);
      lines.push("");
    }
    if (verdict.recommendations.length > 0) {
      lines.push("### Recommendations");
      for (const r of verdict.recommendations) lines.push(`- ${r}`);
    }
    await artifactApi.createArtifact({
      conversationId: plan.conversationId,
      planId: plan.id,
      type: "review-findings",
      title: `Review: ${plan.title} (${verdict.verdict})`,
      content: lines.join("\n"),
    });
  } catch (e) { console.warn("[artifact] verdict artifact failed:", e); }
}

/** Create architect-decision artifact when plan is approved (fire-and-forget). */
export async function createArchitectDecisionArtifact(plan: Plan): Promise<void> {
  try {
    const subtasks = await planApi.listSubtasks(plan.id);
    const lines: string[] = [];
    lines.push(`## Plan Approved: ${plan.title}`);
    if (plan.description) lines.push("", plan.description);
    if (plan.expectedOutcome) lines.push("", `**Expected**: ${plan.expectedOutcome}`);
    if (subtasks.length > 0) {
      lines.push("", "### Subtasks");
      for (const st of subtasks) {
        lines.push(`${st.idx + 1}. ${st.title}${st.details ? ` — ${st.details}` : ""}`);
      }
    }
    await artifactApi.createArtifact({
      conversationId: plan.conversationId,
      planId: plan.id,
      type: "architect-decision",
      title: `Decision: ${plan.title}`,
      content: lines.join("\n"),
    });
  } catch (e) { console.warn("[artifact] architect decision artifact failed:", e); }
}

/** Create test-report artifact from test output (fire-and-forget). */
export async function createTestReportArtifact(plan: Plan, testOutput: string): Promise<void> {
  try {
    await artifactApi.createArtifact({
      conversationId: plan.conversationId,
      planId: plan.id,
      type: "test-report",
      title: `Test: ${plan.title}`,
      content: testOutput.slice(0, 10000),
    });
  } catch (e) { console.warn("[artifact] test report artifact failed:", e); }
}
