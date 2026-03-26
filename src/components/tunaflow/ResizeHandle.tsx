import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  /** "left" = drag grows left panel, "right" = drag grows right panel */
  side: "left" | "right";
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
  className?: string;
}

/**
 * Vertical resize handle — wide hit area (8px), thin visual line (1px).
 * `onResize(delta)` receives pixel delta based on side.
 */
export function ResizeHandle({ side, onResize, onResizeEnd, className }: ResizeHandleProps) {
  const [active, setActive] = useState(false);
  const dragging = useRef(false);
  const startX = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      setActive(true);
      startX.current = e.clientX;

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = ev.clientX - startX.current;
        startX.current = ev.clientX;
        onResize(side === "left" ? delta : -delta);
      };

      const handleMouseUp = () => {
        dragging.current = false;
        setActive(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        onResizeEnd?.();
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [onResize, onResizeEnd, side],
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      className={cn(
        // Wide hit area, transparent background
        "shrink-0 w-2 cursor-col-resize relative group",
        className,
      )}
    >
      {/* Thin visual line — centered within the 8px hit area */}
      <div
        className={cn(
          "absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px transition-all duration-150",
          active
            ? "w-0.5 bg-primary/50"
            : "bg-border/60 group-hover:bg-primary/30 group-hover:w-0.5",
        )}
      />
    </div>
  );
}
