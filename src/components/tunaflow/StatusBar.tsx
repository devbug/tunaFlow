import { Users, MessageSquare, GitBranch, Zap, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatusBarProps {
  mode: "chat" | "roundtable";
  branch?: { id: string; label: string } | null;
  agentCount?: number;
  activeSkills?: number;
  crossSessionCount?: number;
}

export function StatusBar({
  mode,
  branch,
  agentCount = 3,
  activeSkills = 0,
  crossSessionCount = 0,
}: StatusBarProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-card border-b border-border text-xs font-medium text-muted-foreground overflow-x-auto shrink-0">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-accent rounded-full shrink-0">
        {mode === "roundtable" ? (
          <>
            <Users className="w-3 h-3" />
            <span>Roundtable</span>
          </>
        ) : (
          <>
            <MessageSquare className="w-3 h-3" />
            <span>Chat</span>
          </>
        )}
      </div>

      {branch && (
        <>
          <div className="w-px h-4 bg-border" />
          <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 rounded-full border border-primary/20 text-primary shrink-0">
            <GitBranch className="w-3 h-3" />
            <span className="font-semibold">{branch.label}</span>
            <span className="ml-1 text-primary/60 text-[10px]">BRANCH</span>
          </div>
        </>
      )}

      {mode === "roundtable" && (
        <>
          <div className="w-px h-4 bg-border" />
          <div className="flex items-center gap-2 px-3 py-1.5 bg-accent/50 rounded-full shrink-0">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-agent-claude" />
              {agentCount} agents
            </span>
          </div>
        </>
      )}

      {(activeSkills > 0 || crossSessionCount > 0) && (
        <>
          <div className="w-px h-4 bg-border" />
          <div className={cn("flex items-center gap-3 px-3 py-1.5 bg-accent/30 rounded-full shrink-0")}>
            {activeSkills > 0 && (
              <span className="flex items-center gap-1.5">
                <Zap className="w-3 h-3 text-status-draft" />
                {activeSkills} skills
              </span>
            )}
            {activeSkills > 0 && crossSessionCount > 0 && (
              <span className="w-px h-3 bg-border/40" />
            )}
            {crossSessionCount > 0 && (
              <span className="flex items-center gap-1.5">
                <Link2 className="w-3 h-3 text-primary" />
                {crossSessionCount} ctx
              </span>
            )}
          </div>
        </>
      )}

      <div className="flex-1" />
    </div>
  );
}
