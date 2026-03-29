import { useEffect } from "react";
import { X } from "lucide-react";
import { TracePanel } from "./context-panel/TracePanel";

interface TraceModalProps {
  onClose: () => void;
}

export function TraceModal({ onClose }: TraceModalProps) {
  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-card border border-border/40 rounded-lg shadow-2xl w-[80vw] max-w-[900px] max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 h-10 border-b border-border/30 shrink-0">
          <span className="text-[13px] font-medium text-foreground flex-1">Runtime Trace</span>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content — reuse existing TracePanel */}
        <div className="flex-1 overflow-y-auto p-4">
          <TracePanel />
        </div>
      </div>
    </div>
  );
}
