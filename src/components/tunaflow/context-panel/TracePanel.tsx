import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import { Activity, Clock, Cpu, DollarSign, RefreshCw } from "lucide-react";

interface TraceSpan {
  id: number;
  conversationId: string;
  traceId: string | null;
  spanId: string | null;
  parentSpanId: string | null;
  operation: string | null;
  engine: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number | null;
  status: string | null;
  recordedAt: number;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTime(epoch: number): string {
  const d = new Date(epoch * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function TracePanel() {
  const {
    selectedConversationId,
    activeBranchId,
    runningThreadIds,
    messageQueue,
    rawqStatus,
  } = useChatStore();

  const [spans, setSpans] = useState<TraceSpan[]>([]);
  const [loading, setLoading] = useState(false);

  const convId = activeBranchId
    ? `branch:${activeBranchId}`
    : selectedConversationId;

  const loadTraces = async () => {
    if (!convId) return;
    setLoading(true);
    try {
      const data = await invoke<TraceSpan[]>("list_traces", {
        conversationId: convId,
        traceId: null,
      });
      setSpans(data);
    } catch {
      setSpans([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTraces();
  }, [convId]);

  const threadRunning = convId ? runningThreadIds.includes(convId) : false;
  const queuedCount = convId
    ? messageQueue.filter((q) => q.threadId === convId).length
    : 0;

  // Aggregate stats
  const totalInputTokens = spans.reduce((s, sp) => s + sp.inputTokens, 0);
  const totalOutputTokens = spans.reduce((s, sp) => s + sp.outputTokens, 0);
  const totalCost = spans.reduce((s, sp) => s + sp.costUsd, 0);

  if (!convId) {
    return <p className="text-xs text-muted-foreground px-2">No conversation selected.</p>;
  }

  return (
    <div className="space-y-3">
      {/* Live status */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className={cn(
            "w-2 h-2 rounded-full shrink-0",
            threadRunning ? "bg-primary animate-pulse" : "bg-muted-foreground/30"
          )} />
          <span className="text-[11px] font-medium text-foreground">
            {threadRunning ? "Running" : "Idle"}
          </span>
          {queuedCount > 0 && (
            <span className="text-[10px] text-muted-foreground bg-accent px-1.5 py-0.5 rounded-full">
              {queuedCount} queued
            </span>
          )}
        </div>

        {rawqStatus && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Cpu className="w-3 h-3 shrink-0" />
            <span>rawq: {rawqStatus.status}</span>
            {rawqStatus.files != null && (
              <span className="text-muted-foreground/50">({rawqStatus.files} files)</span>
            )}
          </div>
        )}
      </div>

      {/* Aggregate stats */}
      {spans.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5">
          <div className="rounded-md bg-accent/50 px-2 py-1.5 text-center">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Input</p>
            <p className="text-[11px] font-semibold text-foreground">{totalInputTokens.toLocaleString()}</p>
          </div>
          <div className="rounded-md bg-accent/50 px-2 py-1.5 text-center">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Output</p>
            <p className="text-[11px] font-semibold text-foreground">{totalOutputTokens.toLocaleString()}</p>
          </div>
          <div className="rounded-md bg-accent/50 px-2 py-1.5 text-center">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Cost</p>
            <p className="text-[11px] font-semibold text-foreground">{formatCost(totalCost)}</p>
          </div>
        </div>
      )}

      {/* Span list */}
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Spans ({spans.length})
        </h4>
        <button
          onClick={loadTraces}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh"
        >
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
        </button>
      </div>

      {loading && spans.length === 0 && (
        <p className="text-[10px] text-muted-foreground">Loading...</p>
      )}

      {!loading && spans.length === 0 && (
        <div className="text-center py-4">
          <Activity className="w-5 h-5 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No trace data yet.</p>
          <p className="text-[10px] text-muted-foreground/60 mt-1">Traces are recorded after agent runs.</p>
        </div>
      )}

      <div className="space-y-1">
        {spans.map((sp) => (
          <div
            key={sp.id}
            className="rounded-md border border-border/50 bg-card px-2.5 py-1.5 text-[10px]"
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              {sp.engine && (
                <span className="font-semibold text-primary/80">{sp.engine}</span>
              )}
              {sp.operation && (
                <span className="text-muted-foreground">{sp.operation}</span>
              )}
              <span className="flex-1" />
              <span className={cn(
                "font-medium",
                sp.status === "ok" ? "text-status-approved" : sp.status === "error" ? "text-status-rejected" : "text-muted-foreground"
              )}>
                {sp.status || "—"}
              </span>
            </div>
            <div className="flex items-center gap-3 text-muted-foreground/70">
              <span className="flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />
                {formatDuration(sp.durationMs)}
              </span>
              <span>{sp.inputTokens + sp.outputTokens} tok</span>
              <span className="flex items-center gap-0.5">
                <DollarSign className="w-2.5 h-2.5" />
                {formatCost(sp.costUsd)}
              </span>
              <span className="ml-auto">{formatTime(sp.recordedAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
