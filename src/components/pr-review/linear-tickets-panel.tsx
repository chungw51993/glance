import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MarkdownViewer } from "@/components/pr-review/markdown-viewer";
import type { LinearTicket } from "@/types";

interface LinearTicketsPanelProps {
  tickets: LinearTicket[];
  loading: boolean;
  error?: string | null;
  expanded: boolean;
  onToggleExpanded: () => void;
}

export function LinearTicketsPanel({
  tickets,
  loading,
  error,
  expanded: panelExpanded,
  onToggleExpanded,
}: LinearTicketsPanelProps) {

  return (
    <div className="shrink-0 border-t">
      <button
        onClick={onToggleExpanded}
        className="flex w-full items-center gap-2 px-4 py-1.5 hover:bg-accent/50 transition-colors"
      >
        <Chevron direction={panelExpanded ? "down" : "up"} />
        <span className="text-xs font-medium text-muted-foreground">
          Linear Context
        </span>
        {tickets.length > 0 && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {tickets.length}
          </Badge>
        )}
        {loading && (
          <span className="text-[10px] text-muted-foreground animate-pulse">
            loading...
          </span>
        )}
      </button>
      {panelExpanded && (
        <div className="px-4 pb-2">
          {error && error.startsWith("NO_TOKEN:") && (
            <p className="text-xs text-muted-foreground py-2">
              {error.replace("NO_TOKEN: ", "")}
            </p>
          )}
          {error && !error.startsWith("NO_TOKEN:") && (
            <p className="text-xs text-destructive py-1">{error}</p>
          )}
          {!loading && !error && tickets.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">
              No Linear tickets found for this PR. Tickets are extracted from
              the PR title, body, and commit messages (e.g. ENG-123).
            </p>
          )}
          {tickets.length === 1 && (
            <SingleTicketView ticket={tickets[0]} />
          )}
          {tickets.length > 1 && (
            <TabbedTicketsView tickets={tickets} />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabbed view for multiple tickets
// ---------------------------------------------------------------------------

function TabbedTicketsView({ tickets }: { tickets: LinearTicket[] }) {
  return (
    <Tabs defaultValue={tickets[0].identifier}>
      <TabsList variant="line" className="w-full justify-start gap-0 overflow-x-auto">
        {tickets.map((ticket) => (
          <TabsTrigger
            key={ticket.identifier}
            value={ticket.identifier}
            className="gap-1.5 text-xs px-3 py-1.5 shrink-0"
          >
            <code className="font-semibold">{ticket.identifier}</code>
            <StateBadge state={ticket.state} />
          </TabsTrigger>
        ))}
      </TabsList>
      {tickets.map((ticket) => (
        <TabsContent key={ticket.identifier} value={ticket.identifier}>
          <TicketDetail ticket={ticket} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Single ticket (no tabs needed)
// ---------------------------------------------------------------------------

function SingleTicketView({ ticket }: { ticket: LinearTicket }) {
  return (
    <div className="rounded-md border bg-card overflow-hidden">
      <div className="flex items-center gap-2 flex-wrap p-2.5">
        <code className="text-xs font-semibold text-primary">
          {ticket.identifier}
        </code>
        <StateBadge state={ticket.state} />
        {ticket.labels.map((label) => (
          <Badge key={label} variant="outline" className="text-[9px] px-1 py-0">
            {label}
          </Badge>
        ))}
      </div>
      <div className="border-t px-3 py-2">
        <p className="text-xs font-medium mb-1.5">{ticket.title}</p>
        <TicketBody ticket={ticket} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared ticket detail (used inside tabs)
// ---------------------------------------------------------------------------

function TicketDetail({ ticket }: { ticket: LinearTicket }) {
  return (
    <div className="pt-2">
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        {ticket.labels.map((label) => (
          <Badge key={label} variant="outline" className="text-[9px] px-1 py-0">
            {label}
          </Badge>
        ))}
      </div>
      <p className="text-xs font-medium mb-1.5">{ticket.title}</p>
      <ScrollArea className="max-h-[40vh]">
        <TicketBody ticket={ticket} />
      </ScrollArea>
    </div>
  );
}

function TicketBody({ ticket }: { ticket: LinearTicket }) {
  return (
    <>
      {ticket.description ? (
        <MarkdownViewer content={ticket.description} />
      ) : (
        <p className="text-[11px] text-muted-foreground italic">
          No description
        </p>
      )}
      <a
        href={ticket.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block mt-2 text-[11px] text-primary hover:underline"
      >
        Open in Linear
      </a>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

const stateColors: Record<string, string> = {
  "Done": "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  "In Progress": "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  "In Review": "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  "Todo": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  "Backlog": "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  "Cancelled": "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
};

function StateBadge({ state }: { state: string }) {
  return (
    <Badge
      className={`text-[10px] px-1.5 py-0 ${stateColors[state] ?? "bg-muted text-muted-foreground"}`}
    >
      {state}
    </Badge>
  );
}

function Chevron({
  direction,
}: {
  direction: "up" | "down" | "right";
}) {
  const paths: Record<string, string> = {
    down: "m6 9 6 6 6-6",
    up: "m18 15-6-6-6 6",
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
