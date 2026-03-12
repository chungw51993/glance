import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownViewer } from "@/components/pr-review/markdown-viewer";

interface DescriptionPanelProps {
  body: string | null;
  expanded: boolean;
  onToggleExpanded: () => void;
}

export function DescriptionPanel({
  body,
  expanded,
  onToggleExpanded,
}: DescriptionPanelProps) {
  return (
    <div className="shrink-0 border-b bg-background">
      <button
        onClick={onToggleExpanded}
        className="flex w-full items-center gap-2 px-4 py-1.5 hover:bg-accent/50 transition-colors"
      >
        <Chevron direction={expanded ? "down" : "right"} />
        <span className="text-xs font-medium text-muted-foreground">
          Description
        </span>
      </button>
      {expanded && (
        <ScrollArea className="max-h-[40vh] px-4 pb-2">
          {body ? (
            <MarkdownViewer content={body} />
          ) : (
            <p className="text-[11px] text-muted-foreground italic py-1">
              No description provided
            </p>
          )}
        </ScrollArea>
      )}
    </div>
  );
}

function Chevron({
  direction,
}: {
  direction: "right" | "down";
}) {
  const paths: Record<string, string> = {
    down: "m6 9 6 6 6-6",
    right: "m9 18 6-6-6-6",
  };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3 w-3 shrink-0 text-muted-foreground mt-0.5"
    >
      <path d={paths[direction]} />
    </svg>
  );
}
