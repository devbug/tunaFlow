import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import { ROUNDTABLE_PARTICIPANTS, DEFAULT_MODEL } from "@/lib/constants";
import { SendHorizonal, Users, MessageSquare, ChevronDown, Zap, Link2 } from "lucide-react";
import type { RtMode } from "@/types";

type Engine = "claude" | "codex" | "gemini" | "opencode";

const RT_MODES: { id: RtMode; label: string; title: string }[] = [
  { id: "sequential", label: "Sequential", title: "Each agent sees prior agents' replies within the round" },
  { id: "independent", label: "Independent", title: "All agents answer with no cross-agent context" },
  { id: "deliberative", label: "Deliberative", title: "Round 1 is independent; Round 2+ reflects on all prior-round answers" },
];

const ENGINE_LIST: { id: Engine; label: string; color: string }[] = [
  { id: "claude", label: "Claude", color: "text-agent-claude" },
  { id: "codex", label: "Codex", color: "text-agent-codex" },
  { id: "gemini", label: "Gemini", color: "text-agent-gemini" },
  { id: "opencode", label: "OpenCode", color: "text-agent-opencode" },
];

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
    activeSkills,
    crossSessionIds,
    toggleCrossSession,
  } = useChatStore();

  const [text, setText] = useState("");
  const [engine, setEngine] = useState<Engine>("claude");
  const [rounds, setRounds] = useState(1);
  const [rtMode, setRtMode] = useState<RtMode>("sequential");
  const [showEngineDropdown, setShowEngineDropdown] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const currentConv = conversations.find((c) => c.id === selectedConversationId);
  const isRoundtable = currentConv?.mode === "roundtable";
  const hasRtMessages = isRoundtable && messages.some((m) => m.persona);
  const participantNames = ROUNDTABLE_PARTICIPANTS.map((p) => p.name).join(", ");

  const handleSend = async (followup = false) => {
    const prompt = text.trim();
    if (!prompt || isRunning || !selectedConversationId) return;
    setText("");
    if (isRoundtable) {
      if (followup) {
        await sendRoundtableFollowup(prompt, rtMode);
      } else {
        await sendRoundtable(prompt, rounds, rtMode);
      }
    } else if (engine === "codex") {
      await sendWithCodex(prompt);
    } else if (engine === "gemini") {
      await sendWithGemini(prompt);
    } else if (engine === "opencode") {
      await sendWithOpencode(prompt);
    } else {
      await sendMessage(prompt, DEFAULT_MODEL);
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

      {/* Context status — compact inline badges */}
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
        <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 border-b border-border/50">
          {isRoundtable ? (
            <>
              <div className={cn("flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md font-medium bg-agent-gemini/15 text-agent-gemini")}>
                <Users className="w-3 h-3" />
                Roundtable — {participantNames}
              </div>
              <div className="h-4 w-px bg-border mx-1" />
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                Rounds:
                <select
                  value={rounds}
                  onChange={(e) => setRounds(Number(e.target.value))}
                  className="bg-input rounded px-1 py-0.5 text-[11px] outline-none border border-border"
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </label>
              <div className="h-4 w-px bg-border mx-1" />
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                Mode:
                <select
                  value={rtMode}
                  onChange={(e) => setRtMode(e.target.value as RtMode)}
                  className="bg-input rounded px-1 py-0.5 text-[11px] outline-none border border-border"
                  title={RT_MODES.find((m) => m.id === rtMode)?.title}
                >
                  {RT_MODES.map((m) => (
                    <option key={m.id} value={m.id} title={m.title}>{m.label}</option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <div className={cn("flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md font-medium bg-primary/15 text-primary")}>
                <MessageSquare className="w-3 h-3" />
                Chat
              </div>
              <div className="h-4 w-px bg-border mx-1" />
              {/* Engine selector */}
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
              ? "Start a roundtable discussion... (⌘↵ to send)"
              : `Ask anything... (⌘↵ to send)`
          }
          disabled={!selectedConversationId || isRunning}
          rows={1}
          className="w-full px-3 py-2.5 text-sm bg-transparent resize-none outline-none text-foreground placeholder:text-muted-foreground leading-relaxed disabled:opacity-50"
        />

        {/* Action bar */}
        <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
          <span className="ml-auto text-[10px] text-muted-foreground font-mono">⌘↵ send</span>
          {isRunning && (
            <button
              onClick={cancelOperation}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors"
            >
              Cancel
            </button>
          )}
          {isRoundtable && hasRtMessages && (
            <button
              onClick={() => handleSend(true)}
              disabled={!text.trim() || isRunning}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                text.trim() && !isRunning
                  ? "bg-agent-gemini/20 text-agent-gemini hover:bg-agent-gemini/30"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              Follow-up
            </button>
          )}
          <button
            onClick={() => handleSend(false)}
            disabled={!text.trim() || isRunning || !selectedConversationId}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              text.trim() && !isRunning && selectedConversationId
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            <SendHorizonal className="w-3.5 h-3.5" />
            {isRunning ? "..." : isRoundtable ? `RT${rounds > 1 ? ` (${rounds}R)` : ""}` : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
