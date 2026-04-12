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
      } else if (req.type === "memory") {
        // Tier 2 Pull: compressed conversation memory by topic
        const { useChatStore } = await import("@/stores/chatStore");
        const convId = useChatStore.getState().selectedConversationId;
        if (convId) {
          const topics = await invoke<{ topic: string; summary: string }[]>(
            "list_memory_topics", { conversationId: convId }
          ).catch(() => []);
          const matched = topics.filter((t) =>
            t.topic.toLowerCase().includes(req.query.toLowerCase()) ||
            t.summary.toLowerCase().includes(req.query.toLowerCase())
          ).slice(0, 3);
          if (matched.length > 0) {
            const lines = matched.map((t) => `### ${t.topic}\n${t.summary.slice(0, 800)}`);
            results.push(`## 🧠 대화 기억: "${req.query}"\n\n${lines.join("\n\n")}`);
          } else {
            results.push(`> "${req.query}" 관련 대화 기억을 찾지 못했습니다.`);
          }
        }
      } else if (req.type === "sessions") {
        // Tier 2 Pull: cross-session search
        const { useChatStore } = await import("@/stores/chatStore");
        const convId = useChatStore.getState().selectedConversationId;
        const pk = useChatStore.getState().selectedProjectKey;
        if (convId && pk) {
          const links = await invoke<{ linkedConvId: string; score: number; method: string }[]>(
            "get_session_links", { conversationId: convId }
          ).catch(() => []);
          if (links.length > 0) {
            const lines = links.slice(0, 5).map((l) => `- ${l.linkedConvId} (score: ${l.score.toFixed(2)}, ${l.method})`);
            results.push(`## 🔗 관련 세션 (${links.length}개)\n\n${lines.join("\n")}`);
          } else {
            results.push(`> 관련 세션을 찾지 못했습니다.`);
          }
        }
      } else if (req.type === "skills") {
        // Tier 2 Pull: search skills by keyword
        const { useChatStore } = await import("@/stores/chatStore");
        const allSkills = useChatStore.getState().skills ?? [];
        const matched = allSkills.filter((s) =>
          s.name?.toLowerCase().includes(req.query.toLowerCase()) ||
          s.description?.toLowerCase().includes(req.query.toLowerCase())
        ).slice(0, 3);
        if (matched.length > 0) {
          const lines = matched.map((s) => `### ${s.name}\n${(s.content ?? s.description ?? "").slice(0, 1000)}`);
          results.push(`## 📖 스킬: "${req.query}"\n\n${lines.join("\n\n")}`);
        } else {
          results.push(`> "${req.query}" 관련 스킬을 찾지 못했습니다.`);
        }
      } else if (req.type === "artifacts") {
        // Tier 2 Pull: fetch artifact by ID or search by title
        const { useChatStore } = await import("@/stores/chatStore");
        const artifacts = useChatStore.getState().artifacts ?? [];
        const matched = artifacts.filter((a) =>
          a.id === req.query || a.title?.toLowerCase().includes(req.query.toLowerCase())
        ).slice(0, 3);
        if (matched.length > 0) {
          const lines = matched.map((a) => `### ${a.title} (${a.type}, ${a.status})\n${(a.content ?? "").slice(0, 1500)}`);
          results.push(`## 📦 아티팩트: "${req.query}"\n\n${lines.join("\n\n")}`);
        } else {
          results.push(`> "${req.query}" 관련 아티팩트를 찾지 못했습니다.`);
        }
      } else if (req.type === "lessons") {
        // Tier 2 Pull: failure lessons by pattern
        const pk = (await import("@/stores/chatStore")).useChatStore.getState().selectedProjectKey;
        if (pk) {
          const lessons = await invoke<{ pattern: string; finding: string; resolution: string | null }[]>(
            "search_similar_failures", { projectKey: pk, query: req.query, filePaths: [], limit: 3 }
          ).catch(() => []);
          if (lessons.length > 0) {
            const lines = lessons.map((l) => `- **${l.pattern}**: ${l.finding}${l.resolution ? ` → ${l.resolution}` : ""}`);
            results.push(`## ⚠️ 과거 실패 패턴: "${req.query}"\n\n${lines.join("\n")}`);
          } else {
            results.push(`> "${req.query}" 관련 실패 패턴이 없습니다.`);
          }
        }
      } else if (req.type === "insight-update") {
        // Format: FINDING_ID|STATUS|NOTE
        // STATUS: resolved|skipped|discarded|in_progress
        const parts = req.query.split("|");
        const findingId = parts[0]?.trim();
        const status = parts[1]?.trim();
        const note = parts[2]?.trim() ?? "";
        const validStatuses = ["resolved", "skipped", "discarded", "in_progress"];
        if (findingId && status && validStatuses.includes(status)) {
          await invoke("update_insight_finding_status", { id: findingId, status, resolution: note || null })
            .catch((e) => console.warn("[insight-update] failed:", e));
          results.push(`> ✅ Insight finding \`${findingId}\` → **${status}**${note ? ` (${note})` : ""}`);
          // Notify Meta badge that an insight task was dispatched
          window.dispatchEvent(new CustomEvent("tunaflow:meta-task"));
        } else {
          results.push(`> ⚠️ insight-update 형식 오류: \`FINDING_ID|STATUS|NOTE\` 형식이어야 합니다. (STATUS: resolved|skipped|discarded|in_progress)`);
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
