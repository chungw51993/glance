import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { X } from "lucide-react";
import type { AiReviewSummary } from "@/types";

interface AiSummaryPanelProps {
  review: AiReviewSummary | null;
  onClose: () => void;
}

export function AiSummaryPanel({ review, onClose }: AiSummaryPanelProps) {
  return (
    <div className="flex h-full flex-col border-l bg-background">
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">AI Review Summary</h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      {review ? (
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-6 px-4 py-4">
            {/* Risk level */}
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">Risk Level:</span>
              <RiskBadge level={review.risk_level} />
            </div>

            {/* Overall assessment */}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Assessment</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {review.overall_assessment}
              </p>
            </div>

            <Separator />

            {/* Findings */}
            {review.findings.length > 0 && (
              <div>
                <h3 className="mb-3 text-sm font-semibold">
                  Findings ({review.findings.length})
                </h3>
                <div className="flex flex-col gap-3">
                  {review.findings.map((finding, i) => (
                    <div
                      key={i}
                      className="rounded border p-3"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <SeverityBadge severity={finding.severity} />
                        <button
                          onClick={() => scrollToFile(finding.file_path)}
                          className="font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
                        >
                          {finding.file_path}:{finding.start_line}
                        </button>
                      </div>
                      <p className="text-xs text-foreground">
                        {finding.message}
                      </p>
                      {finding.suggestion && (
                        <pre className="mt-2 rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap">
                          {finding.suggestion}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {review.findings.length > 0 && review.recommendations.length > 0 && (
              <Separator />
            )}

            {/* Recommendations */}
            {review.recommendations.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">
                  Recommendations
                </h3>
                <ol className="flex flex-col gap-1.5 list-decimal pl-4">
                  {review.recommendations.map((rec, i) => (
                    <li key={i} className="text-xs text-muted-foreground">
                      {rec}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </ScrollArea>
      ) : (
        <div className="flex h-64 items-center justify-center">
          <p className="text-sm text-muted-foreground">
            No review data yet. Click "Run AI Review" to analyze this PR.
          </p>
        </div>
      )}
    </div>
  );
}

function scrollToFile(filePath: string) {
  const el = document.querySelector(`[data-file-path="${filePath}"]`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function RiskBadge({ level }: { level: string }) {
  const styles: Record<string, string> = {
    low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
    medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
    high: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
    critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  };

  return (
    <Badge className={styles[level] ?? styles.low}>
      {level}
    </Badge>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, string> = {
    info: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
    warning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
    critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  };

  return (
    <Badge className={`text-[10px] ${styles[severity] ?? styles.info}`}>
      {severity}
    </Badge>
  );
}
