"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Project, Conversation } from "@/lib/tunaflow-types";
import { MOCK_PROJECTS } from "@/lib/tunaflow-data";
import {
  FolderOpen,
  Folder,
  MessageSquare,
  Users,
  Plus,
  Search,
  ChevronRight,
  ChevronDown,
  Settings,
  Waves,
} from "lucide-react";

interface SidebarProps {
  activeConversationId: string;
  onSelectConversation: (id: string) => void;
}

function ConversationItem({
  conv,
  isActive,
  onSelect,
}: {
  conv: Conversation;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "group w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left transition-colors",
        isActive
          ? "bg-primary/15 text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-accent"
      )}
    >
      {conv.type === "roundtable" ? (
        <Users className="w-3.5 h-3.5 shrink-0 text-agent-gemini" />
      ) : (
        <MessageSquare className="w-3.5 h-3.5 shrink-0" />
      )}
      <span className="flex-1 text-xs truncate">{conv.title}</span>
      {isActive && (
        <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
      )}
    </button>
  );
}

function ProjectItem({
  project,
  activeConversationId,
  onSelect,
}: {
  project: Project;
  activeConversationId: string;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(project.isExpanded ?? false);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="group w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        )}
        {expanded ? (
          <FolderOpen className="w-3.5 h-3.5 text-primary shrink-0" />
        ) : (
          <Folder className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="flex-1 text-xs font-medium text-foreground truncate">
          {project.name}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {project.conversations.length}
        </span>
      </button>
      {expanded && (
        <div className="ml-4 mt-0.5 space-y-0.5">
          {project.conversations.map((conv) => (
            <ConversationItem
              key={conv.id}
              conv={conv}
              isActive={conv.id === activeConversationId}
              onSelect={() => onSelect(conv.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ activeConversationId, onSelectConversation }: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const allConvs = MOCK_PROJECTS.flatMap((p) => p.conversations);
  const filtered = searchQuery
    ? allConvs.filter((c) => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
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
      <div className="px-3 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2 bg-input rounded-md px-2.5 py-1.5">
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <input
            className="flex-1 text-xs bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {searchQuery && filtered ? (
          <div className="space-y-0.5">
            <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Results
            </p>
            {filtered.length === 0 && (
              <p className="px-2 text-xs text-muted-foreground">No results</p>
            )}
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conv={conv}
                isActive={conv.id === activeConversationId}
                onSelect={() => onSelectConversation(conv.id)}
              />
            ))}
          </div>
        ) : (
          <>
            {/* Quick links */}
            <div>
              <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                Workspace
              </p>
              <div className="space-y-0.5">
                <button className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <Users className="w-3.5 h-3.5 text-agent-gemini" />
                  All Roundtables
                </button>
                <button className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <MessageSquare className="w-3.5 h-3.5" />
                  All Chats
                </button>
              </div>
            </div>

            {/* Projects */}
            <div>
              <div className="flex items-center justify-between px-2 mb-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Projects
                </p>
                <button className="text-muted-foreground hover:text-foreground transition-colors">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="space-y-0.5">
                {MOCK_PROJECTS.map((project) => (
                  <ProjectItem
                    key={project.id}
                    project={project}
                    activeConversationId={activeConversationId}
                    onSelect={onSelectConversation}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="px-3 py-2.5 border-t border-border shrink-0 flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-primary/30 flex items-center justify-center text-[10px] font-bold text-primary">
          JD
        </div>
        <span className="text-xs text-muted-foreground flex-1 truncate">Jane Doe</span>
        <button className="text-muted-foreground hover:text-foreground transition-colors">
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>
    </aside>
  );
}
