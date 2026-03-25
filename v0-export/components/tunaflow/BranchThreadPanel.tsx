"use client";

import { X, Check, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageItem } from "./MessageItem";
import { MOCK_MESSAGES } from "@/lib/tunaflow-data";
import type { Message } from "@/lib/tunaflow-types";

interface BranchThreadPanelProps {
  branch: { id: string; label: string };
  onClose: () => void;
  onAdopt: () => void;
}

export function BranchThreadPanel({ branch, onClose, onAdopt }: BranchThreadPanelProps) {
  // Find messages related to this branch
  const branchMessages = MOCK_MESSAGES.filter(
    (msg) => msg.roundtableRound && (msg.roundtableRound === 1 || msg.roundtableRound === 2)
  ).slice(0, 3); // Show first 3 for demo

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-sidebar border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right-96 duration-300 z-50">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-4 py-4 border-b border-border shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <GitBranch className="w-4 h-4 text-primary shrink-0" />
            <h2 className="text-sm font-semibold text-foreground truncate">{branch.label}</h2>
            <span className="text-[10px] font-bold text-primary bg-primary/15 px-1.5 py-0.5 rounded-full ml-auto">
              ACTIVE
            </span>
          </div>
          <p className="text-xs text-muted-foreground">Parent: Freemium path</p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Thread messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="py-3 space-y-0.5">
          {branchMessages.map((msg) => (
            <MessageItem
              key={msg.id}
              message={msg}
              onBranch={() => {}}
              showRound={false}
              variant="compact"
            />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="flex gap-2 p-4 border-t border-border shrink-0">
        <button
          onClick={onClose}
          className="flex-1 px-3 py-2.5 rounded-lg border border-border text-foreground hover:bg-accent transition-colors font-medium text-sm"
        >
          Close
        </button>
        <button
          onClick={onAdopt}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors font-medium text-sm"
        >
          <Check className="w-4 h-4" />
          Adopt
        </button>
      </div>
    </div>
  );
}
