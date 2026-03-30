import type { PromptSources } from "./rtUtils";

export function RtReferenceBadge({ sources }: { sources: PromptSources }) {
  const hasPrior = sources.priorRoundRefs.length > 0;
  const hasCurrent = sources.currentRoundRefs.length > 0;

  if (!hasPrior && !hasCurrent) {
    return <span className="text-[8px] font-medium px-1 py-0.5 rounded bg-muted text-muted-foreground/50">Independent</span>;
  }

  const refs: string[] = [];
  if (hasPrior) {
    refs.push(sources.priorRoundRefs.length <= 2
      ? sources.priorRoundRefs.map((n) => `← ${n}`).join(", ")
      : `← Round ${sources.round - 1}`);
  }
  if (hasCurrent) {
    refs.push(...sources.currentRoundRefs.map((n) => `← ${n}`));
  }

  return (
    <span className="text-[8px] font-medium text-primary/50 bg-primary/5 px-1 py-0.5 rounded">
      {refs.join(" · ")}
    </span>
  );
}
