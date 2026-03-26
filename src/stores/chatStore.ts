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
  RoundtableParticipant,
  RtMode,
  AdoptBranchInput,
  CreateMemoInput,
  CreateArtifactInput,
  UpdateArtifactStatusInput,
  RawqStatus,
  EngineModel,
} from "../types";

/** Queued send action for same-thread serial execution */
interface QueuedAction {
  threadId: string;
  label: string;
  execute: () => Promise<void>;
}

interface ChatState {
  projects: Project[];
  selectedProjectKey: string | null;
  conversations: Conversation[];
  selectedConversationId: string | null;
  messages: Message[];
  branches: Branch[];
  /** @deprecated — use runningThreadIds for thread-local checks */
  isRunning: boolean;
  /** Conversation thread IDs currently executing agent calls (supports multi-project parallel) */
  runningThreadIds: string[];
  /** Same-thread message queue — drained sequentially after active run completes */
  messageQueue: QueuedAction[];
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
  rawqStatus: RawqStatus | null;
  engineModels: EngineModel[];
  /** Pending handoff source set by UI actions (artifact forward, plan forward, etc.) */
  handoffSource: { type: string; content: string } | null;

  setHandoffSource: (source: { type: string; content: string } | null) => void;
  _startRun: (threadId: string) => void;
  _endRun: (threadId: string) => void;
  _enqueue: (threadId: string, label: string, execute: () => Promise<void>) => void;
  loadProjects: () => Promise<void>;
  loadEngineModels: () => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<void>;
  selectProject: (key: string) => Promise<void>;
  createConversation: (input: CreateConversationInput) => Promise<Conversation>;
  deleteConversation: (id: string) => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  sendMessage: (prompt: string, model?: string, systemPrompt?: string) => Promise<void>;
  sendWithCodex: (prompt: string, model?: string) => Promise<void>;
  sendWithGemini: (prompt: string, model?: string) => Promise<void>;
  sendWithOpencode: (prompt: string, model?: string) => Promise<void>;
  sendFollowup: (engine: string, sourceType: string, sourceContent: string, goal?: string) => Promise<void>;
  sendRoundtable: (prompt: string, participants: RoundtableParticipant[], mode?: RtMode) => Promise<void>;
  sendRoundtableFollowup: (prompt: string, participants: RoundtableParticipant[], mode?: RtMode) => Promise<void>;
  loadBranches: (conversationId: string) => Promise<void>;
  createBranch: (conversationId: string, checkpointId?: string, label?: string, mode?: string) => Promise<void>;
  deleteBranch: (branchId: string) => Promise<void>;
  renameConversation: (id: string, customLabel: string) => Promise<void>;
  renameBranch: (branchId: string, customLabel: string) => Promise<void>;
  adoptBranch: (branchId: string, conversationId: string) => Promise<void>;
  openBranchStream: (branchId: string) => Promise<void>;
  closeBranchStream: () => Promise<void>;
  openThread: (branchId: string) => Promise<void>;
  closeThread: () => void;
  sendThreadMessage: (prompt: string, engine?: string, model?: string) => Promise<void>;
  cancelOperation: (threadId?: string) => Promise<void>;
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
  runningThreadIds: [],
  messageQueue: [],
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
  rawqStatus: null,
  engineModels: [],
  handoffSource: null,

  loadProjects: async () => {
    try {
      const projects = await invoke<Project[]>("list_projects");
      set({ projects, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadEngineModels: async () => {
    try {
      const engineModels = await invoke<EngineModel[]>("list_engine_models");
      set({ engineModels });
    } catch (e) {
      console.warn("[engine models]", e);
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
    set({ selectedProjectKey: key, selectedConversationId: null, messages: [], branches: [], rawqStatus: null });
    // 마지막 프로젝트 기억
    import("@/lib/appStore").then(({ setSetting }) => setSetting("lastProjectKey", key)).catch(() => {});
    try {
      const conversations = await invoke<Conversation[]>("list_conversations", {
        projectKey: key,
      });
      set({ conversations, error: null });

      // rawq: check status → ensure index → update status
      const project = await invoke<Project>("get_project", { key });
      if (project.path) {
        // 1. Quick status check
        const initialStatus = await invoke<RawqStatus>("get_rawq_status", { projectPath: project.path });
        set({ rawqStatus: initialStatus });

        // 2. If not indexed, trigger build (shows "indexing..." in UI)
        if (initialStatus.available && !initialStatus.indexed) {
          set({ rawqStatus: { ...initialStatus, status: "indexing", message: "building index..." } });
          const result = await invoke<RawqStatus>("ensure_rawq_index", { projectPath: project.path });
          set({ rawqStatus: result });
        }
      }
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

  setHandoffSource: (source) => set({ handoffSource: source }),

  // ─── Thread run helpers ──────────────────────────────────────────────
  _startRun: (threadId: string) => {
    set((state) => ({
      isRunning: true,
      runningThreadIds: [...state.runningThreadIds.filter((id) => id !== threadId), threadId],
      error: null,
    }));
  },
  _endRun: (threadId: string) => {
    set((state) => {
      const next = state.runningThreadIds.filter((id) => id !== threadId);
      return { isRunning: next.length > 0, runningThreadIds: next };
    });
    // Notify if app is not focused
    if (document.hidden) {
      import("@tauri-apps/plugin-notification").then(({ sendNotification, isPermissionGranted }) => {
        isPermissionGranted().then((granted) => {
          if (granted) {
            sendNotification({ title: "tunaFlow", body: "에이전트 응답이 완료되었습니다." });
          }
        });
      }).catch(() => {});
    }
    // Drain next queued action for this thread
    const queue = get().messageQueue;
    const nextIdx = queue.findIndex((q) => q.threadId === threadId);
    if (nextIdx >= 0) {
      const next = queue[nextIdx];
      set({ messageQueue: queue.filter((_, i) => i !== nextIdx) });
      next.execute();
    }
  },
  _enqueue: (threadId: string, label: string, execute: () => Promise<void>) => {
    set((state) => ({
      messageQueue: [...state.messageQueue, { threadId, label, execute }],
    }));
  },

  sendMessage: async (prompt: string, model?: string, systemPrompt?: string) => {
    const { selectedProjectKey, selectedConversationId, runningThreadIds } = get();
    if (!selectedProjectKey || !selectedConversationId) return;

    // Queue if this thread is already running
    if (runningThreadIds.includes(selectedConversationId)) {
      get()._enqueue(selectedConversationId, prompt.slice(0, 30), () =>
        get().sendMessage(prompt, model, systemPrompt),
      );
      return;
    }

    get()._startRun(selectedConversationId);
    const now = Date.now();
    set((state) => ({
      messages: [
        ...state.messages,
        { id: `temp-user-${now}`, conversationId: selectedConversationId, role: "user", content: prompt, timestamp: now, status: "done" },
        { id: `temp-thinking-${now}`, conversationId: selectedConversationId, role: "assistant", content: "", progressContent: "Claude initializing...", timestamp: now, status: "streaming", engine: "claude-code", model },
      ],
    }));

    // Subscribe to progress events (thinking/tool steps — shown as plain text during streaming)
    const unlistenProgress = await listen<{ messageId: string; text: string }>(
      "claude:progress",
      (event) => {
        const { messageId, text } = event.payload;
        set((state) => {
          const existing = state.messages.find((m) => m.id === messageId);
          if (existing) {
            // Append to progressContent
            const prev = existing.progressContent || "";
            const updated = prev ? `${prev}\n${text}` : text;
            return {
              messages: state.messages.map((m) =>
                m.id === messageId ? { ...m, progressContent: updated } : m
              ),
            };
          }
          // First progress event: replace thinking placeholder
          const withoutPlaceholder = state.messages.filter(
            (m) => !m.id.startsWith("temp-thinking-"),
          );
          return {
            messages: [...withoutPlaceholder, {
              id: messageId,
              conversationId: selectedConversationId,
              role: "assistant" as const,
              content: "",
              progressContent: text,
              timestamp: Date.now(),
              status: "streaming" as const,
              engine: "claude-code",
              model,
            }],
          };
        });
      },
    );

    // Subscribe to streaming chunks (final answer text)
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
          // First chunk: replace thinking placeholder with real streaming message
          const withoutPlaceholder = state.messages.filter(
            (m) => !m.id.startsWith("temp-thinking-"),
          );
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
          return { messages: [...withoutPlaceholder, streamingMsg] };
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
      set({ messages });
      get()._endRun(selectedConversationId);
    } catch (e) {
      set((state) => ({
        error: String(e),
        messages: state.messages
          .filter((m) => !m.id.startsWith("temp-thinking-"))
          .map((m) => m.status === "streaming" ? { ...m, status: "error", content: m.content || String(e) } : m),
      }));
      get()._endRun(selectedConversationId);
    } finally {
      unlisten();
      unlistenProgress();
    }
  },

  sendWithCodex: async (prompt: string, model?: string) => {
    const { selectedProjectKey, selectedConversationId, runningThreadIds } = get();
    if (!selectedProjectKey || !selectedConversationId) return;
    if (runningThreadIds.includes(selectedConversationId)) {
      get()._enqueue(selectedConversationId, prompt.slice(0, 30), () => get().sendWithCodex(prompt, model));
      return;
    }
    get()._startRun(selectedConversationId);
    const now = Date.now();
    set((state) => ({
      messages: [
        ...state.messages,
        { id: `temp-user-${now}`, conversationId: selectedConversationId, role: "user", content: prompt, timestamp: now, status: "done" },
        { id: `temp-thinking-${now}`, conversationId: selectedConversationId, role: "assistant", content: "", progressContent: "Codex processing...", timestamp: now, status: "streaming", engine: "codex", model },
      ],
    }));
    try {
      const input: SendWithClaudeInput = { projectKey: selectedProjectKey, conversationId: selectedConversationId, prompt, model };
      await invoke<Message>("send_with_codex", { input });
      const messages = await invoke<Message[]>("list_messages", { conversationId: selectedConversationId });
      set({ messages });
      get()._endRun(selectedConversationId);
    } catch (e) {
      set((state) => ({
        error: String(e),
        messages: state.messages.filter((m) => !m.id.startsWith("temp-thinking-")),
      }));
      get()._endRun(selectedConversationId);
    }
  },

  sendWithGemini: async (prompt: string, model?: string) => {
    const { selectedProjectKey, selectedConversationId, runningThreadIds } = get();
    if (!selectedProjectKey || !selectedConversationId) return;
    if (runningThreadIds.includes(selectedConversationId)) {
      get()._enqueue(selectedConversationId, prompt.slice(0, 30), () => get().sendWithGemini(prompt, model));
      return;
    }
    get()._startRun(selectedConversationId);
    const now = Date.now();
    set((state) => ({
      messages: [
        ...state.messages,
        { id: `temp-user-${now}`, conversationId: selectedConversationId, role: "user", content: prompt, timestamp: now, status: "done" },
        { id: `temp-thinking-${now}`, conversationId: selectedConversationId, role: "assistant", content: "", progressContent: "Gemini processing...", timestamp: now, status: "streaming", engine: "gemini", model },
      ],
    }));
    try {
      const input: SendWithClaudeInput = { projectKey: selectedProjectKey, conversationId: selectedConversationId, prompt, model };
      await invoke<Message>("send_with_gemini", { input });
      const messages = await invoke<Message[]>("list_messages", { conversationId: selectedConversationId });
      set({ messages });
      get()._endRun(selectedConversationId);
    } catch (e) {
      set((state) => ({
        error: String(e),
        messages: state.messages.filter((m) => !m.id.startsWith("temp-thinking-")),
      }));
      get()._endRun(selectedConversationId);
    }
  },

  sendWithOpencode: async (prompt: string, model?: string) => {
    const { selectedProjectKey, selectedConversationId, runningThreadIds } = get();
    if (!selectedProjectKey || !selectedConversationId) return;
    if (runningThreadIds.includes(selectedConversationId)) {
      get()._enqueue(selectedConversationId, prompt.slice(0, 30), () => get().sendWithOpencode(prompt, model));
      return;
    }
    get()._startRun(selectedConversationId);
    const now = Date.now();
    set((state) => ({
      messages: [
        ...state.messages,
        { id: `temp-user-${now}`, conversationId: selectedConversationId, role: "user", content: prompt, timestamp: now, status: "done" },
        { id: `temp-thinking-${now}`, conversationId: selectedConversationId, role: "assistant", content: "", progressContent: "OpenCode processing...", timestamp: now, status: "streaming", engine: "opencode", model },
      ],
    }));
    try {
      const input: SendWithClaudeInput = { projectKey: selectedProjectKey, conversationId: selectedConversationId, prompt, model };
      await invoke<Message>("send_with_opencode", { input });
      const messages = await invoke<Message[]>("list_messages", { conversationId: selectedConversationId });
      set({ messages });
      get()._endRun(selectedConversationId);
    } catch (e) {
      set((state) => ({
        error: String(e),
        messages: state.messages.filter((m) => !m.id.startsWith("temp-thinking-")),
      }));
      get()._endRun(selectedConversationId);
    }
  },

  sendFollowup: async (engine: string, sourceType: string, sourceContent: string, goal?: string) => {
    const truncated = sourceContent.length > 800 ? sourceContent.slice(0, 800) + "..." : sourceContent;
    const goalLine = goal ? `\nGoal: ${goal}` : "";
    const prompt = `[Follow-up: ${sourceType}]${goalLine}\n\n${truncated}\n\n위 내용을 기반으로 작업해주세요.`;

    if (engine === "codex") {
      await get().sendWithCodex(prompt);
    } else if (engine === "gemini") {
      await get().sendWithGemini(prompt);
    } else if (engine === "opencode") {
      await get().sendWithOpencode(prompt);
    } else {
      await get().sendMessage(prompt);
    }
  },

  sendRoundtable: async (prompt: string, participants: RoundtableParticipant[], mode?: RtMode) => {
    const { selectedConversationId, runningThreadIds } = get();
    if (!selectedConversationId) return;
    if (runningThreadIds.includes(selectedConversationId)) {
      get()._enqueue(selectedConversationId, prompt.slice(0, 30), () => get().sendRoundtable(prompt, participants, mode));
      return;
    }
    get()._startRun(selectedConversationId);
    const now = Date.now();
    set((state) => ({
      messages: [
        ...state.messages,
        { id: `temp-user-${now}`, conversationId: selectedConversationId, role: "user", content: prompt, timestamp: now, status: "done" },
        { id: `temp-thinking-${now}`, conversationId: selectedConversationId, role: "assistant", content: "", progressContent: "Roundtable starting...", timestamp: now, status: "streaming", engine: "system" },
      ],
    }));

    let placeholderCleared = false;
    const unlisten = await listen<Message>("roundtable:progress", (event) => {
      const msg = event.payload;
      if (msg.role === "user") return;
      set((state) => {
        if (!placeholderCleared) {
          placeholderCleared = true;
          const filtered = state.messages.filter((m) => !m.id.startsWith("temp-thinking-"));
          return { messages: [...filtered, msg] };
        }
        return { messages: [...state.messages, msg] };
      });
    });

    try {
      const input: RoundtableRunInput = {
        conversationId: selectedConversationId,
        prompt,
        participants,
        mode,
      };
      await invoke<Message[]>("roundtable_run", { input });
      const messages = await invoke<Message[]>("list_messages", {
        conversationId: selectedConversationId,
      });
      set({ messages });
      get()._endRun(selectedConversationId);
    } catch (e) {
      set({ error: String(e) });
      get()._endRun(selectedConversationId);
    } finally {
      unlisten();
    }
  },

  sendRoundtableFollowup: async (prompt: string, participants: RoundtableParticipant[], mode?: RtMode) => {
    const { selectedConversationId, runningThreadIds } = get();
    if (!selectedConversationId) return;
    if (runningThreadIds.includes(selectedConversationId)) {
      get()._enqueue(selectedConversationId, prompt.slice(0, 30), () => get().sendRoundtableFollowup(prompt, participants, mode));
      return;
    }
    get()._startRun(selectedConversationId);
    const now = Date.now();
    set((state) => ({
      messages: [
        ...state.messages,
        { id: `temp-user-${now}`, conversationId: selectedConversationId, role: "user", content: prompt, timestamp: now, status: "done" },
        { id: `temp-thinking-${now}`, conversationId: selectedConversationId, role: "assistant", content: "", progressContent: "Roundtable starting...", timestamp: now, status: "streaming", engine: "system" },
      ],
    }));

    let placeholderCleared2 = false;
    const unlisten = await listen<Message>("roundtable:progress", (event) => {
      const msg = event.payload;
      if (msg.role === "user") return;
      set((state) => {
        if (!placeholderCleared2) {
          placeholderCleared2 = true;
          const filtered = state.messages.filter((m) => !m.id.startsWith("temp-thinking-"));
          return { messages: [...filtered, msg] };
        }
        return { messages: [...state.messages, msg] };
      });
    });

    try {
      const input: RoundtableRunInput = {
        conversationId: selectedConversationId,
        prompt,
        participants,
        mode,
      };
      await invoke<Message[]>("roundtable_followup", { input });
      const messages = await invoke<Message[]>("list_messages", {
        conversationId: selectedConversationId,
      });
      set({ messages });
      get()._endRun(selectedConversationId);
    } catch (e) {
      set({ error: String(e) });
      get()._endRun(selectedConversationId);
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

  createBranch: async (conversationId: string, checkpointId?: string, label?: string, mode?: string) => {
    try {
      const input: CreateBranchInput = { conversationId, checkpointId, label, mode };
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

  renameConversation: async (id: string, customLabel: string) => {
    const trimmed = customLabel.trim() || undefined;
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, customLabel: trimmed } : c
      ),
    }));
    try {
      await invoke("rename_conversation", { id, customLabel });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  renameBranch: async (branchId: string, customLabel: string) => {
    const trimmed = customLabel.trim() || undefined;
    set((state) => ({
      branches: state.branches.map((b) =>
        b.id === branchId ? { ...b, customLabel: trimmed } : b
      ),
    }));
    try {
      await invoke("rename_branch", { id: branchId, customLabel });
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

  cancelOperation: async (threadId?: string) => {
    const target = threadId ?? get().selectedConversationId;

    // Backend cancel flag — thread-aware
    if (target) {
      try {
        await invoke("cancel_running", { conversationId: target });
      } catch {
        // Best-effort
      }
    }

    if (!target) {
      // 대상 불명 — 전체 초기화 (fallback)
      set({ isRunning: false, runningThreadIds: [], error: null });
      return;
    }

    // 해당 thread만 running에서 제거
    set((state) => {
      const next = state.runningThreadIds.filter((id) => id !== target);
      return { isRunning: next.length > 0, runningThreadIds: next, error: null };
    });

    // 해당 thread의 queue도 비움 (cancel이면 대기 중인 것도 무의미)
    set((state) => ({
      messageQueue: state.messageQueue.filter((q) => q.threadId !== target),
    }));

    // 현재 보고 있는 conversation이면 메시지 새로고침
    if (target === get().selectedConversationId) {
      try {
        const messages = await invoke<Message[]>("list_messages", {
          conversationId: target,
        });
        set({ messages });
      } catch {
        // 무시
      }
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
