/**
 * Workflow orchestration utilities.
 *
 * Split into lib/workflow/ sub-modules:
 * - helpers.ts      — slug, project path, branch creation, artifacts
 * - reportSync.ts   — syncPlanDocument, syncReviewReport, syncResultReport
 * - implementWorkflow.ts — startReviewBranch, approveAndStartImplementation, approveImplPlan, requestPlanRevision
 * - reviewWorkflow.ts   — startReviewRT, processReviewVerdict, scanMessagesForMarkers
 */
export * from "./workflow/index";
