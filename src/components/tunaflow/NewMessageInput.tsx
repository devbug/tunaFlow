import { useState, useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import { ROUNDTABLE_PARTICIPANTS } from "@/lib/constants";
import { SendHorizonal, Users, MessageSquare, ChevronDown, Zap, Link2 } from "lucide-react";
import type { RtMode, RoundtableParticipant } from "@/types";

type Engine = "claude" | "codex" | "gemini" | "opencode";

const RT_MODES: { id: RtMode; label: string; title: string }[] = [
  { id: "sequential", label: "Sequential", title: "Each agent sees prior agents' replies within the round" },
  { id: "deliberative", label: "Deliberative", title: "Round 1 is independent; Round 2+ reflects on all prior-round answers" },
];

const ENGINE_LIST: { id: Engine; label: string; color: string }[] = [
  { id: "claude", label: "Claude", color: "text-agent-claude" },
  { id: "codex", label: "Codex", color: "text-agent-codex" },
  { id: "gemini", label: "Gemini", color: "text-agent-gemini" },
  { id: "opencode", label: "OpenCode", color: "text-agent-opencode" },
];

/** Parse `/follow name1,name2 <prompt>` — returns null if no match */
function parseFollowCommand(
  text: string,
  allParticipants: RoundtableParticipant[],
): { participants: RoundtableParticipant[]; prompt: string } | null {
  const match = text.match(/^\/follow\s+([\w,\s]+?)\s+([\s\S]+)/);
  if (!match) return null;
  const requestedNames = match[1]
    .split(",")
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);
  const matched = allParticipants.filter((p) =>
    requestedNames.includes(p.name.toLowerCase()),
  );
  if (matched.length === 0) return null;
  return { participants: matched, prompt: match[2].trim() };
}

// ─── Natural language handoff alias parser ────────────────────────────────────

const ENGINE_ALIASES: Record<string, string> = {
  // 한국어
  "클로드": "claude", "클": "claude",
  "코덱스": "codex", "코": "codex",
  "제미나이": "gemini", "제미니": "gemini", "젬": "gemini",
  "오픈코드": "opencode",
  // 영어
  "claude": "claude",
  "codex": "codex",
  "gemini": "gemini",
  "opencode": "opencode",
};

const GOAL_ALIASES: Record<string, string> = {
  "구현": "implement", "구현해": "implement", "만들어": "implement",
  "검토": "critique", "검토해": "critique", "리뷰": "critique",
  "다듬": "refine", "다듬어": "refine", "정리": "refine", "정리해": "refine",
  "넘겨": "", "넘기기": "", "보내": "", "시켜": "",
  "implement": "implement", "refine": "refine", "critique": "critique",
  "review": "critique", "fix": "implement", "summarize": "refine",
};

// Pattern: "{engine alias}로 {goal?}" or "{engine alias}에게 {goal?}" or just "{engine alias}로"
// Also: "{goal} {engine alias}로" (reversed)
function parseNaturalHandoff(text: string): { engine: string; goal: string } | null {
  const trimmed = text.trim();
  // Too long → not a handoff command
  if (trimmed.length > 40) return null;

  const lower = trimmed.toLowerCase();

  // Try each engine alias
  for (const [alias, engine] of Object.entries(ENGINE_ALIASES)) {
    // Pattern: "{alias}로 {goal}" or "{alias}에게 {goal}" or "{alias}로"
    const suffixes = [`${alias}로`, `${alias}에게`, `${alias}한테`];
    for (const suffix of suffixes) {
      if (lower.startsWith(suffix)) {
        const rest = lower.slice(suffix.length).trim();
        const goal = rest ? (GOAL_ALIASES[rest] ?? rest) : "";
        return { engine, goal };
      }
      if (lower.endsWith(suffix)) {
        const rest = lower.slice(0, lower.length - suffix.length).trim();
        const goal = rest ? (GOAL_ALIASES[rest] ?? rest) : "";
        return { engine, goal };
      }
    }

    // Pattern: just the engine name alone (e.g., "codex", "claude")
    if (lower === alias) {
      return { engine, goal: "" };
    }
  }

  return null;
}

export function NewMessageInput() {
  const {
    selectedConversationId,
    conversations,
    messages,
    isRunning,
    activeBranchId,
    closeBranchStream,
    sendMessage,
    sendWithCodex,
    sendWithGemini,
    sendWithOpencode,
    sendRoundtable,
    sendRoundtableFollowup,
    cancelOperation,
    sendFollowup,
    runningThreadIds,
    messageQueue,
    activeSkills,
    crossSessionIds,
    toggleCrossSession,
    engineModels,
    loadEngineModels,
  } = useChatStore();

  const [text, setText] = useState("");
  const [engine, setEngine] = useState<Engine>("claude");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [rtMode, setRtMode] = useState<RtMode>("sequential");
  const [activeParticipants, setActiveParticipants] = useState<Set<string>>(
    () => new Set(ROUNDTABLE_PARTICIPANTS.map((p) => p.name)),
  );
  const [showEngineDropdown, setShowEngineDropdown] = useState(false);

  const isCurrentThreadRunning = !!selectedConversationId && runningThreadIds.includes(selectedConversationId);
  const currentQueueLength = messageQueue.filter((q) => q.threadId === selectedConversationId).length;

  // 현재 엔진의 모델 목록
  const currentModels = useMemo(
    () => engineModels.filter((m) => m.engine === engine),
    [engineModels, engine],
  );

  // 엔진 변경 시 추천 모델로 자동 선택
  useEffect(() => {
    const rec = currentModels.find((m) => m.recommended);
    setSelectedModel(rec?.id ?? currentModels[0]?.id ?? "");
  }, [engine, currentModels.length]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const currentConv = conversations.find((c) => c.id === selectedConversationId);
  const isRoundtable = currentConv?.mode === "roundtable";
  const hasRtMessages = isRoundtable && messages.some((m) => m.persona);

  const toggleParticipant = (name: string) => {
    setActiveParticipants((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        if (next.size > 1) next.delete(name); // keep at least 1
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const handleSend = async () => {
    let prompt = text.trim();
    if (!prompt || !selectedConversationId) return;

    // !models 명령 처리
    if (prompt === "!models" || prompt === "!models --refresh") {
      if (prompt.includes("--refresh")) {
        await loadEngineModels();
      }
      const lines = ["## Engine Model Catalog", ""];
      let lastEngine = "";
      for (const m of useChatStore.getState().engineModels) {
        if (m.engine !== lastEngine) {
          lines.push(`### ${m.engine}`);
          lastEngine = m.engine;
        }
        lines.push(`- ${m.recommended ? "★ " : "  "}${m.id} — ${m.label} [${m.source}]`);
      }
      if (lines.length === 2) lines.push("(카탈로그가 비어 있습니다)");
      // 로컬 표시 — 임시 메시지로 추가
      const now = Date.now();
      useChatStore.setState((state) => ({
        messages: [...state.messages, {
          id: `local-models-${now}`,
          conversationId: selectedConversationId,
          role: "assistant" as const,
          content: lines.join("\n"),
          timestamp: now,
          status: "done",
          engine: "system",
        }],
      }));
      setText("");
      return;
    }

    // Natural language handoff: "클로드로 넘겨", "codex로 구현", etc.
    const handoff = parseNaturalHandoff(prompt);
    if (handoff && !isRoundtable) {
      // Source priority: 1) explicit handoffSource (artifact/plan expanded) 2) last assistant message
      const explicitSource = useChatStore.getState().handoffSource;
      if (explicitSource) {
        setText("");
        useChatStore.setState({ handoffSource: null });
        await sendFollowup(handoff.engine, explicitSource.type, explicitSource.content, handoff.goal || undefined);
        return;
      }
      const lastAssistant = messages.filter((m) => m.role === "assistant" && m.status === "done").pop();
      if (!lastAssistant) {
        // No source — block handoff, show inline guide
        const now = Date.now();
        useChatStore.setState((state) => ({
          messages: [...state.messages, {
            id: `local-guide-${now}`,
            conversationId: selectedConversationId,
            role: "assistant" as const,
            content: `⚠️ **넘길 이전 응답이 없습니다.**\n\n먼저 에이전트에게 질문하고, 응답을 받은 후 handoff를 사용하세요.\n\n입력: \`${prompt}\` → ${handoff.engine}`,
            timestamp: now,
            status: "done",
            engine: "system",
          }],
        }));
        setText("");
        return;
      }
      setText("");
      await sendFollowup(handoff.engine, "message", lastAssistant.content, handoff.goal || undefined);
      return;
    }

    setText("");

    if (isRoundtable) {
      // Determine participants: /follow override or UI toggles
      let participants: RoundtableParticipant[];
      const followCmd = parseFollowCommand(prompt, ROUNDTABLE_PARTICIPANTS);
      if (followCmd) {
        participants = followCmd.participants;
        prompt = followCmd.prompt;
        // Sync UI toggles with /follow selection
        setActiveParticipants(new Set(participants.map((p) => p.name)));
      } else {
        participants = ROUNDTABLE_PARTICIPANTS.filter((p) =>
          activeParticipants.has(p.name),
        );
      }

      if (hasRtMessages) {
        await sendRoundtableFollowup(prompt, participants, rtMode);
      } else {
        await sendRoundtable(prompt, participants, rtMode);
      }
    } else if (engine === "codex") {
      await sendWithCodex(prompt, selectedModel || undefined);
    } else if (engine === "gemini") {
      await sendWithGemini(prompt, selectedModel || undefined);
    } else if (engine === "opencode") {
      await sendWithOpencode(prompt, selectedModel || undefined);
    } else {
      await sendMessage(prompt, selectedModel || undefined);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const selectedEngine = ENGINE_LIST.find((e) => e.id === engine)!;

  return (
    <div className="px-4 pb-4 pt-2 shrink-0">
      {/* Branch stream banner */}
      {activeBranchId && (
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground bg-primary/10 border border-primary/20 rounded-md px-3 py-1.5">
          <span className="text-primary font-mono text-[10px]">BRANCH</span>
          <span className="font-medium text-foreground flex-1 truncate">{activeBranchId.slice(0, 16)}...</span>
          <button
            onClick={closeBranchStream}
            className="ml-auto text-muted-foreground hover:text-foreground text-xs"
          >
            ← Back to main
          </button>
        </div>
      )}

      {/* Context status */}
      {(activeSkills.length > 0 || crossSessionIds.length > 0) && (
        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
          {activeSkills.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-status-draft bg-status-draft/10 border border-status-draft/20 px-1.5 py-0.5 rounded-full">
              <Zap className="w-2.5 h-2.5" />
              {activeSkills.length} skill{activeSkills.length > 1 ? "s" : ""}
            </span>
          )}
          {crossSessionIds.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded-full">
              <Link2 className="w-2.5 h-2.5" />
              {crossSessionIds.length} linked
            </span>
          )}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card focus-within:border-ring/50 transition-colors">
        {/* Mode bar */}
        <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 border-b border-border/50 flex-wrap">
          {isRoundtable ? (
            <>
              <div className={cn("flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md font-medium bg-agent-gemini/15 text-agent-gemini shrink-0")}>
                <Users className="w-3 h-3" />
                Roundtable
              </div>
              <div className="h-4 w-px bg-border mx-0.5" />
              {/* Mode selector */}
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground shrink-0">
                <select
                  value={rtMode}
                  onChange={(e) => setRtMode(e.target.value as RtMode)}
                  className="bg-input rounded px-1 py-0.5 text-[11px] outline-none border border-border"
                  title={RT_MODES.find((m) => m.id === rtMode)?.title}
                >
                  {RT_MODES.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </label>
              <div className="h-4 w-px bg-border mx-0.5" />
              {/* Participant toggles */}
              <div className="flex items-center gap-1 flex-wrap">
                {ROUNDTABLE_PARTICIPANTS.map((p) => {
                  const active = activeParticipants.has(p.name);
                  return (
                    <button
                      key={p.name}
                      onClick={() => toggleParticipant(p.name)}
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-full border transition-colors",
                        active
                          ? "text-foreground bg-accent border-border font-medium"
                          : "text-muted-foreground/40 border-border/30 line-through"
                      )}
                      title={active ? `${p.name} participates — click to exclude` : `${p.name} excluded — click to include`}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className={cn("flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md font-medium bg-primary/15 text-primary")}>
                <MessageSquare className="w-3 h-3" />
                Chat
              </div>
              <div className="h-4 w-px bg-border mx-1" />
              <div className="relative">
                <button
                  onClick={() => setShowEngineDropdown(!showEngineDropdown)}
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-accent"
                >
                  <span className={cn("w-2 h-2 rounded-full", `bg-agent-${engine}`)} />
                  <span className={cn("font-medium", selectedEngine.color)}>{selectedEngine.label}</span>
                  <ChevronDown className="w-3 h-3" />
                </button>
                {showEngineDropdown && (
                  <div className="absolute bottom-full left-0 mb-2 bg-popover border border-border rounded-lg shadow-xl p-1.5 min-w-[150px] z-50">
                    {ENGINE_LIST.map((eng) => (
                      <button
                        key={eng.id}
                        onClick={() => { setEngine(eng.id); setShowEngineDropdown(false); }}
                        className={cn(
                          "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors",
                          engine === eng.id ? "text-foreground bg-accent" : "text-muted-foreground hover:text-foreground hover:bg-accent"
                        )}
                      >
                        <span className={cn("w-2 h-2 rounded-full shrink-0", engine === eng.id ? `bg-agent-${eng.id}` : "bg-muted")} />
                        <span className="flex-1 text-left font-medium">{eng.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* 모델 셀렉터 */}
              {currentModels.length > 0 && (
                <>
                  <div className="h-4 w-px bg-border mx-0.5" />
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="bg-input rounded px-1 py-0.5 text-[11px] outline-none border border-border text-muted-foreground max-w-[140px]"
                    title={`모델 (${currentModels[0]?.source ?? "curated"})`}
                  >
                    {currentModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.recommended ? "★ " : ""}{m.label}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </>
          )}
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            !selectedConversationId
              ? "Select a conversation first"
              : isRoundtable
              ? hasRtMessages
                ? "/follow codex,claude <prompt> or type normally... (⌘↵)"
                : "Start a roundtable discussion... (⌘↵ to send)"
              : `Ask anything... (⌘↵ to send)`
          }
          disabled={!selectedConversationId}
          rows={1}
          className="w-full px-3 py-2.5 text-sm bg-transparent resize-none outline-none text-foreground placeholder:text-muted-foreground leading-relaxed disabled:opacity-50"
        />

        {/* Action bar */}
        <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
          <span className="ml-auto text-[10px] text-muted-foreground font-mono">⌘↵ send</span>
          {isCurrentThreadRunning && (
            <button
              onClick={() => cancelOperation(selectedConversationId ?? undefined)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleSend}
            disabled={!text.trim() || !selectedConversationId}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              text.trim() && selectedConversationId
                ? isCurrentThreadRunning
                  ? "bg-agent-gemini/20 text-agent-gemini hover:bg-agent-gemini/30"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            <SendHorizonal className="w-3.5 h-3.5" />
            {isCurrentThreadRunning
              ? `Queue${currentQueueLength > 0 ? ` (${currentQueueLength})` : ""}`
              : isRoundtable ? (hasRtMessages ? "Next Round" : "Start RT") : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
