import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  Project,
  Conversation,
  Message,
  Branch,
  Memo,
  Artifact,
  SkillDef,
  CreateProjectInput,
  CreateConversationInput,
  CreateBranchInput,
  SendWithClaudeInput,
  RoundtableRunInput,
  RtMode,
  AdoptBranchInput,
  CreateMemoInput,
  CreateArtifactInput,
  UpdateArtifactStatusInput,
} from "../types";
import { ROUNDTABLE_PARTICIPANTS } from "../lib/constants";

interface ChatState {
  projects: Project[];
  selectedProjectKey: string | null;
  conversations: Conversation[];
  selectedConversationId: string | null;
  messages: Message[];
  branches: Branch[];
  isRunning: boolean;
  error: string | null;
  /** Branch stream mode — set when user "opens" a branch for chatting */
  activeBranchId: string | null;
  /** Conversation to restore when closing the branch stream */
  parentConversationId: string | null;
  /** Thread drawer state — sliding panel showing branch messages anchored to a parent message */
  threadBranchId: string | null;
  threadBranchConvId: string | null;
  threadMessages: Message[];
  threadBranchLabel: string | null;
  threadParentMessage: Message | null;
  memos: Memo[];
  artifacts: Artifact[];
  skills: SkillDef[];
  activeSkills: string[];
  crossSessionIds: string[];

  loadProjects: () => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<void>;
  selectProject: (key: string) => Promise<void>;
  createConversation: (input: CreateConversationInput) => Promise<Conversation>;
  deleteConversation: (id: string) => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  sendMessage: (prompt: string, model?: string, systemPrompt?: string) => Promise<void>;
  sendWithCodex: (prompt: string, model?: string) => Promise<void>;
  sendWithGemini: (prompt: string, model?: string) => Promise<void>;
  sendWithOpencode: (prompt: string, model?: string) => Promise<void>;
  sendRoundtable: (prompt: string, rounds?: number, mode?: RtMode) => Promise<void>;
  sendRoundtableFollowup: (prompt: string, mode?: RtMode) => Promise<void>;
  loadBranches: (conversationId: string) => Promise<void>;
  createBranch: (conversationId: string, checkpointId?: string) => Promise<void>;
  deleteBranch: (branchId: string) => Promise<void>;
  adoptBranch: (branchId: string, conversationId: string) => Promise<void>;
  openBranchStream: (branchId: string) => Promise<void>;
  closeBranchStream: () => Promise<void>;
  openThread: (branchId: string) => Promise<void>;
  closeThread: () => void;
  sendThreadMessage: (prompt: string, engine?: string, model?: string) => Promise<void>;
  cancelOperation: () => Promise<void>;
  // Cross-session
  toggleCrossSession: (conversationId: string) => void;
  // Skill
  loadSkills: () => Promise<void>;
  toggleSkill: (name: string) => void;
  // Memo
  loadMemos: () => Promise<void>;
  createMemo: (messageId: string, content: string) => Promise<void>;
  deleteMemo: (id: string) => Promise<void>;
  // Artifact
  loadArtifacts: () => Promise<void>;
  createArtifact: (input: CreateArtifactInput) => Promise<void>;
  updateArtifactStatus: (id: string, status: "draft" | "approved" | "rejected") => Promise<void>;
  deleteArtifact: (id: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  projects: [],
  selectedProjectKey: null,
  conversations: [],
  selectedConversationId: null,
  messages: [],
  branches: [],
  isRunning: false,
  error: null,
  activeBranchId: null,
  parentConversationId: null,
  threadBranchId: null,
  threadBranchConvId: null,
  threadMessages: [],
  threadBranchLabel: null,
  threadParentMessage: null,
  memos: [],
  artifacts: [],
  skills: [],
  activeSkills: [],
  crossSessionIds: [],

  loadProjects: async () => {
    try {
      const projects = await invoke<Project[]>("list_projects");
      set({ projects, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createProject: async (input: CreateProjectInput) => {
    try {
      await invoke<Project>("create_project", { input });
      await get().loadProjects();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  selectProject: async (key: string) => {
    set({ selectedProjectKey: key, selectedConversationId: null, messages: [], branches: [] });
    try {
      const conversations = await invoke<Conversation[]>("list_conversations", {
        projectKey: key,
      });
      set({ conversations, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createConversation: async (input: CreateConversationInput) => {
    const conv = await invoke<Conversation>("create_conversation", { input });
    const projectKey = get().selectedProjectKey;
    if (projectKey) {
      const conversations = await invoke<Conversation[]>("list_conversations", {
        projectKey,
      });
      set({ conversations });
    }
    return conv;
  },

  deleteConversation: async (id: string) => {
    try {
      await invoke("delete_conversation", { id });
      const { selectedProjectKey, selectedConversationId } = get();
      // Refresh conversation list
      if (selectedProjectKey) {
        const conversations = await invoke<Conversation[]>("list_conversations", {
          projectKey: selectedProjectKey,
        });
        set({ conversations });
      }
      // Clear selection if deleted conversation was selected
      if (selectedConversationId === id) {
        set({
          selectedConversationId: null,
          messages: [],
          branches: [],
          memos: [],
          artifacts: [],
          crossSessionIds: get().crossSessionIds.filter((cid) => cid !== id),
        });
      } else {
        // Remove from cross-session if it was included
        set({ crossSessionIds: get().crossSessionIds.filter((cid) => cid !== id) });
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  selectConversation: async (id: string) => {
    set({ selectedConversationId: id, messages: [], branches: [], memos: [], artifacts: [] });
    try {
      const [messages, branches, memos, artifacts] = await Promise.all([
        invoke<Message[]>("list_messages", { conversationId: id }),
        invoke<Branch[]>("list_branches", { conversationId: id }),
        invoke<Memo[]>("list_memos_by_conversation", { conversationId: id }),
        invoke<Artifact[]>("list_artifacts", { conversationId: id }),
      ]);
      set({ messages, branches, memos, artifacts, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  sendMessage: async (prompt: string, model?: string, systemPrompt?: string) => {
    const { selectedProjectKey, selectedConversationId } = get();
    if (!selectedProjectKey || !selectedConversationId) return;

    // Optimistic: show user message immediately
    const tempUserMsg: Message = {
      id: `temp-user-${Date.now()}`,
      conversationId: selectedConversationId,
      role: "user",
      content: prompt,
      timestamp: Date.now(),
      status: "done",
    };
    set((state) => ({
      isRunning: true,
      error: null,
      messages: [...state.messages, tempUserMsg],
    }));

    // Subscribe to streaming chunks before invoking the command
    const unlisten = await listen<{ messageId: string; text: string }>(
      "claude:chunk",
      (event) => {
        const { messageId, text } = event.payload;
        set((state) => {
          const existing = state.messages.find((m) => m.id === messageId);
          if (existing) {
            return {
              messages: state.messages.map((m) =>
                m.id === messageId ? { ...m, content: text } : m
              ),
            };
          }
          // Streaming placeholder not yet in list — add it as a new streaming message
          const streamingMsg: Message = {
            id: messageId,
            conversationId: selectedConversationId,
            role: "assistant",
            content: text,
            timestamp: Date.now(),
            status: "streaming",
            engine: "claude-code",
            model,
          };
          return { messages: [...state.messages, streamingMsg] };
        });
      }
    );

    try {
      const input: SendWithClaudeInput = {
        projectKey: selectedProjectKey,
        conversationId: selectedConversationId,
        prompt,
        model,
        systemPrompt,
        activeSkills: get().activeSkills,
        crossSessionIds: get().crossSessionIds,
      };
      const assistantMsg = await invoke<Message>("stream_with_claude", { input });
      // Load final messages from DB to replace temp + streaming states
      const messages = await invoke<Message[]>("list_messages", {
        conversationId: selectedConversationId,
      });
      set({ messages, isRunning: false });
    } catch (e) {
      set({ error: String(e), isRunning: false });
    } finally {
      unlisten();
    }
  },

  sendWithCodex: async (prompt: string, model?: string) => {
    const { selectedProjectKey, selectedConversationId } = get();
    if (!selectedProjectKey || !selectedConversationId) return;
    const tempUserMsg: Message = {
      id: `temp-user-${Date.now()}`,
      conversationId: selectedConversationId,
      role: "user",
      content: prompt,
      timestamp: Date.now(),
      status: "done",
    };
    set((state) => ({
      isRunning: true,
      error: null,
      messages: [...state.messages, tempUserMsg],
    }));
    try {
      const input: SendWithClaudeInput = {
        projectKey: selectedProjectKey,
        conversationId: selectedConversationId,
        prompt,
        model,
      };
      await invoke<Message>("send_with_codex", { input });
      const messages = await invoke<Message[]>("list_messages", {
        conversationId: selectedConversationId,
      });
      set({ messages, isRunning: false });
    } catch (e) {
      set({ error: String(e), isRunning: false });
    }
  },

  sendWithGemini: async (prompt: string, model?: string) => {
    const { selectedProjectKey, selectedConversationId } = get();
    if (!selectedProjectKey || !selectedConversationId) return;
    const tempUserMsg: Message = {
      id: `temp-user-${Date.now()}`,
      conversationId: selectedConversationId,
      role: "user",
      content: prompt,
      timestamp: Date.now(),
      status: "done",
    };
    set((state) => ({
      isRunning: true,
      error: null,
      messages: [...state.messages, tempUserMsg],
    }));
    try {
      const input: SendWithClaudeInput = {
        projectKey: selectedProjectKey,
        conversationId: selectedConversationId,
        prompt,
        model,
      };
      await invoke<Message>("send_with_gemini", { input });
      const messages = await invoke<Message[]>("list_messages", {
        conversationId: selectedConversationId,
      });
      set({ messages, isRunning: false });
    } catch (e) {
      set({ error: String(e), isRunning: false });
    }
  },

  sendWithOpencode: async (prompt: string, model?: string) => {
    const { selectedProjectKey, selectedConversationId } = get();
    if (!selectedProjectKey || !selectedConversationId) return;
    const tempUserMsg: Message = {
      id: `temp-user-${Date.now()}`,
      conversationId: selectedConversationId,
      role: "user",
      content: prompt,
      timestamp: Date.now(),
      status: "done",
    };
    set((state) => ({
      isRunning: true,
      error: null,
      messages: [...state.messages, tempUserMsg],
    }));
    try {
      const input: SendWithClaudeInput = {
        projectKey: selectedProjectKey,
        conversationId: selectedConversationId,
        prompt,
        model,
      };
      await invoke<Message>("send_with_opencode", { input });
      const messages = await invoke<Message[]>("list_messages", {
        conversationId: selectedConversationId,
      });
      set({ messages, isRunning: false });
    } catch (e) {
      set({ error: String(e), isRunning: false });
    }
  },

  sendRoundtable: async (prompt: string, rounds?: number, mode?: RtMode) => {
    const { selectedConversationId } = get();
    if (!selectedConversationId) return;

    // Optimistic user message so the UI is never blank
    const tempUserMsg: Message = {
      id: `temp-user-${Date.now()}`,
      conversationId: selectedConversationId,
      role: "user",
      content: prompt,
      timestamp: Date.now(),
      status: "done",
    };
    set((state) => ({
      isRunning: true,
      error: null,
      messages: [...state.messages, tempUserMsg],
    }));

    // Listen for per-participant progress so messages appear incrementally
    const unlisten = await listen<Message>("roundtable:progress", (event) => {
      const msg = event.payload;
      // Skip user messages (already shown optimistically)
      if (msg.role === "user") return;
      set((state) => ({ messages: [...state.messages, msg] }));
    });

    try {
      const input: RoundtableRunInput = {
        conversationId: selectedConversationId,
        prompt,
        participants: ROUNDTABLE_PARTICIPANTS,
        rounds,
        mode,
      };
      await invoke<Message[]>("roundtable_run", { input });
      // Reload canonical state from DB (replaces temp + streamed messages)
      const messages = await invoke<Message[]>("list_messages", {
        conversationId: selectedConversationId,
      });
      set({ messages, isRunning: false });
    } catch (e) {
      set({ error: String(e), isRunning: false });
    } finally {
      unlisten();
    }
  },

  sendRoundtableFollowup: async (prompt: string, mode?: RtMode) => {
    const { selectedConversationId } = get();
    if (!selectedConversationId) return;

    const tempUserMsg: Message = {
      id: `temp-user-${Date.now()}`,
      conversationId: selectedConversationId,
      role: "user",
      content: prompt,
      timestamp: Date.now(),
      status: "done",
    };
    set((state) => ({
      isRunning: true,
      error: null,
      messages: [...state.messages, tempUserMsg],
    }));

    const unlisten = await listen<Message>("roundtable:progress", (event) => {
      const msg = event.payload;
      if (msg.role === "user") return;
      set((state) => ({ messages: [...state.messages, msg] }));
    });

    try {
      const input: RoundtableRunInput = {
        conversationId: selectedConversationId,
        prompt,
        participants: ROUNDTABLE_PARTICIPANTS,
        mode,
      };
      await invoke<Message[]>("roundtable_followup", { input });
      const messages = await invoke<Message[]>("list_messages", {
        conversationId: selectedConversationId,
      });
      set({ messages, isRunning: false });
    } catch (e) {
      set({ error: String(e), isRunning: false });
    } finally {
      unlisten();
    }
  },

  loadBranches: async (conversationId: string) => {
    try {
      const branches = await invoke<Branch[]>("list_branches", { conversationId });
      set({ branches });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createBranch: async (conversationId: string, checkpointId?: string) => {
    try {
      const input: CreateBranchInput = { conversationId, checkpointId };
      await invoke<Branch>("create_branch", { input });
      const branches = await invoke<Branch[]>("list_branches", { conversationId });
      set({ branches });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteBranch: async (branchId: string) => {
    const { selectedConversationId, threadBranchId } = get();
    try {
      await invoke("delete_branch", { id: branchId });
      if (selectedConversationId) {
        const branches = await invoke<Branch[]>("list_branches", {
          conversationId: selectedConversationId,
        });
        set({ branches });
      }
      // Close thread drawer if the deleted branch was open
      if (threadBranchId === branchId) {
        set({
          threadBranchId: null,
          threadBranchConvId: null,
          threadMessages: [],
          threadBranchLabel: null,
          threadParentMessage: null,
        });
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  adoptBranch: async (branchId: string, conversationId: string) => {
    try {
      const input: AdoptBranchInput = { branchId, conversationId };
      await invoke("adopt_branch", { input });
      const [messages, branches] = await Promise.all([
        invoke<Message[]>("list_messages", { conversationId }),
        invoke<Branch[]>("list_branches", { conversationId }),
      ]);
      set({ messages, branches });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  openBranchStream: async (branchId: string) => {
    const { selectedConversationId } = get();
    if (!selectedConversationId) return;
    try {
      // Ensure shadow conversations row exists, get branch conv id
      const branchConvId = await invoke<string>("open_branch_stream", { branchId });
      const branchMessages = await invoke<Message[]>("list_messages", {
        conversationId: branchConvId,
      });
      set({
        parentConversationId: selectedConversationId,
        activeBranchId: branchId,
        selectedConversationId: branchConvId,
        messages: branchMessages,
        branches: [],
        error: null,
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  closeBranchStream: async () => {
    const { parentConversationId } = get();
    if (!parentConversationId) return;
    set({ activeBranchId: null, parentConversationId: null });
    await get().selectConversation(parentConversationId);
  },

  openThread: async (branchId: string) => {
    try {
      const branchConvId = await invoke<string>("open_branch_stream", { branchId });
      const branchMessages = await invoke<Message[]>("list_messages", {
        conversationId: branchConvId,
      });
      const branch = get().branches.find((b) => b.id === branchId);
      // Find parent message using branch.checkpointId
      const parentMsg = branch?.checkpointId
        ? get().messages.find((m) => m.id === branch.checkpointId) ?? null
        : null;
      set({
        threadBranchId: branchId,
        threadBranchConvId: branchConvId,
        threadMessages: branchMessages,
        threadBranchLabel: branch?.customLabel ?? branch?.label ?? branchId.slice(0, 12),
        threadParentMessage: parentMsg,
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  closeThread: () => {
    set({
      threadBranchId: null,
      threadBranchConvId: null,
      threadMessages: [],
      threadBranchLabel: null,
      threadParentMessage: null,
    });
  },

  sendThreadMessage: async (prompt: string, engine?: string, model?: string) => {
    const { threadBranchConvId, selectedProjectKey } = get();
    if (!threadBranchConvId || !selectedProjectKey) return;

    const tempMsg: Message = {
      id: `temp-thread-${Date.now()}`,
      conversationId: threadBranchConvId,
      role: "user",
      content: prompt,
      timestamp: Date.now(),
      status: "done",
    };
    set((state) => ({
      isRunning: true,
      threadMessages: [...state.threadMessages, tempMsg],
    }));

    try {
      const input: SendWithClaudeInput = {
        projectKey: selectedProjectKey,
        conversationId: threadBranchConvId,
        prompt,
        model,
      };
      const engineKey = engine ?? "claude";
      if (engineKey === "codex") {
        await invoke<Message>("send_with_codex", { input });
      } else if (engineKey === "gemini") {
        await invoke<Message>("send_with_gemini", { input });
      } else if (engineKey === "opencode") {
        await invoke<Message>("send_with_opencode", { input });
      } else {
        await invoke<Message>("stream_with_claude", { input });
      }
      const threadMessages = await invoke<Message[]>("list_messages", {
        conversationId: threadBranchConvId,
      });
      set({ threadMessages, isRunning: false });
    } catch (e) {
      set({ error: String(e), isRunning: false });
    }
  },

  cancelOperation: async () => {
    try {
      await invoke("cancel_running");
    } catch {
      // Best-effort: flag may not be consumed if nothing is running
    }
    const { selectedConversationId } = get();
    if (selectedConversationId) {
      const messages = await invoke<Message[]>("list_messages", {
        conversationId: selectedConversationId,
      });
      set({ messages, isRunning: false, error: null });
    } else {
      set({ isRunning: false, error: null });
    }
  },

  // ─── Cross-session ───────────────────────────────────────────────────────
  toggleCrossSession: (conversationId: string) => {
    set((state) => {
      const ids = state.crossSessionIds.includes(conversationId)
        ? state.crossSessionIds.filter((id) => id !== conversationId)
        : [...state.crossSessionIds, conversationId];
      return { crossSessionIds: ids };
    });
  },

  // ─── Skill ───────────────────────────────────────────────────────────────
  loadSkills: async () => {
    try {
      const skills = await invoke<SkillDef[]>("list_skills");
      set({ skills });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  toggleSkill: (name: string) => {
    set((state) => {
      const active = state.activeSkills.includes(name)
        ? state.activeSkills.filter((s) => s !== name)
        : [...state.activeSkills, name];
      return { activeSkills: active };
    });
  },

  // ─── Memo ────────────────────────────────────────────────────────────────
  loadMemos: async () => {
    const { selectedConversationId } = get();
    if (!selectedConversationId) return;
    try {
      const memos = await invoke<Memo[]>("list_memos_by_conversation", {
        conversationId: selectedConversationId,
      });
      set({ memos });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createMemo: async (messageId: string, content: string) => {
    const { selectedProjectKey, selectedConversationId } = get();
    if (!selectedProjectKey || !selectedConversationId) return;
    try {
      const input: CreateMemoInput = {
        messageId,
        conversationId: selectedConversationId,
        projectKey: selectedProjectKey,
        content,
      };
      await invoke<Memo>("create_memo", { input });
      await get().loadMemos();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteMemo: async (id: string) => {
    try {
      await invoke("delete_memo", { id });
      await get().loadMemos();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  // ─── Artifact ────────────────────────────────────────────────────────────
  loadArtifacts: async () => {
    const { selectedConversationId } = get();
    if (!selectedConversationId) return;
    try {
      const artifacts = await invoke<Artifact[]>("list_artifacts", {
        conversationId: selectedConversationId,
      });
      set({ artifacts });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createArtifact: async (input: CreateArtifactInput) => {
    try {
      await invoke<Artifact>("create_artifact", { input });
      await get().loadArtifacts();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  updateArtifactStatus: async (id: string, status: "draft" | "approved" | "rejected") => {
    try {
      const input: UpdateArtifactStatusInput = { id, status };
      await invoke("update_artifact_status", { input });
      await get().loadArtifacts();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteArtifact: async (id: string) => {
    try {
      await invoke("delete_artifact", { id });
      await get().loadArtifacts();
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
