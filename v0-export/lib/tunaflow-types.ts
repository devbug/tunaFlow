export type AgentEngine = "Claude" | "Codex" | "Gemini" | "OpenCode";

export type MessageRole = "user" | "agent" | "system";

export type ArtifactStatus = "draft" | "approved" | "rejected";

export interface Agent {
  id: string;
  name: string;
  engine: AgentEngine;
  model: string;
  color: string;
}

export interface Branch {
  id: string;
  label: string;
  parentMessageId: string;
  messageCount: number;
  isActive: boolean;
  children?: Branch[];
}

export interface Artifact {
  id: string;
  title: string;
  status: ArtifactStatus;
  excerpt: string;
  updatedAt: string;
}

export interface Memo {
  id: string;
  content: string;
  createdAt: string;
  pinned: boolean;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export interface CrossSession {
  id: string;
  title: string;
  date: string;
  included: boolean;
}

export interface Message {
  id: string;
  role: MessageRole;
  agent?: Agent;
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  branchCount?: number;
  memoCount?: number;
  roundtableRound?: number;
}

export interface RoundtableParticipant {
  agent: Agent;
  messages: Message[];
}

export interface Conversation {
  id: string;
  title: string;
  type: "chat" | "roundtable";
  updatedAt: string;
  isActive?: boolean;
}

export interface Project {
  id: string;
  name: string;
  conversations: Conversation[];
  isExpanded?: boolean;
}

export const AGENTS: Record<string, Agent> = {
  claude: {
    id: "claude",
    name: "Claude",
    engine: "Claude",
    model: "claude-opus-4",
    color: "agent-claude",
  },
  codex: {
    id: "codex",
    name: "Codex",
    engine: "Codex",
    model: "gpt-4o",
    color: "agent-codex",
  },
  gemini: {
    id: "gemini",
    name: "Gemini",
    engine: "Gemini",
    model: "gemini-2.0-flash",
    color: "agent-gemini",
  },
  opencode: {
    id: "opencode",
    name: "OpenCode",
    engine: "OpenCode",
    model: "opencode-1.5",
    color: "agent-opencode",
  },
};

export const AGENT_COLORS: Record<AgentEngine, string> = {
  Claude: "text-agent-claude border-agent-claude/30 bg-agent-claude/10",
  Codex: "text-agent-codex border-agent-codex/30 bg-agent-codex/10",
  Gemini: "text-agent-gemini border-agent-gemini/30 bg-agent-gemini/10",
  OpenCode: "text-agent-opencode border-agent-opencode/30 bg-agent-opencode/10",
};

export const AGENT_DOT_COLORS: Record<AgentEngine, string> = {
  Claude: "bg-agent-claude",
  Codex: "bg-agent-codex",
  Gemini: "bg-agent-gemini",
  OpenCode: "bg-agent-opencode",
};
