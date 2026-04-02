import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import { Link2, Sparkles, Pin } from "lucide-react";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface SessionLink {
  id: string;
  conversationId: string;
  linkedConvId: string;
  linkedConvLabel: string | null;
  score: number;
  method: string;
  createdAt: number;
}

export function CrossSessionPanel() {
  const conversations = useChatStore((s) => s.conversations);
  const selectedConversationId = useChatStore((s) => s.selectedConversationId);
  const [sessionLinks, setSessionLinks] = useState<SessionLink[]>([]);
  const [loading, setLoading] = useState(false);

  const loadLinks = async () => {
    if (!selectedConversationId) return;
    try {
      const links = await invoke<SessionLink[]>("get_session_links", {
        conversationId: selectedConversationId,
      });
      setSessionLinks(links);
    } catch {
      setSessionLinks([]);
    }
  };

  useEffect(() => {
    loadLinks();
  }, [selectedConversationId]);

  const handleRefresh = async () => {
    if (!selectedConversationId) return;
    setLoading(true);
    try {
      const links = await invoke<SessionLink[]>("refresh_session_links", {
        conversationId: selectedConversationId,
      });
      setSessionLinks(links);
    } catch (e) {
      console.error("[CrossSession] refresh failed", e);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleManual = async (linkedConvId: string) => {
    if (!selectedConversationId) return;
    try {
      const links = await invoke<SessionLink[]>("toggle_manual_session_link", {
        conversationId: selectedConversationId,
        linkedConvId,
      });
      setSessionLinks(links);
    } catch (e) {
      console.error("[CrossSession] toggle failed", e);
    }
  };

  const autoLinks = sessionLinks.filter((l) => l.method === "fts5" || l.method === "hybrid");
  const manualLinks = sessionLinks.filter((l) => l.method === "manual");
  const linkedIds = new Set(sessionLinks.map((l) => l.linkedConvId));

  // Other conversations available for manual linking
  const others = conversations.filter(
    (c) =>
      c.id !== selectedConversationId &&
      c.mode !== "roundtable" &&
      !c.id.startsWith("branch:") &&
      !linkedIds.has(c.id)
  );

  return (
    <div className="space-y-3">
      {/* Auto-discovered section */}
      <div>
        <div className="flex items-center justify-between px-2 mb-1.5">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider font-medium flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> Auto-discovered
            {autoLinks.length > 0 && <span className="ml-0.5">({autoLinks.length})</span>}
          </p>
          <button
            className="text-[10px] text-muted-foreground/50 hover:text-foreground/70 transition-colors"
            onClick={handleRefresh}
            disabled={loading}
          >
            {loading ? "..." : "refresh"}
          </button>
        </div>
        {autoLinks.length === 0 && (
          <p className="text-[10px] text-muted-foreground/40 px-2">
            No related sessions found. Click refresh to discover.
          </p>
        )}
        {autoLinks.map((link) => (
          <div
            key={link.id}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-primary/5 hover:bg-primary/10 transition-colors"
          >
            <Link2 className="w-3 h-3 shrink-0 text-primary/60" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-foreground truncate">
                {link.linkedConvLabel ?? link.linkedConvId.slice(0, 8)}
              </p>
            </div>
            <span className="text-[8px] text-muted-foreground/40 tabular-nums">
              {(link.score * 100).toFixed(0)}%
            </span>
            <button
              className="text-[10px] text-muted-foreground/40 hover:text-primary transition-colors"
              onClick={() => handleToggleManual(link.linkedConvId)}
              title="Pin as manual link"
            >
              <Pin className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Manual pinned section */}
      {manualLinks.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider font-medium px-2 mb-1.5 flex items-center gap-1">
            <Pin className="w-3 h-3" /> Pinned ({manualLinks.length})
          </p>
          {manualLinks.map((link) => (
            <div
              key={link.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-accent/50 hover:bg-accent transition-colors"
            >
              <Link2 className="w-3 h-3 shrink-0 text-primary" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-foreground truncate">
                  {link.linkedConvLabel ?? link.linkedConvId.slice(0, 8)}
                </p>
              </div>
              <button
                className="text-[10px] text-muted-foreground/40 hover:text-destructive transition-colors"
                onClick={() => handleToggleManual(link.linkedConvId)}
                title="Unpin"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Available for manual linking */}
      {others.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider font-medium px-2 mb-1.5">
            Available
          </p>
          {others.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-accent transition-colors cursor-pointer"
              onClick={() => handleToggleManual(c.id)}
            >
              <Link2 className="w-3 h-3 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-foreground truncate">{c.customLabel ?? c.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
