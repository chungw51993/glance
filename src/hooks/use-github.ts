import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import type { PullRequestSummary, Repo } from "@/types";

interface UseGitHubReturn {
  repos: Repo[];
  pullRequests: PullRequestSummary[];
  loadingRepos: boolean;
  loadingPRs: boolean;
  reposError: string | null;
  prsError: string | null;
  fetchRepos: () => Promise<void>;
  fetchPullRequests: (owner: string, repo: string) => Promise<void>;
}

export function useGitHub(): UseGitHubReturn {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [pullRequests, setPullRequests] = useState<PullRequestSummary[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingPRs, setLoadingPRs] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [prsError, setPrsError] = useState<string | null>(null);

  const fetchRepos = useCallback(async () => {
    setLoadingRepos(true);
    setReposError(null);
    try {
      const result = await invoke<Repo[]>("list_repos");
      setRepos(result);
    } catch (err) {
      setReposError(String(err));
    } finally {
      setLoadingRepos(false);
    }
  }, []);

  const fetchPullRequests = useCallback(
    async (owner: string, repo: string) => {
      setLoadingPRs(true);
      setPrsError(null);
      try {
        const result = await invoke<PullRequestSummary[]>(
          "list_open_pull_requests",
          { owner, repo }
        );
        setPullRequests(result);
      } catch (err) {
        setPrsError(String(err));
      } finally {
        setLoadingPRs(false);
      }
    },
    []
  );

  return {
    repos,
    pullRequests,
    loadingRepos,
    loadingPRs,
    reposError,
    prsError,
    fetchRepos,
    fetchPullRequests,
  };
}
