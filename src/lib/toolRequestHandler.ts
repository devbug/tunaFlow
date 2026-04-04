/**
 * Tool request handler — processes `<!-- tunaflow:tool-request:TYPE:QUERY -->` markers.
 *
 * When an agent outputs a tool-request marker, this handler:
 * 1. Calls the appropriate backend (context-hub, rawq, code-review-graph)
 * 2. Formats results
 * 3. Returns a follow-up prompt for the next turn
 */

import { invoke } from "@tauri-apps/api/core";
import type { ToolRequest } from "@/lib/planProposalParser";

interface HubSearchResult {
  id: string;
  title: string;
  snippet: string;
}

interface HubDocument {
  id: string;
  title: string;
  content: string;
}

/** Execute tool requests and return formatted results as a follow-up prompt. */
export async function executeToolRequests(requests: ToolRequest[]): Promise<string | null> {
  const results: string[] = [];

  for (const req of requests.slice(0, 3)) {
    try {
      if (req.type === "docs") {
        const hits = await invoke<HubSearchResult[]>(
          "context_hub_search", { query: req.query, sourceFilter: null, limit: 3 }
        );
        if (hits.length > 0) {
          const doc = await invoke<HubDocument>(
            "context_hub_get", { documentId: hits[0].id }
          ).catch(() => null);
          if (doc) {
            results.push(`## 📚 ${doc.title}\n\n${doc.content.slice(0, 4000)}`);
          } else {
            results.push(`## 📚 ${hits[0].title}\n\n${hits[0].snippet}`);
          }
        } else {
          results.push(`> "${req.query}" 관련 문서를 찾지 못했습니다.`);
        }
      } else if (req.type === "rawq") {
        const { useChatStore } = await import("@/stores/chatStore");
        const pk = useChatStore.getState().selectedProjectKey;
        if (pk) {
          const project = await invoke<{ path?: string }>("get_project", { key: pk });
          if (project.path) {
            const searchResult = await invoke<string>("search_rawq", {
              projectPath: project.path, query: req.query, limit: 5,
            }).catch(() => "");
            if (searchResult) {
              results.push(`## 🔍 코드 검색: "${req.query}"\n\n${searchResult.slice(0, 3000)}`);
            }
          }
        }
      } else if (req.type === "graph") {
        const { useChatStore } = await import("@/stores/chatStore");
        const pk = useChatStore.getState().selectedProjectKey;
        if (pk) {
          const project = await invoke<{ path?: string }>("get_project", { key: pk });
          if (project.path) {
            const parts = req.query.split(/\s+/, 2);
            const pattern = parts[0] || "callers_of";
            const target = parts[1] || req.query;
            const graphResult = await invoke<string>("crg_query", {
              projectPath: project.path, pattern, target,
            }).catch(() => "");
            if (graphResult) {
              results.push(`## 🔗 Graph: ${pattern}("${target}")\n\n${graphResult.slice(0, 3000)}`);
            }
          }
        }
      } else if (req.type === "plans") {
        const { useChatStore } = await import("@/stores/chatStore");
        const convId = useChatStore.getState().selectedConversationId;
        if (convId) {
          const plans = await invoke<{ id: string; title: string; status: string; phase: string }[]>(
            "list_plans_by_conversation", { conversationId: convId }
          ).catch(() => []);
          const donePlans = plans.filter((p) => p.status === "done");
          if (donePlans.length > 0) {
            const lines = donePlans.map((p) => `- ✅ "${p.title}" (완료)`);
            results.push([
              `## 📋 완료된 플랜 (${donePlans.length}개)`,
              "",
              ...lines,
              "",
              "> 후속 작업은 새 plan-proposal 마커로 제안하세요. 완료된 플랜에 subtask를 추가하지 마세요.",
            ].join("\n"));
          } else {
            results.push("> 완료된 플랜이 없습니다. 새 plan-proposal을 자유롭게 제안하세요.");
          }
        }
      }
    } catch (e) {
      console.warn(`[tool-request] ${req.type}:${req.query} failed:`, e);
    }
  }

  if (results.length === 0) return null;

  return [
    `### 🛠️ 도구 호출 결과`,
    "",
    ...results,
    "",
    "> 위 정보를 참고하여 작업을 계속하세요.",
  ].join("\n");
}
