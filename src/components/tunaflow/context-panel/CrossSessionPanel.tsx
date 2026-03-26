import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import { Link2 } from "lucide-react";

export function CrossSessionPanel() {
  const { conversations, selectedConversationId, crossSessionIds, toggleCrossSession } = useChatStore();
  const others = conversations.filter(
    (c) => c.id !== selectedConversationId && c.mode !== "roundtable" && !c.id.startsWith("branch:")
  );

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] text-muted-foreground mb-2 leading-relaxed px-2">
        Include context from other conversations to ground agent responses.
      </p>
      {others.length === 0 && (
        <p className="text-xs text-muted-foreground px-2">No other conversations available.</p>
      )}
      {others.map((c) => {
        const included = crossSessionIds.includes(c.id);
        return (
          <div
            key={c.id}
            className={cn("flex items-center gap-2.5 px-2 py-2 rounded-lg transition-colors cursor-pointer", included ? "bg-primary/10" : "hover:bg-accent")}
            onClick={() => toggleCrossSession(c.id)}
          >
            <Link2 className={cn("w-3.5 h-3.5 shrink-0", included ? "text-primary" : "text-muted-foreground")} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-foreground truncate">{c.customLabel ?? c.label}</p>
            </div>
            <button className={cn("relative w-8 h-4 rounded-full transition-colors shrink-0", included ? "bg-primary" : "bg-muted")}>
              <span className={cn("absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow-sm", included ? "translate-x-4" : "translate-x-0.5")} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
