import { cn, AGENT_TEXT_COLORS, AGENT_DISPLAY_NAMES, formatTimestamp, normalizeEngine } from "@/lib/utils";
import { GitBranch, User } from "lucide-react";
import { AgentAvatar } from "../AgentAvatar";
import type { Message, Branch } from "@/types";
import { useEffect, useState } from "react";
import { getSetting } from "@/lib/appStore";

interface MessageMetaProps {
  message: Message;
  isCompact?: boolean;
  threadBranches?: Branch[];
  onOpenThread?: (branchId: string) => void;
}

interface CachedUserProfile { name: string; title: string; githubUsername: string }
let _cachedProfile: CachedUserProfile | null = null;

function useUserProfile(isUser: boolean) {
  const [profile, setProfile] = useState<CachedUserProfile | null>(_cachedProfile);

  const loadProfile = () => {
    getSetting<CachedUserProfile>("userProfile", { name: "", title: "", githubUsername: "" })
      .then((p) => { _cachedProfile = p; setProfile(p); });
  };

  useEffect(() => {
    if (!isUser) return;
    if (_cachedProfile) { setProfile(_cachedProfile); return; }
    loadProfile();
  }, [isUser]);

  // Re-load when profile is saved from Settings
  useEffect(() => {
    if (!isUser) return;
    const handler = () => { _cachedProfile = null; loadProfile(); };
    window.addEventListener("tunaflow:profile-changed", handler);
    return () => window.removeEventListener("tunaflow:profile-changed", handler);
  }, [isUser]);

  return profile;
}

export function MessageMeta({ message, isCompact = false, threadBranches, onOpenThread }: MessageMetaProps) {
  const isUser = message.role === "user";
  const isStreaming = message.status === "streaming";
  const engine = normalizeEngine(message.engine);
  const displayName = message.persona ?? (engine ? AGENT_DISPLAY_NAMES[engine] : "Assistant");
  const nameColorClass = engine ? AGENT_TEXT_COLORS[engine] : "text-foreground/80";
  const userProfile = useUserProfile(isUser);

  const avatarUrl = userProfile?.githubUsername
    ? `https://github.com/${userProfile.githubUsername}.png?size=40`
    : null;
  const userName = userProfile?.name || "You";

  return (
    <div className={cn("flex items-baseline gap-1.5 mb-1", isCompact && "mb-0.5")}>
      {/* Avatar */}
      <span className="self-center">
        {isUser && avatarUrl ? (
          <img
            src={avatarUrl}
            alt={userName}
            className="w-4 h-4 rounded-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : isUser ? (
          <User className="w-3.5 h-3.5 text-muted-foreground/40" />
        ) : (
          <AgentAvatar engine={message.engine} isUser={false} size="xs" />
        )}
      </span>
      {isUser ? (
        <div className={cn("flex items-baseline gap-1")}>
          <span className={cn("font-medium text-prose-base", isCompact ? "text-tf-sm" : "text-tf-caption")}>{userName}</span>
          {userProfile?.title && !isCompact && (
            <span className="text-prose-disabled text-tf-micro">{userProfile.title}</span>
          )}
        </div>
      ) : (
        <>
          <span className={cn("font-medium", nameColorClass, isCompact ? "text-tf-sm" : "text-tf-caption")}>
            {displayName}
          </span>
          {message.model && (
            <span className="text-prose-disabled font-mono text-tf-micro">{message.model}</span>
          )}
        </>
      )}
      <span className={cn("text-prose-disabled font-mono", isCompact ? "text-tf-micro" : "text-tf-xs")}>
        {formatTimestamp(message.timestamp)}
      </span>
      {!isUser && message.durationMs != null && message.durationMs > 0 && (
        <span className="text-prose-disabled font-mono text-tf-micro">
          {message.durationMs >= 60000
            ? `${Math.floor(message.durationMs / 60000)}m ${(message.durationMs % 60000 / 1000).toFixed(1)}s`
            : `${(message.durationMs / 1000).toFixed(1)}s`}
          {message.inputTokens || message.outputTokens ? " · " : ""}
          {message.inputTokens ? `${message.inputTokens}in` : ""}
          {message.inputTokens && message.outputTokens ? "/" : ""}
          {message.outputTokens ? `${message.outputTokens}out` : ""}
        </span>
      )}
      {/* Branch badges inline in header */}
      {threadBranches && threadBranches.length > 0 && !isCompact && threadBranches.map((branch) => (
        <button
          key={branch.id}
          onClick={(e) => { e.stopPropagation(); onOpenThread?.(branch.id); }}
          className="inline-flex items-center gap-0.5 text-tf-micro font-medium text-primary/80 bg-primary/10 hover:bg-primary/18 px-1.5 py-0.5 rounded transition-colors"
        >
          <GitBranch className="w-2 h-2" />
          <span className="truncate max-w-[60px]">{branch.customLabel ?? branch.label}</span>
          <span className={cn("uppercase",
            branch.status === "active" && "text-primary/70",
            branch.status === "adopted" && "text-status-approved/70",
          )}>{branch.status}</span>
        </button>
      ))}
      {isStreaming && (
        <span className="text-primary/50 font-mono text-tf-micro animate-pulse">streaming</span>
      )}
      {message.status === "error" && (
        <span className="text-destructive/60 font-mono text-tf-micro">error</span>
      )}
    </div>
  );
}
