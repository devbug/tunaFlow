import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Bot, X, Pin, PinOff, Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import { getOrCreateMetaConversation } from "@/lib/metaConversation";
import type { Message } from "@/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { vizMarkersAll } from "@/lib/vizMarkers";

interface MetaFloatingChatProps {
  projectKey: string;
}

const BUTTON_SIZE = 36;
const POPUP_W = 360;
const POPUP_H = 520;
const DEFAULT_POS = { x: 16, y: 56 };

function loadPos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem("meta-float-pos");
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return DEFAULT_POS;
}

export function MetaFloatingChat({ projectKey }: MetaFloatingChatProps) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [metaConvId, setMetaConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [pos, setPos] = useState<{ x: number; y: number }>(loadPos);
  const posRef = useRef(pos);
  posRef.current = pos;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const runningThreadIds = useChatStore((s) => s.runningThreadIds);

  // Listen for meta task assignments from other agents
  useEffect(() => {
    const handler = () => setPendingCount((c) => c + 1);
    window.addEventListener("tunaflow:meta-task", handler);
    return () => window.removeEventListener("tunaflow:meta-task", handler);
  }, []);

  // Close popup on outside click (pinned stays open)
  useEffect(() => {
    if (!open || pinned) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, pinned]);

  // Resolve or create Meta conversation on project change
  useEffect(() => {
    setMetaConvId(null);
    setMessages([]);
    getOrCreateMetaConversation(projectKey)
      .then(setMetaConvId)
      .catch((e) => console.warn("[meta] conversation init failed:", e));
  }, [projectKey]);

  // Load messages when Meta conv is ready and panel opens
  const loadMessages = useCallback(async () => {
    if (!metaConvId) return;
    try {
      const msgs = await invoke<Message[]>("list_messages", { conversationId: metaConvId });
      setMessages(msgs);
    } catch (e) {
      console.warn("[meta] load messages failed:", e);
    }
  }, [metaConvId]);

  useEffect(() => {
    if (open && metaConvId) {
      loadMessages();
      setPendingCount(0); // Clear notification badge on open
    }
  }, [open, metaConvId, loadMessages]);

  // Subscribe to streaming events for this conversation
  useEffect(() => {
    if (!metaConvId) return;

    const unlisten: (() => void)[] = [];

    const onChunk = (payload: { messageId: string; text: string }) => {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === payload.messageId);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], content: payload.text, status: "streaming" };
          return updated;
        }
        return prev;
      });
      setStreamingId(payload.messageId);
    };

    const onCompleted = (payload: { messageId: string; conversationId: string }) => {
      if (payload.conversationId !== metaConvId) return;
      setRunning(false);
      setStreamingId(null);
      loadMessages();
    };

    const onError = (payload: { conversationId: string }) => {
      if (payload.conversationId !== metaConvId) return;
      setRunning(false);
      setStreamingId(null);
      loadMessages();
    };

    Promise.all([
      listen<{ messageId: string; text: string }>("claude:chunk", (e) => onChunk(e.payload)),
      listen<{ messageId: string; conversationId: string }>("agent:completed", (e) => onCompleted(e.payload)),
      listen<{ conversationId: string }>("agent:error", (e) => onError(e.payload)),
    ]).then((fns) => { unlisten.push(...fns); });

    return () => { unlisten.forEach((fn) => fn()); };
  }, [metaConvId, loadMessages]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const isMetaRunning = metaConvId ? runningThreadIds.includes(metaConvId) : false;

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !metaConvId || running || isMetaRunning) return;
    setInput("");
    setRunning(true);

    // Optimistic user message
    const optimisticUser = {
      id: `opt-user-${Date.now()}`,
      conversationId: metaConvId,
      role: "user" as const,
      content: text,
      timestamp: Date.now(),
      status: "done" as const,
    };
    setMessages((prev) => [...prev, optimisticUser]);

    try {
      // Fire start_claude_stream — creates messages internally, returns messageId
      const result = await invoke<{ messageId: string }>("start_claude_stream", {
        input: {
          projectKey,
          conversationId: metaConvId,
          prompt: text,
          agentName: "meta",
        },
      });
      setStreamingId(result.messageId);
      // Optimistically add a streaming placeholder until first chunk arrives
      setMessages((prev) => [
        ...prev,
        {
          id: result.messageId,
          conversationId: metaConvId,
          role: "assistant" as const,
          content: "",
          timestamp: Date.now(),
          status: "streaming" as const,
        },
      ]);
    } catch (e) {
      console.error("[meta] send failed:", e);
      setRunning(false);
      setStreamingId(null);
      loadMessages();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleOpen = () => {
    if (pinned) return; // pinned = always open
    setOpen((v) => !v);
    if (!open) setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleButtonMouseDown = (e: React.MouseEvent) => {
    // Only left button
    if (e.button !== 0) return;
    e.preventDefault();

    const startX = e.clientX - posRef.current.x;
    const startY = e.clientY - posRef.current.y;
    let moved = false;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - (startX + posRef.current.x);
      const dy = ev.clientY - (startY + posRef.current.y);
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;

      const parent = wrapperRef.current?.parentElement;
      const pw = parent?.clientWidth ?? window.innerWidth;
      const ph = parent?.clientHeight ?? window.innerHeight;

      const x = Math.max(0, Math.min(ev.clientX - startX, pw - BUTTON_SIZE));
      const y = Math.max(0, Math.min(ev.clientY - startY, ph - BUTTON_SIZE));
      setPos({ x, y });
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (moved) {
        localStorage.setItem("meta-float-pos", JSON.stringify(posRef.current));
      } else {
        toggleOpen();
      }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
  };

  const isOpen = open || pinned;

  // Flip popup upward when button is in the lower portion of the container
  const parent = wrapperRef.current?.parentElement;
  const containerH = parent?.clientHeight ?? window.innerHeight;
  const openUpward = pos.y > containerH * 0.55;
  // Flip popup leftward when button is near the right edge
  const containerW = parent?.clientWidth ?? window.innerWidth;
  const openLeft = pos.x + POPUP_W > containerW - 8;

  return (
    <div
      ref={wrapperRef}
      className="absolute z-[60]"
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Floating trigger button */}
      <div className="relative">
        <button
          onMouseDown={handleButtonMouseDown}
          className={cn(
            "w-9 h-9 rounded-full shadow-lg flex items-center justify-center transition-all select-none",
            "border cursor-grab active:cursor-grabbing",
            isOpen
              ? "bg-primary text-primary-foreground border-primary shadow-primary/20"
              : "bg-background border-border/30 text-muted-foreground/60 hover:text-primary hover:border-primary/30 hover:shadow-primary/10",
            !isOpen && pendingCount > 0 && "animate-pulse border-amber-400/60 text-amber-400",
          )}
          title="Meta Agent (드래그로 이동)"
        >
          <Bot className="w-4 h-4" />
        </button>
        {pendingCount > 0 && !isOpen && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-400 text-[9px] font-bold text-black flex items-center justify-center pointer-events-none">
            {pendingCount > 9 ? "9+" : pendingCount}
          </span>
        )}
      </div>

      {/* Popup chat panel — direction flips based on position */}
      {isOpen && (
        <div
          className="absolute w-[360px] flex flex-col bg-background border border-border/40 rounded-xl shadow-2xl overflow-hidden"
          style={{
            width: POPUP_W,
            height: Math.min(POPUP_H, containerH * 0.65),
            ...(openUpward
              ? { bottom: BUTTON_SIZE + 8 }
              : { top: BUTTON_SIZE + 8 }),
            ...(openLeft
              ? { right: 0 }
              : { left: 0 }),
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 shrink-0 bg-card/50">
            <Bot className="w-4 h-4 text-primary/70 shrink-0" />
            <span className="flex-1 text-[12px] font-semibold text-foreground">Meta</span>
            <span className="text-[10px] text-muted-foreground/40 mr-1">프로세스 관리자</span>
            <button
              onClick={() => setPinned((v) => !v)}
              className={cn(
                "p-1 rounded hover:bg-accent/50 transition-colors",
                pinned ? "text-primary" : "text-muted-foreground/40 hover:text-muted-foreground"
              )}
              title={pinned ? "핀 해제" : "고정"}
            >
              {pinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
            </button>
            {!pinned && (
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-accent/50 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
                <Bot className="w-8 h-8 text-muted-foreground/20" />
                <p className="text-[12px] text-muted-foreground/40">
                  프로젝트 상태 분석, 이슈 감지, 우선순위 제안을 도와드립니다.
                </p>
                <p className="text-[11px] text-muted-foreground/25">
                  "프로젝트 상태 확인해줘" 로 시작해보세요
                </p>
              </div>
            )}
            {messages.map((msg) => (
              <MetaMessage
                key={msg.id}
                message={msg}
                isStreaming={msg.id === streamingId}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="px-3 py-2 border-t border-border/20 shrink-0 bg-card/30">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Meta에게 물어보기..."
                rows={1}
                className="flex-1 resize-none bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground/30 outline-none border border-border/20 rounded-lg px-3 py-2 min-h-[36px] max-h-[80px] overflow-y-auto"
                style={{ height: "auto" }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = `${Math.min(el.scrollHeight, 80)}px`;
                }}
                disabled={running || isMetaRunning}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || running || isMetaRunning}
                className="p-2 rounded-lg bg-primary/80 hover:bg-primary text-primary-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                {running || isMetaRunning
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Send className="w-3.5 h-3.5" />
                }
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ─── MetaMessage ─────────────────────────────────────────────────────────────

function MetaMessage({ message, isStreaming }: { message: Message; isStreaming: boolean }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex gap-2", isUser && "justify-end")}>
      {!isUser && (
        <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <Bot className="w-3 h-3 text-primary/60" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] rounded-xl px-3 py-2 text-[12px] leading-relaxed",
          isUser
            ? "bg-primary/10 text-foreground"
            : "bg-card/60 text-foreground/90"
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className={cn(
            "prose prose-sm prose-invert max-w-none",
            "[&_p]:my-1 [&_h2]:text-[13px] [&_h3]:text-[12px]",
            "[&_ul]:my-1 [&_li]:my-0 [&_code]:text-[11px]",
            "[&_pre]:my-2 [&_pre]:text-[11px]",
          )}>
            <ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: false }]]}>
              {vizMarkersAll(message.content) || (isStreaming ? "▋" : "")}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
