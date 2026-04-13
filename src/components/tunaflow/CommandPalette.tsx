import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { useChatStore } from "@/stores/chatStore";
import {
  MessageSquare,
  FolderOpen,
  ClipboardList,
  FileText,
  FileSearch,
  Lightbulb,
  Settings,
  Plus,
  Search,
} from "lucide-react";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const conversations = useChatStore((s) => s.conversations);
  const projects = useChatStore((s) => s.projects);
  const selectedConversationId = useChatStore((s) => s.selectedConversationId);
  const selectedProjectKey = useChatStore((s) => s.selectedProjectKey);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const selectProject = useChatStore((s) => s.selectProject);

  // Global keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Custom event trigger from TitleBar search bar
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("tunaflow:open-command-palette", handler);
    return () => window.removeEventListener("tunaflow:open-command-palette", handler);
  }, []);

  const otherConversations = conversations.filter(
    (c) => c.id !== selectedConversationId && !c.id.startsWith("branch:") && c.mode !== "roundtable"
  );

  const otherProjects = projects.filter((p) => p.key !== selectedProjectKey);

  // Tab switching via store setState (CenterPanel reads from URL-like state)
  const switchTab = (tab: string) => {
    // Dispatch custom event that CenterPanel listens for
    window.dispatchEvent(new CustomEvent("tunaflow:switch-tab", { detail: tab }));
    setOpen(false);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command Palette"
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={() => setOpen(false)}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-lg bg-background border border-border/60 rounded-xl shadow-2xl overflow-hidden">
        <Command.Input
          placeholder="Type a command or search..."
          className="w-full px-4 py-3 text-[13px] bg-transparent border-b border-border/30 outline-none placeholder:text-muted-foreground/40 text-foreground"
        />

        <Command.List className="max-h-[50vh] overflow-y-auto p-1.5">
          <Command.Empty className="py-6 text-center text-[12px] text-muted-foreground/50">
            No results found.
          </Command.Empty>

          {/* Tab switching */}
          <Command.Group heading="Tabs" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:text-muted-foreground/50 [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:font-medium">
            <PaletteItem icon={<MessageSquare />} onSelect={() => switchTab("chat")}>Chat</PaletteItem>
            <PaletteItem icon={<ClipboardList />} onSelect={() => switchTab("plan")}>Plan</PaletteItem>
            <PaletteItem icon={<FileText />} onSelect={() => switchTab("artifacts")}>Artifacts</PaletteItem>
            <PaletteItem icon={<FileSearch />} onSelect={() => switchTab("review")}>Review</PaletteItem>
            <PaletteItem icon={<Lightbulb />} onSelect={() => switchTab("insight")}>Insight</PaletteItem>
          </Command.Group>

          {/* Conversations */}
          {otherConversations.length > 0 && (
            <Command.Group heading="Conversations" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:text-muted-foreground/50 [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:font-medium">
              {otherConversations.slice(0, 10).map((c) => (
                <PaletteItem
                  key={c.id}
                  icon={<MessageSquare />}
                  onSelect={() => { selectConversation(c.id); setOpen(false); }}
                >
                  {c.customLabel ?? c.label}
                </PaletteItem>
              ))}
            </Command.Group>
          )}

          {/* Projects */}
          {otherProjects.length > 0 && (
            <Command.Group heading="Projects" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:text-muted-foreground/50 [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:font-medium">
              {otherProjects.map((p) => (
                <PaletteItem
                  key={p.key}
                  icon={<FolderOpen />}
                  onSelect={() => { selectProject(p.key); setOpen(false); }}
                >
                  {p.name}
                </PaletteItem>
              ))}
            </Command.Group>
          )}

          {/* Actions */}
          <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:text-muted-foreground/50 [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:font-medium">
            <PaletteItem
              icon={<Plus />}
              onSelect={() => {
                if (selectedProjectKey) {
                  useChatStore.getState().createConversation({ projectKey: selectedProjectKey, label: "New Chat" });
                }
                setOpen(false);
              }}
            >
              New Conversation
            </PaletteItem>
            <PaletteItem
              icon={<Search />}
              onSelect={() => { switchTab("chat"); /* focus search box via event */ }}
            >
              Search Messages
            </PaletteItem>
            <PaletteItem
              icon={<Settings />}
              onSelect={() => {
                window.dispatchEvent(new CustomEvent("tunaflow:open-settings"));
                setOpen(false);
              }}
            >
              Settings
            </PaletteItem>
            <PaletteItem
              icon={<span className="text-red-500">💀</span>}
              onSelect={async () => {
                setOpen(false);
                const { openDoom } = await import("./DoomModal");
                openDoom();
              }}
            >
              DOOM
            </PaletteItem>
          </Command.Group>
        </Command.List>

        <div className="border-t border-border/20 px-3 py-1.5 flex items-center justify-between text-[10px] text-muted-foreground/40">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </Command.Dialog>
  );
}

function PaletteItem({
  icon,
  children,
  onSelect,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12px] text-foreground/80 cursor-pointer transition-colors data-[selected=true]:bg-accent data-[selected=true]:text-foreground [&_svg]:w-3.5 [&_svg]:h-3.5 [&_svg]:text-muted-foreground/50"
    >
      {icon}
      <span className="truncate">{children}</span>
    </Command.Item>
  );
}
