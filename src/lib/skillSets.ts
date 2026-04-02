/**
 * Skill Sets — predefined groups of skills for quick selection.
 *
 * Instead of toggling 246 individual skills, users select a set name
 * and all included skills are activated automatically.
 */

export interface SkillSet {
  id: string;
  label: string;
  description: string;
  skills: string[];
}

/**
 * Built-in skill sets. These are curated groups based on common use cases.
 * Users can also create custom sets (future).
 */
export const SKILL_SETS: SkillSet[] = [
  {
    id: "frontend",
    label: "Frontend",
    description: "React, Zustand, Tailwind, UI 설계",
    skills: [
      "anthropic-frontend-design",
      "microsoft-zustand-store-ts",
      "microsoft-frontend-ui-dark-ts",
      "vercel-react-best-practices",
      "openai-frontend-skill",
    ],
  },
  {
    id: "frontend-review",
    label: "Frontend Review",
    description: "프론트엔드 코드 리뷰 + 테스트",
    skills: [
      "microsoft-frontend-design-review",
      "anthropic-webapp-testing",
    ],
  },
  {
    id: "api-sdk",
    label: "API / SDK",
    description: "Claude, OpenAI, MCP 연동",
    skills: [
      "anthropic-claude-api",
      "openai-chatgpt-apps",
      "anthropic-mcp-builder",
    ],
  },
  {
    id: "docs",
    label: "Documentation",
    description: "문서 작성, 공동 편집",
    skills: [
      "anthropic-doc-coauthoring",
      "anthropic-pdf",
      "anthropic-xlsx",
      "anthropic-pptx",
    ],
  },
  {
    id: "supabase",
    label: "Supabase",
    description: "Supabase 백엔드 연동",
    skills: [
      "supabase-supabase-auth-ts",
      "supabase-supabase-ts",
      "supabase-supabase-py",
    ],
  },
];

/**
 * Expand a skill set ID to individual skill names.
 * Returns the set's skills if found, or an empty array.
 */
export function expandSkillSet(setId: string): string[] {
  return SKILL_SETS.find((s) => s.id === setId)?.skills ?? [];
}

/**
 * Expand a mixed array of set IDs and individual skill names.
 * Set IDs are prefixed with "set:" to distinguish from skill names.
 */
export function expandSkillRefs(refs: string[]): string[] {
  const expanded = new Set<string>();
  for (const ref of refs) {
    if (ref.startsWith("set:")) {
      for (const skill of expandSkillSet(ref.slice(4))) {
        expanded.add(skill);
      }
    } else {
      expanded.add(ref);
    }
  }
  return [...expanded];
}
