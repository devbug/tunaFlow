import { useState } from "react";
import { FolderOpen, Plus, Clock } from "lucide-react";
import { useChatStore } from "@/stores/chatStore";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { setSetting } from "@/lib/appStore";
import { basename } from "@/lib/utils";

export function ProjectStartup() {
  const projects = useChatStore((s) => s.projects);
  const selectProject = useChatStore((s) => s.selectProject);
  const createProject = useChatStore((s) => s.createProject);
  const loadProjects = useChatStore((s) => s.loadProjects);
  const [adding, setAdding] = useState(false);

  const handleOpenFolder = async () => {
    setAdding(true);
    try {
      const selected = await open({ directory: true, title: "Select project folder" });
      if (selected && typeof selected === "string") {
        const name = basename(selected, "Project");
        const key = `proj-${Date.now()}`;
        await createProject({ key, name, type: "project", source: "configured", path: selected });
        await loadProjects();
        await selectProject(key);
        setSetting("lastProjectKey", key);
        toast.success(`Project initialized: ${name}`, {
          description: "Created CLAUDE.md + docs/ structure. Edit CLAUDE.md to customize agent rules.",
          duration: 6000,
        });
      }
    } catch { /* cancelled */ }
    finally { setAdding(false); }
  };

  const handleSelectRecent = async (key: string) => {
    await selectProject(key);
    setSetting("lastProjectKey", key);
  };

  return (
    <div className="flex items-center justify-center h-screen w-screen bg-sidebar text-foreground">
      <div className="w-[400px] space-y-6">
        {/* Logo / Title */}
        <div className="text-center">
          <h1 className="text-[24px] font-bold text-foreground">tunaFlow</h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            Of the agent, By the agent, For the agent
          </p>
        </div>

        {/* Open project */}
        <button
          onClick={handleOpenFolder}
          disabled={adding}
          className="w-full flex items-center gap-3 px-5 py-4 rounded-xl border border-border/40 bg-background hover:bg-accent/30 transition-colors text-left"
        >
          <FolderOpen className="w-5 h-5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-[14px] font-medium text-foreground block">Open Project</span>
            <span className="text-[12px] text-muted-foreground">Select a project folder to start</span>
          </div>
          <Plus className="w-4 h-4 text-muted-foreground/40" />
        </button>

        {/* Recent projects */}
        {projects.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <Clock className="w-3.5 h-3.5 text-muted-foreground/40" />
              <span className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider">Recent Projects</span>
            </div>
            <div className="space-y-1">
              {projects.slice(0, 5).map((p) => (
                <button
                  key={p.key}
                  onClick={() => handleSelectRecent(p.key)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-border/20 hover:border-border/40 hover:bg-accent/20 transition-colors text-left"
                >
                  <FolderOpen className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-[13px] font-medium text-foreground/80 block truncate">{p.name}</span>
                    {p.path && <span className="text-[11px] text-muted-foreground/40 block truncate">{p.path}</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
