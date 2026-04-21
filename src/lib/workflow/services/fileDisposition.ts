/**
 * File disposition parsing — re-exported from `planProposalParser`.
 *
 * The parser itself already sits in `planProposalParser.ts` and is
 * purely functional. This thin shim puts it next to the other workflow
 * domain services so new code has one place to look when working with
 * keep/modify/revert file lists, without forcing a move that would
 * break every existing import of `parseFileDispositions`.
 */
export {
  parseFileDispositions,
  mergeDispositions,
  type FileDispositions,
} from "@/lib/planProposalParser";
