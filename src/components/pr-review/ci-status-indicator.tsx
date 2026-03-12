import { CheckCircle2, XCircle, Clock, Loader2, ExternalLink } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import type { CombinedCheckStatus, CheckRun } from "@/types";

interface CiStatusIndicatorProps {
  checkStatus: CombinedCheckStatus;
}

function getStateIcon(state: string) {
  switch (state) {
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "failure":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "pending":
      return <Loader2 className="h-4 w-4 text-yellow-500 animate-spin" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function getCheckIcon(check: CheckRun) {
  if (check.status !== "completed") {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 text-yellow-500 animate-spin" />;
  }
  switch (check.conclusion) {
    case "success":
    case "neutral":
    case "skipped":
      return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />;
    case "failure":
    case "timed_out":
    case "cancelled":
    case "action_required":
      return <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />;
    default:
      return <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  }
}

function getStatusSummary(checkStatus: CombinedCheckStatus): string {
  if (checkStatus.total === 0) return "No checks";
  if (checkStatus.state === "success") return `${checkStatus.passed}/${checkStatus.total} checks passed`;
  if (checkStatus.state === "failure") return `${checkStatus.failed} failed, ${checkStatus.passed} passed`;
  return `${checkStatus.pending} pending, ${checkStatus.passed} passed`;
}

export function CiStatusIndicator({ checkStatus }: CiStatusIndicatorProps) {
  if (checkStatus.total === 0) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-muted transition-colors"
          title={getStatusSummary(checkStatus)}
        >
          {getStateIcon(checkStatus.state)}
          <span className="text-muted-foreground">
            {checkStatus.passed}/{checkStatus.total}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="px-3 py-2 border-b">
          <p className="text-xs font-medium">{getStatusSummary(checkStatus)}</p>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {checkStatus.checks.map((check) => (
            <div
              key={check.name}
              className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/50"
            >
              {getCheckIcon(check)}
              <span className="truncate flex-1">{check.name}</span>
              {check.details_url && (
                <a
                  href={check.details_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  title="View details"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
