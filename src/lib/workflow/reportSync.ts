/**
 * Document sync utilities — plan document, review report, result report generation.
 */
import type { Message, Plan } from "@/types";
import * as planApi from "../api/plans";
import type { ParsedReviewVerdict } from "../planProposalParser";
import { getProjectPath, createTestReportArtifact } from "./helpers";

/** Generate/update plan document in project directory. Fire-and-forget. */
export async function syncPlanDocument(planId: string): Promise<void> {
  try {
    const pp = await getProjectPath();
    if (!pp) return;
    await planApi.generatePlanDocument(planId, pp);
  } catch (e) { console.warn("[tunaflow]", e); }
}

/** Generate review report document. Fire-and-forget. */
export async function syncReviewReport(
  planId: string,
  verdict: ParsedReviewVerdict,
  reviewerEngines: string[] = [],
  testOutput?: string,
): Promise<void> {
  try {
    const pp = await getProjectPath();
    if (!pp) return;
    await planApi.generateReviewReport(
      planId, pp, verdict.verdict,
      verdict.findings, verdict.recommendations,
      reviewerEngines, testOutput,
    );
  } catch (e) { console.warn("[tunaflow]", e); }
}

/** Generate implementation result report. Fire-and-forget. */
export async function syncResultReport(
  planId: string,
  implMessages: Message[],
  developerEngine?: string,
  branchLabel?: string,
): Promise<void> {
  try {
    const pp = await getProjectPath();
    if (!pp) return;

    const stripMarkers = (text: string) =>
      text.replace(/<!--\s*tunaflow:[a-z_-]+(?::\d+)?\s*-->/g, "")
          .replace(/<!--\s*subtask-done:\d+\s*-->/g, "")
          .replace(/<!--\s*impl-complete\s*-->/g, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

    let lastReworkIdx = -1;
    for (let i = implMessages.length - 1; i >= 0; i--) {
      if (implMessages[i].role === "user" && implMessages[i].content.includes("### 🔄 Rework")) {
        lastReworkIdx = i;
        break;
      }
    }
    const relevantMessages = lastReworkIdx >= 0
      ? implMessages.slice(lastReworkIdx + 1)
      : implMessages;
    const assistantMsgs = relevantMessages.filter((m) => m.role === "assistant");
    const summary = assistantMsgs.length > 0
      ? stripMarkers(assistantMsgs[assistantMsgs.length - 1].content.slice(0, 2000))
      : "(No implementation output)";

    const { scanCompletedSubtasks } = await import("../planProposalParser");
    const completedNums = scanCompletedSubtasks(implMessages);
    const subtaskResults = assistantMsgs
      .slice(-10)
      .map((m) => stripMarkers(m.content.slice(0, 500)))
      .filter((c) => c.trim().length > 0);

    const knownIssues: string[] = [];

    await planApi.generateResultReport(
      planId, pp, summary, subtaskResults, knownIssues,
      developerEngine, branchLabel,
    );
  } catch (e) { console.warn("[tunaflow]", e); }
}
