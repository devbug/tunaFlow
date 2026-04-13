import { lazy, Suspense, useState, useContext, type ComponentPropsWithoutRef, type ReactElement, isValidElement, Children } from "react";
import { copyToClipboard } from "@/lib/clipboard";
import type { Components } from "react-markdown";
import { Check, Copy, ChevronDown, ChevronRight, FileCode } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileViewerContext } from "./fileViewerContext";

// Lazy-load syntax highlighter
const SyntaxHighlighter = lazy(() =>
  import("react-syntax-highlighter").then((mod) => ({ default: mod.Prism }))
);
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

// ─── Constants ─────────────────────────────────────────────────────────────

/** Auto-collapse threshold (lines) */
const COLLAPSE_THRESHOLD = 15;
/** Visible lines when collapsed */
const COLLAPSED_VISIBLE_LINES = 8;

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Extract language from <code className="language-xxx"> inside <pre> */
function extractLang(children: React.ReactNode): string | null {
  const child = Children.toArray(children)[0];
  if (isValidElement(child)) {
    const cls = (child as ReactElement<{ className?: string }>).props.className ?? "";
    const m = cls.match(/language-(\w+)/);
    return m ? m[1] : null;
  }
  return null;
}

/** Extract raw text from <code> children */
function extractText(children: React.ReactNode): string {
  const child = Children.toArray(children)[0];
  if (isValidElement(child)) {
    const props = (child as ReactElement<{ children?: React.ReactNode }>).props;
    return String(props.children ?? "").replace(/\n$/, "");
  }
  return "";
}

// ─── Code block (pre > code) ────────────────────────────────────────────────

function CodeBlock({ children, ...rest }: ComponentPropsWithoutRef<"pre">) {
  const [copied, setCopied] = useState(false);
  const lang = extractLang(children);
  const text = extractText(children);
  const lineCount = text.split("\n").length;
  const shouldCollapse = lineCount > COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(!shouldCollapse);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const showHeader = !!(lang || shouldCollapse);

  return (
    <div className="group/codeblock relative my-2 rounded-md bg-card border border-border/30 overflow-hidden">
      {/* ─── Header bar — only when language tag or collapsible ─── */}
      {showHeader && (
        <div className="flex items-center gap-2 px-3 py-1 bg-white/[0.03] border-b border-border/10 text-[10px] text-muted-foreground/50">
          {shouldCollapse && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-0.5 hover:text-muted-foreground transition-colors"
            >
              {expanded
                ? <ChevronDown className="w-3 h-3" />
                : <ChevronRight className="w-3 h-3" />
              }
            </button>
          )}
          {lang && <span className="font-mono">{lang}</span>}
          <span>{lineCount} lines</span>
          <div className="flex-1" />
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 hover:text-muted-foreground transition-colors"
          >
            {copied
              ? <><Check className="w-3 h-3 text-status-approved" /><span className="text-status-approved">Copied</span></>
              : <><Copy className="w-3 h-3" /><span>Copy</span></>
            }
          </button>
        </div>
      )}

      {/* ─── Code content ─── */}
      <div className="relative">
        <pre
          {...rest}
          className={cn(
            "!m-0 text-[13px] leading-relaxed overflow-x-auto [&>code]:!bg-transparent [&>code]:!p-0",
            !lang && "px-3 py-2.5",
            !expanded && "overflow-hidden"
          )}
          style={!expanded ? { maxHeight: `${COLLAPSED_VISIBLE_LINES * 1.6 + 0.75}rem` } : undefined}
        >
          {children}
        </pre>

        {/* No-header hover copy button */}
        {!showHeader && (
          <button
            onClick={handleCopy}
            className="absolute top-1.5 right-1.5 opacity-0 group-hover/codeblock:opacity-100 transition-opacity flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground bg-card/80 px-1.5 py-0.5 rounded border border-border/20"
          >
            {copied
              ? <><Check className="w-3 h-3 text-status-approved" /><span className="text-status-approved">Copied</span></>
              : <><Copy className="w-3 h-3" /><span>Copy</span></>
            }
          </button>
        )}

        {/* Collapse gradient overlay */}
        {!expanded && (
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-card to-transparent flex items-end justify-center pb-1">
            <button
              onClick={() => setExpanded(true)}
              className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground bg-card px-2 py-0.5 rounded border border-border/20 transition-colors"
            >
              Show all {lineCount} lines
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── File path detection ────────────────────────────────────────────────────

/** Known file extensions for path detection in inline code */
const FILE_EXT_RE = /\.(rs|ts|tsx|js|jsx|py|go|java|rb|md|json|toml|yaml|yml|html|css|sql|sh|bash|xml|c|h|cpp|cc|hpp|vue|svelte|txt|cfg|conf|env|lock|mod|sum)$/;

/** Match patterns like `src/foo/bar.ts` or `src/foo/bar.ts:12` */
const FILE_PATH_RE = /^([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)(?::(\d+))?$/;

function parseFilePath(text: string): { path: string; line?: number } | null {
  // Must contain at least one slash or dot to be a path
  if (!text.includes("/") && !text.includes("\\")) return null;
  const m = text.trim().match(FILE_PATH_RE);
  if (!m) return null;
  const filePart = m[1];
  // Must have a known extension
  if (!FILE_EXT_RE.test(filePart)) return null;
  return { path: filePart, line: m[2] ? parseInt(m[2], 10) : undefined };
}

// ─── Headings ────────────────────────────────────────────────────────────────

function H1({ children, ...rest }: ComponentPropsWithoutRef<"h1">) {
  return <h1 {...rest} className="text-[18px] font-semibold text-foreground mt-4 mb-2 leading-tight">{children}</h1>;
}
function H2({ children, ...rest }: ComponentPropsWithoutRef<"h2">) {
  return <h2 {...rest} className="text-[15px] font-semibold text-foreground mt-3 mb-1.5 leading-tight">{children}</h2>;
}
function H3({ children, ...rest }: ComponentPropsWithoutRef<"h3">) {
  return <h3 {...rest} className="text-[13px] font-semibold text-foreground/90 mt-2.5 mb-1 leading-tight">{children}</h3>;
}
function H4({ children, ...rest }: ComponentPropsWithoutRef<"h4">) {
  return <h4 {...rest} className="text-[12px] font-semibold text-foreground/80 mt-2 mb-1 leading-tight">{children}</h4>;
}

// ─── Inline code / syntax highlighted code ──────────────────────────────────

function InlineCode({ children, className, ...rest }: ComponentPropsWithoutRef<"code">) {
  const fileViewer = useContext(FileViewerContext);
  const match = className?.match(/language-(\w+)/);

  if (match) {
    const lang = match[1];
    return (
      <Suspense fallback={<code className={className} {...rest}>{children}</code>}>
        <SyntaxHighlighter
          style={oneDark}
          language={lang}
          PreTag="div"
          customStyle={{
            margin: 0,
            padding: "0.75rem",
            background: "transparent",
            fontSize: "12px",
            lineHeight: "1.6",
            textShadow: "none",
          }}
          codeTagProps={{ style: {} }}
        >
          {String(children).replace(/\n$/, "")}
        </SyntaxHighlighter>
      </Suspense>
    );
  }

  // Suppress empty code spans (e.g. stripped workflow markers left inside backticks)
  const text = String(children);
  if (!text.trim()) return null;

  // Check if inline code is a file path
  const fileParsed = parseFilePath(text);

  if (fileParsed && fileViewer) {
    return (
      <code
        {...rest}
        onClick={() => fileViewer.openFile(fileParsed.path, fileParsed.line)}
        className="text-[13px] bg-accent/60 text-primary px-1 py-0.5 rounded cursor-pointer hover:bg-accent/60 hover:text-primary transition-colors inline-flex items-center gap-0.5"
        title={`Open ${fileParsed.path}${fileParsed.line ? `:${fileParsed.line}` : ""}`}
      >
        <FileCode className="w-3 h-3 shrink-0 opacity-50" />
        {children}
      </code>
    );
  }

  return (
    <code {...rest}
      className="text-[13px] bg-accent/60 text-foreground/90 px-1 py-0.5 rounded">
      {children}
    </code>
  );
}

// ─── Table ──────────────────────────────────────────────────────────────────

function ScrollTable({ children, ...rest }: ComponentPropsWithoutRef<"table">) {
  return (
    <div className="overflow-x-auto my-2 rounded-md max-w-full border border-border/20 inline-block">
      <table {...rest}
        className="border-collapse text-[13px] [&_th]:bg-accent/30 [&_th]:px-2.5 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground/70 [&_th]:border-b [&_th]:border-border/20 [&_td]:px-2.5 [&_td]:py-1 [&_td]:border-b [&_td]:border-border/10">
        {children}
      </table>
    </div>
  );
}

// ─── Links ──────────────────────────────────────────────────────────────────

function SafeLink({ href, children, ...rest }: ComponentPropsWithoutRef<"a">) {
  const fileViewer = useContext(FileViewerContext);
  const isExternal = href && (href.startsWith("http://") || href.startsWith("https://"));
  const isRelative = href && !isExternal && !href.startsWith("#") && !href.startsWith("mailto:");

  if (isRelative && fileViewer) {
    // Strip leading ./ for cleaner path
    const path = href.replace(/^\.\//, "");
    return (
      <button
        type="button"
        onClick={() => fileViewer.openFile(path)}
        className="text-primary hover:text-primary hover:underline transition-colors inline cursor-pointer"
      >
        {children}
      </button>
    );
  }

  return (
    <a {...rest} href={href}
      {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="text-primary hover:text-primary hover:underline transition-colors">
      {children}
      {isExternal && <span className="inline-block ml-0.5 text-[9px] opacity-30">↗</span>}
    </a>
  );
}

// ─── Blockquote ─────────────────────────────────────────────────────────────

function Quote({ children, ...rest }: ComponentPropsWithoutRef<"blockquote">) {
  return (
    <blockquote {...rest}
      className="!my-1.5 pl-3 border-l-2 border-border/40 text-muted-foreground/80 italic">
      {children}
    </blockquote>
  );
}

// ─── Export ─────────────────────────────────────────────────────────────────

export const markdownComponents: Partial<Components> = {
  pre: CodeBlock as Components["pre"],
  code: InlineCode as Components["code"],
  table: ScrollTable as Components["table"],
  a: SafeLink as Components["a"],
  blockquote: Quote as Components["blockquote"],
  h1: H1 as Components["h1"],
  h2: H2 as Components["h2"],
  h3: H3 as Components["h3"],
  h4: H4 as Components["h4"],
};
