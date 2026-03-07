import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { getReviewCache, updateReviewCache } from "@/lib/review-cache";
import type { DraftComment, ReviewEvent } from "@/types";

interface UseReviewDraftReturn {
  draftComments: DraftComment[];
  reviewBody: string;
  setReviewBody: (body: string) => void;
  addComment: (
    filePath: string,
    line: number,
    side: "LEFT" | "RIGHT",
    body: string,
    startLine?: number
  ) => void;
  updateComment: (id: string, body: string) => void;
  removeComment: (id: string) => void;
  submitReview: (
    owner: string,
    repo: string,
    prNumber: number,
    event: ReviewEvent,
    body: string
  ) => Promise<void>;
  clearDraft: () => void;
  submitting: boolean;
}

let nextId = 1;

export function useReviewDraft(prKey: string | null): UseReviewDraftReturn {
  const cached = prKey ? getReviewCache(prKey) : null;

  const [draftComments, setDraftComments] = useState<DraftComment[]>(cached?.draftComments ?? []);
  const [reviewBody, setReviewBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Sync draft comments to cache
  useEffect(() => {
    if (!prKey) return;
    updateReviewCache({ prKey, draftComments });
  }, [prKey, draftComments]);

  const addComment = useCallback(
    (filePath: string, line: number, side: "LEFT" | "RIGHT", body: string, startLine?: number) => {
      const comment: DraftComment = {
        id: `draft-${nextId++}`,
        file_path: filePath,
        line,
        side,
        body,
        ...(startLine != null && startLine !== line ? { start_line: startLine } : {}),
      };
      setDraftComments((prev) => [...prev, comment]);
    },
    []
  );

  const updateComment = useCallback((id: string, body: string) => {
    setDraftComments((prev) =>
      prev.map((c) => (c.id === id ? { ...c, body } : c))
    );
  }, []);

  const removeComment = useCallback((id: string) => {
    setDraftComments((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const clearDraft = useCallback(() => {
    setDraftComments([]);
    setReviewBody("");
  }, []);

  const submitReview = useCallback(
    async (
      owner: string,
      repo: string,
      prNumber: number,
      event: ReviewEvent,
      body: string
    ) => {
      setSubmitting(true);
      try {
        const comments = draftComments.map((c) => ({
          path: c.file_path,
          line: c.line,
          start_line: c.start_line ?? null,
          side: c.side,
          body: c.body,
        }));
        await invoke("submit_pr_review", {
          owner,
          repo,
          prNumber,
          event,
          body,
          comments,
        });
        clearDraft();
      } finally {
        setSubmitting(false);
      }
    },
    [draftComments, clearDraft]
  );

  return {
    draftComments,
    reviewBody,
    setReviewBody,
    addComment,
    updateComment,
    removeComment,
    submitReview,
    clearDraft,
    submitting,
  };
}
