/**
 * Implementation workflow — plan approval, branch creation, revision requests.
 * Phases: C (review branch), C→D (approve), D (approve impl-plan), revision.
 */
import { invoke } from "@tauri-apps/api/core";
import type { Message, Plan } from "@/types";
import * as planApi from "../api/plans";
import {
  buildPlanContext,
  createAndLinkBranch,
  createArchitectDecisionArtifact,
  getProjectPath,
  getPlanSlug,
} from "./helpers";
import type { CreateBranchResult } from "./helpers";

export type { CreateBranchResult };

// ─── Phase C: Review Branch ────────────────────────────────────────────────

export async function startReviewBranch(
  plan: Plan,
  feedback: string,
): Promise<CreateBranchResult> {
  const { branch, shadowConvId } = await createAndLinkBranch(
    plan, "review", `review: ${plan.title}`, "chat",
  );
  await planApi.createPlanEvent(plan.id, "review_requested", "user", feedback);

  const planContext = await buildPlanContext(plan);
  const prompt = [
    `이 Plan에 대한 검토가 요청되었습니다.`,
    "",
    planContext,
    "",
    `### 사용자 의견`,
    feedback,
    "",
    `Plan을 분석하고, 수정이 필요하면 \`<!-- tunaflow:plan-proposal -->\` 형식으로 수정된 Plan을 제안하세요.`,
  ].join("\n");

  await invoke("create_user_message", { input: { conversationId: shadowConvId, content: prompt } });

  return { branch, shadowConvId };
}

// ─── Phase C→D: Approve → Implementation Branch ───────────────────────────

export async function approveAndStartImplementation(
  plan: Plan,
  developerEngine: string = "claude",
): Promise<CreateBranchResult & { prompt: string }> {
  await planApi.updatePlanPhase(plan.id, "implementation");
  await planApi.updatePlanStatus(plan.id, "active");
  await planApi.createPlanEvent(plan.id, "approved", "user");
  await planApi.assignPlanEngines(plan.id, { developer: developerEngine });

  createArchitectDecisionArtifact(plan);

  const { branch, shadowConvId } = await createAndLinkBranch(
    plan, "implementation", `dev: ${plan.title}`, "chat",
  );

  const slug = getPlanSlug(plan);
  const subtasks = await planApi.listSubtasks(plan.id);
  const pendingSubtasks = subtasks.filter((s) => s.status !== "done");
  const targetSubtasks = pendingSubtasks.length > 0 ? pendingSubtasks : subtasks;

  const taskItems = targetSubtasks.map((s) =>
    `- \`docs/plans/${slug}-task-${String(s.idx).padStart(2, "0")}.md\` — ${s.title}`
  );
  const doneCount = subtasks.length - targetSubtasks.length;
  const doneNote = doneCount > 0
    ? `\n> ${doneCount}개 태스크는 이미 완료됨 — 해당 코드를 변경하지 마세요.`
    : "";
  const prompt = [
    `### 🔧 구현 시작`,
    ``,
    `**Plan**: "${plan.title}"`,
    ``,
    `**작업 지시서**:`,
    ...taskItems,
    ``,
    `각 task 파일을 읽고 순서대로 구현하세요.${doneNote}`,
    ``,
    `**필수 절차**:`,
    `1. task 파일을 읽고 **Changed files** 섹션의 파일만 수정하세요.`,
    `2. 구현 후 task 파일의 **Verification** 섹션의 명령을 **모두 실행**하고 결과를 보고하세요.`,
    `3. 모든 검증이 통과하면 \`<!-- tunaflow:subtask-done:N -->\` 마커를 포함하세요.`,
    `4. 전체 완료 시 \`<!-- tunaflow:impl-complete -->\` 마커를 포함하세요.`,
  ].join("\n");

  return { branch, shadowConvId, prompt };
}

// ─── Phase D: Approve impl-plan ───────────────────────────────────────────

/** Returns the prompt string — caller sends via sendThreadMessage */
export async function approveImplPlan(
  plan: Plan,
): Promise<string> {
  await planApi.createPlanEvent(plan.id, "impl_approved", "user");
  return "실행 계획이 승인되었습니다. 구현을 시작하세요.";
}

// ─── Plan Revision (from Implementation Branch) ───────────────────────────

/**
 * Request plan revision from the Architect.
 *
 * Compresses the Implementation Branch conversation and sends it to the
 * main conversation's Architect agent, asking for a revised plan-proposal.
 *
 * Flow: Developer Branch → compress conversation → Architect reviews →
 *       produces revised plan-proposal → user merges via MergeBranchButton.
 */
/**
 * Archive the review branch (if any) when control has been handed off to the
 * Architect. Shared by the three escalation paths:
 *   1. `requestPlanRevision` (계획 수정 버튼) — direct user action
 *   2. `doom_loop_escalated` (automatic, failCount ≥ 5)
 *   3. `architect_redesign_requested` (SubtaskReviewView)
 * Intentionally does NOT archive the implementation branch — that stays alive
 * for the rework cycle. Errors are swallowed (archiving a stale/missing
 * branch is not worth aborting the escalation).
 */
export async function archiveReviewBranchForHandoff(plan: Plan): Promise<void> {
  if (!plan.reviewBranchId) return;
  try {
    await invoke("archive_branch", { id: plan.reviewBranchId });
  } catch (e) {
    console.debug("[archive-review-on-handoff]", e);
  }
}

export async function requestPlanRevision(
  plan: Plan,
  branchMessages: Message[],
  architectEngine: string = "claude",
  sendToArchitect: (engine: string, prompt: string, systemPrompt?: string) => Promise<void> = async () => {},
): Promise<void> {
  const branchSummary = branchMessages
    .slice(-20)
    .map((m) => {
      const role = m.role === "assistant"
        ? `assistant${m.persona ? `:${m.persona}` : ""}${m.engine ? ` (${m.engine})` : ""}`
        : m.role;
      const content = m.content.length > 800
        ? m.content.slice(0, 800) + "…"
        : m.content;
      return `[${role}] ${content}`;
    })
    .join("\n\n");

  const planContext = await buildPlanContext(plan);

  let projectAnalysis = "";
  try {
    const pp = await getProjectPath();
    if (pp) {
      const stack = await invoke<{ keywords: string[]; detectedFiles: string[] }>("detect_project_stack", { projectPath: pp }).catch(() => null);
      if (stack && stack.keywords.length > 0) {
        const topKeywords = stack.keywords.slice(0, 15).join(", ");
        projectAnalysis = [
          `### 프로젝트 분석 (자동)`,
          `- 감지된 매니페스트: ${stack.detectedFiles.join(", ")}`,
          `- 주요 기술: ${topKeywords}`,
          "",
        ].join("\n");
      }
    }
  } catch { /* best-effort */ }

  const systemPrompt = [
    `당신은 Architect입니다. Implementation Branch에서 계획 수정 요청이 왔습니다.`,
    `아래 정보를 기반으로 수정된 Plan을 \`<!-- tunaflow:plan-proposal -->\` 형식으로 제안하세요.`,
    `변경 이유를 간단히 설명하고, 기존 subtask 중 유지/수정/삭제할 항목을 명확히 구분하세요.`,
    "",
    projectAnalysis,
    `### 태스크 작성 규칙`,
    `각 subtask의 작업 지시서에 반드시 포함:`,
    `1. **변경 대상 파일** — 정확한 경로 (ContextPack의 graph/rawq 섹션 참고)`,
    `2. **변경 내용** — 추가/수정/삭제할 코드의 의도`,
    `3. **의존성** — 선행 태스크`,
    `4. **검증 조건** — Developer가 자가 검증할 수 있는 구체적 기준`,
    `5. **위험 요소** — 사이드 이펙트 (graph의 impacted files 참고)`,
    "",
    `### 기존 Plan`,
    planContext,
    "",
    `### Implementation Branch 논의 내용`,
    branchSummary.slice(0, 6000),
  ].join("\n");

  const prompt = `[계획 수정 요청] "${plan.title}" (rev.${plan.revision}) — Implementation Branch 논의를 반영하여 Plan 수정을 요청합니다.`;

  await sendToArchitect(architectEngine, prompt, systemPrompt);

  await planApi.createPlanEvent(plan.id, "revision_requested", "user", `from implementation branch, architect=${architectEngine}`);
  // Baton has moved to Architect → review branch is no longer active.
  await archiveReviewBranchForHandoff(plan);
}
