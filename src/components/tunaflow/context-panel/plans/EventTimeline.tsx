import { useState } from "react";
import { cn } from "@/lib/utils";
import { Clock, GitBranch, ChevronDown } from "lucide-react";
import type { PlanEvent, Branch } from "@/types";

interface TimelineEntry {
  id: string;
  timestamp: number;
  type: "event" | "branch";
  label: string;
  actor?: string;
  branchId?: string;
  branchStatus?: string;
}

interface UnifiedTimelineProps {
  events: PlanEvent[];
  branches: Branch[];
  onOpenBranch?: (branchId: string) => void;
}

export function EventTimeline({ events, branches, onOpenBranch }: UnifiedTimelineProps) {
  const [expanded, setExpanded] = useState(false);

  // Merge events + branches into unified timeline
  const entries: TimelineEntry[] = [
    ...events.map((ev) => ({
      id: ev.id,
      timestamp: ev.createdAt * 1000, // events use seconds
      type: "event" as const,
      label: ev.eventType.replace(/_/g, " "),
      actor: ev.actor ?? undefined,
    })),
    ...branches.map((b) => ({
      id: b.id,
      timestamp: b.createdAt, // branches use milliseconds
      type: "branch" as const,
      label: b.label ?? b.id.slice(0, 8),
      branchId: b.id,
      branchStatus: b.status,
    })),
  ].sort((a, b) => a.timestamp - b.timestamp);

  if (entries.length === 0) return null;

  const formatTs = (ms: number) => {
    const d = new Date(ms);
    return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div className="mt-2 pt-2 border-t border-border/20">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 mb-1 w-full text-left hover:text-foreground/60 transition-colors"
      >
        <ChevronDown className={cn("w-3 h-3 text-muted-foreground/40 transition-transform", !expanded && "-rotate-90")} />
        <Clock className="w-3 h-3 text-muted-foreground/40" />
        <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wide">
          Timeline ({entries.length})
        </span>
      </button>
      {expanded && (
        <div className="space-y-0.5 ml-1 border-l border-border/20 pl-2">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-start gap-1.5 text-[9px] text-muted-foreground/60">
              <span className="shrink-0 text-muted-foreground/30 tabular-nums">{formatTs(entry.timestamp)}</span>
              {entry.type === "branch" ? (
                <button
                  onClick={() => entry.branchId && onOpenBranch?.(entry.branchId)}
                  className="flex items-center gap-1 hover:text-primary transition-colors text-left"
                >
                  <GitBranch className="w-2.5 h-2.5 shrink-0" />
                  <span className="truncate">{entry.label}</span>
                  {entry.branchStatus && (
                    <span className={cn(
                      "text-[7px] px-1 rounded",
                      entry.branchStatus === "archived" ? "text-muted-foreground/30 bg-accent/30" : "text-primary/50 bg-primary/10"
                    )}>{entry.branchStatus}</span>
                  )}
                </button>
              ) : (
                <span>
                  {entry.label}
                  {entry.actor && <span className="text-foreground/50"> ({entry.actor})</span>}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
