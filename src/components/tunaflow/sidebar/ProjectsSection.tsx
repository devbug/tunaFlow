import { cn } from "@/lib/utils";
import { FolderOpen, Folder, Loader2, Trash2 } from "lucide-react";
import { TreeRow } from "./TreeRow";
import type { Project } from "@/types";

interface ProjectsSectionProps {
  projects: Project[];
  selectedProjectKey: string | null;
  selectProject: (key: string) => void;
  hideProject?: (key: string) => void;
  /** Number of running threads for current project */
  runningCount?: number;
  /** Number of queued actions for current project */
  queuedCount?: number;
  /** Whether any thread is running in ANY project (including non-selected) */
  hasOtherRunning?: boolean;
}

export function ProjectsSection({
  projects, selectedProjectKey, selectProject, hideProject,
  runningCount = 0, queuedCount = 0, hasOtherRunning = false,
}: ProjectsSectionProps) {
  const currentProject = projects.find((p) => p.key === selectedProjectKey);

  return (
    <>
      <div className="px-2 mt-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50 pl-1">Projects</span>
      </div>
      <div className="mt-0.5">
        {projects.map((project) => {
          const isSelected = project.key === selectedProjectKey;
          const isRunning = isSelected && runningCount > 0;
          // Non-selected projects: show dot if there's running elsewhere
          const showOtherDot = !isSelected && hasOtherRunning;

          return (
            <TreeRow key={project.key} depth={0} active={isSelected}
              icon={isSelected
                ? <FolderOpen className="w-3.5 h-3.5 text-primary" />
                : <Folder className="w-3.5 h-3.5 text-sidebar-foreground/35" />}
              label={<span className={cn("truncate", isSelected && "font-medium")}>{project.name}</span>}
              suffix={
                <span className="flex items-center gap-1 shrink-0 mr-1">
                  {/* Running indicator */}
                  {isRunning && (
                    <span className="inline-flex items-center gap-0.5 text-[8px] text-primary/70" title={`${runningCount} running${queuedCount > 0 ? `, ${queuedCount} queued` : ""}`}>
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      {runningCount > 1 && runningCount}
                    </span>
                  )}
                  {isSelected && queuedCount > 0 && !isRunning && (
                    <span className="text-[8px] text-muted-foreground/40">{queuedCount}q</span>
                  )}
                  {/* Other project running dot */}
                  {showOtherDot && (
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-pulse" title="Running in another project" />
                  )}
                  {/* Path suffix for selected */}
                  {isSelected && currentProject?.path && (
                    <span className="text-[8px] text-sidebar-foreground/25 truncate max-w-[50px]" title={currentProject.path}>
                      {currentProject.path.split(/[\\/]/).pop()}
                    </span>
                  )}
                </span>
              }
              actions={hideProject ? (
                <button
                  onClick={(e) => { e.stopPropagation(); if (window.confirm(`"${project.name}" 프로젝트를 삭제하시겠습니까?\n(프로젝트 데이터는 보존되며, 같은 경로로 다시 추가할 수 있습니다)`)) hideProject(project.key); }}
                  className="p-0.5 rounded text-sidebar-foreground/20 hover:text-destructive transition-colors"
                  title="Delete project"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              ) : undefined}
              onClick={() => selectProject(project.key)} />
          );
        })}
      </div>
      <div className="mx-2 mt-2 mb-1 border-t border-white/[0.06]" />
    </>
  );
}
