import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { parsePatch } from "@/lib/diff-parser";
import type { DiffLine } from "@/lib/diff-parser";
import type { AiAnnotation, Commit, DraftComment, FileDiff } from "@/types";
import { useHighlighter } from "@/hooks/use-highlighter";
import {
  useTokenizedHunks,
  TokenizedLine,
} from "@/components/pr-review/highlighted-code";
import type { ThemedToken } from "shiki";

export type DiffViewMode = "unified" | "split";

interface DiffPaneProps {
  commit: Commit | null;
  files?: FileDiff[];
  aiAnnotations: AiAnnotation[];
  draftComments: DraftComment[];
  viewMode: DiffViewMode;
  onAddComment: (
    filePath: string,
    line: number,
    side: "LEFT" | "RIGHT",
    body: string
  ) => void;
  onRemoveComment: (id: string) => void;
  onUpdateComment: (id: string, body: string) => void;
}

export function DiffPane({
  commit,
  files,
  aiAnnotations,
  draftComments,
  viewMode,
  onAddComment,
  onRemoveComment,
  onUpdateComment,
}: DiffPaneProps) {
  const { highlighter } = useHighlighter();
  // Use explicit files array if provided (full PR view), otherwise use commit files
  const resolvedFiles = files ?? commit?.files ?? [];

  if (!commit && !files) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Select a commit to view changes.
        </p>
      </div>
    );
  }

  if (resolvedFiles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">
          No file changes to display.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4">
      {resolvedFiles.map((file) => (
        <FileSection
          key={file.path}
          file={file}
          viewMode={viewMode}
          highlighter={highlighter}
          annotations={aiAnnotations.filter((a) => a.file_path === file.path)}
          draftComments={draftComments.filter(
            (c) => c.file_path === file.path
          )}
          onAddComment={onAddComment}
          onRemoveComment={onRemoveComment}
          onUpdateComment={onUpdateComment}
        />
      ))}
    </div>
  );
}

// -- Side-by-side row model --------------------------------------------------

interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

/** Pair deletions with additions into side-by-side rows. */
function buildSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let deletions: DiffLine[] = [];
  let additions: DiffLine[] = [];

  const flush = () => {
    const max = Math.max(deletions.length, additions.length);
    for (let i = 0; i < max; i++) {
      rows.push({
        left: deletions[i] ?? null,
        right: additions[i] ?? null,
      });
    }
    deletions = [];
    additions = [];
  };

  for (const line of lines) {
    if (line.type === "deletion") {
      deletions.push(line);
    } else if (line.type === "addition") {
      additions.push(line);
    } else {
      flush();
      rows.push({ left: line, right: line });
    }
  }
  flush();
  return rows;
}

// -- FileSection -------------------------------------------------------------

function FileSection({
  file,
  viewMode,
  highlighter,
  annotations,
  draftComments,
  onAddComment,
  onRemoveComment,
  onUpdateComment,
}: {
  file: FileDiff;
  viewMode: DiffViewMode;
  highlighter: import("shiki").Highlighter | null;
  annotations: AiAnnotation[];
  draftComments: DraftComment[];
  onAddComment: (
    filePath: string,
    line: number,
    side: "LEFT" | "RIGHT",
    body: string
  ) => void;
  onRemoveComment: (id: string) => void;
  onUpdateComment: (id: string, body: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const parsed = parsePatch(file.patch);
  const tokenizedHunks = useTokenizedHunks(file.path, parsed.hunks, file.patch, highlighter);

  return (
    <div className="mb-4" data-file-path={file.path}>
      {/* File header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-2 rounded-t border bg-muted/50 px-3 py-2 text-left hover:bg-muted"
      >
        <span className="text-xs text-muted-foreground">
          {collapsed ? "+" : "-"}
        </span>
        <span className="flex-1 truncate font-mono text-xs font-medium">
          {file.path}
        </span>
        <FileStatusBadge status={file.status} />
        <span className="text-xs text-muted-foreground">
          <span className="text-green-600 dark:text-green-400">
            +{file.additions}
          </span>
          {" / "}
          <span className="text-red-600 dark:text-red-400">
            -{file.deletions}
          </span>
        </span>
      </button>

      {/* Diff content */}
      {!collapsed && (
        <div className="overflow-x-auto rounded-b border border-t-0">
          {parsed.hunks.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Binary file or no patch available.
            </p>
          ) : viewMode === "split" ? (
            <table className="w-full border-collapse table-fixed">
              <tbody>
                {parsed.hunks.map((hunk, hi) => {
                  const splitRows = buildSplitRows(hunk.lines);
                  const hunkTokens = tokenizedHunks?.[hi] ?? null;
                  return splitRows.map((row, ri) => {
                    // Map split row lines back to their index in the hunk
                    const leftIdx = row.left ? hunk.lines.indexOf(row.left) : -1;
                    const rightIdx = row.right ? hunk.lines.indexOf(row.right) : -1;
                    return (
                      <SplitDiffRow
                        key={`${hi}-${ri}`}
                        left={row.left}
                        right={row.right}
                        leftTokens={leftIdx >= 0 ? hunkTokens?.lineTokens[leftIdx] ?? null : null}
                        rightTokens={rightIdx >= 0 ? hunkTokens?.lineTokens[rightIdx] ?? null : null}
                        annotations={annotations}
                        draftComments={draftComments}
                        filePath={file.path}
                        onAddComment={onAddComment}
                        onRemoveComment={onRemoveComment}
                        onUpdateComment={onUpdateComment}
                      />
                    );
                  });
                })}
              </tbody>
            </table>
          ) : (
            <table className="w-full border-collapse">
              <tbody>
                {parsed.hunks.map((hunk, hi) =>
                  hunk.lines.map((line, li) => {
                    const lineAnnotations = annotations.filter(
                      (a) =>
                        (line.newLineNumber !== null &&
                          line.newLineNumber >= a.start_line &&
                          line.newLineNumber <= a.end_line) ||
                        (line.oldLineNumber !== null &&
                          line.oldLineNumber >= a.start_line &&
                          line.oldLineNumber <= a.end_line)
                    );

                    const lineNumber =
                      line.type === "deletion"
                        ? line.oldLineNumber
                        : line.newLineNumber;
                    const side: "LEFT" | "RIGHT" =
                      line.type === "deletion" ? "LEFT" : "RIGHT";

                    const lineDrafts = draftComments.filter(
                      (c) => c.line === lineNumber && c.side === side
                    );

                    const hunkTokens = tokenizedHunks?.[hi] ?? null;

                    return (
                      <UnifiedDiffRow
                        key={`${hi}-${li}`}
                        type={line.type}
                        oldLineNumber={line.oldLineNumber}
                        newLineNumber={line.newLineNumber}
                        content={line.content}
                        tokens={hunkTokens?.lineTokens[li] ?? null}
                        annotations={lineAnnotations}
                        draftComments={lineDrafts}
                        filePath={file.path}
                        onAddComment={onAddComment}
                        onRemoveComment={onRemoveComment}
                        onUpdateComment={onUpdateComment}
                      />
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// -- Split (side-by-side) diff row -------------------------------------------

function SplitDiffRow({
  left,
  right,
  leftTokens,
  rightTokens,
  annotations,
  draftComments,
  filePath,
  onAddComment,
  onRemoveComment,
  onUpdateComment,
}: {
  left: DiffLine | null;
  right: DiffLine | null;
  leftTokens: ThemedToken[] | null;
  rightTokens: ThemedToken[] | null;
  annotations: AiAnnotation[];
  draftComments: DraftComment[];
  filePath: string;
  onAddComment: (
    filePath: string,
    line: number,
    side: "LEFT" | "RIGHT",
    body: string
  ) => void;
  onRemoveComment: (id: string) => void;
  onUpdateComment: (id: string, body: string) => void;
}) {
  const [commentSide, setCommentSide] = useState<"LEFT" | "RIGHT" | null>(
    null
  );
  const [commentText, setCommentText] = useState("");

  const leftBg =
    left?.type === "deletion"
      ? "bg-red-500/10"
      : left?.type === "context"
        ? ""
        : "";
  const rightBg =
    right?.type === "addition"
      ? "bg-green-500/10"
      : right?.type === "context"
        ? ""
        : "";

  const leftLineNum = left?.oldLineNumber ?? null;
  const rightLineNum = right?.newLineNumber ?? null;

  // Annotations for left side (old lines)
  const leftAnnotations = leftLineNum
    ? annotations.filter(
        (a) => leftLineNum >= a.start_line && leftLineNum <= a.end_line
      )
    : [];

  // Annotations for right side (new lines)
  const rightAnnotations = rightLineNum
    ? annotations.filter(
        (a) => rightLineNum >= a.start_line && rightLineNum <= a.end_line
      )
    : [];

  const leftDrafts = leftLineNum
    ? draftComments.filter((c) => c.line === leftLineNum && c.side === "LEFT")
    : [];
  const rightDrafts = rightLineNum
    ? draftComments.filter(
        (c) => c.line === rightLineNum && c.side === "RIGHT"
      )
    : [];

  const handleSubmitComment = () => {
    if (!commentText.trim() || !commentSide) return;
    const lineNum =
      commentSide === "LEFT" ? leftLineNum : rightLineNum;
    if (lineNum === null) return;
    onAddComment(filePath, lineNum, commentSide, commentText.trim());
    setCommentText("");
    setCommentSide(null);
  };

  const hasAnnotationsBelow =
    leftAnnotations.length > 0 ||
    rightAnnotations.length > 0 ||
    leftDrafts.length > 0 ||
    rightDrafts.length > 0;

  return (
    <>
      <tr className="group/row">
        {/* Left side: old */}
        <td
          className={`relative w-10 select-none border-r px-1.5 text-right font-mono text-xs text-muted-foreground ${leftBg}`}
        >
          {leftLineNum ?? ""}
          {left && leftLineNum !== null && (
            <button
              onClick={() => setCommentSide("LEFT")}
              className="absolute left-0 top-1/2 -translate-y-1/2 rounded px-0.5 text-blue-500 opacity-0 transition-opacity hover:bg-blue-100 dark:hover:bg-blue-900 group-hover/row:opacity-100"
              title="Add comment"
            >
              +
            </button>
          )}
        </td>
        <td
          className={`w-1/2 whitespace-pre overflow-hidden text-ellipsis border-r pl-1 font-mono text-xs ${leftBg}`}
        >
          {left && (
            <span
              className={
                left.type === "deletion" && !leftTokens
                  ? "text-red-700 dark:text-red-400"
                  : ""
              }
            >
              {left.type === "deletion" ? "-" : " "}
              <TokenizedLine tokens={leftTokens} fallback={left.content} />
            </span>
          )}
        </td>

        {/* Right side: new */}
        <td
          className={`relative w-10 select-none border-r px-1.5 text-right font-mono text-xs text-muted-foreground ${rightBg}`}
        >
          {rightLineNum ?? ""}
          {right && rightLineNum !== null && (
            <button
              onClick={() => setCommentSide("RIGHT")}
              className="absolute left-0 top-1/2 -translate-y-1/2 rounded px-0.5 text-blue-500 opacity-0 transition-opacity hover:bg-blue-100 dark:hover:bg-blue-900 group-hover/row:opacity-100"
              title="Add comment"
            >
              +
            </button>
          )}
        </td>
        <td
          className={`w-1/2 whitespace-pre overflow-hidden text-ellipsis pl-1 font-mono text-xs ${rightBg}`}
        >
          {right && (
            <span
              className={
                right.type === "addition" && !rightTokens
                  ? "text-green-700 dark:text-green-400"
                  : ""
              }
            >
              {right.type === "addition" ? "+" : " "}
              <TokenizedLine tokens={rightTokens} fallback={right.content} />
            </span>
          )}
        </td>
      </tr>

      {/* Annotations / drafts below the row */}
      {hasAnnotationsBelow && (
        <tr>
          {/* Left annotations */}
          <td
            colSpan={2}
            className="border-r align-top"
          >
            {leftAnnotations.map((ann, i) => (
              <div
                key={`lann-${i}`}
                className="border-l-2 border-yellow-500 bg-yellow-500/10 px-3 py-1.5"
              >
                <div className="flex items-start gap-2">
                  <SeverityBadge severity={ann.severity} />
                  <div className="text-xs">
                    <p>{ann.message}</p>
                    {ann.suggestion && (
                      <pre className="mt-1 rounded bg-muted p-1.5 font-mono text-xs">
                        {ann.suggestion}
                      </pre>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {leftDrafts.map((draft) => (
              <DraftCommentBlock
                key={draft.id}
                draft={draft}
                onRemove={onRemoveComment}
                onUpdate={onUpdateComment}
              />
            ))}
          </td>
          {/* Right annotations */}
          <td colSpan={2} className="align-top">
            {rightAnnotations.map((ann, i) => (
              <div
                key={`rann-${i}`}
                className="border-l-2 border-yellow-500 bg-yellow-500/10 px-3 py-1.5"
              >
                <div className="flex items-start gap-2">
                  <SeverityBadge severity={ann.severity} />
                  <div className="text-xs">
                    <p>{ann.message}</p>
                    {ann.suggestion && (
                      <pre className="mt-1 rounded bg-muted p-1.5 font-mono text-xs">
                        {ann.suggestion}
                      </pre>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {rightDrafts.map((draft) => (
              <DraftCommentBlock
                key={draft.id}
                draft={draft}
                onRemove={onRemoveComment}
                onUpdate={onUpdateComment}
              />
            ))}
          </td>
        </tr>
      )}

      {/* Inline comment form */}
      {commentSide !== null && (
        <tr>
          <td colSpan={4} className="border-l-2 border-blue-500 bg-blue-500/5 px-4 py-2">
            <p className="mb-1 text-[10px] text-muted-foreground">
              Comment on {commentSide === "LEFT" ? "old" : "new"} line{" "}
              {commentSide === "LEFT" ? leftLineNum : rightLineNum}
            </p>
            <textarea
              autoFocus
              className="w-full rounded border bg-background px-2 py-1 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              rows={3}
              placeholder="Leave a comment..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  handleSubmitComment();
                }
                if (e.key === "Escape") {
                  setCommentSide(null);
                  setCommentText("");
                }
              }}
            />
            <div className="mt-1 flex items-center gap-2">
              <Button
                size="sm"
                variant="default"
                onClick={handleSubmitComment}
                disabled={!commentText.trim()}
              >
                Add to review
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCommentSide(null);
                  setCommentText("");
                }}
              >
                Cancel
              </Button>
              <span className="text-[10px] text-muted-foreground ml-auto">
                Ctrl+Enter to save
              </span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// -- Unified diff row (existing) ---------------------------------------------

function UnifiedDiffRow({
  type,
  oldLineNumber,
  newLineNumber,
  content,
  tokens,
  annotations,
  draftComments,
  filePath,
  onAddComment,
  onRemoveComment,
  onUpdateComment,
}: {
  type: "addition" | "deletion" | "context";
  oldLineNumber: number | null;
  newLineNumber: number | null;
  content: string;
  tokens: ThemedToken[] | null;
  annotations: AiAnnotation[];
  draftComments: DraftComment[];
  filePath: string;
  onAddComment: (
    filePath: string,
    line: number,
    side: "LEFT" | "RIGHT",
    body: string
  ) => void;
  onRemoveComment: (id: string) => void;
  onUpdateComment: (id: string, body: string) => void;
}) {
  const [showCommentForm, setShowCommentForm] = useState(false);
  const [commentText, setCommentText] = useState("");

  const rowClass =
    type === "addition"
      ? "bg-green-500/10"
      : type === "deletion"
        ? "bg-red-500/10"
        : "";

  const prefix =
    type === "addition" ? "+" : type === "deletion" ? "-" : " ";

  const lineNumber =
    type === "deletion" ? oldLineNumber : newLineNumber;
  const side: "LEFT" | "RIGHT" = type === "deletion" ? "LEFT" : "RIGHT";

  const handleSubmitComment = () => {
    if (!commentText.trim() || lineNumber === null) return;
    onAddComment(filePath, lineNumber, side, commentText.trim());
    setCommentText("");
    setShowCommentForm(false);
  };

  return (
    <>
      <tr className={`group/row ${rowClass}`}>
        <td className="relative w-12 select-none border-r px-2 text-right font-mono text-xs text-muted-foreground">
          {oldLineNumber ?? ""}
          {type !== "addition" && oldLineNumber !== null && (
            <button
              onClick={() => setShowCommentForm(true)}
              className="absolute left-0 top-1/2 -translate-y-1/2 rounded px-0.5 text-blue-500 opacity-0 transition-opacity hover:bg-blue-100 dark:hover:bg-blue-900 group-hover/row:opacity-100"
              title="Add comment"
            >
              +
            </button>
          )}
        </td>
        <td className="relative w-12 select-none border-r px-2 text-right font-mono text-xs text-muted-foreground">
          {newLineNumber ?? ""}
          {type !== "deletion" && newLineNumber !== null && (
            <button
              onClick={() => setShowCommentForm(true)}
              className="absolute left-0 top-1/2 -translate-y-1/2 rounded px-0.5 text-blue-500 opacity-0 transition-opacity hover:bg-blue-100 dark:hover:bg-blue-900 group-hover/row:opacity-100"
              title="Add comment"
            >
              +
            </button>
          )}
        </td>
        <td className="whitespace-pre pl-1 font-mono text-xs">
          <span
            className={
              !tokens
                ? type === "addition"
                  ? "text-green-700 dark:text-green-400"
                  : type === "deletion"
                    ? "text-red-700 dark:text-red-400"
                    : ""
                : ""
            }
          >
            {prefix}
            <TokenizedLine tokens={tokens} fallback={content} />
          </span>
        </td>
      </tr>
      {annotations.map((ann, i) => (
        <tr key={`ann-${i}`}>
          <td
            colSpan={3}
            className="border-l-2 border-yellow-500 bg-yellow-500/10 px-4 py-2"
          >
            <div className="flex items-start gap-2">
              <SeverityBadge severity={ann.severity} />
              <div className="text-xs">
                <p>{ann.message}</p>
                {ann.suggestion && (
                  <pre className="mt-1 rounded bg-muted p-2 font-mono text-xs">
                    {ann.suggestion}
                  </pre>
                )}
              </div>
            </div>
          </td>
        </tr>
      ))}
      {draftComments.map((draft) => (
        <tr key={draft.id}>
          <td
            colSpan={3}
            className="border-l-2 border-amber-400 bg-amber-500/10 px-4 py-2"
          >
            <DraftCommentInline
              draft={draft}
              onRemove={onRemoveComment}
              onUpdate={onUpdateComment}
            />
          </td>
        </tr>
      ))}
      {showCommentForm && (
        <tr>
          <td
            colSpan={3}
            className="border-l-2 border-blue-500 bg-blue-500/5 px-4 py-2"
          >
            <textarea
              autoFocus
              className="w-full rounded border bg-background px-2 py-1 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              rows={3}
              placeholder="Leave a comment..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  handleSubmitComment();
                }
                if (e.key === "Escape") {
                  setShowCommentForm(false);
                  setCommentText("");
                }
              }}
            />
            <div className="mt-1 flex items-center gap-2">
              <Button
                size="sm"
                variant="default"
                onClick={handleSubmitComment}
                disabled={!commentText.trim()}
              >
                Add to review
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowCommentForm(false);
                  setCommentText("");
                }}
              >
                Cancel
              </Button>
              <span className="text-[10px] text-muted-foreground ml-auto">
                Ctrl+Enter to save
              </span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// -- Shared components -------------------------------------------------------

function DraftCommentBlock({
  draft,
  onRemove,
  onUpdate,
}: {
  draft: DraftComment;
  onRemove: (id: string) => void;
  onUpdate: (id: string, body: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(draft.body);

  return (
    <div className="border-l-2 border-amber-400 bg-amber-500/10 px-3 py-1.5">
      {editing ? (
        <div>
          <textarea
            autoFocus
            className="w-full rounded border bg-background px-2 py-1 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            rows={2}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                onUpdate(draft.id, editText.trim());
                setEditing(false);
              }
              if (e.key === "Escape") {
                setEditText(draft.body);
                setEditing(false);
              }
            }}
          />
          <div className="mt-1 flex gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={() => {
                onUpdate(draft.id, editText.trim());
                setEditing(false);
              }}
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditText(draft.body);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <Badge variant="outline" className="shrink-0 text-[10px]">
              Pending
            </Badge>
            <p className="whitespace-pre-wrap font-mono text-xs">
              {draft.body}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs text-destructive"
              onClick={() => onRemove(draft.id)}
            >
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function DraftCommentInline({
  draft,
  onRemove,
  onUpdate,
}: {
  draft: DraftComment;
  onRemove: (id: string) => void;
  onUpdate: (id: string, body: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(draft.body);

  if (editing) {
    return (
      <div>
        <textarea
          autoFocus
          className="w-full rounded border bg-background px-2 py-1 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          rows={3}
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              onUpdate(draft.id, editText.trim());
              setEditing(false);
            }
            if (e.key === "Escape") {
              setEditText(draft.body);
              setEditing(false);
            }
          }}
        />
        <div className="mt-1 flex gap-2">
          <Button
            size="sm"
            variant="default"
            onClick={() => {
              onUpdate(draft.id, editText.trim());
              setEditing(false);
            }}
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditText(draft.body);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-start gap-2">
        <Badge variant="outline" className="shrink-0 text-[10px]">
          Pending
        </Badge>
        <p className="whitespace-pre-wrap font-mono text-xs">{draft.body}</p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onClick={() => setEditing(true)}
        >
          Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs text-destructive"
          onClick={() => onRemove(draft.id)}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

function FileStatusBadge({ status }: { status: string }) {
  const variants: Record<string, { label: string; className: string }> = {
    added: {
      label: "A",
      className:
        "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
    },
    removed: {
      label: "D",
      className:
        "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
    },
    modified: {
      label: "M",
      className:
        "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
    },
    renamed: {
      label: "R",
      className:
        "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
    },
  };

  const v = variants[status] ?? variants.modified;

  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${v.className}`}
    >
      {v.label}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    info: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
    warning:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
    critical:
      "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  };

  return (
    <Badge
      className={`shrink-0 text-[10px] ${colors[severity] ?? colors.info}`}
    >
      {severity}
    </Badge>
  );
}
