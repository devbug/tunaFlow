import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useChatStore } from "@/stores/chatStore";

/**
 * Custom title bar — overlays the macOS traffic light area.
 * Shows: tunaFlow / projectName / gitBranch
 */
export function TitleBar() {
  const selectedProjectKey = useChatStore((s) => s.selectedProjectKey);
  const projects = useChatStore((s) => s.projects);
  const project = projects.find((p) => p.key === selectedProjectKey);
  const projectName = project?.name ?? "";

  const [gitBranch, setGitBranch] = useState<string | null>(null);
  useEffect(() => {
    if (!project?.path) { setGitBranch(null); return; }
    invoke<{ isRepo: boolean; branch: string | null; dirty: boolean }>("get_git_status", { projectPath: project.path })
      .then((s) => setGitBranch(s.isRepo ? s.branch : null))
      .catch(() => setGitBranch(null));
    const interval = setInterval(() => {
      if (!project?.path) return;
      invoke<{ isRepo: boolean; branch: string | null; dirty: boolean }>("get_git_status", { projectPath: project.path })
        .then((s) => setGitBranch(s.isRepo ? s.branch : null))
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(interval);
  }, [project?.path]);

  return (
    <div
      data-tauri-drag-region
      className="h-[28px] shrink-0 flex items-center justify-center select-none bg-sidebar"
    >
      <div data-tauri-drag-region className="flex items-center gap-0">
        <span data-tauri-drag-region className="text-[11px] font-bold text-foreground/70 tracking-wide">
          tunaFlow
        </span>

        {projectName && (
          <>
            <span data-tauri-drag-region className="mx-2 text-[6px] text-muted-foreground/30">●</span>
            <span data-tauri-drag-region className="text-[11px] font-medium text-foreground/45 truncate max-w-[160px]">
              {projectName}
            </span>
          </>
        )}

        {gitBranch && (
          <>
            <span data-tauri-drag-region className="mx-2 text-[6px] text-muted-foreground/25">●</span>
            <span data-tauri-drag-region className="text-[10px] font-mono text-muted-foreground/35 truncate max-w-[180px]">
              {gitBranch}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
