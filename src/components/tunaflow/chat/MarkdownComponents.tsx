import type { ComponentPropsWithoutRef } from "react";
import type { Components } from "react-markdown";

// ─── Code block (pre > code) ─────────────────────────────────────────────────

function CodeBlock({ children, ...rest }: ComponentPropsWithoutRef<"pre">) {
  return (
    <pre
      {...rest}
      className="my-2 rounded-lg bg-[#1a1a2e] text-[13px] leading-relaxed overflow-x-auto p-4 border border-border/30"
    >
      {children}
    </pre>
  );
}

// ─── Inline code ─────────────────────────────────────────────────────────────

function InlineCode({ children, className, ...rest }: ComponentPropsWithoutRef<"code">) {
  // Code inside <pre> (code block) — pass through, CodeBlock handles styling
  if (className?.includes("language-")) {
    return <code className={className} {...rest}>{children}</code>;
  }
  return (
    <code
      {...rest}
      className="text-[13px] bg-accent/60 text-foreground px-1.5 py-0.5 rounded border border-border/20"
    >
      {children}
    </code>
  );
}

// ─── Table with overflow scroll ──────────────────────────────────────────────

function ScrollTable({ children, ...rest }: ComponentPropsWithoutRef<"table">) {
  return (
    <div className="overflow-x-auto my-2 rounded-lg max-w-full border border-border/30">
      <table
        {...rest}
        className="w-full border-collapse text-[13px] [&_th]:bg-accent/40 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:border-b [&_th]:border-border/30 [&_td]:px-3 [&_td]:py-1.5 [&_td]:border-b [&_td]:border-border/10"
      >
        {children}
      </table>
    </div>
  );
}

// ─── Links ───────────────────────────────────────────────────────────────────

function SafeLink({ href, children, ...rest }: ComponentPropsWithoutRef<"a">) {
  const isExternal = href && (href.startsWith("http://") || href.startsWith("https://"));
  return (
    <a
      {...rest}
      href={href}
      {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="text-primary hover:underline"
    >
      {children}
      {isExternal && <span className="inline-block ml-0.5 text-[10px] opacity-40">↗</span>}
    </a>
  );
}

// ─── Blockquote ──────────────────────────────────────────────────────────────

function Quote({ children, ...rest }: ComponentPropsWithoutRef<"blockquote">) {
  return (
    <blockquote
      {...rest}
      className="my-2 pl-3 border-l-2 border-primary/30 text-muted-foreground italic"
    >
      {children}
    </blockquote>
  );
}

// ─── Export ──────────────────────────────────────────────────────────────────

export const markdownComponents: Partial<Components> = {
  pre: CodeBlock as Components["pre"],
  code: InlineCode as Components["code"],
  table: ScrollTable as Components["table"],
  a: SafeLink as Components["a"],
  blockquote: Quote as Components["blockquote"],
};
