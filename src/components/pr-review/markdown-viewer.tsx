import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const remarkPlugins = [remarkGfm];

interface MarkdownViewerProps {
  content: string;
  className?: string;
}

/**
 * Markdown renderer for Linear ticket descriptions.
 * Uses react-markdown + remark-gfm for full GFM support including
 * checkboxes, strikethrough, tables, and nested lists.
 */
export function MarkdownViewer({ content, className }: MarkdownViewerProps) {
  return (
    <div className={className}>
      <Markdown remarkPlugins={remarkPlugins} components={components}>
        {content}
      </Markdown>
    </div>
  );
}

const components: Components = {
  h1: ({ children }) => (
    <p className="text-sm font-bold mt-3 mb-1">{children}</p>
  ),
  h2: ({ children }) => (
    <p className="text-[13px] font-semibold mt-2.5 mb-1">{children}</p>
  ),
  h3: ({ children }) => (
    <p className="text-xs font-semibold mt-2 mb-0.5">{children}</p>
  ),
  h4: ({ children }) => (
    <p className="text-xs font-semibold mt-1.5 mb-0.5">{children}</p>
  ),
  p: ({ children }) => (
    <p className="text-[11px] leading-relaxed text-muted-foreground mb-1.5">
      {children}
    </p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground/90">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => (
    <del className="text-muted-foreground/60 line-through">{children}</del>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline"
    >
      {children}
    </a>
  ),
  code: ({ className: codeClassName, children, ...props }) => {
    // Fenced code blocks get a className like "language-ts"
    const isBlock = codeClassName?.startsWith("language-");
    if (isBlock) {
      return (
        <code
          className="text-[10px] leading-relaxed font-mono text-foreground/80"
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-muted px-1 py-0.5 text-[10px] font-mono">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="rounded-md bg-muted/50 border px-3 py-2 my-1.5 overflow-x-auto">
      {children}
    </pre>
  ),
  ul: ({ children }) => (
    <ul className="mb-1.5 space-y-0.5 pl-4 list-disc marker:text-muted-foreground/60">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-1.5 space-y-0.5 pl-4 list-decimal marker:text-muted-foreground/60 marker:tabular-nums">
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => {
    // Checkbox list items have a className from remark-gfm
    const isTask = typeof props.className === "string" && props.className.includes("task-list-item");
    return (
      <li className={`text-[11px] leading-relaxed text-muted-foreground ${isTask ? "list-none -ml-4 flex items-start gap-1.5" : ""}`}>
        {children}
      </li>
    );
  },
  input: ({ checked, ...props }) => (
    <input
      type="checkbox"
      checked={checked}
      readOnly
      className="mt-0.5 accent-primary pointer-events-none"
      {...props}
    />
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-muted-foreground/30 pl-2.5 my-1.5 [&>p]:text-muted-foreground/80 [&>p]:italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-2 border-muted-foreground/20" />,
  table: ({ children }) => (
    <div className="my-1.5 overflow-x-auto">
      <table className="text-[11px] border-collapse w-full">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-muted-foreground/20">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="text-left font-semibold px-2 py-1 text-xs">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-2 py-1 text-muted-foreground border-t border-muted-foreground/10">
      {children}
    </td>
  ),
  img: ({ alt }) => (
    <span className="text-[11px] text-muted-foreground italic">[{alt}]</span>
  ),
};
