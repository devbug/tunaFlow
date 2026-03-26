import { invoke } from "@tauri-apps/api/core";
import type { Plan, PlanSubtask, CreatePlanInput } from "@/types";

export async function listPlansByConversation(conversationId: string): Promise<Plan[]> {
  return invoke<Plan[]>("list_plans_by_conversation", { conversationId });
}

export async function createPlan(input: CreatePlanInput): Promise<Plan> {
  return invoke<Plan>("create_plan", { input });
}

export async function updatePlanStatus(id: string, status: string): Promise<void> {
  return invoke("update_plan_status", { input: { id, status } });
}

export async function listSubtasks(planId: string): Promise<PlanSubtask[]> {
  return invoke<PlanSubtask[]>("list_subtasks", { planId });
}

export async function updateSubtaskStatus(
  id: string,
  status: string,
  outcome: string | null = null,
): Promise<void> {
  return invoke("update_subtask_status", { input: { id, status, outcome } });
}

export async function setSubtaskOwner(
  id: string,
  ownerAgent: string | null,
): Promise<void> {
  return invoke("set_subtask_owner", { id, ownerAgent });
}
