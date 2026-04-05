/**
 * Custom right-click context menus for tunaFlow.
 *
 * - Shift+Right-click: browser default (Inspect Element for devtools)
 * - Regular right-click: tunaFlow custom menu based on click target
 *
 * Menus:
 * - MessageContextMenu: assistant / user messages
 * - ChatAreaContextMenu: empty chat area
 * - SidebarContextMenu: conversation items (provided separately)
 */

import * as ContextMenu from "@radix-ui/react-context-menu";
import { cn } from "@/lib/utils";
import { Copy, GitBranch, Users, Bookmark, FileText, Forward, Trash2, Pencil, Plus, ClipboardPaste } from "lucide-react";

// ─── Shared menu styling ────────────────────────────────────────────────────

const menuContentClass = "min-w-[180px] bg-popover border border-border/40 rounded-lg shadow-xl p-1 z-[100] animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2";
const menuItemClass = "flex items-center gap-2 px-2.5 py-1.5 text-[12px] rounded-md cursor-pointer outline-none transition-colors text-foreground/80 data-[highlighted]:bg-accent data-[highlighted]:text-foreground";
const menuSeparatorClass = "h-px bg-border/30 my-1 mx-1";
const menuIconClass = "w-3.5 h-3.5 text-muted-foreground/60";
const destructiveItemClass = "flex items-center gap-2 px-2.5 py-1.5 text-[12px] rounded-md cursor-pointer outline-none transition-colors text-destructive/70 data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive";

// ─── MessageContextMenu ─────────────────────────────────────────────────────

interface MessageContextMenuProps {
  children: React.ReactNode;
  isUser: boolean;
  onCopy: () => void;
  onBranch?: () => void;
  onBranchRT?: () => void;
  onMemo?: () => void;
  onSaveArtifact?: () => void;
  onFollowup?: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
}

export function MessageContextMenu({
  children, isUser, onCopy, onBranch, onBranchRT, onMemo, onSaveArtifact, onFollowup, onDelete, onEdit,
}: MessageContextMenuProps) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        className="contents"
        onContextMenu={(e) => {
          // Shift+right-click → browser default (devtools)
          if (e.shiftKey) {
            e.stopPropagation();
            return;
          }
        }}
      >
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuContentClass}>
          <ContextMenu.Item className={menuItemClass} onSelect={onCopy}>
            <Copy className={menuIconClass} />복사
          </ContextMenu.Item>

          {isUser && onEdit && (
            <ContextMenu.Item className={menuItemClass} onSelect={onEdit}>
              <Pencil className={menuIconClass} />편집 (재전송)
            </ContextMenu.Item>
          )}

          {!isUser && (
            <>
              {onBranch && (
                <ContextMenu.Item className={menuItemClass} onSelect={onBranch}>
                  <GitBranch className={menuIconClass} />Branch 분기
                </ContextMenu.Item>
              )}
              {onBranchRT && (
                <ContextMenu.Item className={menuItemClass} onSelect={onBranchRT}>
                  <Users className={menuIconClass} />RT 분기
                </ContextMenu.Item>
              )}
              {onMemo && (
                <ContextMenu.Item className={menuItemClass} onSelect={onMemo}>
                  <Bookmark className={menuIconClass} />Memo 저장
                </ContextMenu.Item>
              )}
              {onSaveArtifact && (
                <ContextMenu.Item className={menuItemClass} onSelect={onSaveArtifact}>
                  <FileText className={menuIconClass} />Artifact 저장
                </ContextMenu.Item>
              )}
              {onFollowup && (
                <ContextMenu.Item className={menuItemClass} onSelect={onFollowup}>
                  <Forward className={menuIconClass} />Forward
                </ContextMenu.Item>
              )}
            </>
          )}

          {onDelete && (
            <>
              <ContextMenu.Separator className={menuSeparatorClass} />
              <ContextMenu.Item className={destructiveItemClass} onSelect={onDelete}>
                <Trash2 className={cn(menuIconClass, "text-destructive/60")} />삭제
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

// ─── ChatAreaContextMenu ────────────────────────────────────────────────────

interface ChatAreaContextMenuProps {
  children: React.ReactNode;
  onNewConversation?: () => void;
  onPaste?: () => void;
}

export function ChatAreaContextMenu({ children, onNewConversation, onPaste }: ChatAreaContextMenuProps) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        className="contents"
        onContextMenu={(e) => {
          if (e.shiftKey) { e.stopPropagation(); return; }
        }}
      >
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuContentClass}>
          {onNewConversation && (
            <ContextMenu.Item className={menuItemClass} onSelect={onNewConversation}>
              <Plus className={menuIconClass} />새 대화
            </ContextMenu.Item>
          )}
          {onPaste && (
            <ContextMenu.Item className={menuItemClass} onSelect={onPaste}>
              <ClipboardPaste className={menuIconClass} />붙여넣기
            </ContextMenu.Item>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

// ─── SidebarItemContextMenu ─────────────────────────────────────────────────

interface SidebarItemContextMenuProps {
  children: React.ReactNode;
  onRename?: () => void;
  onCreateBranch?: () => void;
  onDelete?: () => void;
}

export function SidebarItemContextMenu({ children, onRename, onCreateBranch, onDelete }: SidebarItemContextMenuProps) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        className="contents"
        onContextMenu={(e) => {
          if (e.shiftKey) { e.stopPropagation(); return; }
        }}
      >
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuContentClass}>
          {onRename && (
            <ContextMenu.Item className={menuItemClass} onSelect={onRename}>
              <Pencil className={menuIconClass} />이름 변경
            </ContextMenu.Item>
          )}
          {onCreateBranch && (
            <ContextMenu.Item className={menuItemClass} onSelect={onCreateBranch}>
              <GitBranch className={menuIconClass} />Branch 생성
            </ContextMenu.Item>
          )}
          {onDelete && (
            <>
              <ContextMenu.Separator className={menuSeparatorClass} />
              <ContextMenu.Item className={destructiveItemClass} onSelect={onDelete}>
                <Trash2 className={cn(menuIconClass, "text-destructive/60")} />삭제
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
