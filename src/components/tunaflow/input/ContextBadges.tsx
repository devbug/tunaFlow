import { Zap, Link2 } from "lucide-react";

interface ContextBadgesProps {
  activeSkills: string[];
  crossSessionIds: string[];
}

function shortName(name: string): string {
  const idx = name.indexOf("-");
  return idx > 0 ? name.slice(idx + 1) : name;
}

export function ContextBadges({ activeSkills, crossSessionIds }: ContextBadgesProps) {
  if (activeSkills.length === 0 && crossSessionIds.length === 0) return null;

  return (
    <div className="flex items-center gap-1 mb-1 flex-wrap">
      {activeSkills.length > 0 && (
        <>
          <Zap className="w-2.5 h-2.5 text-status-draft/50 shrink-0" />
          {activeSkills.slice(0, 3).map((name) => (
            <span key={name} className="text-[8px] text-status-draft/50 bg-status-draft/6 px-1 py-px rounded truncate max-w-[80px]">
              {shortName(name)}
            </span>
          ))}
          {activeSkills.length > 3 && (
            <span className="text-[8px] text-status-draft/40">+{activeSkills.length - 3}</span>
          )}
        </>
      )}
      {crossSessionIds.length > 0 && (
        <span className="inline-flex items-center gap-1 text-[9px] font-medium text-primary/50 bg-primary/6 px-1 py-0.5 rounded">
          <Link2 className="w-2.5 h-2.5" />
          {crossSessionIds.length} linked
        </span>
      )}
    </div>
  );
}
