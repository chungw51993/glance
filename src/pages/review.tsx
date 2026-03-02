import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useReview } from "@/hooks/use-review";
import { useReviewDraft } from "@/hooks/use-review-draft";
import { useLayoutPreferences } from "@/hooks/use-layout-preferences";
import { PrHeader } from "@/components/pr-review/pr-header";
import { CommitSidebar } from "@/components/pr-review/commit-sidebar";
import { DiffPane } from "@/components/pr-review/diff-pane";
import { LinearTicketsPanel } from "@/components/pr-review/linear-tickets-panel";
import { AiSummaryPanel } from "@/components/pr-review/ai-summary-panel";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import type { MergeMethod, ReviewEvent } from "@/types";

export function ReviewPage() {
  const { owner, name, prNumber } = useParams();
  const navigate = useNavigate();
  const { prefs, update } = useLayoutPreferences();
  const [aiPanelOpen, setAiPanelOpen] = useState(false);

  const {
    pr,
    aiReview,
    selectedCommitIndex,
    hideMerges,
    loading,
    reviewLoading,
    error,
    reviewError,
    mergeStatus,
    linearTickets,
    linearLoading,
    linearError,
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
  } = useReview({
    hideMerges: prefs.hideMerges,
    diffScope: prefs.diffScope,
    onHideMergesChange: useCallback((v: boolean) => update("hideMerges", v), [update]),
    onDiffScopeChange: useCallback((v: "commit" | "full-pr") => update("diffScope", v), [update]),
  });

  const {
    draftComments,
    addComment,
    updateComment,
    removeComment,
    submitReview,
    submitting: submittingReview,
  } = useReviewDraft();

  useEffect(() => {
    if (owner && name && prNumber) {
      fetchPRDetail(owner, name, Number(prNumber));
    }
  }, [owner, name, prNumber, fetchPRDetail]);

  // Auto-open AI panel when review completes
  useEffect(() => {
    if (aiReview) {
      setAiPanelOpen(true);
    }
  }, [aiReview]);

  const handleSubmitReview = useCallback(
    async (event: ReviewEvent, body: string) => {
      if (!owner || !name || !prNumber) return;
      try {
        await submitReview(owner, name, Number(prNumber), event, body);
        toast.success("Review submitted");
      } catch (err) {
        toast.error(`Failed to submit review: ${err}`);
        throw err;
      }
    },
    [owner, name, prNumber, submitReview]
  );

  const handleMerge = useCallback(
    async (title: string, message: string, method: MergeMethod) => {
      if (!owner || !name || !prNumber) return;
      await mergePR(owner, name, Number(prNumber), title, message, method);
      toast.success("Pull request merged");
      navigate("/");
    },
    [owner, name, prNumber, mergePR, navigate]
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Loading pull request...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-sm text-destructive">{error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (owner && name && prNumber) {
              fetchPRDetail(owner, name, Number(prNumber));
            }
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (!pr) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">
          No pull request data.
        </p>
      </div>
    );
  }

  const selectedCommit = visibleCommits[selectedCommitIndex] ?? null;
  const annotationsForCommit =
    diffScope === "full-pr"
      ? (aiReview?.findings ?? [])
      : (aiReview?.findings.filter((f) =>
          selectedCommit?.files.some((file) => file.path === f.file_path)
        ) ?? []);

  return (
    <div className="flex h-full flex-col">
      <PrHeader
        title={pr.title}
        number={pr.number}
        author={pr.author}
        headBranch={pr.head_branch}
        baseBranch={pr.base_branch}
        onRefresh={() => {
          if (owner && name && prNumber) {
            fetchPRDetail(owner, name, Number(prNumber));
          }
        }}
        refreshing={loading}
        onRunReview={() => {
          if (owner && name && prNumber) {
            runAiReview(owner, name, Number(prNumber));
          }
        }}
        reviewLoading={reviewLoading}
        reviewError={reviewError}
        onBack={() => navigate("/")}
        pendingCommentCount={draftComments.length}
        onSubmitReview={handleSubmitReview}
        submittingReview={submittingReview}
        mergeStatus={mergeStatus}
        onMerge={handleMerge}
      />
      <div className="flex flex-1 overflow-hidden">
        <CommitSidebar
          commits={pr.commits}
          visibleCommits={visibleCommits}
          selectedIndex={selectedCommitIndex}
          hideMerges={hideMerges}
          collapsed={prefs.sidebarCollapsed}
          diffScope={diffScope}
          onSelectCommit={(index) => {
            setDiffScope("commit");
            selectCommit(index);
          }}
          onNext={nextCommit}
          onPrev={prevCommit}
          onToggleHideMerges={setHideMerges}
          onToggleCollapsed={() => update("sidebarCollapsed", !prefs.sidebarCollapsed)}
          onSelectFullPr={() => setDiffScope("full-pr")}
        />
        <ResizablePanelGroup orientation="horizontal" className="flex-1">
          <ResizablePanel defaultSize={aiPanelOpen ? 65 : 100} minSize={30}>
            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex shrink-0 items-center justify-between border-b px-4 py-1.5">
                <div className="flex items-center gap-1">
                  <span className="mr-2 text-xs text-muted-foreground">View:</span>
                  <Button
                    size="sm"
                    variant={prefs.diffViewMode === "unified" ? "secondary" : "ghost"}
                    className="h-6 px-2 text-xs"
                    onClick={() => update("diffViewMode", "unified")}
                  >
                    Unified
                  </Button>
                  <Button
                    size="sm"
                    variant={prefs.diffViewMode === "split" ? "secondary" : "ghost"}
                    className="h-6 px-2 text-xs"
                    onClick={() => update("diffViewMode", "split")}
                  >
                    Split
                  </Button>
                  {diffScope === "full-pr" && (
                    <span className="ml-3 text-xs font-medium text-muted-foreground">
                      Showing full PR diff
                      {prFilesLoading && " (loading...)"}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {aiReview && !aiPanelOpen && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      onClick={() => setAiPanelOpen(true)}
                    >
                      AI Summary
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-auto">
                <DiffPane
                  commit={diffScope === "commit" ? selectedCommit : null}
                  files={diffScope === "full-pr" ? prFiles : undefined}
                  aiAnnotations={annotationsForCommit}
                  draftComments={draftComments}
                  viewMode={prefs.diffViewMode}
                  onAddComment={addComment}
                  onRemoveComment={removeComment}
                  onUpdateComment={updateComment}
                />
              </div>
            </div>
          </ResizablePanel>
          {aiPanelOpen && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={35} minSize={20} maxSize={60}>
                <AiSummaryPanel
                  review={aiReview}
                  onClose={() => setAiPanelOpen(false)}
                />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
      <LinearTicketsPanel
        tickets={linearTickets}
        loading={linearLoading}
        error={linearError}
        expanded={prefs.linearPanelExpanded}
        onToggleExpanded={() => update("linearPanelExpanded", !prefs.linearPanelExpanded)}
      />
    </div>
  );
}
