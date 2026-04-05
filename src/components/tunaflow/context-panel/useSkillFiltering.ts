import { useMemo } from "react";
import type { SkillDef } from "@/types";

function getVendor(skill: { name: string; vendor?: string | null }): string {
  if (skill.vendor) return skill.vendor;
  const idx = skill.name.indexOf("-");
  return idx > 0 ? skill.name.slice(0, idx) : "other";
}

export { getVendor };

export function useSkillFiltering(
  skills: SkillDef[],
  search: string,
  vendorFilter: string | null,
) {
  const allVendors = useMemo(() => {
    const set = new Set<string>();
    for (const skill of skills) set.add(getVendor(skill));
    return [...set].sort();
  }, [skills]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return skills.filter((s) => {
      if (vendorFilter && getVendor(s) !== vendorFilter) return false;
      if (q && !s.name.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [skills, search, vendorFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, SkillDef[]>();
    for (const skill of filtered) {
      const vendor = getVendor(skill);
      if (!map.has(vendor)) map.set(vendor, []);
      map.get(vendor)!.push(skill);
    }
    return map;
  }, [filtered]);

  const sortedVendors = useMemo(() => [...grouped.keys()].sort(), [grouped]);

  return { allVendors, filtered, grouped, sortedVendors };
}
