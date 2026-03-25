import { useState } from "react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import {
  FolderOpen,
  Folder,
  MessageSquare,
  Users,
  Plus,
  Search,
  ChevronRight,
  ChevronDown,
  Waves,
  Trash2,
} from "lucide-react";

export function Sidebar() {
  const {
    projects,
    selectedProjectKey,
    selectProject,
    conversations,
    selectedConversationId,
    selectConversation,
    createConversation,
    deleteConversation,
    activeBranchId,
  } = useChatStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set(selectedProjectKey ? [selectedProjectKey] : [])
  );

  const toggleProject = (key: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const handleSelectProject = async (key: string) => {
    await selectProject(key);
    setExpandedProjects((prev) => new Set([...prev, key]));
  };

  const handleCreate = async (mode: "chat" | "roundtable") => {
    if (!selectedProjectKey) return;
    const label =
      mode === "roundtable"
        ? `Roundtable ${conversations.filter((c) => c.mode === "roundtable").length + 1}`
        : `Conversation ${conversations.length + 1}`;
    const conv = await createConversation({
      projectKey: selectedProjectKey,
      label,
      type: "main",
      mode,
      source: "tunadish",
    });
    await selectConversation(conv.id);
  };

  const handleDelete = async (id: string, label: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`"${label}" 대화를 삭제하시겠습니까?\n\n포함된 메시지, 브랜치, 메모, 아티팩트가 모두 삭제됩니다.`)) return;
    await deleteConversation(id);
  };

  // Conversations for selected project (exclude branch: shadow convs from list)
  const visibleConvs = conversations.filter((c) => !c.id.startsWith("branch:"));

  const filtered = searchQuery.trim()
    ? visibleConvs.filter((c) =>
        (c.customLabel ?? c.label).toLowerCase().includes(searchQuery.toLowerCase())
      )
    : null;

  return (
    <aside className="flex flex-col w-56 shrink-0 bg-sidebar border-r border-border h-full overflow-hidden">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-3.5 border-b border-border shrink-0">
        <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
          <Waves className="w-4 h-4 text-primary" />
        </div>
        <span className="font-semibold text-sm text-foreground tracking-tight">tunaFlow</span>
        <span className="ml-auto text-[10px] text-muted-foreground bg-accent px-1.5 py-0.5 rounded font-mono">
          beta
        </span>
      </div>

      {/* Search */}
      {selectedProjectKey && (
        <div className="px-3 py-2.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2 bg-input rounded-md px-2.5 py-1.5">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <input
              className="flex-1 text-xs bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {/* Projects */}
        <div>
          <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            Projects
          </p>
          <div className="space-y-0.5">
            {projects.map((project) => {
              const isSelected = project.key === selectedProjectKey;
              const isExpanded = expandedProjects.has(project.key);
              const projectConvs = isSelected ? (filtered ?? visibleConvs) : [];

              return (
                <div key={project.key}>
                  <button
                    onClick={() => {
                      handleSelectProject(project.key);
                      toggleProject(project.key);
                    }}
                    className="group w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors"
                  >
                    {isExpanded && isSelected ? (
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                    {isExpanded && isSelected ? (
                      <FolderOpen className="w-3.5 h-3.5 text-primary shrink-0" />
                    ) : (
                      <Folder className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="flex-1 text-xs font-medium text-foreground truncate">{project.name}</span>
                    {isSelected && (
                      <span className="text-[10px] text-muted-foreground">
                        {visibleConvs.length}
                      </span>
                    )}
                  </button>

                  {isSelected && isExpanded && (
                    <div className="ml-4 mt-0.5 space-y-0.5">
                      {/* Conversations */}
                      {projectConvs.length === 0 && (
                        <p className="px-2 text-xs text-muted-foreground py-1">No conversations</p>
                      )}
                      {projectConvs.map((conv) => {
                        const isActive = conv.id === selectedConversationId || (activeBranchId && false);
                        const label = conv.customLabel ?? conv.label;
                        return (
                          <button
                            key={conv.id}
                            onClick={() => selectConversation(conv.id)}
                            className={cn(
                              "group w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left transition-colors",
                              isActive
                                ? "bg-primary/15 text-foreground"
                                : "text-muted-foreground hover:text-foreground hover:bg-accent"
                            )}
                          >
                            {conv.mode === "roundtable" ? (
                              <Users className="w-3.5 h-3.5 shrink-0 text-agent-gemini" />
                            ) : (
                              <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                            )}
                            <span className="flex-1 text-xs truncate">{label}</span>
                            {isActive && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                            <button
                              onClick={(e) => handleDelete(conv.id, label, e)}
                              className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-destructive transition-all"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </button>
                        );
                      })}

                      {/* Create buttons */}
                      <div className="flex gap-1 pt-1">
                        <button
                          onClick={() => handleCreate("chat")}
                          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                          New
                        </button>
                        <button
                          onClick={() => handleCreate("roundtable")}
                          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs text-agent-gemini hover:bg-agent-gemini/10 transition-colors"
                        >
                          <Users className="w-3 h-3" />
                          RT
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </nav>
    </aside>
  );
}
