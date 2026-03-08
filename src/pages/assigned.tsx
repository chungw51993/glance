import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useAssignedPrs } from "@/hooks/use-assigned-prs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

export function AssignedPage() {
  const navigate = useNavigate();
  const { prs, loading, error, fetch } = useAssignedPrs();
  const [hasToken, setHasToken] = useState<boolean | null>(null);

  useEffect(() => {
    invoke<boolean>("has_github_token").then((has) => {
      setHasToken(has);
      if (has) {
        fetch();
      }
    });
  }, [fetch]);

  function formatDate(iso: string): string {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "today";
    if (diffDays === 1) return "yesterday";
    if (diffDays < 30) return `${diffDays}d ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
    return `${Math.floor(diffDays / 365)}y ago`;
  }

  if (hasToken === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!hasToken) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground">
          Connect your GitHub account in Settings to view assigned PRs.
        </p>
        <Button variant="outline" onClick={() => navigate("/settings")}>
          Go to Settings
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div>
          <h2 className="text-sm font-semibold">Assigned to me</h2>
          <p className="text-xs text-muted-foreground">
            Open pull requests where you are an assignee
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { if (!loading) fetch(); }}
          title="Refresh assigned PRs"
          className={`h-8 w-8 p-0${loading ? " pointer-events-none" : ""}`}
        >
          <svg
            className={`h-4 w-4${loading ? " animate-spin" : ""}`}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        </Button>
      </div>

      {error && (
        <div className="px-6 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-3 p-6">
          {loading && prs.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Fetching assigned pull requests...
            </p>
          )}

          {!loading && prs.length === 0 && !error && (
            <p className="text-sm text-muted-foreground">
              No open pull requests assigned to you.
            </p>
          )}

          {prs.map((pr) => (
            <Card
              key={`${pr.repo_full_name}/${pr.number}`}
              className="cursor-pointer transition-colors hover:bg-accent/50"
              onClick={() =>
                navigate(
                  `/review/${pr.repo_owner}/${pr.repo_name}/${pr.number}`
                )
              }
            >
              <CardHeader className="pb-0">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-sm">{pr.title}</CardTitle>
                  <Badge variant="outline" className="shrink-0">
                    #{pr.number}
                  </Badge>
                </div>
                <CardDescription>
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">
                    {pr.repo_full_name}
                  </code>
                  {" -- "}
                  {pr.author}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Opened {formatDate(pr.created_at)} -- updated{" "}
                  {formatDate(pr.updated_at)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
