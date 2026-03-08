import { describe, expect, it, beforeEach } from "vitest";
import { getReposCache, updateReposCache, getLastReposPath, setLastReposPath } from "./repos-cache";

describe("repos-cache", () => {
  beforeEach(() => {
    updateReposCache({ repos: [], selectedRepo: null, pullRequests: [] });
    setLastReposPath("/");
  });

  it("returns initial empty state", () => {
    const cache = getReposCache();
    expect(cache.repos).toEqual([]);
    expect(cache.selectedRepo).toBeNull();
    expect(cache.pullRequests).toEqual([]);
  });

  it("merges partial updates", () => {
    const repo = { owner: "me", name: "app", full_name: "me/app", default_branch: "main", open_pr_count: 1, updated_at: "" };
    updateReposCache({ selectedRepo: repo });
    const cache = getReposCache();
    expect(cache.selectedRepo).toEqual(repo);
    expect(cache.repos).toEqual([]);
  });

  it("getLastReposPath / setLastReposPath round-trips", () => {
    expect(getLastReposPath()).toBe("/");
    setLastReposPath("/review/me/app/42");
    expect(getLastReposPath()).toBe("/review/me/app/42");
  });
});
