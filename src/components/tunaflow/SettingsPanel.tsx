import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { X, Bot, UserCircle, Zap, Cpu, Plus, Trash2 } from "lucide-react";
import { useChatStore } from "@/stores/chatStore";
import { getSetting, setSetting } from "@/lib/appStore";
import { DEFAULT_PERSONAS } from "@/lib/defaultPersonas";
import { SkillsPanel } from "./context-panel/SkillsPanel";
import { AgentAvatar } from "./AgentAvatar";
import type { AgentProfile, Persona } from "@/types";

type SettingsSection = "agents" | "personas" | "skills" | "runtime";

const SECTIONS: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
  { id: "agents", label: "Agents", icon: <Bot className="w-4 h-4" /> },
  { id: "personas", label: "Personas", icon: <UserCircle className="w-4 h-4" /> },
  { id: "skills", label: "Skills", icon: <Zap className="w-4 h-4" /> },
  { id: "runtime", label: "Runtime", icon: <Cpu className="w-4 h-4" /> },
];

const ENGINES = ["claude", "codex", "gemini", "opencode"] as const;

const DEFAULT_PROFILES: AgentProfile[] = [
  { id: "architect-claude", label: "Architect Claude", engine: "claude", defaultSkills: [] },
  { id: "reviewer-codex", label: "Reviewer Codex", engine: "codex", defaultSkills: [] },
  { id: "tester-gemini", label: "Tester Gemini", engine: "gemini", defaultSkills: [] },
  { id: "general-opencode", label: "General OpenCode", engine: "opencode", defaultSkills: [] },
];

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("agents");

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <div className="relative bg-sidebar border border-border/40 rounded-xl shadow-2xl w-[80vw] max-w-[900px] h-[70vh] max-h-[600px] overflow-hidden flex flex-col">
        <div className="flex items-center px-5 h-12 shrink-0">
          <span className="text-[14px] font-[550] text-foreground flex-1">Settings</span>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          <nav className="w-[180px] shrink-0 px-3 py-2 space-y-0.5">
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors text-left",
                  activeSection === section.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )}
              >
                {section.icon}
                {section.label}
              </button>
            ))}
          </nav>

          <div className="flex-1 min-w-0 border-l border-border/30 overflow-y-auto">
            <div className="p-5">
              {activeSection === "agents" && <AgentsSection />}

              {activeSection === "personas" && <PersonasSection />}

              {activeSection === "skills" && (
                <div>
                  <h2 className="text-[14px] font-[550] text-foreground mb-1">Skills</h2>
                  <p className="text-[12px] text-muted-foreground mb-4">에이전트에게 적용할 스킬을 관리합니다.</p>
                  <SkillsPanel />
                </div>
              )}

              {activeSection === "runtime" && <RuntimeSection />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Agents Section ─────────────────────────────────────────────────────────

function AgentsSection() {
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const engineModels = useChatStore((s) => s.engineModels);
  const skills = useChatStore((s) => s.skills);

  // Load from settings
  useEffect(() => {
    getSetting<AgentProfile[]>("agentProfiles", DEFAULT_PROFILES).then((p) => {
      setProfiles(p);
      if (p.length > 0) setSelectedId(p[0].id);
      setLoaded(true);
    });
  }, []);

  // Save on change
  const save = (next: AgentProfile[]) => {
    setProfiles(next);
    setSetting("agentProfiles", next);
  };

  const selected = profiles.find((p) => p.id === selectedId);

  const updateField = <K extends keyof AgentProfile>(field: K, value: AgentProfile[K]) => {
    if (!selectedId) return;
    save(profiles.map((p) => p.id === selectedId ? { ...p, [field]: value } : p));
  };

  const addProfile = () => {
    const id = `agent-${Date.now()}`;
    const newProfile: AgentProfile = { id, label: "New Agent", engine: "claude", defaultSkills: [] };
    const next = [...profiles, newProfile];
    save(next);
    setSelectedId(id);
  };

  const deleteProfile = (id: string) => {
    const next = profiles.filter((p) => p.id !== id);
    save(next);
    if (selectedId === id) setSelectedId(next[0]?.id ?? null);
  };

  const toggleSkill = (skillName: string) => {
    if (!selected) return;
    const has = selected.defaultSkills.includes(skillName);
    updateField("defaultSkills", has
      ? selected.defaultSkills.filter((s) => s !== skillName)
      : [...selected.defaultSkills, skillName]);
  };

  if (!loaded) return null;

  const currentModels = engineModels.filter((m) => m.engine === selected?.engine);

  return (
    <div>
      <h2 className="text-[14px] font-[550] text-foreground mb-1">Agent Profiles</h2>
      <p className="text-[12px] text-muted-foreground mb-4">에이전트 프로필을 관리합니다. 각 프로필은 엔진, 모델, 기본 스킬을 하나의 실행 단위로 묶습니다.</p>

      <div className="flex gap-4 min-h-[300px]">
        {/* Profile list */}
        <div className="w-[180px] shrink-0 space-y-1">
          {profiles.map((p) => (
            <div key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={cn(
                "group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors",
                selectedId === p.id ? "bg-background text-foreground" : "text-muted-foreground hover:bg-background/50"
              )}
            >
              <AgentAvatar engine={p.engine} size="sm" />
              <span className="flex-1 text-[12px] font-medium truncate">{p.label}</span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteProfile(p.id); }}
                className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 text-muted-foreground/30 hover:text-destructive transition-all"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button onClick={addProfile}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] text-muted-foreground/50 hover:text-foreground hover:bg-background/50 transition-colors w-full">
            <Plus className="w-3.5 h-3.5" /> New Agent
          </button>
        </div>

        {/* Profile editor */}
        {selected ? (
          <div className="flex-1 min-w-0 space-y-4">
            {/* Label */}
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Name</label>
              <input value={selected.label} onChange={(e) => updateField("label", e.target.value)}
                className="w-full bg-background rounded-lg px-3 py-2 text-[13px] font-medium outline-none border border-border/30 focus:border-ring/40" />
            </div>

            {/* Engine */}
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Engine</label>
              <div className="flex gap-1.5">
                {ENGINES.map((eng) => (
                  <button key={eng}
                    onClick={() => { updateField("engine", eng); updateField("model", undefined); }}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors border",
                      selected.engine === eng
                        ? "border-primary/40 bg-primary/8 text-foreground"
                        : "border-border/20 text-muted-foreground hover:border-border/40"
                    )}
                  >
                    <AgentAvatar engine={eng} size="xs" />
                    {eng}
                  </button>
                ))}
              </div>
            </div>

            {/* Model */}
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Model</label>
              <select value={selected.model ?? ""} onChange={(e) => updateField("model", e.target.value || undefined)}
                className="w-full bg-background rounded-lg px-3 py-2 text-[12px] outline-none border border-border/30 focus:border-ring/40 cursor-pointer">
                <option value="">Engine default</option>
                {currentModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.recommended ? "★ " : ""}{m.label}</option>
                ))}
              </select>
            </div>

            {/* Persona */}
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Persona</label>
              <select value={selected.personaId ?? ""} onChange={(e) => updateField("personaId", e.target.value || undefined)}
                className="w-full bg-background rounded-lg px-3 py-2 text-[12px] outline-none border border-border/30 focus:border-ring/40 cursor-pointer">
                <option value="">None</option>
                {DEFAULT_PERSONAS.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {p.role}</option>
                ))}
              </select>
            </div>

            {/* Default Skills */}
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">
                Default Skills ({selected.defaultSkills.length})
              </label>
              <div className="max-h-[150px] overflow-y-auto space-y-0.5 border border-border/30 rounded-lg p-2">
                {skills.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground/30 py-2 text-center">No skills loaded</p>
                ) : skills.map((s) => (
                  <label key={s.name} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-background/50 cursor-pointer">
                    <input type="checkbox" checked={selected.defaultSkills.includes(s.name)}
                      onChange={() => toggleSkill(s.name)}
                      className="rounded border-border/40" />
                    <span className="text-[11px] text-foreground/70 truncate">{s.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground/30 text-[13px]">
            Select or create an agent profile
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Personas Section ────────────────────────────────────────────────────────

function PersonasSection() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    getSetting<Persona[]>("personas", DEFAULT_PERSONAS).then((p) => {
      setPersonas(p);
      if (p.length > 0) setSelectedId(p[0].id);
    });
  }, []);

  const save = (next: Persona[]) => {
    setPersonas(next);
    setSetting("personas", next);
  };

  const selected = personas.find((p) => p.id === selectedId);

  const updateField = <K extends keyof Persona>(field: K, value: Persona[K]) => {
    if (!selectedId) return;
    save(personas.map((p) => p.id === selectedId ? { ...p, [field]: value } : p));
  };

  const updateArrayField = (field: "priorities" | "behaviors" | "constraints", idx: number, value: string) => {
    if (!selected) return;
    const arr = [...selected[field]];
    arr[idx] = value;
    updateField(field, arr);
  };

  const addToArray = (field: "priorities" | "behaviors" | "constraints") => {
    if (!selected) return;
    updateField(field, [...selected[field], ""]);
  };

  const removeFromArray = (field: "priorities" | "behaviors" | "constraints", idx: number) => {
    if (!selected) return;
    updateField(field, selected[field].filter((_, i) => i !== idx));
  };

  return (
    <div>
      <h2 className="text-[14px] font-[550] text-foreground mb-1">Personas</h2>
      <p className="text-[12px] text-muted-foreground mb-4">에이전트의 역할과 행동 규칙을 정의합니다. Agent Profile에서 persona를 선택하여 사용합니다.</p>

      <div className="flex gap-4 min-h-[300px]">
        {/* List */}
        <div className="w-[160px] shrink-0 space-y-1">
          {personas.map((p) => (
            <button key={p.id} onClick={() => setSelectedId(p.id)}
              className={cn("w-full text-left px-3 py-2 rounded-lg transition-colors",
                selectedId === p.id ? "bg-background text-foreground" : "text-muted-foreground hover:bg-background/50")}>
              <span className="text-[12px] font-medium block truncate">{p.name}</span>
              <span className="text-[10px] text-muted-foreground/50 block truncate">{p.role}</span>
            </button>
          ))}
        </div>

        {/* Editor */}
        {selected ? (
          <div className="flex-1 min-w-0 space-y-3 overflow-y-auto max-h-[400px] pr-1">
            {/* Header */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-[11px] text-muted-foreground mb-1 block">Name</label>
                <input value={selected.name} onChange={(e) => updateField("name", e.target.value)}
                  disabled={selected.builtIn}
                  className="w-full bg-background rounded-lg px-3 py-1.5 text-[13px] font-medium outline-none border border-border/30 focus:border-ring/40 disabled:opacity-50" />
              </div>
              <div className="flex-1">
                <label className="text-[11px] text-muted-foreground mb-1 block">Role</label>
                <input value={selected.role} onChange={(e) => updateField("role", e.target.value)}
                  className="w-full bg-background rounded-lg px-3 py-1.5 text-[12px] outline-none border border-border/30 focus:border-ring/40" />
              </div>
            </div>

            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Summary</label>
              <input value={selected.summary} onChange={(e) => updateField("summary", e.target.value)}
                className="w-full bg-background rounded-lg px-3 py-1.5 text-[12px] outline-none border border-border/30 focus:border-ring/40" />
            </div>

            {/* Tone + Output Style */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-[11px] text-muted-foreground mb-1 block">Tone</label>
                <select value={selected.tone} onChange={(e) => updateField("tone", e.target.value)}
                  className="w-full bg-background rounded-lg px-3 py-1.5 text-[12px] outline-none border border-border/30 focus:border-ring/40 cursor-pointer">
                  <option value="direct">Direct</option>
                  <option value="analytical">Analytical</option>
                  <option value="critical">Critical</option>
                  <option value="formal">Formal</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="text-[11px] text-muted-foreground mb-1 block">Output Style</label>
                <select value={selected.outputStyle} onChange={(e) => updateField("outputStyle", e.target.value)}
                  className="w-full bg-background rounded-lg px-3 py-1.5 text-[12px] outline-none border border-border/30 focus:border-ring/40 cursor-pointer">
                  <option value="structured">Structured</option>
                  <option value="brief">Brief</option>
                  <option value="checklist">Checklist</option>
                  <option value="diff_first">Diff First</option>
                </select>
              </div>
            </div>

            {/* Array fields */}
            {(["priorities", "behaviors", "constraints"] as const).map((field) => (
              <div key={field}>
                <label className="text-[11px] text-muted-foreground mb-1 block capitalize">{field} ({selected[field].length})</label>
                <div className="space-y-1">
                  {selected[field].map((item, i) => (
                    <div key={i} className="flex gap-1">
                      <input value={item} onChange={(e) => updateArrayField(field, i, e.target.value)}
                        className="flex-1 bg-background rounded px-2 py-1 text-[11px] outline-none border border-border/30 focus:border-ring/40" />
                      <button onClick={() => removeFromArray(field, i)}
                        className="p-1 rounded text-muted-foreground/30 hover:text-destructive transition-colors shrink-0">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <button onClick={() => addToArray(field)}
                    className="text-[10px] text-primary/60 hover:text-primary transition-colors">
                    <Plus className="w-3 h-3 inline mr-0.5" />Add
                  </button>
                </div>
              </div>
            ))}

            {/* Prompt Fragment */}
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Prompt Fragment</label>
              <textarea value={selected.promptFragment} onChange={(e) => updateField("promptFragment", e.target.value)}
                rows={3}
                className="w-full bg-background rounded-lg px-3 py-2 text-[11px] font-mono outline-none border border-border/30 focus:border-ring/40 resize-none" />
            </div>

            {selected.builtIn && (
              <p className="text-[10px] text-muted-foreground/30 italic">Built-in persona. Name cannot be changed.</p>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground/30 text-[13px]">
            Select a persona
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Runtime Section ─────────────────────────────────────────────────────────

function RuntimeSection() {
  const rawqStatus = useChatStore((s) => s.rawqStatus);
  const engineModels = useChatStore((s) => s.engineModels);
  const loadEngineModels = useChatStore((s) => s.loadEngineModels);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefreshModels = async () => {
    setRefreshing(true);
    await loadEngineModels(true);
    setRefreshing(false);
  };

  // Group models by engine
  const engineGroups = engineModels.reduce<Record<string, number>>((acc, m) => {
    acc[m.engine] = (acc[m.engine] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[14px] font-[550] text-foreground mb-1">Runtime</h2>
        <p className="text-[12px] text-muted-foreground mb-4">런타임 환경 상태를 확인하고 관리합니다.</p>
      </div>

      {/* rawq */}
      <div className="rounded-lg border border-border/30 bg-background/50 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-medium text-foreground flex-1">rawq — Code Search Engine</h3>
          {rawqStatus && (
            <span className={cn("text-[11px] px-2 py-0.5 rounded-md font-medium",
              rawqStatus.status === "ready" || rawqStatus.status === "built"
                ? "text-status-approved bg-status-approved/10"
                : rawqStatus.status === "indexing"
                ? "text-primary bg-primary/10"
                : "text-muted-foreground bg-muted"
            )}>
              {rawqStatus.status}
            </span>
          )}
        </div>
        {rawqStatus ? (
          <div className="space-y-1 text-[12px]">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-[80px]">Status</span>
              <span className="text-foreground/80">{rawqStatus.message}</span>
            </div>
            {rawqStatus.files != null && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-[80px]">Files</span>
                <span className="text-foreground/80">{rawqStatus.files.toLocaleString()}</span>
              </div>
            )}
            {rawqStatus.chunks != null && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-[80px]">Chunks</span>
                <span className="text-foreground/80">{rawqStatus.chunks.toLocaleString()}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-[80px]">Available</span>
              <span className="text-foreground/80">{rawqStatus.available ? "Yes" : "No"}</span>
            </div>
          </div>
        ) : (
          <p className="text-[12px] text-muted-foreground/50">No project selected</p>
        )}
      </div>

      {/* Model Catalog */}
      <div className="rounded-lg border border-border/30 bg-background/50 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-medium text-foreground flex-1">Model Catalog</h3>
          <button
            onClick={handleRefreshModels}
            disabled={refreshing}
            className="text-[11px] px-2.5 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40 font-medium"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className="space-y-1 text-[12px]">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-[80px]">Total</span>
            <span className="text-foreground/80">{engineModels.length} models</span>
          </div>
          {Object.entries(engineGroups).map(([engine, count]) => (
            <div key={engine} className="flex items-center gap-2">
              <span className="text-muted-foreground w-[80px]">{engine}</span>
              <span className="text-foreground/80">{count} models</span>
            </div>
          ))}
        </div>
      </div>

      {/* Context Budget */}
      <div className="rounded-lg border border-border/30 bg-background/50 p-4 space-y-2">
        <h3 className="text-[13px] font-medium text-foreground">Context Budget</h3>
        <div className="space-y-1 text-[12px]">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-[80px]">Max total</span>
            <span className="text-foreground/80">60,000 chars</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-[80px]">Mode</span>
            <span className="text-foreground/80">Lite → Standard → Full (auto)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-[80px]">Sections</span>
            <span className="text-foreground/80">Project, Context, Plan, Findings, Artifacts, Skills, rawq, Persona, Cross-session</span>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground/40 mt-1">Context budget 조정은 향후 지원 예정입니다.</p>
      </div>

      {/* Background / Daemon */}
      <div className="rounded-lg border border-border/30 bg-background/50 p-4 space-y-2">
        <h3 className="text-[13px] font-medium text-foreground">Background Execution</h3>
        <div className="space-y-1 text-[12px]">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-[80px]">Pattern</span>
            <span className="text-foreground/80">start_* command + event listener (fire-and-forget)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-[80px]">rawq daemon</span>
            <span className="text-foreground/80">Auto-start, 30min idle timeout</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-[80px]">DB SSOT</span>
            <span className="text-foreground/80">Event 유실 시 list_messages()로 복구</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Placeholder ─────────────────────────────────────────────────────────────

function PlaceholderSection({ title, description, items }: { title: string; description: string; items: string[] }) {
  return (
    <div>
      <h2 className="text-[14px] font-[550] text-foreground mb-1">{title}</h2>
      <p className="text-[12px] text-muted-foreground mb-4">{description}</p>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border/30 bg-background/50">
            <div className="w-2 h-2 rounded-full bg-muted-foreground/20" />
            <span className="text-[13px] text-muted-foreground/60">{item}</span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground/30 mt-4 italic">Coming soon</p>
    </div>
  );
}
