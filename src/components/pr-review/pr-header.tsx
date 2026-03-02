import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MergeMethod, MergeStatus, ReviewEvent } from "@/types";

interface PrHeaderProps {
  title: string;
  number: number;
  author: string;
  headBranch: string;
  baseBranch: string;
  onRefresh: () => void;
  refreshing: boolean;
  onRunReview: () => void;
  reviewLoading: boolean;
  reviewError: string | null;
  onBack: () => void;
  pendingCommentCount: number;
  onSubmitReview: (event: ReviewEvent, body: string) => Promise<void>;
  submittingReview: boolean;
  mergeStatus: MergeStatus | null;
  onMerge: (title: string, message: string, method: MergeMethod) => Promise<void>;
}

export function PrHeader({
  title,
  number,
  author,
  headBranch,
  baseBranch,
  onRefresh,
  refreshing,
  onRunReview,
  reviewLoading,
  reviewError,
  onBack,
  pendingCommentCount,
  onSubmitReview,
  submittingReview,
  mergeStatus,
  onMerge,
}: PrHeaderProps) {
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewEvent, setReviewEvent] = useState<ReviewEvent>("APPROVE");
  const [reviewBody, setReviewBody] = useState("");
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeMethod, setMergeMethod] = useState<MergeMethod>("squash");
  const [mergeTitle, setMergeTitle] = useState("");
  const [mergeMessage, setMergeMessage] = useState("");
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const handleOpenReviewDialog = (event: ReviewEvent) => {
    setReviewEvent(event);
    setReviewBody("");
    setReviewDialogOpen(true);
  };

  const handleSubmitReview = async () => {
    try {
      await onSubmitReview(reviewEvent, reviewBody);
      setReviewDialogOpen(false);
    } catch (err) {
      console.error("Failed to submit review:", err);
    }
  };

  const handleOpenMergeDialog = () => {
    setMergeTitle(title);
    setMergeMessage("");
    setMergeError(null);
    setMergeDialogOpen(true);
  };

  const handleMerge = async () => {
    setMerging(true);
    setMergeError(null);
    try {
      await onMerge(mergeTitle, mergeMessage, mergeMethod);
      setMergeDialogOpen(false);
    } catch (err) {
      setMergeError(String(err));
    } finally {
      setMerging(false);
    }
  };

  const reviewEventLabel: Record<ReviewEvent, string> = {
    APPROVE: "Approve",
    REQUEST_CHANGES: "Request Changes",
    COMMENT: "Comment",
  };

  return (
    <div className="shrink-0 border-b">
      <div className="flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack}>
            &larr; Back
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold">{title}</h1>
              <Badge variant="outline" className="shrink-0">
                #{number}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {author} wants to merge{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                {headBranch}
              </code>{" "}
              into{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                {baseBranch}
              </code>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {reviewError && (
            <span className="text-xs text-destructive max-w-48 truncate">
              {reviewError}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={onRefresh}
            disabled={refreshing}
            title="Refresh PR data"
            className="h-8 w-8 p-0"
          >
            <svg
              className={`h-4 w-4${refreshing ? " animate-spin" : ""}`}
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
          <Button
            size="sm"
            variant="outline"
            onClick={onRunReview}
            disabled={reviewLoading}
          >
            {reviewLoading ? "Reviewing..." : "Run AI Review"}
          </Button>

          {/* Submit Review dropdown */}
          <div className="relative">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleOpenReviewDialog("APPROVE")}
              disabled={submittingReview}
            >
              Submit Review
              {pendingCommentCount > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">
                  {pendingCommentCount}
                </Badge>
              )}
            </Button>
          </div>

          {/* Merge button */}
          <Button
            size="sm"
            onClick={handleOpenMergeDialog}
            disabled={mergeStatus !== null && !mergeStatus.mergeable}
            title={
              mergeStatus && !mergeStatus.mergeable
                ? `Not mergeable: ${mergeStatus.mergeable_state}`
                : "Merge pull request"
            }
          >
            Merge
          </Button>
        </div>
      </div>

      {/* Submit Review Dialog */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit Review</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Review action</Label>
              <Select
                value={reviewEvent}
                onValueChange={(v) => setReviewEvent(v as ReviewEvent)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="APPROVE">Approve</SelectItem>
                  <SelectItem value="REQUEST_CHANGES">Request Changes</SelectItem>
                  <SelectItem value="COMMENT">Comment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Body (optional)</Label>
              <textarea
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                rows={4}
                placeholder="Leave a summary comment..."
                value={reviewBody}
                onChange={(e) => setReviewBody(e.target.value)}
              />
            </div>
            {pendingCommentCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {pendingCommentCount} pending comment{pendingCommentCount !== 1 ? "s" : ""} will be submitted with this review.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReviewDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmitReview} disabled={submittingReview}>
              {submittingReview
                ? "Submitting..."
                : reviewEventLabel[reviewEvent]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge Dialog */}
      <Dialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge Pull Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Merge method</Label>
              <Select
                value={mergeMethod}
                onValueChange={(v) => setMergeMethod(v as MergeMethod)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="squash">Squash and merge</SelectItem>
                  <SelectItem value="merge">Merge commit</SelectItem>
                  <SelectItem value="rebase">Rebase and merge</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Commit title</Label>
              <Input
                value={mergeTitle}
                onChange={(e) => setMergeTitle(e.target.value)}
                placeholder="Commit title"
              />
            </div>
            <div className="space-y-2">
              <Label>Commit message (optional)</Label>
              <textarea
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                rows={4}
                placeholder="Additional commit message..."
                value={mergeMessage}
                onChange={(e) => setMergeMessage(e.target.value)}
              />
            </div>
            {mergeError && (
              <p className="text-xs text-destructive">{mergeError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMergeDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleMerge} disabled={merging}>
              {merging ? "Merging..." : "Confirm merge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
