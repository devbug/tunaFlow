import { cn } from "@/lib/utils";
import { ChevronRight, ChevronDown } from "lucide-react";

// ─── Tree primitives (Linear-inspired spacing) ──────────────────────────────

export const INDENT_PX = 10;
export const BASE_PAD = 12;

export function TreeRow({
  depth, active, isParent, icon, label, suffix, actions, onClick, className,
}: {
  depth: number; active?: boolean; isParent?: boolean; icon: React.ReactNode; label: React.ReactNode;
  suffix?: React.ReactNode; actions?: React.ReactNode; onClick?: () => void; className?: string;
}) {
  return (
    <div onClick={onClick}
      style={{ paddingLeft: BASE_PAD + depth * INDENT_PX }}
      className={cn(
        "group flex items-center gap-1.5 h-7 my-px cursor-pointer select-none transition-colors text-left pr-3 relative rounded-lg",
        active ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : isParent ? "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground/80",
        className,
      )}>
      <span className="shrink-0 w-4 flex items-center justify-center">{icon}</span>
      <span className="flex-1 min-w-0 text-[13px] font-medium truncate">{label}</span>
      {suffix}
      {actions && (
        <span className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {actions}
        </span>
      )}
    </div>
  );
}

export function SectionHeader({ title, expanded, onToggle, actions, className }: {
  title: string; expanded: boolean; onToggle: () => void; actions?: React.ReactNode; className?: string;
}) {
  return (
    <div onClick={onToggle}
      className={cn("group flex items-center h-7 px-3 mt-4 first:mt-1 cursor-pointer select-none hover:bg-sidebar-accent/50 transition-colors rounded-lg", className)}>
      {expanded ? <ChevronDown className="w-3 h-3 text-sidebar-foreground/40 shrink-0" />
        : <ChevronRight className="w-3 h-3 text-sidebar-foreground/40 shrink-0" />}
      <span className="text-[12px] font-medium text-muted-foreground pl-1.5 flex-1">{title}</span>
      {actions && <span className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">{actions}</span>}
    </div>
  );
}
