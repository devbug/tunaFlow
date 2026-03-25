"use client";

import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { ChatPanel } from "./ChatPanel";
import { BranchThreadPanel } from "./BranchThreadPanel";
import { MOCK_PROJECTS } from "@/lib/tunaflow-data";

export function AppShell() {
  const [activeConversationId, setActiveConversationId] = useState("c1");
  const [activeBranch, setActiveBranch] = useState<{ id: string; label: string } | null>(null);
  const [branchThreadOpen, setBranchThreadOpen] = useState(false);

  const allConversations = MOCK_PROJECTS.flatMap((p) => p.conversations);
  const activeConversation = allConversations.find((c) => c.id === activeConversationId);

  const handleBranchClick = (branchId: string, label: string) => {
    setActiveBranch({ id: branchId, label });
    setBranchThreadOpen(true);
  };

  const handleCloseBranch = () => {
    setBranchThreadOpen(false);
    setTimeout(() => setActiveBranch(null), 300); // delay for animation
  };

  const handleAdoptBranch = () => {
    // Adopt branch logic
    handleCloseBranch();
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground font-sans">
      {/* Left: Sidebar */}
      <Sidebar
        activeConversationId={activeConversationId}
        onSelectConversation={setActiveConversationId}
      />

      {/* Center: Chat/Workspace */}
      <main className="flex-1 flex min-w-0 h-full">
        <ChatPanel
          conversationId={activeConversationId}
          conversationType={activeConversation?.type ?? "chat"}
          activeBranch={activeBranch}
          onBranchClick={handleBranchClick}
        />

        {/* Right: Branch Thread Panel (overlay style) */}
        {branchThreadOpen && activeBranch && (
          <BranchThreadPanel
            branch={activeBranch}
            onClose={handleCloseBranch}
            onAdopt={handleAdoptBranch}
          />
        )}
      </main>
    </div>
  );
}
