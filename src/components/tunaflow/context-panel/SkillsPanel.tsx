import { useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import { Zap, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import type { SkillsSnapshotInfo } from "@/types";

function getVendor(skill: { name: string; vendor?: string | null }): string {
  if (skill.vendor) return skill.vendor;
  const idx = skill.name.indexOf("-");
  return idx > 0 ? skill.name.slice(0, idx) : "other";
}

function skillLabel(name: string): string {
  const idx = name.indexOf("-");
  return idx > 0 ? name.slice(idx + 1) : name;
}

const VENDOR_COLORS: Record<string, string> = {
  anthropic: "bg-agent-claude/20 text-agent-claude",
  microsoft: "bg-blue-500/15 text-blue-400",
  openai: "bg-agent-codex/20 text-agent-codex",
  vercel: "bg-foreground/10 text-foreground/70",
  supabase: "bg-emerald-500/15 text-emerald-400",
  remotion: "bg-purple-500/15 text-purple-400",
};

// ─── Presets (CLAUDE.md §15) ────────────────────────────────────────────────

interface Preset {
  label: string;
  skills: string[];
}

const PRESETS: Preset[] = [
  { label: "Frontend", skills: ["anthropic-frontend-design", "microsoft-zustand-store-ts"] },
  { label: "Review", skills: ["microsoft-frontend-design-review", "anthropic-webapp-testing"] },
  { label: "OpenAI", skills: ["openai-openai-docs"] },
  { label: "Claude", skills: ["anthropic-claude-api"] },
  { label: "MCP", skills: ["anthropic-mcp-builder"] },
];

export function SkillsPanel() {
  const skills = useChatStore((s) => s.skills);
  const activeSkills = useChatStore((s) => s.activeSkills);
  const toggleSkill = useChatStore((s) => s.toggleSkill);
  const loadSkills = useChatStore((s) => s.loadSkills);
  const [collapsedVendors, setCollapsedVendors] = useState<Set<string>>(new Set());
  const [snapshot, setSnapshot] = useState<SkillsSnapshotInfo | null>(null);
  const [search, setSearch] = useState("");
  const [vendorFilter, setVendorFilter] = useState<string | null>(null);

  useEffect(() => {
    loadSkills();
    invoke<SkillsSnapshotInfo>("get_skills_snapshot").then(setSnapshot).catch(() => {});
  }, []);

  // All unique vendors
  const allVendors = useMemo(() => {
    const set = new Set<string>();
    for (const skill of skills) set.add(getVendor(skill));
    return [...set].sort();
  }, [skills]);

  // Filter skills
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return skills.filter((s) => {
      if (vendorFilter && getVendor(s) !== vendorFilter) return false;
      if (q && !s.name.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [skills, search, vendorFilter]);

  // Group by vendor
  const grouped = useMemo(() => {
    const map = new Map<string, typeof skills>();
    for (const skill of filtered) {
      const vendor = getVendor(skill);
      if (!map.has(vendor)) map.set(vendor, []);
      map.get(vendor)!.push(skill);
    }
    return map;
  }, [filtered]);

  const sortedVendors = useMemo(() => [...grouped.keys()].sort(), [grouped]);

  const toggleVendor = (vendor: string) => {
    setCollapsedVendors((prev) => {
      const next = new Set(prev);
      if (next.has(vendor)) next.delete(vendor);
      else next.add(vendor);
      return next;
    });
  };

  const isPresetActive = (preset: Preset) =>
    preset.skills.length > 0 && preset.skills.every((s) => activeSkills.includes(s));

  const applyPreset = (preset: Preset) => {
    if (isPresetActive(preset)) {
      // Re-click: deactivate all preset skills
      for (const name of preset.skills) {
        if (activeSkills.includes(name)) toggleSkill(name);
      }
    } else {
      // Deactivate non-preset, activate preset
      const available = new Set(skills.map((s) => s.name));
      for (const name of activeSkills) {
        if (!preset.skills.includes(name)) toggleSkill(name);
      }
      for (const name of preset.skills) {
        if (available.has(name) && !activeSkills.includes(name)) toggleSkill(name);
      }
    }
  };

  if (skills.length === 0) {
    return <p className="text-xs text-muted-foreground px-2">No skills found. Add SKILL.md files to ~/.tunaflow/skills/.</p>;
  }

  return (
    <div className="space-y-2">
      {/* ─── Presets ─── */}
      <div className="flex flex-wrap gap-1 px-1">
        {PRESETS.map((preset) => {
          const active = isPresetActive(preset);
          return (
            <button
              key={preset.label}
              onClick={() => applyPreset(preset)}
              title={preset.skills.join(", ")}
              className={cn(
                "text-[8px] px-1.5 py-0.5 rounded-full border transition-colors",
                active
                  ? "border-primary/50 bg-primary/15 text-primary font-semibold"
                  : "border-border/30 text-muted-foreground/60 hover:border-border/60 hover:text-muted-foreground"
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* ─── Search + Vendor filter ─── */}
      <div className="px-1 space-y-1.5">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search skills..."
            className="w-full h-6 pl-5 pr-6 text-[10px] bg-muted/30 border border-border/20 rounded text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-border/50"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2">
              <X className="w-3 h-3 text-muted-foreground/40 hover:text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Vendor filter pills */}
        <div className="flex flex-wrap gap-0.5">
          {allVendors.map((v) => {
            const isSelected = vendorFilter === v;
            const colorClass = VENDOR_COLORS[v] || "bg-muted text-muted-foreground";
            return (
              <button
                key={v}
                onClick={() => setVendorFilter(isSelected ? null : v)}
                className={cn(
                  "text-[7px] px-1 py-px rounded transition-colors",
                  isSelected ? colorClass : "text-muted-foreground/30 hover:text-muted-foreground/50"
                )}
              >
                {v}
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Results count (when filtering) ─── */}
      {(search || vendorFilter) && (
        <p className="text-[9px] text-muted-foreground/40 px-1">
          {filtered.length} / {skills.length} skills
        </p>
      )}

      {/* ─── Grouped skill list ─── */}
      {sortedVendors.map((vendor) => {
        const vendorSkills = grouped.get(vendor)!;
        const activeCount = vendorSkills.filter((s) => activeSkills.includes(s.name)).length;
        const isCollapsed = collapsedVendors.has(vendor);
        const colorClass = VENDOR_COLORS[vendor] || "bg-muted text-muted-foreground";

        return (
          <div key={vendor}>
            <button
              onClick={() => toggleVendor(vendor)}
              className="flex items-center gap-1.5 w-full text-left px-1 py-0.5 rounded hover:bg-accent/50 transition-colors"
            >
              {isCollapsed
                ? <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
                : <ChevronDown className="w-3 h-3 text-muted-foreground/50" />
              }
              <span className={cn("text-[8px] font-medium px-1 rounded", colorClass)}>
                {vendor}
              </span>
              <span className="text-[9px] text-muted-foreground/40 flex-1">
                {vendorSkills.length}
              </span>
              {activeCount > 0 && (
                <span className="text-[8px] bg-primary/10 text-primary/70 px-1 rounded">
                  {activeCount}
                </span>
              )}
            </button>

            {!isCollapsed && (
              <div className="ml-3 mt-0.5 space-y-0.5">
                {vendorSkills.map((skill) => {
                  const isActive = activeSkills.includes(skill.name);
                  return (
                    <div
                      key={skill.name}
                      className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-accent/40 transition-colors group"
                      title={skill.sourcePath || skill.name}
                    >
                      <Zap className={cn("w-3 h-3 shrink-0", isActive ? "text-primary" : "text-muted-foreground/30")} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium text-foreground truncate">{skillLabel(skill.name)}</p>
                        {skill.description && (
                          <p className="text-[9px] text-muted-foreground/60 truncate">{skill.description}</p>
                        )}
                      </div>
                      <button
                        onClick={() => toggleSkill(skill.name)}
                        className={cn("relative w-7 h-3.5 rounded-full transition-colors shrink-0 overflow-hidden", isActive ? "bg-primary" : "bg-muted")}
                      >
                        <span className={cn("absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all shadow-sm", isActive ? "left-[16px]" : "left-0.5")} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* ─── Snapshot metadata footer ─── */}
      {snapshot && (
        <div className="mt-3 pt-2 border-t border-border/20 px-1">
          <p className="text-[9px] text-muted-foreground/40">
            {snapshot.totalSkills} skills
            {snapshot.publishedAt && (
              <> · {snapshot.publishedAt.slice(0, 10)}</>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
