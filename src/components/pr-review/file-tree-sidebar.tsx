import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { FileDiff } from "@/types";
import type { AiAnnotation } from "@/types";

interface FileTreeSidebarProps {
  files: FileDiff[];
  collapsed: boolean;
  aiAnnotations?: AiAnnotation[];
  onToggleCollapsed: () => void;
  onSelectFile: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  file?: FileDiff;
  children: Map<string, TreeNode>;
  findingCount: number;
}

function buildTree(files: FileDiff[], annotations: AiAnnotation[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map(), findingCount: 0 };

  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const partPath = parts.slice(0, i + 1).join("/");
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path: partPath,
          children: new Map(),
          findingCount: 0,
        });
      }
      current = current.children.get(part)!;
    }
    current.file = file;
    current.findingCount = annotations.filter((a) => a.file_path === file.path).length;
  }

  return root;
}

function flattenTree(node: TreeNode, depth: number = 0): { node: TreeNode; depth: number }[] {
  const result: { node: TreeNode; depth: number }[] = [];

  // Sort: directories first, then files, alphabetically within each group
  const sorted = [...node.children.values()].sort((a, b) => {
    const aIsDir = a.children.size > 0 && !a.file;
    const bIsDir = b.children.size > 0 && !b.file;
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const child of sorted) {
    // Collapse single-child directories into one entry (e.g., "src/components" instead of "src" > "components")
    if (child.children.size === 1 && !child.file) {
      const [grandchild] = child.children.values();
      const collapsed: TreeNode = {
        ...grandchild,
        name: `${child.name}/${grandchild.name}`,
      };
      // Recursively collapse further if needed
      let current = collapsed;
      while (current.children.size === 1 && !current.file) {
        const [next] = current.children.values();
        current = { ...next, name: `${current.name}/${next.name}` };
      }
      if (current.file) {
        result.push({ node: current, depth });
      } else {
        result.push({ node: current, depth });
        result.push(...flattenTree(current, depth + 1));
      }
    } else if (child.file) {
      result.push({ node: child, depth });
    } else {
      result.push({ node: child, depth });
      result.push(...flattenTree(child, depth + 1));
    }
  }

  return result;
}

const STATUS_COLORS: Record<string, { label: string; className: string }> = {
  added: { label: "A", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300" },
  removed: { label: "D", className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" },
  modified: { label: "M", className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300" },
  renamed: { label: "R", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300" },
};

export function FileTreeSidebar({
  files,
  collapsed,
  aiAnnotations = [],
  onToggleCollapsed,
  onSelectFile,
}: FileTreeSidebarProps) {
  const flatEntries = useMemo(() => {
    const tree = buildTree(files, aiAnnotations);
    return flattenTree(tree);
  }, [files, aiAnnotations]);

  const totalFindings = aiAnnotations.length;

  return (
    <div
      className="flex h-full shrink-0 flex-col border-r bg-background transition-all duration-200 overflow-hidden"
      style={{ width: collapsed ? 48 : 260 }}
    >
      {collapsed ? (
        <div className="flex h-full flex-col items-center pt-3">
          <button
            onClick={onToggleCollapsed}
            className="rounded p-1 hover:bg-accent"
            title="Expand file tree"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="mt-3 text-xs text-muted-foreground [writing-mode:vertical-lr]">
            Files
          </span>
        </div>
      ) : (
        <>
          <div className="shrink-0 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={onToggleCollapsed}
                  className="rounded p-1 hover:bg-accent"
                  title="Collapse file tree"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <h2 className="text-sm font-semibold">Files</h2>
              </div>
              <Badge variant="secondary" className="text-xs">
                {files.length}
              </Badge>
            </div>
          </div>
          <Separator />

          {/* Summary stats */}
          <div className="shrink-0 flex items-center gap-3 px-4 py-2 text-xs text-muted-foreground border-b">
            <span className="text-green-600 dark:text-green-400">
              +{files.reduce((s, f) => s + f.additions, 0)}
            </span>
            <span className="text-red-600 dark:text-red-400">
              -{files.reduce((s, f) => s + f.deletions, 0)}
            </span>
            {totalFindings > 0 && (
              <span className="text-yellow-600 dark:text-yellow-400">
                {totalFindings} finding{totalFindings !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col py-1">
              {flatEntries.map(({ node, depth }) => {
                const isFile = !!node.file;
                return (
                  <button
                    key={node.path}
                    onClick={() => {
                      if (isFile) onSelectFile(node.file!.path);
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent ${
                      !isFile ? "cursor-default" : ""
                    }`}
                    style={{ paddingLeft: `${depth * 12 + 12}px` }}
                  >
                    {isFile ? (
                      <>
                        <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold ${STATUS_COLORS[node.file!.status]?.className ?? STATUS_COLORS.modified.className}`}>
                          {STATUS_COLORS[node.file!.status]?.label ?? "M"}
                        </span>
                        <span className="truncate font-mono">{node.name}</span>
                        {node.findingCount > 0 && (
                          <span className="ml-auto shrink-0 inline-flex h-4 w-4 items-center justify-center rounded-full bg-yellow-100 text-[9px] font-bold text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300">
                            {node.findingCount}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <FolderIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate text-muted-foreground">{node.name}</span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  );
}

function ChevronLeft({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}
