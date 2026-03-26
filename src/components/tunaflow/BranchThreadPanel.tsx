import { useRef, useEffect, useState, useMemo } from "react";
import { X, Check, GitBranch, Maximize2, SendHorizonal, User, ChevronDown } from "lucide-react";
import { cn, isKnownEngine, AGENT_COLORS, AGENT_DOT_COLORS, AGENT_DISPLAY_NAMES, formatTimestamp } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import { MessageItem } from "./MessageItem";

type Engine = "claude" | "codex" | "gemini" | "opencode";
const ENGINE_LIST: { id: Engine; label: string }[] = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "gemini", label: "Gemini" },
  { id: "opencode", label: "OpenCode" },
];

export function BranchThreadPanel() {
  const {
    threadBranchId,
    threadMessages,
    threadBranchLabel,
    threadParentMessage,
    selectedConversationId,
    isRunning,
    runningThreadIds,
    closeThread,
    adoptBranch,
    openBranchStream,
    sendThreadMessage,
    engineModels,
  } = useChatStore();

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [engine, setEngine] = useState<Engine>("claude");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [showEnginePicker, setShowEnginePicker] = useState(false);

  const currentModels = useMemo(
    () => engineModels.filter((m) => m.engine === engine),
    [engineModels, engine],
  );

  useEffect(() => {
    const rec = currentModels.find((m) => m.recommended);
    setSelectedModel(rec?.id ?? currentModels[0]?.id ?? "");
  }, [engine, currentModels.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [threadMessages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  if (!threadBranchId) return null;

  const handleSend = async () => {
    const prompt = text.trim();
    if (!prompt) return;
    setText("");
    await sendThreadMessage(prompt, engine, selectedModel || undefined);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleAdopt = async () => {
    if (!selectedConversationId) return;
    await adoptBranch(threadBranchId, selectedConversationId);
    closeThread();
  };

  const handleOpenFull = async () => {
    closeThread();
    await openBranchStream(threadBranchId);
  };

  // Parent message meta for the anchor preview
  const parentEngine = threadParentMessage?.engine;
  const parentKnown = isKnownEngine(parentEngine ?? "") ? (parentEngine as "claude" | "codex" | "gemini" | "opencode") : null;
  const parentName = threadParentMessage
    ? threadParentMessage.role === "user"
      ? "You"
      : threadParentMessage.persona ?? (parentKnown ? AGENT_DISPLAY_NAMES[parentKnown] : "Assistant")
    : null;

  return (
    <div className="flex flex-col w-full h-full bg-background">
      {/* ── Header — conversation-style, same visual weight as ChatPanel header ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <GitBranch className="w-4 h-4 text-primary shrink-0" />
          <h2 className="text-sm font-semibold text-foreground truncate">
            {threadBranchLabel}
          </h2>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wide border shrink-0 text-primary bg-primary/10 border-primary/20">
            Branch
          </span>
        </div>

        {/* Header actions: Adopt / Open Full / Close */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleAdopt}
            title="Adopt this branch"
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-primary hover:bg-primary/10 transition-colors border border-primary/20"
          >
            <Check className="w-3 h-3" />
            Adopt
          </button>
          <button
            onClick={handleOpenFull}
            title="Open as full conversation"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={closeThread}
            title="Close thread"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Parent message anchor — pinned context ── */}
      {threadParentMessage && (
        <div className="flex gap-3 px-4 py-3 border-b border-border bg-accent/20 shrink-0">
          {/* Avatar */}
          <div className="shrink-0 mt-0.5">
            {threadParentMessage.role === "user" ? (
              <div className="w-6 h-6 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
                <User className="w-3 h-3 text-primary" />
              </div>
            ) : (
              <div className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center border text-[10px] font-bold",
                parentKnown ? AGENT_COLORS[parentKnown] : "text-muted-foreground border-border bg-accent"
              )}>
                {(parentName ?? "A").charAt(0)}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[11px] font-semibold text-foreground">{parentName}</span>
              <span className="text-[10px] text-muted-foreground font-mono">
                {formatTimestamp(threadParentMessage.timestamp)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
              {threadParentMessage.content.slice(0, 300)}
            </p>
          </div>
        </div>
      )}

      {/* ── Thread messages — same MessageItem as main, default variant ── */}
      <div className="flex-1 overflow-y-auto">
        {threadMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
            <GitBranch className="w-5 h-5 text-muted-foreground/50" />
            <p>No replies yet</p>
            <p className="text-[11px] text-muted-foreground/60">Start the conversation below</p>
          </div>
        ) : (
          <div className="py-3 space-y-0.5">
            {threadMessages.map((msg) => (
              <MessageItem
                key={msg.id}
                message={msg}
                showActions={false}
              />
            ))}
            {runningThreadIds.length > 0 && threadMessages[threadMessages.length - 1]?.status !== "streaming" && (
              <div className="flex items-center gap-1 px-4 py-3 text-muted-foreground text-xs">
                <span className="typing-dot w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                <span className="typing-dot w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                <span className="typing-dot w-1.5 h-1.5 rounded-full bg-muted-foreground" />
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ── Input — same structure as main NewMessageInput ── */}
      <div className="px-4 pb-4 pt-2 shrink-0">
        <div className="rounded-xl border border-border bg-card focus-within:border-ring/50 transition-colors">
          {/* Engine selector */}
          <div className="flex items-center gap-2 px-3 pt-2 pb-1 border-b border-border/50">
            <div className="relative">
              <button
                onClick={() => setShowEnginePicker(!showEnginePicker)}
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-accent"
              >
                <span className={cn("w-2 h-2 rounded-full", `bg-agent-${engine}`)} />
                <span className="font-medium">{ENGINE_LIST.find((e) => e.id === engine)?.label}</span>
                <ChevronDown className="w-3 h-3" />
              </button>
              {showEnginePicker && (
                <div className="absolute bottom-full left-0 mb-1 bg-popover border border-border rounded-lg shadow-xl p-1 min-w-[140px] z-50">
                  {ENGINE_LIST.map((eng) => (
                    <button
                      key={eng.id}
                      onClick={() => { setEngine(eng.id); setShowEnginePicker(false); }}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors",
                        engine === eng.id
                          ? "text-foreground bg-accent"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent"
                      )}
                    >
                      <span className={cn("w-2 h-2 rounded-full", engine === eng.id ? `bg-agent-${eng.id}` : "bg-muted")} />
                      {eng.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* 모델 셀렉터 */}
            {currentModels.length > 0 && (
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-input rounded px-1 py-0.5 text-[10px] outline-none border border-border text-muted-foreground max-w-[120px]"
              >
                {currentModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.recommended ? "★ " : ""}{m.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Continue this thread... (⌘↵ to send)"
            rows={1}
            className="w-full px-3 py-2.5 text-sm bg-transparent resize-none outline-none text-foreground placeholder:text-muted-foreground leading-relaxed"
          />
          <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
            <span className="ml-auto text-[10px] text-muted-foreground font-mono">⌘↵ send</span>
            <button
              onClick={handleSend}
              disabled={!text.trim()}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                text.trim()
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              <SendHorizonal className="w-3.5 h-3.5" />
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
