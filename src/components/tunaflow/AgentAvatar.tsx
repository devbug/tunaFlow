import { cn } from "@/lib/utils";
import { normalizeEngine } from "@/lib/utils";
import { User } from "lucide-react";

const ENGINE_ICONS: Record<string, string> = {
  claude: "/_resource/claude.png",
  codex: "/_resource/gpt.png",
  gemini: "/_resource/gemini.png",
  opencode: "/_resource/opencode.png",
};

interface AgentAvatarProps {
  engine?: string | null;
  isUser?: boolean;
  size?: "xs" | "sm" | "md";
  className?: string;
}

export function AgentAvatar({ engine, isUser, size = "md", className }: AgentAvatarProps) {
  const dim = size === "xs" ? "w-4 h-4" : size === "sm" ? "w-6 h-6" : "w-8 h-8";
  const iconDim = size === "xs" ? "w-2.5 h-2.5" : size === "sm" ? "w-3 h-3" : "w-4 h-4";

  if (isUser) {
    return (
      <div className={cn(dim, "rounded-full bg-foreground/8 flex items-center justify-center shrink-0", className)}>
        <User className={cn(iconDim, "text-foreground/50")} />
      </div>
    );
  }

  const normalized = normalizeEngine(engine ?? undefined);
  const iconSrc = normalized ? ENGINE_ICONS[normalized] : null;

  if (iconSrc) {
    const needsBg = normalized === "codex";
    return (
      <div className={cn(dim, "rounded-full shrink-0 flex items-center justify-center overflow-hidden",
        needsBg ? "bg-white" : "", className)}>
        <img src={iconSrc} alt={normalized ?? "agent"}
          className={cn(needsBg ? "w-[70%] h-[70%]" : "w-full h-full", "object-contain")} />
      </div>
    );
  }

  return (
    <div className={cn(dim, "rounded-full bg-accent flex items-center justify-center shrink-0 text-foreground/60 text-[11px] font-medium", className)}>
      ?
    </div>
  );
}
