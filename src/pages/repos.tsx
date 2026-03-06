import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useGitHub } from "@/hooks/use-github";
import { getReposCache, setLastReposPath, updateReposCache } from "@/lib/repos-cache";
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
import type { Repo } from "@/types";

export function ReposPage() {
  const navigate = useNavigate();
  const {
    repos,
    pullRequests,
    loadingRepos,
    loadingPRs,
    reposError,
    prsError,
    fetchRepos,
    fetchPullRequests,
  } = useGitHub();

  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(
    getReposCache().selectedRepo
  );

  // Register this page as the last repos-area path
  useEffect(() => {
    setLastReposPath("/");
  }, []);

  useEffect(() => {
    updateReposCache({ selectedRepo });
  }, [selectedRepo]);

  useEffect(() => {
    invoke<boolean>("has_github_token").then((has) => {
      setHasToken(has);
      if (has && repos.length === 0) {
        fetchRepos();
      }
    });
  }, [fetchRepos, repos.length]);

  function handleSelectRepo(repo: Repo) {
    setSelectedRepo(repo);
    fetchPullRequests(repo.owner, repo.name);
  }

  function handleBackToRepos() {
    setSelectedRepo(null);
  }

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
          Connect your GitHub account in Settings to view repositories.
        </p>
        <Button variant="outline" onClick={() => navigate("/settings")}>
          Go to Settings
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Repo list panel */}
      <div className="w-80 shrink-0 border-r">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Repositories</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchRepos}
            disabled={loadingRepos}
          >
            {loadingRepos ? "Loading..." : "Refresh"}
          </Button>
        </div>

        {reposError && (
          <div className="px-4 py-3">
            <p className="text-sm text-destructive">{reposError}</p>
          </div>
        )}

        <ScrollArea className="h-[calc(100%-49px)]">
          <div className="flex flex-col">
            {repos.map((repo) => (
              <button
                key={repo.full_name}
                onClick={() => handleSelectRepo(repo)}
                className={`flex flex-col gap-1 border-b px-4 py-3 text-left transition-colors hover:bg-accent ${
                  selectedRepo?.full_name === repo.full_name ? "bg-accent" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {repo.full_name}
                  </span>
                  <Badge variant="secondary" className="shrink-0 text-xs">
                    {repo.default_branch}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  Updated {formatDate(repo.updated_at)}
                </span>
              </button>
            ))}
            {!loadingRepos && repos.length === 0 && !reposError && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No repositories found.
              </p>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* PR list panel */}
      <div className="flex-1">
        {!selectedRepo ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Select a repository to view open pull requests.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b px-6 py-3">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={handleBackToRepos}
                  title="Back to repositories"
                >
                  <BackArrow className="h-4 w-4" />
                </Button>
                <div>
                  <h2 className="text-sm font-semibold">
                    {selectedRepo.full_name}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Open pull requests
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  fetchPullRequests(selectedRepo.owner, selectedRepo.name)
                }
                disabled={loadingPRs}
              >
                {loadingPRs ? "Loading..." : "Refresh"}
              </Button>
            </div>

            {prsError && (
              <div className="px-6 py-3">
                <p className="text-sm text-destructive">{prsError}</p>
              </div>
            )}

            <ScrollArea className="h-[calc(100%-61px)]">
              <div className="flex flex-col gap-3 p-6">
                {loadingPRs && pullRequests.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Fetching pull requests...
                  </p>
                )}

                {!loadingPRs && pullRequests.length === 0 && !prsError && (
                  <p className="text-sm text-muted-foreground">
                    No open pull requests.
                  </p>
                )}

                {pullRequests.map((pr) => (
                  <Card
                    key={pr.number}
                    className="cursor-pointer transition-colors hover:bg-accent/50"
                    onClick={() =>
                      navigate(
                        `/review/${selectedRepo.owner}/${selectedRepo.name}/${pr.number}`
                      )
                    }
                  >
                    <CardHeader className="pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle className="text-sm">
                          {pr.title}
                        </CardTitle>
                        <Badge variant="outline" className="shrink-0">
                          #{pr.number}
                        </Badge>
                      </div>
                      <CardDescription>
                        {pr.author} wants to merge{" "}
                        <code className="rounded bg-muted px-1 py-0.5 text-xs">
                          {pr.head_branch}
                        </code>{" "}
                        into{" "}
                        <code className="rounded bg-muted px-1 py-0.5 text-xs">
                          {pr.base_branch}
                        </code>
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
          </>
        )}
      </div>
    </div>
  );
}

function BackArrow({ className }: { className?: string }) {
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
