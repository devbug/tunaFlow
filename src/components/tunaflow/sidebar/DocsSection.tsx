import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileText, ChevronRight, ChevronDown, Folder, FolderOpen, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DocEntry {
  name: string;
  path: string;
  isDir: boolean;
  children?: DocEntry[];
}

/** Scan project for .md files, return a tree structure */
async function scanDocs(projectPath: string): Promise<DocEntry[]> {
  try {
    const entries = await invoke<{ name: string; isDir: boolean; path: string }[]>(
      "list_directory", { path: projectPath }
    );

    const tree: DocEntry[] = [];
    for (const entry of entries) {
      if (entry.isDir) {
        // Only scan docs/, no recursion into node_modules, target, etc.
        if (["docs", ".github"].includes(entry.name)) {
          const children = await scanDocsDir(entry.path, 0);
          if (children.length > 0) {
            tree.push({ name: entry.name, path: entry.path, isDir: true, children });
          }
        }
      } else if (entry.name.endsWith(".md")) {
        tree.push({ name: entry.name, path: entry.path, isDir: false });
      }
    }
    return tree;
  } catch {
    return [];
  }
}

async function scanDocsDir(dirPath: string, depth: number): Promise<DocEntry[]> {
  if (depth > 3) return [];
  try {
    const entries = await invoke<{ name: string; isDir: boolean; path: string }[]>(
      "list_directory", { path: dirPath }
    );
    const result: DocEntry[] = [];
    for (const entry of entries) {
      if (entry.isDir) {
        const children = await scanDocsDir(entry.path, depth + 1);
        if (children.length > 0) {
          result.push({ name: entry.name, path: entry.path, isDir: true, children });
        }
      } else if (entry.name.endsWith(".md")) {
        result.push({ name: entry.name, path: entry.path, isDir: false });
      }
    }
    return result;
  } catch {
    return [];
  }
}

// ─── Doc Viewer Popup ────────────────────────────────────────────────────────

function DocViewer({ path, onClose }: { path: string; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const filename = path.split("/").pop() ?? path;

  useEffect(() => {
    invoke<string>("read_file_content", { path })
      .then(setContent)
      .catch(() => setContent("(파일을 읽을 수 없습니다)"));
  }, [path]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-popover border border-border/40 rounded-xl shadow-2xl w-[700px] max-w-[90vw] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
          <span className="text-sm font-medium text-foreground truncate">{filename}</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {content === null ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : (
            <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-mono leading-relaxed">{content}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── DocsSection ─────────────────────────────────────────────────────────────

interface DocsSectionProps {
  projectPath: string | null | undefined;
}

export function DocsSection({ projectPath }: DocsSectionProps) {
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [viewerPath, setViewerPath] = useState<string | null>(null);

  useEffect(() => {
    if (!projectPath) { setDocs([]); return; }
    scanDocs(projectPath).then(setDocs);
  }, [projectPath]);

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }, []);

  const renderEntry = (entry: DocEntry, depth: number) => {
    if (entry.isDir) {
      const isOpen = expanded.has(entry.path);
      return (
        <div key={entry.path}>
          <button
            onClick={() => toggle(entry.path)}
            className="w-full flex items-center gap-1 px-2 py-0.5 text-[11px] text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/40 rounded transition-colors"
            style={{ paddingLeft: `${8 + depth * 12}px` }}
          >
            {isOpen ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
            {isOpen ? <FolderOpen className="w-3 h-3 shrink-0 text-sidebar-foreground/40" /> : <Folder className="w-3 h-3 shrink-0 text-sidebar-foreground/30" />}
            <span className="truncate">{entry.name}/</span>
          </button>
          {isOpen && entry.children?.map((child) => renderEntry(child, depth + 1))}
        </div>
      );
    }

    return (
      <button
        key={entry.path}
        onClick={() => setViewerPath(entry.path)}
        className="w-full flex items-center gap-1.5 px-2 py-0.5 text-[11px] text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/40 rounded transition-colors"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        title={entry.path}
      >
        <FileText className="w-3 h-3 shrink-0 text-sidebar-foreground/25" />
        <span className="truncate">{entry.name}</span>
      </button>
    );
  };

  if (!projectPath) return null;

  return (
    <>
      <div className="py-1">
        {docs.length === 0 ? (
          <p className="px-3 text-[10px] text-sidebar-foreground/25 italic">No docs found</p>
        ) : (
          docs.map((entry) => renderEntry(entry, 0))
        )}
      </div>
      {viewerPath && <DocViewer path={viewerPath} onClose={() => setViewerPath(null)} />}
    </>
  );
}
