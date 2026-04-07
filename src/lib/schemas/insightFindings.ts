import { z } from "zod";

/**
 * Insight Findings schema — validates agent analysis output.
 *
 * Agent produces JSON inside `<!-- tunaflow:insight-findings -->` markers.
 */

export const InsightFindingItemSchema = z.object({
  category: z.enum(["stability", "test", "architecture", "performance", "security", "debt"]),
  severity: z.enum(["critical", "major", "minor", "info"]),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  title: z.string().min(1),
  description: z.string().min(1),
  evidence: z.string().optional(), // exact code quote from input that proves this finding
  file_path: z.string().optional(),
  line_number: z.number().int().optional(),
  snippet: z.string().optional(),
  estimated_files: z.number().int().min(1).default(1),
});

export const InsightFindingsSchema = z.object({
  findings: z.array(InsightFindingItemSchema).min(1),
  summary: z.string().optional(),
});

export type InsightFindingsInput = z.infer<typeof InsightFindingsSchema>;
export type InsightFindingItemInput = z.infer<typeof InsightFindingItemSchema>;
