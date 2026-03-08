import type { PullRequestSummary, Repo } from "@/types";

interface ReposCacheEntry {
  repos: Repo[];
  selectedRepo: Repo | null;
  pullRequests: PullRequestSummary[];
  prsInvalidated: boolean;
}

let _cache: ReposCacheEntry = {
  repos: [],
  selectedRepo: null,
  pullRequests: [],
  prsInvalidated: false,
};

export function getReposCache(): ReposCacheEntry {
  return _cache;
}

export function updateReposCache(partial: Partial<ReposCacheEntry>): void {
  _cache = { ..._cache, ...partial };
}

/** Mark the cached pull request list as stale so the next visit triggers a refresh. */
export function invalidatePullRequests(): void {
  _cache = { ..._cache, pullRequests: [], prsInvalidated: true };
}

export function clearPrsInvalidated(): void {
  _cache = { ..._cache, prsInvalidated: false };
}

// Tracks the last path in the repos/review area so the sidebar can restore it
let _lastReposPath = "/";

export function getLastReposPath(): string {
  return _lastReposPath;
}

export function setLastReposPath(path: string): void {
  _lastReposPath = path;
}
