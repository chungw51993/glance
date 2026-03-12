import type {
  AiReviewSummary,
  CombinedCheckStatus,
  DraftComment,
  FileDiff,
  MergeStatus,
  PullRequestDetail,
  Ticket,
} from "@/types";

export interface ReviewCacheEntry {
  prKey: string;
  pr: PullRequestDetail | null;
  aiReview: AiReviewSummary | null;
  tickets: Ticket[];
  ticketsError: string | null;
  mergeStatus: MergeStatus | null;
  checkStatus: CombinedCheckStatus | null;
  prFiles: FileDiff[];
  selectedCommitIndex: number;
  draftComments: DraftComment[];
  aiPanelOpen: boolean;
}

let _cache: ReviewCacheEntry | null = null;

export function getReviewCache(prKey: string): ReviewCacheEntry | null {
  return _cache?.prKey === prKey ? _cache : null;
}

export function updateReviewCache(partial: Partial<ReviewCacheEntry> & { prKey: string }): void {
  if (_cache?.prKey === partial.prKey) {
    _cache = { ..._cache, ...partial };
  } else {
    const { prKey, ...rest } = partial;
    _cache = {
      prKey,
      pr: null,
      aiReview: null,
      tickets: [],
      ticketsError: null,
      mergeStatus: null,
      checkStatus: null,
      prFiles: [],
      selectedCommitIndex: 0,
      draftComments: [],
      aiPanelOpen: false,
      ...rest,
    };
  }
}

export function getActiveReviewKey(): string | null {
  return _cache?.prKey ?? null;
}
