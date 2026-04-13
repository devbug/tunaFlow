import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  separator?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export function SidebarContextMenu({ menu, onClose }: { menu: ContextMenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onMouse);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouse);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const x = Math.min(menu.x, window.innerWidth - 180);
  const y = Math.min(menu.y, window.innerHeight - menu.items.length * 28 - 16);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[200] min-w-[160px] bg-popover border border-border/40 rounded-lg shadow-xl py-1 overflow-hidden"
      style={{ left: x, top: y }}
    >
      {menu.items.map((item, i) =>
        item.separator ? (
          <div key={i} className="my-1 border-t border-border/30" />
        ) : (
          <button
            key={i}
            onClick={() => { item.onClick(); onClose(); }}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors text-left",
              item.danger
                ? "text-destructive hover:bg-destructive/10"
                : "text-foreground/80 hover:bg-accent hover:text-foreground"
            )}
          >
            {item.icon && <span className="w-3.5 h-3.5 shrink-0 flex items-center">{item.icon}</span>}
            {item.label}
          </button>
        )
      )}
    </div>,
    document.body,
  );
}
