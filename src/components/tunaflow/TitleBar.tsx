import { useChatStore } from "@/stores/chatStore";

/**
 * Custom title bar — overlays the macOS traffic light area.
 *
 * macOS: titleBarStyle "Overlay" keeps native traffic lights (close/minimize/maximize).
 *        This component fills the title bar space with app branding + project name.
 *        ~28px tall, padded-left to avoid overlapping traffic lights.
 *
 * Windows/Linux: decorations are kept for now (future: decorations false + custom buttons).
 *
 * data-tauri-drag-region enables window dragging on the title bar area.
 */
export function TitleBar() {
  const selectedProjectKey = useChatStore((s) => s.selectedProjectKey);
  const projects = useChatStore((s) => s.projects);
  const project = projects.find((p) => p.key === selectedProjectKey);
  const projectName = project?.name ?? "";

  return (
    <div
      data-tauri-drag-region
      className="h-[28px] shrink-0 flex items-center select-none bg-sidebar"
      style={{ paddingLeft: 78 }} // macOS traffic light width (~68px) + gap
    >
      {/* App name */}
      <span
        data-tauri-drag-region
        className="text-[11px] font-semibold text-muted-foreground/50 tracking-wide"
      >
        tunaFlow
      </span>

      {/* Separator + project name */}
      {projectName && (
        <>
          <span data-tauri-drag-region className="mx-2 text-[10px] text-muted-foreground/20">—</span>
          <span
            data-tauri-drag-region
            className="text-[11px] font-medium text-muted-foreground/40 truncate max-w-[200px]"
          >
            {projectName}
          </span>
        </>
      )}

      {/* Spacer — makes entire area draggable */}
      <div data-tauri-drag-region className="flex-1" />
    </div>
  );
}
