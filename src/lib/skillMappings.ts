/**
 * Tech-stack → Skill mapping table.
 *
 * Maps dependency names (detected from package.json, Cargo.toml, etc.)
 * to recommended tunaFlow skill names.
 *
 * Separated from skillSets.ts for reuse by future prompt-based
 * dynamic activation (feature C).
 */

export interface SkillMapping {
  /** Dependency name patterns to match (lowercase, exact match against detected keywords) */
  patterns: string[];
  /** Skill names to recommend when any pattern matches */
  skills: string[];
  /** Category for UI grouping */
  category?: string;
}

export const SKILL_MAPPINGS: SkillMapping[] = [
  // ── Frontend ──
  {
    patterns: ["react", "react-dom", "next", "nextjs", "@next/core"],
    skills: ["anthropic-frontend-design", "vercel-react-best-practices"],
    category: "frontend",
  },
  {
    patterns: ["zustand"],
    skills: ["microsoft-zustand-store-ts"],
    category: "frontend",
  },
  {
    patterns: ["tailwindcss", "@tailwindcss/vite"],
    skills: ["microsoft-frontend-ui-dark-ts"],
    category: "frontend",
  },

  // ── Testing ──
  {
    patterns: ["vitest", "jest", "@testing-library/react", "@testing-library/jest-dom"],
    skills: ["anthropic-webapp-testing"],
    category: "testing",
  },
  {
    patterns: ["playwright", "@playwright/test"],
    skills: ["openai-playwright"],
    category: "testing",
  },

  // ── AI / API ──
  {
    patterns: ["@anthropic-ai/sdk"],
    skills: ["anthropic-claude-api"],
    category: "api",
  },
  {
    patterns: ["openai"],
    skills: ["openai-openai-docs"],
    category: "api",
  },
  {
    patterns: ["@modelcontextprotocol/sdk", "@modelcontextprotocol/server-stdio"],
    skills: ["anthropic-mcp-builder"],
    category: "api",
  },

  // ── Backend / Database ──
  {
    patterns: ["@supabase/supabase-js", "@supabase/ssr"],
    skills: ["supabase-supabase-ts", "supabase-supabase-auth-ts"],
    category: "backend",
  },
  {
    patterns: ["supabase"],  // Python package name
    skills: ["supabase-supabase-py"],
    category: "backend",
  },

  // ── Deployment ──
  {
    patterns: ["vercel", "@vercel/node", "@vercel/next"],
    skills: ["vercel-deploy-to-vercel"],
    category: "deployment",
  },
];

/**
 * Prompt keyword → skill mappings for dynamic per-request activation (feature C).
 * These patterns match words found in user prompts (natural language),
 * unlike SKILL_MAPPINGS which match package dependency names.
 */
export const PROMPT_SKILL_MAPPINGS: SkillMapping[] = [
  { patterns: ["react", "컴포넌트", "component", "jsx", "tsx", "hook", "useeffect", "usestate"], skills: ["anthropic-frontend-design", "vercel-react-best-practices"], category: "frontend" },
  { patterns: ["zustand", "store", "스토어", "slice"], skills: ["microsoft-zustand-store-ts"], category: "frontend" },
  { patterns: ["tailwind", "tailwindcss", "className", "스타일"], skills: ["microsoft-frontend-ui-dark-ts"], category: "frontend" },
  { patterns: ["test", "테스트", "vitest", "jest", "coverage", "spec"], skills: ["anthropic-webapp-testing"], category: "testing" },
  { patterns: ["playwright", "e2e", "브라우저"], skills: ["openai-playwright"], category: "testing" },
  { patterns: ["claude", "anthropic", "claude-api"], skills: ["anthropic-claude-api"], category: "api" },
  { patterns: ["openai", "gpt", "chatgpt"], skills: ["openai-openai-docs"], category: "api" },
  { patterns: ["mcp", "tool_use", "서버"], skills: ["anthropic-mcp-builder"], category: "api" },
  { patterns: ["supabase", "수파베이스"], skills: ["supabase-supabase-ts", "supabase-supabase-auth-ts"], category: "backend" },
  { patterns: ["deploy", "배포", "vercel"], skills: ["vercel-deploy-to-vercel"], category: "deployment" },
  { patterns: ["review", "리뷰", "코드리뷰"], skills: ["microsoft-frontend-design-review"], category: "review" },
];

/**
 * Match prompt text against PROMPT_SKILL_MAPPINGS.
 * Returns skill names that match any word in the prompt.
 * Only returns skills not already in activeSkills (additive).
 */
export function matchPromptToSkills(prompt: string, activeSkills: string[]): string[] {
  const words = new Set(
    prompt.toLowerCase().split(/[\s,.:;!?()[\]{}<>'"]+/).filter((w) => w.length >= 2)
  );
  const active = new Set(activeSkills);
  const matched = new Set<string>();

  for (const mapping of PROMPT_SKILL_MAPPINGS) {
    if (mapping.patterns.some((p) => words.has(p))) {
      for (const skill of mapping.skills) {
        if (!active.has(skill)) matched.add(skill);
      }
    }
  }
  return [...matched];
}

/**
 * Map detected dependency keywords to recommended skill names.
 * Returns deduplicated array of skill names.
 */
export function mapKeywordsToSkills(keywords: string[]): string[] {
  const matched = new Set<string>();
  const kwSet = new Set(keywords.map((k) => k.toLowerCase()));

  for (const mapping of SKILL_MAPPINGS) {
    if (mapping.patterns.some((p) => kwSet.has(p))) {
      for (const skill of mapping.skills) {
        matched.add(skill);
      }
    }
  }
  return [...matched];
}
