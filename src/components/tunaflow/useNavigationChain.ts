import { useMemo } from "react";
import type { Branch, Conversation } from "@/types";

export interface NavItem {
  id: string | null;
  label: string;
  isRT?: boolean;
}

export interface NavigationChain {
  fullChain: NavItem[];
  currentIdx: number;
  windowStart: number;
  visibleChain: NavItem[];
  hasLeftOverflow: boolean;
  hasRightOverflow: boolean;
}

/**
 * Build a breadcrumb navigation chain for the branch drawer.
 * [Main, ...ancestors, current, ...descendants]
 * Visible window: 2 items before + current + 2 items after.
 */
export function useNavigationChain(
  threadBranchId: string | null,
  threadBranchLabel: string | null,
  branches: Branch[],
  conversations: Conversation[],
  selectedConversationId: string | null,
): NavigationChain {
  return useMemo(() => {
    if (!threadBranchId) {
      return { fullChain: [], currentIdx: -1, windowStart: 0, visibleChain: [], hasLeftOverflow: false, hasRightOverflow: false };
    }

    const threadBranch = branches.find((b) => b.id === threadBranchId);
    const isRT = threadBranch?.mode === "roundtable";
    const chain: NavItem[] = [];

    // Walk up: ancestors
    let cur = threadBranch;
    while (cur?.parentBranchId) {
      const parent = branches.find((b) => b.id === cur?.parentBranchId);
      if (!parent) break;
      chain.unshift({ id: parent.id, label: parent.customLabel ?? parent.label, isRT: parent.mode === "roundtable" });
      cur = parent;
    }

    // Root conversation
    const conv = selectedConversationId ? conversations.find((c) => c.id === selectedConversationId) : null;
    chain.unshift({ id: null, label: conv?.customLabel ?? conv?.label ?? "Main" });

    // Current
    chain.push({ id: threadBranchId, label: threadBranchLabel ?? threadBranchId, isRT });
    const idx = chain.length - 1;

    // Walk down: descendants (most recent child at each level)
    let descendantId: string | null = threadBranchId;
    while (descendantId) {
      const children = branches
        .filter((b) => b.parentBranchId === descendantId)
        .sort((a, b) => b.createdAt - a.createdAt);
      if (children.length === 0) break;
      const child = children[0];
      chain.push({ id: child.id, label: child.customLabel ?? child.label, isRT: child.mode === "roundtable" });
      descendantId = child.id;
    }

    // Visible window: 2 before + current + 2 after
    const wStart = Math.max(0, idx - 2);
    const wEnd = Math.min(chain.length - 1, idx + 2);

    return {
      fullChain: chain,
      currentIdx: idx,
      windowStart: wStart,
      visibleChain: chain.slice(wStart, wEnd + 1),
      hasLeftOverflow: wStart > 0,
      hasRightOverflow: wEnd < chain.length - 1,
    };
  }, [threadBranchId, threadBranchLabel, branches, selectedConversationId, conversations]);
}
