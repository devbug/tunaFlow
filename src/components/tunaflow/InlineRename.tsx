import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Pencil, Check, X } from "lucide-react";

interface InlineRenameProps {
  value: string;
  onSave: (newValue: string) => void;
  className?: string;
  inputClassName?: string;
  /** Show pencil icon on hover (default true) */
  showIcon?: boolean;
}

/**
 * Inline editable text — click pencil to edit, Enter/blur to save, Escape to cancel.
 * Empty input → clears custom label (reverts to auto label).
 */
export function InlineRename({
  value,
  onSave,
  className,
  inputClassName,
  showIcon = true,
}: InlineRenameProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      // Focus + select on next frame
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== value) {
      onSave(trimmed);
    }
  };

  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1 min-w-0">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { e.preventDefault(); cancel(); }
          }}
          onBlur={commit}
          className={cn(
            "bg-input rounded px-1.5 py-0.5 text-xs outline-none text-foreground border border-ring/50 min-w-[80px]",
            inputClassName,
          )}
          placeholder="Enter name..."
        />
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={commit}
          className="shrink-0 text-status-approved hover:text-status-approved/80 transition-colors"
        >
          <Check className="w-3 h-3" />
        </button>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={cancel}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </span>
    );
  }

  return (
    <span className={cn("group/rename inline-flex items-center gap-1 min-w-0", className)}>
      <span className="truncate">{value}</span>
      {showIcon && (
        <button
          onClick={(e) => { e.stopPropagation(); setEditing(true); }}
          className="shrink-0 opacity-0 group-hover/rename:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
          title="Rename"
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}
