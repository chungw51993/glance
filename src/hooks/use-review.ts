import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getReviewCache, updateReviewCache } from "@/lib/review-cache";
import type {
  AiReviewSummary,
  Commit,
  FileDiff,
  LinearTicket,
  MergeMethod,
  MergeStatus,
  PullRequestDetail,
} from "@/types";

export type DiffScope = "commit" | "full-pr";

interface UseReviewOptions {
  prKey: string | null;
  hideMerges: boolean;
  diffScope: DiffScope;
  onHideMergesChange: (hide: boolean) => void;
  onDiffScopeChange: (scope: DiffScope) => void;
}

interface UseReviewReturn {
  pr: PullRequestDetail | null;
  aiReview: AiReviewSummary | null;
  linearTickets: LinearTicket[];
  linearLoading: boolean;
  linearError: string | null;
  selectedCommitIndex: number;
  hideMerges: boolean;
  loading: boolean;
  reviewLoading: boolean;
  error: string | null;
  reviewError: string | null;
  mergeStatus: MergeStatus | null;
  diffScope: DiffScope;
  prFiles: FileDiff[];
  prFilesLoading: boolean;
  fetchPRDetail: (owner: string, repo: string, prNumber: number) => Promise<void>;
  runAiReview: (owner: string, repo: string, prNumber: number) => Promise<void>;
  selectCommit: (index: number) => void;
  nextCommit: () => void;
  prevCommit: () => void;
  setHideMerges: (hide: boolean) => void;
  setDiffScope: (scope: DiffScope) => void;
  visibleCommits: Commit[];
  mergePR: (
    owner: string,
    repo: string,
    prNumber: number,
    title: string,
    message: string,
    method: MergeMethod
  ) => Promise<void>;
}

export function useReview(options: UseReviewOptions): UseReviewReturn {
  const { prKey, hideMerges, diffScope, onHideMergesChange, onDiffScopeChange } = options;

  const cached = prKey ? getReviewCache(prKey) : null;

  const [pr, setPr] = useState<PullRequestDetail | null>(cached?.pr ?? null);
  const [aiReview, setAiReview] = useState<AiReviewSummary | null>(cached?.aiReview ?? null);
  const [linearTickets, setLinearTickets] = useState<LinearTicket[]>(cached?.linearTickets ?? []);
  const [linearLoading, setLinearLoading] = useState(false);
  const [linearError, setLinearError] = useState<string | null>(cached?.linearError ?? null);
  const [selectedCommitIndex, setSelectedCommitIndex] = useState(cached?.selectedCommitIndex ?? 0);
  const [loading, setLoading] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [mergeStatus, setMergeStatus] = useState<MergeStatus | null>(cached?.mergeStatus ?? null);
  const [prFiles, setPrFiles] = useState<FileDiff[]>(cached?.prFiles ?? []);
  const [prFilesLoading, setPrFilesLoading] = useState(false);

  const activeKeyRef = useRef<string | null>(prKey);
  activeKeyRef.current = prKey;

  // Sync state to cache whenever it changes
  useEffect(() => {
    if (!prKey) return;
    updateReviewCache({
      prKey,
      pr,
      aiReview,
      linearTickets,
      linearError,
      mergeStatus,
      prFiles,
      selectedCommitIndex,
    });
  }, [prKey, pr, aiReview, linearTickets, linearError, mergeStatus, prFiles, selectedCommitIndex]);

  const visibleCommits = useMemo(() => {
    if (!pr) return [];
    return hideMerges
      ? pr.commits.filter((c) => !c.is_trunk_merge)
      : pr.commits;
  }, [pr, hideMerges]);

  const fetchPRDetail = useCallback(
    async (owner: string, repo: string, prNumber: number) => {
      const newKey = `${owner}/${repo}/${prNumber}`;
      const isSamePR = newKey === activeKeyRef.current;
      const existingCache = getReviewCache(newKey);

      setLoading(true);
      setError(null);

      // Only clear AI review and related state when switching to a different PR
      if (!isSamePR || !existingCache?.pr) {
        if (!existingCache?.aiReview) {
          setAiReview(null);
        }
        setLinearTickets(existingCache?.linearTickets ?? []);
        setSelectedCommitIndex(existingCache?.selectedCommitIndex ?? 0);
      }

      try {
        const result = await invoke<PullRequestDetail>(
          "get_pull_request_detail",
          { owner, repo, prNumber }
        );
        setPr(result);

        // Fetch merge status after PR loads
        invoke<MergeStatus>("get_pr_merge_status", {
          owner,
          repo,
          prNumber,
        })
          .then(setMergeStatus)
          .catch(() => setMergeStatus(null));

        // Fetch full PR files (aggregate diff) in background
        setPrFilesLoading(true);
        invoke<FileDiff[]>("get_pr_files", { owner, repo, prNumber })
          .then(setPrFiles)
          .catch(() => setPrFiles([]))
          .finally(() => setPrFilesLoading(false));

        // Skip re-fetching Linear tickets if returning to same PR with cached data
        if (isSamePR && existingCache?.linearTickets.length) {
          setLinearTickets(existingCache.linearTickets);
        } else {
          setLinearLoading(true);
          setLinearError(null);
          const commitMessages = result.commits.map((c) => c.message);
          invoke<LinearTicket[]>("fetch_linear_tickets", {
            title: result.title,
            body: result.body,
            commitMessages,
          })
            .then(setLinearTickets)
            .catch((err) => {
              const msg = String(err);
              setLinearTickets([]);
              setLinearError(msg);
            })
            .finally(() => setLinearLoading(false));
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const runAiReview = useCallback(
    async (owner: string, repo: string, prNumber: number) => {
      setReviewLoading(true);
      setReviewError(null);
      try {
        const result = await invoke<AiReviewSummary>("run_ai_review", {
          owner,
          repo,
          prNumber,
        });
        setAiReview(result);
      } catch (err) {
        setReviewError(String(err));
      } finally {
        setReviewLoading(false);
      }
    },
    []
  );

  const selectCommit = useCallback(
    (index: number) => {
      if (index >= 0 && index < visibleCommits.length) {
        setSelectedCommitIndex(index);
      }
    },
    [visibleCommits.length]
  );

  const nextCommit = useCallback(() => {
    setSelectedCommitIndex((prev) =>
      Math.min(prev + 1, visibleCommits.length - 1)
    );
  }, [visibleCommits.length]);

  const prevCommit = useCallback(() => {
    setSelectedCommitIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  const setHideMerges = useCallback((hide: boolean) => {
    onHideMergesChange(hide);
    setSelectedCommitIndex(0);
  }, [onHideMergesChange]);

  const setDiffScope = useCallback((scope: DiffScope) => {
    onDiffScopeChange(scope);
  }, [onDiffScopeChange]);

  const mergePR = useCallback(
    async (
      owner: string,
      repo: string,
      prNumber: number,
      title: string,
      message: string,
      method: MergeMethod
    ) => {
      await invoke("merge_pull_request", {
        owner,
        repo,
        prNumber,
        commitTitle: title,
        commitMessage: message,
        mergeMethod: method,
      });
    },
    []
  );

  return {
    pr,
    aiReview,
    linearTickets,
    linearLoading,
    linearError,
    selectedCommitIndex,
    hideMerges,
    loading,
    reviewLoading,
    error,
    reviewError,
    mergeStatus,
    diffScope,
    prFiles,
    prFilesLoading,
    fetchPRDetail,
    runAiReview,
    selectCommit,
    nextCommit,
    prevCommit,
    setHideMerges,
    setDiffScope,
    visibleCommits,
    mergePR,
  };
}
