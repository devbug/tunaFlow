import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { X, Bot, UserCircle, Zap, Cpu, Plus, Trash2 } from "lucide-react";
import { useChatStore } from "@/stores/chatStore";
import { getSetting, setSetting } from "@/lib/appStore";
import { SkillsPanel } from "./context-panel/SkillsPanel";
import { AgentAvatar } from "./AgentAvatar";
import type { AgentProfile } from "@/types";

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

              {activeSection === "personas" && (
                <PlaceholderSection
                  title="Personas"
                  description="에이전트의 역할과 행동 스타일을 정의합니다. 페르소나는 Agent Profile에서 선택하여 사용합니다."
                  items={["architect — 설계 중심, 구조적 판단", "reviewer — 코드 리뷰, 버그/리스크 발견", "tester — 테스트 관점, 엣지 케이스 탐색", "concise — 간결한 응답 스타일"]}
                />
              )}

              {activeSection === "skills" && (
                <div>
                  <h2 className="text-[14px] font-[550] text-foreground mb-1">Skills</h2>
                  <p className="text-[12px] text-muted-foreground mb-4">에이전트에게 적용할 스킬을 관리합니다.</p>
                  <SkillsPanel />
                </div>
              )}

              {activeSection === "runtime" && (
                <PlaceholderSection
                  title="Runtime"
                  description="런타임 환경을 설정합니다."
                  items={["rawq — 코드 검색 엔진 상태 및 인덱싱 관리", "Context Budget — 컨텍스트 윈도우 크기 제한", "Model Catalog — 엔진별 모델 목록", "Daemon — 백그라운드 서비스"]}
                />
              )}
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
              <input value={selected.personaKey ?? ""} onChange={(e) => updateField("personaKey", e.target.value || undefined)}
                placeholder="e.g. architect, reviewer, tester"
                className="w-full bg-background rounded-lg px-3 py-2 text-[12px] outline-none border border-border/30 focus:border-ring/40 placeholder:text-muted-foreground/30" />
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
