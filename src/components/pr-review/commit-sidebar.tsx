import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { Commit } from "@/types";
import type { DiffScope } from "@/hooks/use-review";

interface CommitSidebarProps {
  commits: Commit[];
  visibleCommits: Commit[];
  selectedIndex: number;
  hideMerges: boolean;
  collapsed: boolean;
  diffScope: DiffScope;
  onSelectCommit: (index: number) => void;
  onNext: () => void;
  onPrev: () => void;
  onToggleHideMerges: (hide: boolean) => void;
  onToggleCollapsed: () => void;
  onSelectFullPr: () => void;
}

export function CommitSidebar({
  commits,
  visibleCommits,
  selectedIndex,
  hideMerges,
  collapsed,
  diffScope,
  onSelectCommit,
  onNext,
  onPrev,
  onToggleHideMerges,
  onToggleCollapsed,
  onSelectFullPr,
}: CommitSidebarProps) {
  const mergeCount = commits.filter((c) => c.is_trunk_merge).length;

  return (
    <div
      className="flex h-full shrink-0 flex-col border-r bg-background transition-all duration-200 overflow-hidden"
      style={{ width: collapsed ? 48 : 280 }}
    >
      {collapsed ? (
        <div className="flex h-full flex-col items-center pt-3">
          <button
            onClick={onToggleCollapsed}
            className="rounded p-1 hover:bg-accent"
            title="Expand sidebar"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="mt-3 text-xs text-muted-foreground [writing-mode:vertical-lr]">
            Commits
          </span>
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="shrink-0 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={onToggleCollapsed}
                  className="rounded p-1 hover:bg-accent"
                  title="Collapse sidebar"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <h2 className="text-sm font-semibold">Commits</h2>
              </div>
              <Badge variant="secondary" className="text-xs">
                {visibleCommits.length}
              </Badge>
            </div>
            {mergeCount > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <Switch
                  id="hide-merges"
                  checked={hideMerges}
                  onCheckedChange={onToggleHideMerges}
                />
                <Label
                  htmlFor="hide-merges"
                  className="text-xs text-muted-foreground"
                >
                  Hide merges ({mergeCount})
                </Label>
              </div>
            )}
          </div>
          <Separator />

          {/* Full PR button */}
          <button
            onClick={onSelectFullPr}
            className={`flex shrink-0 items-center gap-2 border-b px-4 py-2.5 text-left text-xs font-medium transition-colors hover:bg-accent ${
              diffScope === "full-pr" ? "bg-accent" : ""
            }`}
          >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-[10px] font-bold text-primary">
              PR
            </span>
            <span>All changes</span>
          </button>

          <div className="shrink-0 px-4 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Commits
          </div>

          {/* Commit list */}
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col">
              {visibleCommits.map((commit, index) => {
                const firstLine = commit.message.split("\n")[0];
                return (
                  <button
                    key={commit.sha}
                    onClick={() => onSelectCommit(index)}
                    className={`flex flex-col gap-1 border-b px-4 py-2.5 text-left transition-colors hover:bg-accent ${
                      diffScope === "commit" && index === selectedIndex ? "bg-accent" : ""
                    } ${commit.is_trunk_merge ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-center gap-2">
                      <code className="text-xs text-muted-foreground">
                        {commit.sha.slice(0, 7)}
                      </code>
                      {commit.is_trunk_merge && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1 py-0"
                        >
                          merge
                        </Badge>
                      )}
                      {commit.ticket_prefix && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1 py-0"
                        >
                          {commit.ticket_prefix}
                        </Badge>
                      )}
                    </div>
                    <span className="truncate text-xs">{firstLine}</span>
                  </button>
                );
              })}
              {visibleCommits.length === 0 && (
                <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                  No commits to show.
                </p>
              )}
            </div>
          </ScrollArea>

          {/* Footer navigation */}
          <Separator />
          <div className="flex shrink-0 items-center justify-between px-4 py-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onPrev}
              disabled={selectedIndex === 0}
            >
              Prev
            </Button>
            <span className="text-xs text-muted-foreground">
              {visibleCommits.length > 0
                ? `${selectedIndex + 1} of ${visibleCommits.length}`
                : "--"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onNext}
              disabled={selectedIndex >= visibleCommits.length - 1}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function ChevronLeft({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
