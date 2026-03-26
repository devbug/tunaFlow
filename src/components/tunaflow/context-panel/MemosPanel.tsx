import { useChatStore } from "@/stores/chatStore";

export function MemosPanel() {
  const { memos, deleteMemo } = useChatStore();

  return (
    <div className="space-y-2">
      {memos.length === 0 && (
        <p className="text-xs text-muted-foreground px-2">No memos yet. Hover over a message and click Memo.</p>
      )}
      {memos.map((m) => (
        <div key={m.id} className="group rounded-lg border border-border bg-card p-3 transition-colors hover:border-border/80">
          <div className="flex items-start gap-2">
            <p className="flex-1 text-xs text-foreground leading-relaxed">{m.content.slice(0, 150)}{m.content.length > 150 ? "..." : ""}</p>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <p className="text-[10px] text-muted-foreground font-mono flex-1">
              {new Date(m.createdAt).toLocaleString()}
            </p>
            <button
              onClick={() => deleteMemo(m.id)}
              className="opacity-0 group-hover:opacity-100 text-[10px] text-destructive hover:underline transition-opacity"
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
