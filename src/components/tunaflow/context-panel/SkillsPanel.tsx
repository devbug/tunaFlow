import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import { Zap } from "lucide-react";

export function SkillsPanel() {
  const { skills, activeSkills, toggleSkill, loadSkills } = useChatStore();

  useEffect(() => {
    loadSkills();
  }, []);

  if (skills.length === 0) {
    return <p className="text-xs text-muted-foreground px-2">No skills found. Add SKILL.md files to ~/.tunaflow/skills/.</p>;
  }

  return (
    <div className="space-y-1.5">
      {skills.map((skill) => {
        const isActive = activeSkills.includes(skill.name);
        return (
          <div
            key={skill.name}
            className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-accent transition-colors"
          >
            <Zap className={cn("w-3.5 h-3.5 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground">{skill.name}</p>
              {skill.description && (
                <p className="text-[10px] text-muted-foreground truncate">{skill.description}</p>
              )}
            </div>
            <button
              onClick={() => toggleSkill(skill.name)}
              className={cn("relative w-8 h-4 rounded-full transition-colors shrink-0", isActive ? "bg-primary" : "bg-muted")}
            >
              <span className={cn("absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow-sm", isActive ? "translate-x-4" : "translate-x-0.5")} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
