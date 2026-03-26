import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import * as planApi from "@/lib/api/plans";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("plans API layer", () => {
  it("listPlansByConversation calls correct command", async () => {
    mockInvoke.mockResolvedValue([]);
    await planApi.listPlansByConversation("conv-1");
    expect(mockInvoke).toHaveBeenCalledWith("list_plans_by_conversation", {
      conversationId: "conv-1",
    });
  });

  it("createPlan passes full input", async () => {
    mockInvoke.mockResolvedValue({ id: "p1" });
    await planApi.createPlan({
      conversationId: "conv-1",
      title: "Test Plan",
      subtasks: [{ title: "Task 1" }],
    });
    expect(mockInvoke).toHaveBeenCalledWith("create_plan", {
      input: {
        conversationId: "conv-1",
        title: "Test Plan",
        subtasks: [{ title: "Task 1" }],
      },
    });
  });

  it("createPlan passes branchId when provided", async () => {
    mockInvoke.mockResolvedValue({ id: "p2" });
    await planApi.createPlan({
      conversationId: "conv-1",
      branchId: "br-1",
      title: "Branch Plan",
      subtasks: [],
    });
    expect(mockInvoke).toHaveBeenCalledWith("create_plan", {
      input: expect.objectContaining({ branchId: "br-1" }),
    });
  });

  it("updatePlanStatus sends correct payload", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await planApi.updatePlanStatus("p1", "active");
    expect(mockInvoke).toHaveBeenCalledWith("update_plan_status", {
      input: { id: "p1", status: "active" },
    });
  });

  it("listSubtasks uses planId", async () => {
    mockInvoke.mockResolvedValue([]);
    await planApi.listSubtasks("plan-1");
    expect(mockInvoke).toHaveBeenCalledWith("list_subtasks", { planId: "plan-1" });
  });

  it("updateSubtaskStatus with default outcome", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await planApi.updateSubtaskStatus("st1", "done");
    expect(mockInvoke).toHaveBeenCalledWith("update_subtask_status", {
      input: { id: "st1", status: "done", outcome: null },
    });
  });
});
