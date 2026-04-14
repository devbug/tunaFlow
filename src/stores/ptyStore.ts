import { create } from "zustand";

/** CLI engines that support PTY interactive mode */
export const PTY_ENGINES = ["claude", "codex", "gemini"] as const;
export type PtyEngine = typeof PTY_ENGINES[number];

const ENGINE_BINARY: Record<PtyEngine, string> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
};

export function getPtyBinary(engine: string): string | null {
  return ENGINE_BINARY[engine as PtyEngine] ?? null;
}

export function isPtyEngine(engine: string): engine is PtyEngine {
  return PTY_ENGINES.includes(engine as PtyEngine);
}

/** Detect completion from VTE screen snapshot.
 * Complete when: screen has ⏺ (response) AND bare ❯ in bottom lines (idle prompt).
 */
function detectCompletion(screenText: string): boolean {
  const hasResponse = /⏺/.test(screenText);
  if (!hasResponse) return false;
  const lines = screenText.split("\n").map((l) => l.trim());
  const bottom = lines.slice(-8);
  for (const line of bottom) {
    if (/^❯\s*$/.test(line)) return true;
    if (/Worked for \d+/i.test(line)) return true;
  }
  return false;
}

interface PtySession {
  sessionId: number;
  engine: PtyEngine;
  projectPath: string;
  jsonlPath?: string; // Tracked JSONL file for this PTY session
  model?: string;    // Model used at spawn time
}

interface PtyStoreState {
  sessions: Map<PtyEngine, PtySession>;

  activeMessageId: string | null;
  activeEngine: PtyEngine | null;
  isCapturing: boolean;
  completionSeen: boolean;
  responseStarted: boolean;

  /** Terminal panel visibility */
  terminalOpen: boolean;
  /** "docked" = fixed at bottom of chat area; "float" = draggable popup */
  terminalMode: "docked" | "float";

  getSession: (engine: string) => number | null;
  getJsonlPath: (engine: string) => string | undefined;
  getModel: (engine: string) => string | undefined;
  setSession: (engine: PtyEngine, sessionId: number, projectPath: string, model?: string) => void;
  setJsonlPath: (engine: PtyEngine, jsonlPath: string) => void;
  clearSession: (engine: PtyEngine) => void;
  clearAllSessions: () => void;

  toggleTerminal: () => void;
  setTerminalMode: (mode: "docked" | "float") => void;

  startCapture: (messageId: string, engine: PtyEngine) => void;
  updateScreen: (screenText: string) => void;   // pty:screen — completion detection
  checkCompletion: () => boolean;
  endCapture: () => void;
}

export const usePtyStore = create<PtyStoreState>((set, get) => ({
  sessions: new Map(),
  activeMessageId: null,
  activeEngine: null,
  isCapturing: false,
  completionSeen: false,
  responseStarted: false,
  terminalOpen: false,
  terminalMode: "docked",

  getSession: (engine) => get().sessions.get(engine as PtyEngine)?.sessionId ?? null,

  getJsonlPath: (engine) => get().sessions.get(engine as PtyEngine)?.jsonlPath,

  getModel: (engine) => get().sessions.get(engine as PtyEngine)?.model,

  setSession: (engine, sessionId, projectPath, model) => set((s) => {
    const next = new Map(s.sessions);
    next.set(engine, { sessionId, engine, projectPath, model });
    return { sessions: next };
  }),

  setJsonlPath: (engine, jsonlPath) => set((s) => {
    const session = s.sessions.get(engine);
    if (!session) return {};
    const next = new Map(s.sessions);
    next.set(engine, { ...session, jsonlPath });
    return { sessions: next };
  }),

  clearSession: (engine) => set((s) => {
    const next = new Map(s.sessions);
    next.delete(engine);
    return { sessions: next };
  }),

  clearAllSessions: () => set({ sessions: new Map() }),

  toggleTerminal: () => set((s) => ({
    terminalOpen: !s.terminalOpen,
    // 닫을 때 항상 docked로 리셋 — 다음에 열면 docked로 시작
    terminalMode: s.terminalOpen ? "docked" : s.terminalMode,
  })),
  setTerminalMode: (mode) => set({ terminalMode: mode }),

  startCapture: (messageId, engine) => set({
    activeMessageId: messageId,
    activeEngine: engine,
    isCapturing: true,
    completionSeen: false,
    responseStarted: false,
  }),

  updateScreen: (screenText) => {
    // pty:screen — VTE screen snapshot, used for completion detection only
    const hasResponse = /⏺/.test(screenText);
    if (hasResponse && !get().responseStarted) {
      set({ responseStarted: true });
    }
    if (get().responseStarted && detectCompletion(screenText)) {
      set({ completionSeen: true });
    }
  },

  checkCompletion: () => get().completionSeen,

  endCapture: () => {
    set({ activeMessageId: null, activeEngine: null, isCapturing: false, completionSeen: false, responseStarted: false });
  },
}));
