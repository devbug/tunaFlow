#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import Database from "better-sqlite3";
import { execSync, spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";

const DB_PATH = join(homedir(), "Library/Application Support/com.tunaflow.app/tunaflow.db");

function getDb() {
  return new Database(DB_PATH, { readonly: true });
}

const server = new Server(
  { name: "tunaflow-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ── Tools ────────────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_projects",
      description: "tunaFlow 프로젝트 목록 조회",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_conversations",
      description: "프로젝트의 대화 목록 조회",
      inputSchema: {
        type: "object",
        properties: { projectKey: { type: "string" } },
        required: ["projectKey"],
      },
    },
    {
      name: "get_messages",
      description: "대화의 메시지 조회 (최근 N개)",
      inputSchema: {
        type: "object",
        properties: {
          conversationId: { type: "string" },
          limit: { type: "number", default: 20 },
        },
        required: ["conversationId"],
      },
    },
    {
      name: "query_db",
      description: "tunaFlow SQLite DB에 읽기 전용 SQL 쿼리 실행",
      inputSchema: {
        type: "object",
        properties: { sql: { type: "string" } },
        required: ["sql"],
      },
    },
    {
      name: "run_roundtable",
      description: "Sequential Roundtable 토론 실행. 여러 에이전트가 순차로 의견을 제시",
      inputSchema: {
        type: "object",
        properties: {
          topic: { type: "string", description: "토론 주제" },
          participants: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                engine: { type: "string", enum: ["claude", "codex", "gemini"] },
                model: { type: "string" },
              },
              required: ["name", "engine"],
            },
          },
          rounds: { type: "number", default: 1 },
          projectPath: { type: "string", description: "프로젝트 경로 (CLI cwd)" },
        },
        required: ["topic", "participants"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "list_projects") {
    const db = getDb();
    const rows = db.prepare("SELECT key, name, path FROM projects WHERE hidden = 0 ORDER BY updated_at DESC").all();
    db.close();
    return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
  }

  if (name === "list_conversations") {
    const db = getDb();
    const rows = db.prepare(
      "SELECT id, label, mode, type, usage_status FROM conversations WHERE project_key = ? ORDER BY updated_at DESC LIMIT 20"
    ).all(args.projectKey);
    db.close();
    return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
  }

  if (name === "get_messages") {
    const db = getDb();
    const limit = args.limit || 20;
    const rows = db.prepare(
      "SELECT id, role, content, engine, persona, status, timestamp FROM messages WHERE conversation_id = ? ORDER BY timestamp DESC LIMIT ?"
    ).all(args.conversationId, limit);
    db.close();
    return { content: [{ type: "text", text: JSON.stringify(rows.reverse(), null, 2) }] };
  }

  if (name === "query_db") {
    const db = getDb();
    try {
      const rows = db.prepare(args.sql).all();
      db.close();
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    } catch (e) {
      db.close();
      return { content: [{ type: "text", text: `SQL Error: ${e.message}` }] };
    }
  }

  if (name === "run_roundtable") {
    const { topic, participants, rounds = 1, projectPath } = args;
    const transcript = [];

    for (let round = 0; round < rounds; round++) {
      for (const p of participants) {
        // Build prompt with transcript context
        let prompt = `## Roundtable Discussion\n\n**Topic:** ${topic}\n**Round:** ${round + 1}/${rounds}\n**You are:** ${p.name} (${p.engine})\n\n`;

        if (transcript.length > 0) {
          prompt += "### Previous responses:\n\n";
          for (const t of transcript) {
            prompt += `**${t.name} (${t.engine}):**\n${t.content}\n\n`;
          }
        }

        prompt += `Please provide your perspective on this topic. Be concise and specific.`;

        // Execute CLI agent
        try {
          const result = runAgent(p.engine, prompt, p.model, projectPath);
          transcript.push({ name: p.name, engine: p.engine, round: round + 1, content: result });
        } catch (e) {
          transcript.push({ name: p.name, engine: p.engine, round: round + 1, content: `Error: ${e.message}` });
        }
      }
    }

    // Format result
    let output = `# Roundtable: ${topic}\n\n`;
    for (const t of transcript) {
      output += `## ${t.name} (${t.engine}) — Round ${t.round}\n\n${t.content}\n\n---\n\n`;
    }

    return { content: [{ type: "text", text: output }] };
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
});

// ── CLI Agent execution ──────────────────────────────────────────────────────

function runAgent(engine, prompt, model, cwd) {
  const cmd = buildCommand(engine, prompt, model);
  const options = { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, timeout: 300000 };
  if (cwd) options.cwd = cwd;

  const result = execSync(cmd, options);
  return parseOutput(engine, result);
}

function buildCommand(engine, prompt, model) {
  // Escape prompt for shell
  const escaped = prompt.replace(/'/g, "'\\''");

  switch (engine) {
    case "claude":
      return `claude -p '${escaped}' --output-format json${model ? ` --model ${model}` : ""} --permission-mode bypassPermissions`;
    case "codex":
      return `echo '${escaped}' | codex exec --json --skip-git-repo-check --full-auto${model ? ` --model ${model}` : ""} -`;
    case "gemini":
      return `gemini -p '${escaped}'${model ? ` --model ${model}` : ""} -y`;
    default:
      throw new Error(`Unsupported engine: ${engine}`);
  }
}

function parseOutput(engine, output) {
  if (engine === "claude") {
    try {
      const parsed = JSON.parse(output.trim());
      return parsed.result || output.trim();
    } catch {
      return output.trim();
    }
  }
  if (engine === "codex") {
    // Codex outputs JSONL — find the last agent_message
    const lines = output.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const event = JSON.parse(lines[i]);
        if (event.type === "item.completed" && event.item?.type === "agent_message") {
          return event.item.content?.map(c => c.text).join("") || lines[i];
        }
      } catch { continue; }
    }
    return output.trim();
  }
  // gemini — plain text
  return output.trim();
}

// ── Start server ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
