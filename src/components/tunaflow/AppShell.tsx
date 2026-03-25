import { useEffect } from "react";
import { useChatStore } from "@/stores/chatStore";
import { Sidebar } from "./Sidebar";
import { ChatPanel } from "./ChatPanel";
import { ContextPanel } from "./ContextPanel";
import { BranchThreadPanel } from "./BranchThreadPanel";

export function AppShell() {
  const { loadProjects, createProject } = useChatStore();

  useEffect(() => {
    const init = async () => {
      await loadProjects();
      const { projects, selectProject } = useChatStore.getState();
      let proj = projects[0];
      if (!proj) {
        await createProject({ key: "default", name: "Workspace", type: "chat", source: "configured" });
        proj = useChatStore.getState().projects[0];
      }
      if (proj) selectProject(proj.key);
    };
    init();
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground font-sans">
      <Sidebar />
      <main className="flex-1 flex min-w-0 h-full">
        <ChatPanel />
        <BranchThreadPanel />
      </main>
      <ContextPanel />
    </div>
  );
}
