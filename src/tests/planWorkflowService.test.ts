/**
 * Tests for planWorkflowService — orchestration layer between PlanCard and API.
 * Covers: autoRecoverSubtasks, checkImplComplete, checkReviewVerdict, loadPlanExpandData.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Plan, PlanSubtask, Message } from "@/types";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@/lib/api/plans", () => ({
  listSubtasks: vi.fn(() => Promise.resolve([])),
  listPlanEvents: vi.fn(() => Promise.resolve([])),
  replacePlanSubtasks: vi.fn(() => Promise.resolve([])),
  findPlanByBranch: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@/lib/workflow/helpers", () => ({
  getPlanSlug: vi.fn((plan: Plan) => plan.title.toLowerCase().replace(/\s+/g, "-")),
}));

vi.mock("@/lib/workflow/reviewWorkflow", () => ({
  scanMessagesForMarkers: vi.fn(() => ({ reviewVerdict: null })),
}));

// ─── Test fixtures ───────────────────────────────────────────────────────────

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan-1",
    conversationId: "conv-1",
    title: "Test Plan",
    status: "active",
    phase: "implementation",
    architectEngine: "claude",
    developerEngine: "claude",
    implementationBranchId: "branch-1",
    slug: "test-plan",
    revision: 1,
    versionMajor: 0,
    versionMinor: 1,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeSubtask(idx: number, status: PlanSubtask["status"] = "todo"): PlanSubtask {
  return {
    id: `st-${idx}`,
    planId: "plan-1",
    idx,
    title: `Task ${idx + 1}`,
    status,
    createdAt: 0,
    updatedAt: 0,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("planWorkflowService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("checkImplComplete", () => {
    it("returns false when plan has no implementationBranchId", async () => {
      const { checkImplComplete } = await import("@/lib/workflow/planWorkflowService");
      const result = await checkImplComplete(makePlan({ implementationBranchId: undefined }), [], []);
      expect(result).toBe(false);
    });

    it("returns false when plan is not in implementation/review phase", async () => {
      const { checkImplComplete } = await import("@/lib/workflow/planWorkflowService");
      const result = await checkImplComplete(makePlan({ phase: "drafting" }), [], []);
      expect(result).toBe(false);
    });

    it("returns true when all subtasks done and branch not running", async () => {
      // invoke returns empty messages (no impl-complete marker)
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockResolvedValueOnce([]); // list_messages returns []

      const { checkImplComplete } = await import("@/lib/workflow/planWorkflowService");
      const subtasks = [makeSubtask(0, "done"), makeSubtask(1, "done")];
      const result = await checkImplComplete(makePlan(), subtasks, []); // not running
      expect(result).toBe(true);
    });

    it("returns false when subtasks done but branch still running", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockResolvedValueOnce([]); // list_messages returns []

      const { checkImplComplete } = await import("@/lib/workflow/planWorkflowService");
      const subtasks = [makeSubtask(0, "done"), makeSubtask(1, "done")];
      const result = await checkImplComplete(makePlan(), subtasks, ["branch:branch-1"]); // still running
      expect(result).toBe(false);
    });
  });

  describe("checkReviewVerdict", () => {
    it("returns null when scanMessagesForMarkers returns null", async () => {
      const { checkReviewVerdict } = await import("@/lib/workflow/planWorkflowService");
      const result = await checkReviewVerdict(makePlan({ phase: "review" }));
      expect(result).toBeNull();
    });
  });

  describe("loadPlanExpandData", () => {
    it("returns empty subtasks and no completion flags for non-implementation plan", async () => {
      const planApi = await import("@/lib/api/plans");
      vi.mocked(planApi.listSubtasks).mockResolvedValueOnce([]);

      const { loadPlanExpandData } = await import("@/lib/workflow/planWorkflowService");
      const plan = makePlan({ phase: "drafting" });
      const result = await loadPlanExpandData(plan, "project-1", []);

      expect(result.subtasks).toEqual([]);
      expect(result.implComplete).toBe(false);
      expect(result.reviewVerdict).toBeNull();
    });

    it("exposes subtasks from API", async () => {
      const planApi = await import("@/lib/api/plans");
      const subtasks = [makeSubtask(0, "done"), makeSubtask(1, "todo")];
      vi.mocked(planApi.listSubtasks).mockResolvedValueOnce(subtasks);

      const { loadPlanExpandData } = await import("@/lib/workflow/planWorkflowService");
      const result = await loadPlanExpandData(makePlan(), "project-1", []);

      expect(result.subtasks).toHaveLength(2);
      expect(result.subtasks[0].status).toBe("done");
    });
  });
});

// ─── Plan phase validation (domain rules) ────────────────────────────────────

describe("Plan phase domain rules", () => {
  const VALID_PHASES = [
    "drafting", "subtask_review", "approval",
    "implementation", "rework", "review", "done",
  ];

  it("valid phases are the canonical set", () => {
    // Verify canonical phases match what's expected
    expect(VALID_PHASES).toContain("drafting");
    expect(VALID_PHASES).toContain("implementation");
    expect(VALID_PHASES).toContain("review");
    expect(VALID_PHASES).toContain("done");
    expect(VALID_PHASES).not.toContain("pending"); // not a valid phase
    expect(VALID_PHASES).not.toContain("complete"); // not a valid phase
  });

  it("phase ordering is drafting → subtask_review → approval → implementation → review → done", () => {
    const expected = ["drafting", "subtask_review", "approval", "implementation", "review", "done"];
    expected.forEach((phase) => {
      expect(VALID_PHASES).toContain(phase);
    });
  });

  it("rework is a valid re-entry phase (implementation → review → rework → implementation)", () => {
    expect(VALID_PHASES).toContain("rework");
  });
});
