import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getReviewCache, updateReviewCache } from "@/lib/review-cache";
import type {
  AiReviewSummary,
  CombinedCheckStatus,
  Commit,
  FileDiff,
  MergeMethod,
  MergeStatus,
  PullRequestDetail,
  Ticket,
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
  tickets: Ticket[];
  ticketsLoading: boolean;
  ticketsError: string | null;
  selectedCommitIndex: number;
  hideMerges: boolean;
  loading: boolean;
  reviewLoading: boolean;
  error: string | null;
  reviewError: string | null;
  mergeStatus: MergeStatus | null;
  checkStatus: CombinedCheckStatus | null;
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
  const [tickets, setTickets] = useState<Ticket[]>(cached?.tickets ?? []);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState<string | null>(cached?.ticketsError ?? null);
  const [selectedCommitIndex, setSelectedCommitIndex] = useState(cached?.selectedCommitIndex ?? 0);
  const [loading, setLoading] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [mergeStatus, setMergeStatus] = useState<MergeStatus | null>(cached?.mergeStatus ?? null);
  const [checkStatus, setCheckStatus] = useState<CombinedCheckStatus | null>(cached?.checkStatus ?? null);
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
      tickets,
      ticketsError,
      mergeStatus,
      checkStatus,
      prFiles,
      selectedCommitIndex,
    });
  }, [prKey, pr, aiReview, tickets, ticketsError, mergeStatus, checkStatus, prFiles, selectedCommitIndex]);

  const visibleCommits = useMemo(() => {
    if (!pr) return [];
    return hideMerges
      ? pr.commits.filter((c) => !c.is_trunk_merge)
      : pr.commits;
  }, [pr, hideMerges]);

  const fetchPRDetail = useCallback(
    async (ownerArg: string, repoArg: string, prNumber: number) => {
      const newKey = `${ownerArg}/${repoArg}/${prNumber}`;
      const isSamePR = newKey === activeKeyRef.current;
      const existingCache = getReviewCache(newKey);

      setLoading(true);
      setError(null);

      // Only clear AI review and related state when switching to a different PR
      if (!isSamePR || !existingCache?.pr) {
        if (!existingCache?.aiReview) {
          setAiReview(null);
        }
        setTickets(existingCache?.tickets ?? []);
        setSelectedCommitIndex(existingCache?.selectedCommitIndex ?? 0);
      }

      try {
        const result = await invoke<PullRequestDetail>(
          "get_pull_request_detail",
          { owner: ownerArg, repo: repoArg, prNumber }
        );
        setPr(result);

        // Fetch merge status after PR loads
        invoke<MergeStatus>("get_pr_merge_status", {
          owner: ownerArg,
          repo: repoArg,
          prNumber,
        })
          .then(setMergeStatus)
          .catch(() => setMergeStatus(null));

        // Fetch CI check status in background
        const headSha = result.commits.length > 0
          ? result.commits[result.commits.length - 1].sha
          : null;
        if (headSha) {
          invoke<CombinedCheckStatus>("get_check_status", {
            owner: ownerArg,
            repo: repoArg,
            headSha,
          })
            .then(setCheckStatus)
            .catch(() => setCheckStatus(null));
        }

        // Fetch full PR files (aggregate diff) in background
        setPrFilesLoading(true);
        invoke<FileDiff[]>("get_pr_files", { owner: ownerArg, repo: repoArg, prNumber })
          .then(setPrFiles)
          .catch(() => setPrFiles([]))
          .finally(() => setPrFilesLoading(false));

        // Skip re-fetching tickets if returning to same PR with cached data
        if (isSamePR && existingCache?.tickets.length) {
          setTickets(existingCache.tickets);
        } else {
          setTicketsLoading(true);
          setTicketsError(null);
          const commitMessages = result.commits.map((c) => c.message);
          invoke<Ticket[]>("fetch_tickets", {
            owner: ownerArg,
            repo: repoArg,
            title: result.title,
            body: result.body,
            commitMessages,
          })
            .then(setTickets)
            .catch((err) => {
              const msg = String(err);
              setTickets([]);
              setTicketsError(msg);
            })
            .finally(() => setTicketsLoading(false));
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
    async (ownerArg: string, repoArg: string, prNumber: number) => {
      setReviewLoading(true);
      setReviewError(null);
      try {
        const result = await invoke<AiReviewSummary>("run_ai_review", {
          owner: ownerArg,
          repo: repoArg,
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
      ownerArg: string,
      repoArg: string,
      prNumber: number,
      title: string,
      message: string,
      method: MergeMethod
    ) => {
      await invoke("merge_pull_request", {
        owner: ownerArg,
        repo: repoArg,
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
    tickets,
    ticketsLoading,
    ticketsError,
    selectedCommitIndex,
    hideMerges,
    loading,
    reviewLoading,
    error,
    reviewError,
    mergeStatus,
    checkStatus,
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
