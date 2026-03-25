import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import {
  GitBranch,
  FileText,
  StickyNote,
  Zap,
  Link2,
  ChevronDown,
  ChevronRight,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  ClipboardList,
  X,
} from "lucide-react";
import type { Artifact, Plan, PlanSubtask, PlanStatus, SubtaskStatus, SubtaskInput } from "@/types";

/** Primary tabs: structural (Branch) vs work assets (Assets) */
type PrimaryTab = "branch" | "assets";
/** Secondary segments within the Assets tab */
type AssetSegment = "artifacts" | "memos" | "skills" | "plans";

// ─── Branch Panel ───────────────────────────────────────────────────────────

function BranchPanel() {
  const {
    branches,
    messages,
    selectedConversationId,
    activeBranchId,
    adoptBranch,
    deleteBranch,
    openBranchStream,
    closeBranchStream,
    openThread,
  } = useChatStore();

  if (!selectedConversationId) return <p className="text-xs text-muted-foreground px-2">No conversation selected</p>;

  if (activeBranchId) {
    return (
      <button
        onClick={closeBranchStream}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-primary hover:bg-primary/10 transition-colors"
      >
        ← Back to main
      </button>
    );
  }

  if (branches.length === 0) {
    return (
      <div className="text-center py-6">
        <GitBranch className="w-5 h-5 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">No threads yet</p>
        <p className="text-[10px] text-muted-foreground/60 mt-1">Hover a message and click "Start thread"</p>
      </div>
    );
  }

  const handleDelete = (branchId: string, label: string) => {
    if (!window.confirm(`"${label}" 브랜치를 삭제하시겠습니까?\n\n브랜치 내 모든 메시지가 삭제됩니다.`)) return;
    deleteBranch(branchId);
  };

  return (
    <div className="space-y-2">
      {branches.map((b) => {
        // Find origin message for preview
        const originMsg = b.checkpointId
          ? messages.find((m) => m.id === b.checkpointId)
          : null;

        return (
          <div
            key={b.id}
            className="group rounded-lg border border-border bg-card p-2.5 hover:border-border/80 transition-colors"
          >
            {/* Branch header row */}
            <div className="flex items-center gap-2 mb-1.5">
              <GitBranch className="w-3 h-3 text-primary shrink-0" />
              <span className="text-xs font-medium text-foreground flex-1 truncate">
                {b.customLabel ?? b.label}
              </span>
              <span className={cn(
                "text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full border",
                b.status === "active" && "text-primary bg-primary/10 border-primary/20",
                b.status === "adopted" && "text-status-approved bg-status-approved/10 border-status-approved/20",
                b.status === "archived" && "text-muted-foreground bg-accent border-border",
              )}>
                {b.status}
              </span>
            </div>

            {/* Origin message preview */}
            {originMsg && (
              <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2 mb-2 pl-5">
                {originMsg.content.slice(0, 120)}{originMsg.content.length > 120 ? "..." : ""}
              </p>
            )}

            {/* Actions */}
            <div className="flex items-center gap-1.5 pl-5">
              <button
                onClick={() => openThread(b.id)}
                className="text-[10px] font-medium text-primary hover:underline"
              >
                Open thread
              </button>
              {b.status === "active" && (
                <>
                  <span className="text-border">·</span>
                  <button
                    onClick={() => openBranchStream(b.id)}
                    className="text-[10px] text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Full view
                  </button>
                  <span className="text-border">·</span>
                  <button
                    onClick={() => adoptBranch(b.id, selectedConversationId)}
                    className="text-[10px] text-status-approved hover:underline"
                  >
                    Adopt
                  </button>
                </>
              )}
              <span className="flex-1" />
              <button
                onClick={() => handleDelete(b.id, b.customLabel ?? b.label)}
                className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition-all"
              >
                Delete
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Artifacts Panel ─────────────────────────────────────────────────────────

type ArtifactStatus = "draft" | "approved" | "rejected";

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

function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const { updateArtifactStatus, deleteArtifact } = useChatStore();
  const status = STATUS_CONFIG[artifact.status];
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="rounded-lg border border-border bg-card p-3 hover:border-border/80 transition-colors cursor-pointer group"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-2 mb-1.5">
        <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
        <span className="text-xs font-medium text-foreground flex-1 leading-snug">{artifact.title}</span>
        <span className={cn("inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border shrink-0", status.class)}>
          {status.icon}
          {status.label}
        </span>
      </div>
      {!expanded && (
        <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2 ml-5">
          {artifact.content.slice(0, 100)}
        </p>
      )}
      {expanded && (
        <div className="ml-5 mt-2 space-y-2">
          <p className="text-[11px] text-foreground leading-relaxed whitespace-pre-wrap">{artifact.content}</p>
          <div className="flex gap-2 pt-1 border-t border-border/30">
            {artifact.status !== "approved" && (
              <button
                onClick={(e) => { e.stopPropagation(); updateArtifactStatus(artifact.id, "approved"); }}
                className="text-[10px] text-status-approved hover:underline"
              >
                Approve
              </button>
            )}
            {artifact.status !== "rejected" && (
              <button
                onClick={(e) => { e.stopPropagation(); updateArtifactStatus(artifact.id, "rejected"); }}
                className="text-[10px] text-status-rejected hover:underline"
              >
                Reject
              </button>
            )}
            {artifact.status !== "draft" && (
              <button
                onClick={(e) => { e.stopPropagation(); updateArtifactStatus(artifact.id, "draft"); }}
                className="text-[10px] text-status-draft hover:underline"
              >
                Draft
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); deleteArtifact(artifact.id); }}
              className="text-[10px] text-destructive hover:underline ml-auto"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ArtifactsPanel() {
  const { artifacts, selectedConversationId, createArtifact } = useChatStore();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [artType, setArtType] = useState("note");

  const handleCreate = async () => {
    if (!title.trim() || !content.trim() || !selectedConversationId) return;
    await createArtifact({ conversationId: selectedConversationId, type: artType, title: title.trim(), content: content.trim() });
    setTitle(""); setContent(""); setShowForm(false);
  };

  return (
    <div className="space-y-2">
      {artifacts.map((a) => <ArtifactCard key={a.id} artifact={a} />)}
      {showForm && (
        <div className="rounded-lg border border-border bg-card p-3 space-y-2">
          <select
            value={artType}
            onChange={(e) => setArtType(e.target.value)}
            className="w-full bg-input rounded-md px-2.5 py-1.5 text-xs outline-none text-foreground border border-border focus:border-ring/50"
          >
            <option value="note">Note</option>
            <option value="code">Code</option>
            <option value="spec">Spec</option>
            <option value="plan">Plan</option>
          </select>
          <input
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-input rounded-md px-2.5 py-1.5 text-xs outline-none text-foreground placeholder:text-muted-foreground border border-border focus:border-ring/50"
          />
          <textarea
            placeholder="Content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            className="w-full bg-input rounded-md px-2.5 py-1.5 text-xs outline-none text-foreground placeholder:text-muted-foreground border border-border focus:border-ring/50 resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              className="flex-1 px-2 py-1.5 rounded-md bg-primary/15 text-primary text-xs hover:bg-primary/25 transition-colors"
            >
              Create
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-2 py-1.5 rounded-md text-muted-foreground text-xs hover:bg-accent transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New artifact
        </button>
      )}
    </div>
  );
}

// ─── Memos Panel ─────────────────────────────────────────────────────────────

function MemosPanel() {
  const { memos, deleteMemo } = useChatStore();

  return (
    <div className="space-y-2">
      {memos.length === 0 && (
        <p className="text-xs text-muted-foreground px-2">No memos yet. Hover over a message and click Memo.</p>
      )}
      {memos.map((m) => (
        <div key={m.id} className="group rounded-lg border border-border bg-card p-3 transition-colors hover:border-border/80">
          <div className="flex items-start gap-2">
            <p className="flex-1 text-xs text-foreground leading-relaxed">{m.content.slice(0, 150)}{m.content.length > 150 ? "..." : ""}</p>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <p className="text-[10px] text-muted-foreground font-mono flex-1">
              {new Date(m.createdAt).toLocaleString()}
            </p>
            <button
              onClick={() => deleteMemo(m.id)}
              className="opacity-0 group-hover:opacity-100 text-[10px] text-destructive hover:underline transition-opacity"
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Skills Panel ─────────────────────────────────────────────────────────────

function SkillsPanel() {
  const { skills, activeSkills, toggleSkill, loadSkills } = useChatStore();

  useEffect(() => {
    loadSkills();
  }, []);

  if (skills.length === 0) {
    return <p className="text-xs text-muted-foreground px-2">No skills found. Add SKILL.md files to ~/.tunaflow/skills/.</p>;
  }

  return (
    <div className="space-y-1.5">
      {skills.map((skill) => {
        const isActive = activeSkills.includes(skill.name);
        return (
          <div
            key={skill.name}
            className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-accent transition-colors"
          >
            <Zap className={cn("w-3.5 h-3.5 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground">{skill.name}</p>
              {skill.description && (
                <p className="text-[10px] text-muted-foreground truncate">{skill.description}</p>
              )}
            </div>
            <button
              onClick={() => toggleSkill(skill.name)}
              className={cn("relative w-8 h-4 rounded-full transition-colors shrink-0", isActive ? "bg-primary" : "bg-muted")}
            >
              <span className={cn("absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow-sm", isActive ? "translate-x-4" : "translate-x-0.5")} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Plans Panel ─────────────────────────────────────────────────────────────

const PLAN_STATUS_CFG: Record<PlanStatus, { label: string; cls: string }> = {
  draft:     { label: "draft",     cls: "text-muted-foreground bg-accent border-border" },
  active:    { label: "active",    cls: "text-primary bg-primary/10 border-primary/20" },
  done:      { label: "done",      cls: "text-status-approved bg-status-approved/10 border-status-approved/20" },
  abandoned: { label: "abandoned", cls: "text-status-rejected bg-status-rejected/10 border-status-rejected/20" },
};

const SUBTASK_STATUS_CFG: Record<SubtaskStatus, { label: string; next: SubtaskStatus; cls: string }> = {
  todo:        { label: "todo",        next: "in_progress", cls: "text-muted-foreground bg-accent border-border" },
  in_progress: { label: "in progress", next: "done",        cls: "text-primary bg-primary/10 border-primary/20" },
  done:        { label: "done",        next: "todo",         cls: "text-status-approved bg-status-approved/10 border-status-approved/20" },
  abandoned:   { label: "abandoned",   next: "todo",         cls: "text-status-rejected bg-status-rejected/10 border-status-rejected/20" },
};

// ─── Plan Create Form ─────────────────────────────────────────────────────────

const INPUT_CLS =
  "w-full bg-input rounded-md px-2.5 py-1.5 text-xs outline-none text-foreground " +
  "placeholder:text-muted-foreground border border-border focus:border-ring/50";

function CreatePlanForm({
  conversationId,
  onCreated,
  onCancel,
}: {
  conversationId: string;
  onCreated: (plan: Plan) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [expectedOutcome, setExpectedOutcome] = useState("");
  const [subtasks, setSubtasks] = useState<SubtaskInput[]>([]);
  const [newSubtask, setNewSubtask] = useState("");
  const [saving, setSaving] = useState(false);

  const addSubtask = () => {
    const t = newSubtask.trim();
    if (!t) return;
    setSubtasks((prev) => [...prev, { title: t }]);
    setNewSubtask("");
  };

  const removeSubtask = (idx: number) => {
    setSubtasks((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleCreate = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const plan = await invoke<Plan>("create_plan", {
        input: {
          conversationId,
          branchId: null,
          title: title.trim(),
          description: description.trim() || null,
          expectedOutcome: expectedOutcome.trim() || null,
          subtasks,
        },
      });
      onCreated(plan);
    } catch {
      // silent — user can retry
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <input
        placeholder="Plan title *"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className={INPUT_CLS}
        autoFocus
      />
      <textarea
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        className={`${INPUT_CLS} resize-none`}
      />
      <textarea
        placeholder="Expected outcome (optional)"
        value={expectedOutcome}
        onChange={(e) => setExpectedOutcome(e.target.value)}
        rows={2}
        className={`${INPUT_CLS} resize-none`}
      />

      {/* Subtask list */}
      {subtasks.length > 0 && (
        <div className="space-y-1">
          {subtasks.map((st, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground shrink-0">{i + 1}.</span>
              <span className="flex-1 text-[11px] text-foreground truncate">{st.title}</span>
              <button
                onClick={() => removeSubtask(i)}
                className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add subtask row */}
      <div className="flex gap-1.5">
        <input
          placeholder="Add subtask…"
          value={newSubtask}
          onChange={(e) => setNewSubtask(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSubtask(); } }}
          className={`${INPUT_CLS} flex-1`}
        />
        <button
          onClick={addSubtask}
          className="shrink-0 px-2 py-1.5 rounded-md bg-accent text-muted-foreground hover:text-foreground text-xs transition-colors border border-border"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleCreate}
          disabled={saving || !title.trim()}
          className="flex-1 px-2 py-1.5 rounded-md bg-primary/15 text-primary text-xs hover:bg-primary/25 transition-colors disabled:opacity-40"
        >
          {saving ? "Creating…" : "Create"}
        </button>
        <button
          onClick={onCancel}
          className="px-2 py-1.5 rounded-md text-muted-foreground text-xs hover:bg-accent transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function SubtaskRow({
  subtask,
  onStatusChange,
}: {
  subtask: PlanSubtask;
  onStatusChange: (id: string, status: SubtaskStatus) => void;
}) {
  const cfg = SUBTASK_STATUS_CFG[subtask.status];
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-border/30 last:border-0">
      <button
        title={`Click to → ${cfg.next}`}
        onClick={() => onStatusChange(subtask.id, cfg.next)}
        className={cn(
          "shrink-0 mt-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap",
          cfg.cls
        )}
      >
        {cfg.label}
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-foreground leading-snug">{subtask.title}</p>
        {subtask.details && (
          <p className="text-[10px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">{subtask.details}</p>
        )}
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  onStatusChange,
  defaultExpanded = false,
}: {
  plan: Plan;
  onStatusChange: (id: string, status: PlanStatus) => void;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [subtasks, setSubtasks] = useState<PlanSubtask[] | null>(null);
  const [loading, setLoading] = useState(false);
  const statusCfg = PLAN_STATUS_CFG[plan.status];

  const handleToggle = async () => {
    if (!expanded && subtasks === null) {
      setLoading(true);
      try {
        const tasks = await invoke<PlanSubtask[]>("list_subtasks", { planId: plan.id });
        setSubtasks(tasks);
      } catch {
        setSubtasks([]);
      } finally {
        setLoading(false);
      }
    }
    setExpanded((v) => !v);
  };

  const handleSubtaskStatus = async (subtaskId: string, status: SubtaskStatus) => {
    try {
      await invoke("update_subtask_status", { input: { id: subtaskId, status, outcome: null } });
      setSubtasks((prev) =>
        prev ? prev.map((st) => (st.id === subtaskId ? { ...st, status } : st)) : prev
      );
    } catch {
      // silent — subtask stays as-is
    }
  };

  const PLAN_STATUS_CYCLE: PlanStatus[] = ["draft", "active", "done", "abandoned"];
  const nextPlanStatus = PLAN_STATUS_CYCLE[
    (PLAN_STATUS_CYCLE.indexOf(plan.status) + 1) % PLAN_STATUS_CYCLE.length
  ];

  return (
    <div className="rounded-lg border border-border bg-card transition-colors">
      {/* Plan header */}
      <div
        className="flex items-start gap-2 p-2.5 cursor-pointer hover:bg-accent/40 rounded-lg transition-colors"
        onClick={handleToggle}
      >
        <span className="mt-0.5 text-muted-foreground shrink-0">
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground leading-snug">{plan.title}</p>
          {plan.description && !expanded && (
            <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{plan.description}</p>
          )}
        </div>
        <button
          title={`Click to → ${nextPlanStatus}`}
          onClick={(e) => { e.stopPropagation(); onStatusChange(plan.id, nextPlanStatus); }}
          className={cn(
            "shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap",
            statusCfg.cls
          )}
        >
          {statusCfg.label}
        </button>
      </div>

      {/* Expanded: description + subtasks */}
      {expanded && (
        <div className="px-2.5 pb-2.5">
          {plan.description && (
            <p className="text-[10px] text-muted-foreground mb-2 leading-snug pl-5">{plan.description}</p>
          )}
          {plan.expectedOutcome && (
            <p className="text-[10px] text-muted-foreground/70 italic mb-2 pl-5 line-clamp-2">
              Goal: {plan.expectedOutcome}
            </p>
          )}
          <div className="pl-5">
            {loading && <p className="text-[10px] text-muted-foreground">Loading…</p>}
            {!loading && subtasks !== null && subtasks.length === 0 && (
              <p className="text-[10px] text-muted-foreground">No subtasks.</p>
            )}
            {!loading && subtasks && subtasks.map((st) => (
              <SubtaskRow key={st.id} subtask={st} onStatusChange={handleSubtaskStatus} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlansPanel() {
  const { selectedConversationId } = useChatStore();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [expandedNewId, setExpandedNewId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedConversationId) return;
    invoke<Plan[]>("list_plans_by_conversation", { conversationId: selectedConversationId })
      .then(setPlans)
      .catch(() => setPlans([]));
    setShowForm(false);
  }, [selectedConversationId]);

  const handlePlanStatus = async (planId: string, status: PlanStatus) => {
    try {
      await invoke("update_plan_status", { input: { id: planId, status } });
      setPlans((prev) => prev.map((p) => (p.id === planId ? { ...p, status } : p)));
    } catch {
      // silent
    }
  };

  const handleCreated = (newPlan: Plan) => {
    setPlans((prev) => [newPlan, ...prev]);
    setShowForm(false);
    setExpandedNewId(newPlan.id);
  };

  if (!selectedConversationId) {
    return <p className="text-xs text-muted-foreground px-2">No conversation selected.</p>;
  }

  return (
    <div className="space-y-2">
      {/* Plan list */}
      {plans.length === 0 && !showForm && (
        <div className="text-center py-4">
          <ClipboardList className="w-5 h-5 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No plans yet.</p>
        </div>
      )}

      {plans.map((plan) => (
        <PlanCard
          key={plan.id}
          plan={plan}
          onStatusChange={handlePlanStatus}
          defaultExpanded={plan.id === expandedNewId}
        />
      ))}

      {/* Inline create form */}
      {showForm && (
        <CreatePlanForm
          conversationId={selectedConversationId}
          onCreated={handleCreated}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* + New Plan button */}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New plan
        </button>
      )}
    </div>
  );
}

// ─── Cross-Session Panel ──────────────────────────────────────────────────────

function CrossSessionPanel() {
  const { conversations, selectedConversationId, crossSessionIds, toggleCrossSession } = useChatStore();
  const others = conversations.filter(
    (c) => c.id !== selectedConversationId && c.mode !== "roundtable" && !c.id.startsWith("branch:")
  );

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] text-muted-foreground mb-2 leading-relaxed px-2">
        Include context from other conversations to ground agent responses.
      </p>
      {others.length === 0 && (
        <p className="text-xs text-muted-foreground px-2">No other conversations available.</p>
      )}
      {others.map((c) => {
        const included = crossSessionIds.includes(c.id);
        return (
          <div
            key={c.id}
            className={cn("flex items-center gap-2.5 px-2 py-2 rounded-lg transition-colors cursor-pointer", included ? "bg-primary/10" : "hover:bg-accent")}
            onClick={() => toggleCrossSession(c.id)}
          >
            <Link2 className={cn("w-3.5 h-3.5 shrink-0", included ? "text-primary" : "text-muted-foreground")} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-foreground truncate">{c.customLabel ?? c.label}</p>
            </div>
            <button className={cn("relative w-8 h-4 rounded-full transition-colors shrink-0", included ? "bg-primary" : "bg-muted")}>
              <span className={cn("absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow-sm", included ? "translate-x-4" : "translate-x-0.5")} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main ContextPanel ────────────────────────────────────────────────────────

export function ContextPanel() {
  const [primaryTab, setPrimaryTab] = useState<PrimaryTab>("branch");
  const [assetSegment, setAssetSegment] = useState<AssetSegment>("artifacts");
  const { branches, artifacts, memos } = useChatStore();

  return (
    <aside className="flex flex-col w-64 shrink-0 border-l border-border h-full bg-sidebar overflow-hidden">

      {/* Primary tab bar: Branch / Assets */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border shrink-0">
        <button
          onClick={() => setPrimaryTab("branch")}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors",
            primaryTab === "branch"
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
          )}
        >
          <GitBranch className="w-3.5 h-3.5" />
          Branches
          {branches.length > 0 && (
            <span className="text-[9px] bg-primary/15 text-primary px-1 rounded-full">{branches.length}</span>
          )}
        </button>
        <button
          onClick={() => setPrimaryTab("assets")}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors",
            primaryTab === "assets"
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
          )}
        >
          <FileText className="w-3.5 h-3.5" />
          Assets
          {(artifacts.length + memos.length) > 0 && (
            <span className="text-[9px] bg-accent text-muted-foreground px-1 rounded-full">
              {artifacts.length + memos.length}
            </span>
          )}
        </button>
      </div>

      {/* Asset sub-segments (only when Assets tab is active) */}
      {primaryTab === "assets" && (
        <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border/50 shrink-0">
          {([
            { id: "artifacts" as AssetSegment, label: "Artifacts", icon: <FileText className="w-3 h-3" /> },
            { id: "memos" as AssetSegment, label: "Memos", icon: <StickyNote className="w-3 h-3" /> },
            { id: "skills" as AssetSegment, label: "Skills", icon: <Zap className="w-3 h-3" /> },
            { id: "plans" as AssetSegment, label: "Plans", icon: <ClipboardList className="w-3 h-3" /> },
          ]).map((seg) => (
            <button
              key={seg.id}
              onClick={() => setAssetSegment(seg.id)}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors",
                assetSegment === seg.id
                  ? "text-foreground bg-accent/70"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {seg.icon}
              {seg.label}
            </button>
          ))}
        </div>
      )}

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto p-3">
        {primaryTab === "branch" && (
          <>
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Branches</h3>
            <BranchPanel />
          </>
        )}
        {primaryTab === "assets" && assetSegment === "artifacts" && (
          <>
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Artifacts</h3>
            <ArtifactsPanel />
          </>
        )}
        {primaryTab === "assets" && assetSegment === "memos" && (
          <>
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Memos</h3>
            <MemosPanel />
          </>
        )}
        {primaryTab === "assets" && assetSegment === "skills" && (
          <>
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Active Skills</h3>
            <SkillsPanel />
          </>
        )}
        {primaryTab === "assets" && assetSegment === "plans" && (
          <>
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Plans</h3>
            <PlansPanel />
          </>
        )}
      </div>
    </aside>
  );
}
