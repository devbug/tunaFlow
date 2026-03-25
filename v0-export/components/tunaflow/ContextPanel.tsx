"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Branch, Artifact, Memo, Skill, CrossSession, ArtifactStatus } from "@/lib/tunaflow-types";
import {
  MOCK_BRANCHES,
  MOCK_ARTIFACTS,
  MOCK_MEMOS,
  MOCK_SKILLS,
  MOCK_CROSS_SESSIONS,
} from "@/lib/tunaflow-data";
import {
  GitBranch,
  FileText,
  StickyNote,
  Zap,
  Link2,
  ChevronDown,
  ChevronRight,
  Pin,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronLeft,
} from "lucide-react";

type PanelTab = "branch" | "artifacts" | "memos" | "skills" | "cross";

const TABS: { id: PanelTab; label: string; icon: React.ReactNode }[] = [
  { id: "branch", label: "Branch", icon: <GitBranch className="w-3.5 h-3.5" /> },
  { id: "artifacts", label: "Artifacts", icon: <FileText className="w-3.5 h-3.5" /> },
  { id: "memos", label: "Memos", icon: <StickyNote className="w-3.5 h-3.5" /> },
  { id: "skills", label: "Skills", icon: <Zap className="w-3.5 h-3.5" /> },
  { id: "cross", label: "Context", icon: <Link2 className="w-3.5 h-3.5" /> },
];

// ─── Branch Panel ───────────────────────────────────────────────────────────

function BranchNode({
  branch,
  depth = 0,
  onAdopt,
}: {
  branch: Branch;
  depth?: number;
  onAdopt: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = branch.children && branch.children.length > 0;

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors cursor-pointer",
          branch.isActive
            ? "bg-primary/15 text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-accent",
          depth > 0 && "ml-4"
        )}
        style={{ paddingLeft: `${(depth + 1) * 8}px` }}
        onClick={() => setExpanded(!expanded)}
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDown className="w-3 h-3 shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 shrink-0" />
          )
        ) : (
          <span className="w-3 h-3 shrink-0" />
        )}
        <GitBranch className={cn("w-3 h-3 shrink-0", branch.isActive && "text-primary")} />
        <span className="flex-1 text-xs truncate">{branch.label}</span>
        {branch.isActive && (
          <span className="text-[9px] text-primary font-semibold uppercase tracking-wide bg-primary/10 px-1 rounded">
            active
          </span>
        )}
        <span className="text-[10px] text-muted-foreground font-mono">{branch.messageCount}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAdopt(branch.id);
          }}
          className="opacity-0 group-hover:opacity-100 text-[10px] text-primary hover:underline"
        >
          adopt
        </button>
      </div>
      {hasChildren && expanded && branch.children?.map((child) => (
        <BranchNode key={child.id} branch={child} depth={depth + 1} onAdopt={onAdopt} />
      ))}
    </div>
  );
}

function BranchPanel({ onBranchSelect }: { onBranchSelect: (label: string) => void }) {
  const [branches, setBranches] = useState<Branch[]>(MOCK_BRANCHES);

  const handleAdopt = (id: string) => {
    setBranches((prev) =>
      prev.map((b) => ({ ...b, isActive: b.id === id }))
    );
    const branch = branches.find((b) => b.id === id);
    if (branch) onBranchSelect(branch.label);
  };

  return (
    <div className="space-y-1">
      {branches.map((branch) => (
        <BranchNode key={branch.id} branch={branch} onAdopt={handleAdopt} />
      ))}
      <button className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors mt-1">
        <Plus className="w-3.5 h-3.5" />
        New branch
      </button>
    </div>
  );
}

// ─── Artifacts Panel ─────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ArtifactStatus, { icon: React.ReactNode; class: string; label: string }> = {
  draft: {
    icon: <Clock className="w-3 h-3" />,
    class: "text-status-draft bg-status-draft/10 border-status-draft/30",
    label: "draft",
  },
  approved: {
    icon: <CheckCircle2 className="w-3 h-3" />,
    class: "text-status-approved bg-status-approved/10 border-status-approved/30",
    label: "approved",
  },
  rejected: {
    icon: <XCircle className="w-3 h-3" />,
    class: "text-status-rejected bg-status-rejected/10 border-status-rejected/30",
    label: "rejected",
  },
};

function ArtifactsPanel() {
  return (
    <div className="space-y-2">
      {MOCK_ARTIFACTS.map((artifact) => {
        const status = STATUS_CONFIG[artifact.status];
        return (
          <div
            key={artifact.id}
            className="rounded-lg border border-border bg-card p-3 hover:border-border/80 transition-colors cursor-pointer group"
          >
            <div className="flex items-start gap-2 mb-1.5">
              <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <span className="text-xs font-medium text-foreground flex-1 leading-snug">
                {artifact.title}
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border shrink-0",
                  status.class
                )}
              >
                {status.icon}
                {status.label}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2 ml-5">
              {artifact.excerpt}
            </p>
            <p className="text-[10px] text-muted-foreground font-mono mt-1.5 ml-5">
              {artifact.updatedAt}
            </p>
          </div>
        );
      })}
      <button className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
        <Plus className="w-3.5 h-3.5" />
        New artifact
      </button>
    </div>
  );
}

// ─── Memos Panel ─────────────────────────────────────────────────────────────

function MemosPanel() {
  const [memos, setMemos] = useState<Memo[]>(MOCK_MEMOS);
  const [newMemo, setNewMemo] = useState("");

  const togglePin = (id: string) => {
    setMemos((prev) =>
      prev.map((m) => (m.id === id ? { ...m, pinned: !m.pinned } : m))
    );
  };

  const sorted = [...memos].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  return (
    <div className="space-y-2">
      {sorted.map((memo) => (
        <div
          key={memo.id}
          className={cn(
            "group rounded-lg border p-3 transition-colors",
            memo.pinned
              ? "border-primary/30 bg-primary/5"
              : "border-border bg-card hover:border-border/80"
          )}
        >
          <div className="flex items-start gap-2">
            <p className="flex-1 text-xs text-foreground leading-relaxed">{memo.content}</p>
            <button
              onClick={() => togglePin(memo.id)}
              className={cn(
                "shrink-0 transition-colors",
                memo.pinned ? "text-primary" : "text-muted-foreground opacity-0 group-hover:opacity-100"
              )}
            >
              <Pin className="w-3 h-3" />
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground font-mono mt-1.5">{memo.createdAt}</p>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          value={newMemo}
          onChange={(e) => setNewMemo(e.target.value)}
          placeholder="Quick note..."
          className="flex-1 bg-input rounded-md px-2.5 py-1.5 text-xs outline-none text-foreground placeholder:text-muted-foreground border border-border focus:border-ring/50"
        />
        <button
          onClick={() => {
            if (!newMemo.trim()) return;
            setMemos((prev) => [
              ...prev,
              {
                id: `mem-${Date.now()}`,
                content: newMemo,
                createdAt: "just now",
                pinned: false,
              },
            ]);
            setNewMemo("");
          }}
          className="px-2 rounded-md bg-primary/15 text-primary text-xs hover:bg-primary/25 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Skills Panel ─────────────────────────────────────────────────────────────

function SkillsPanel() {
  const [skills, setSkills] = useState<Skill[]>(MOCK_SKILLS);

  const toggle = (id: string) => {
    setSkills((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    );
  };

  return (
    <div className="space-y-1.5">
      {skills.map((skill) => (
        <div
          key={skill.id}
          className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-accent transition-colors"
        >
          <Zap
            className={cn(
              "w-3.5 h-3.5 shrink-0",
              skill.enabled ? "text-primary" : "text-muted-foreground"
            )}
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground">{skill.name}</p>
            <p className="text-[10px] text-muted-foreground truncate">{skill.description}</p>
          </div>
          {/* Toggle */}
          <button
            onClick={() => toggle(skill.id)}
            className={cn(
              "relative w-8 h-4 rounded-full transition-colors shrink-0",
              skill.enabled ? "bg-primary" : "bg-muted"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow-sm",
                skill.enabled ? "translate-x-4" : "translate-x-0.5"
              )}
            />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Cross-Session Panel ──────────────────────────────────────────────────────

function CrossSessionPanel() {
  const [sessions, setSessions] = useState<CrossSession[]>(MOCK_CROSS_SESSIONS);

  const toggle = (id: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, included: !s.included } : s))
    );
  };

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] text-muted-foreground mb-2 leading-relaxed">
        Include context from other sessions to ground agent responses.
      </p>
      {sessions.map((session) => (
        <div
          key={session.id}
          className={cn(
            "flex items-center gap-2.5 px-2 py-2 rounded-lg transition-colors",
            session.included ? "bg-primary/8" : "hover:bg-accent"
          )}
        >
          <Link2
            className={cn(
              "w-3.5 h-3.5 shrink-0",
              session.included ? "text-primary" : "text-muted-foreground"
            )}
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-foreground truncate">{session.title}</p>
            <p className="text-[10px] text-muted-foreground font-mono">{session.date}</p>
          </div>
          <button
            onClick={() => toggle(session.id)}
            className={cn(
              "relative w-8 h-4 rounded-full transition-colors shrink-0",
              session.included ? "bg-primary" : "bg-muted"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow-sm",
                session.included ? "translate-x-4" : "translate-x-0.5"
              )}
            />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Main ContextPanel ────────────────────────────────────────────────────────

interface ContextPanelProps {
  activeBranch: string | null;
  onBranchSelect: (label: string) => void;
}

export function ContextPanel({ activeBranch, onBranchSelect }: ContextPanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>("branch");

  return (
    <aside className="flex flex-col w-64 shrink-0 border-l border-border h-full bg-sidebar overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 px-2 py-2 border-b border-border shrink-0 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap",
              activeTab === tab.id
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === "branch" && (
          <>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Branches
              </h3>
              {activeBranch && (
                <button
                  onClick={() => onBranchSelect("")}
                  className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors"
                >
                  <ChevronLeft className="w-3 h-3" />
                  Main
                </button>
              )}
            </div>
            <BranchPanel onBranchSelect={onBranchSelect} />
          </>
        )}

        {activeTab === "artifacts" && (
          <>
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Artifacts
            </h3>
            <ArtifactsPanel />
          </>
        )}

        {activeTab === "memos" && (
          <>
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Memos
            </h3>
            <MemosPanel />
          </>
        )}

        {activeTab === "skills" && (
          <>
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Active Skills
            </h3>
            <SkillsPanel />
          </>
        )}

        {activeTab === "cross" && (
          <>
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Cross-Session
            </h3>
            <CrossSessionPanel />
          </>
        )}
      </div>
    </aside>
  );
}
