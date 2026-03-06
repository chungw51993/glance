import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// ---------------------------------------------------------------------------
// Annotation / draft lookup maps -- built once per render of DiffPane,
// shared with all file sections to avoid per-row .filter() calls.
// ---------------------------------------------------------------------------

type AnnotationMap = Map<string, AiAnnotation[]>;
type DraftMap = Map<string, DraftComment[]>;

function buildAnnotationMap(annotations: AiAnnotation[]): AnnotationMap {
  const map: AnnotationMap = new Map();
  for (const a of annotations) {
    const existing = map.get(a.file_path);
    if (existing) {
      existing.push(a);
    } else {
      map.set(a.file_path, [a]);
    }
  }
  return map;
}

function buildDraftMap(drafts: DraftComment[]): DraftMap {
  const map: DraftMap = new Map();
  for (const d of drafts) {
    const existing = map.get(d.file_path);
    if (existing) {
      existing.push(d);
    } else {
      map.set(d.file_path, [d]);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Lazy visibility hook -- defers rendering until element is near viewport
// ---------------------------------------------------------------------------

function useLazyVisible(rootMargin = "200px"): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin]);

  return [ref, visible];
}

// ---------------------------------------------------------------------------
// DiffPane
// ---------------------------------------------------------------------------

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
  const resolvedFiles = files ?? commit?.files ?? [];

  const annotationMap = useMemo(
    () => buildAnnotationMap(aiAnnotations),
    [aiAnnotations]
  );
  const draftMap = useMemo(() => buildDraftMap(draftComments), [draftComments]);

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
          annotations={annotationMap.get(file.path) ?? EMPTY_ANNOTATIONS}
          draftComments={draftMap.get(file.path) ?? EMPTY_DRAFTS}
          onAddComment={onAddComment}
          onRemoveComment={onRemoveComment}
          onUpdateComment={onUpdateComment}
        />
      ))}
    </div>
  );
}

// Stable empty array references to avoid re-renders
const EMPTY_ANNOTATIONS: AiAnnotation[] = [];
const EMPTY_DRAFTS: DraftComment[] = [];

// -- Side-by-side row model --------------------------------------------------

interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
  leftIndex: number;
  rightIndex: number;
}

function buildSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let deletions: { line: DiffLine; index: number }[] = [];
  let additions: { line: DiffLine; index: number }[] = [];

  const flush = () => {
    const max = Math.max(deletions.length, additions.length);
    for (let i = 0; i < max; i++) {
      rows.push({
        left: deletions[i]?.line ?? null,
        right: additions[i]?.line ?? null,
        leftIndex: deletions[i]?.index ?? -1,
        rightIndex: additions[i]?.index ?? -1,
      });
    }
    deletions = [];
    additions = [];
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (line.type === "deletion") {
      deletions.push({ line, index: idx });
    } else if (line.type === "addition") {
      additions.push({ line, index: idx });
    } else {
      flush();
      rows.push({ left: line, right: line, leftIndex: idx, rightIndex: idx });
    }
  }
  flush();
  return rows;
}

// Large file threshold -- auto-collapse files above this line count
const LARGE_FILE_LINES = 500;

// -- FileSection -------------------------------------------------------------

const FileSection = memo(function FileSection({
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
  const parsed = useMemo(() => parsePatch(file.patch), [file.patch]);
  const totalLines = useMemo(
    () => parsed.hunks.reduce((sum, h) => sum + h.lines.length, 0),
    [parsed.hunks]
  );
  const [collapsed, setCollapsed] = useState(totalLines > LARGE_FILE_LINES);
  const [sentinelRef, isVisible] = useLazyVisible("400px");

  // Only tokenize when visible and not collapsed
  const shouldTokenize = isVisible && !collapsed;
  const tokenizedHunks = useTokenizedHunks(
    file.path,
    parsed.hunks,
    shouldTokenize ? file.patch : null,
    highlighter
  );

  return (
    <div className="mb-4" data-file-path={file.path} ref={sentinelRef}>
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
        {totalLines > LARGE_FILE_LINES && (
          <span className="text-[10px] text-muted-foreground">
            {totalLines} lines
          </span>
        )}
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

      {/* Diff content -- only rendered when visible and not collapsed */}
      {!collapsed && (
        <div className="overflow-x-auto rounded-b border border-t-0">
          {!isVisible ? (
            <div className="h-20 flex items-center justify-center">
              <p className="text-xs text-muted-foreground">Scroll to load diff...</p>
            </div>
          ) : parsed.hunks.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Binary file or no patch available.
            </p>
          ) : viewMode === "split" ? (
            <SplitDiffTable
              parsed={parsed}
              tokenizedHunks={tokenizedHunks}
              annotations={annotations}
              draftComments={draftComments}
              filePath={file.path}
              onAddComment={onAddComment}
              onRemoveComment={onRemoveComment}
              onUpdateComment={onUpdateComment}
            />
          ) : (
            <UnifiedDiffTable
              parsed={parsed}
              tokenizedHunks={tokenizedHunks}
              annotations={annotations}
              draftComments={draftComments}
              filePath={file.path}
              onAddComment={onAddComment}
              onRemoveComment={onRemoveComment}
              onUpdateComment={onUpdateComment}
            />
          )}
        </div>
      )}
    </div>
  );
});

// -- Split diff table --------------------------------------------------------

import type { ParsedFileDiff } from "@/lib/diff-parser";
import type { TokenizedHunk } from "@/components/pr-review/highlighted-code";

interface SplitRowData {
  key: string;
  left: DiffLine | null;
  right: DiffLine | null;
  leftTokens: ThemedToken[] | null;
  rightTokens: ThemedToken[] | null;
}

const SplitDiffTable = memo(function SplitDiffTable({
  parsed,
  tokenizedHunks,
  annotations,
  draftComments,
  filePath,
  onAddComment,
  onRemoveComment,
  onUpdateComment,
}: {
  parsed: ParsedFileDiff;
  tokenizedHunks: TokenizedHunk[] | null;
  annotations: AiAnnotation[];
  draftComments: DraftComment[];
  filePath: string;
  onAddComment: (filePath: string, line: number, side: "LEFT" | "RIGHT", body: string) => void;
  onRemoveComment: (id: string) => void;
  onUpdateComment: (id: string, body: string) => void;
}) {
  const rows = useMemo<SplitRowData[]>(() => {
    return parsed.hunks.flatMap((hunk, hi) => {
      const splitRows = buildSplitRows(hunk.lines);
      const hunkTokens = tokenizedHunks?.[hi] ?? null;
      return splitRows.map((row, ri) => ({
        key: `${hi}-${ri}`,
        left: row.left,
        right: row.right,
        leftTokens: row.leftIndex >= 0 ? hunkTokens?.lineTokens[row.leftIndex] ?? null : null,
        rightTokens: row.rightIndex >= 0 ? hunkTokens?.lineTokens[row.rightIndex] ?? null : null,
      }));
    });
  }, [parsed.hunks, tokenizedHunks]);

  return (
    <div className="flex">
      <SplitPane
        side="LEFT"
        rows={rows}
        annotations={annotations}
        draftComments={draftComments}
        filePath={filePath}
        onAddComment={onAddComment}
        onRemoveComment={onRemoveComment}
        onUpdateComment={onUpdateComment}
        className="w-1/2 overflow-x-auto border-r"
      />
      <SplitPane
        side="RIGHT"
        rows={rows}
        annotations={annotations}
        draftComments={draftComments}
        filePath={filePath}
        onAddComment={onAddComment}
        onRemoveComment={onRemoveComment}
        onUpdateComment={onUpdateComment}
        className="w-1/2 overflow-x-auto"
      />
    </div>
  );
});

// -- Split pane (one side of the split view) ---------------------------------

const SplitPane = memo(function SplitPane({
  side,
  rows,
  annotations,
  draftComments,
  filePath,
  onAddComment,
  onRemoveComment,
  onUpdateComment,
  className,
}: {
  side: "LEFT" | "RIGHT";
  rows: SplitRowData[];
  annotations: AiAnnotation[];
  draftComments: DraftComment[];
  filePath: string;
  onAddComment: (filePath: string, line: number, side: "LEFT" | "RIGHT", body: string) => void;
  onRemoveComment: (id: string) => void;
  onUpdateComment: (id: string, body: string) => void;
  className: string;
}) {
  return (
    <div className={className}>
      <table className="min-w-full border-collapse">
        <colgroup>
          <col style={{ width: 40 }} />
          <col />
        </colgroup>
        <tbody>
          {rows.map((row) => (
            <SplitPaneRow
              key={row.key}
              side={side}
              line={side === "LEFT" ? row.left : row.right}
              tokens={side === "LEFT" ? row.leftTokens : row.rightTokens}
              otherSideLine={side === "LEFT" ? row.right : row.left}
              annotations={annotations}
              draftComments={draftComments}
              filePath={filePath}
              onAddComment={onAddComment}
              onRemoveComment={onRemoveComment}
              onUpdateComment={onUpdateComment}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
});

// -- Unified diff table ------------------------------------------------------

const UnifiedDiffTable = memo(function UnifiedDiffTable({
  parsed,
  tokenizedHunks,
  annotations,
  draftComments,
  filePath,
  onAddComment,
  onRemoveComment,
  onUpdateComment,
}: {
  parsed: ParsedFileDiff;
  tokenizedHunks: TokenizedHunk[] | null;
  annotations: AiAnnotation[];
  draftComments: DraftComment[];
  filePath: string;
  onAddComment: (filePath: string, line: number, side: "LEFT" | "RIGHT", body: string) => void;
  onRemoveComment: (id: string) => void;
  onUpdateComment: (id: string, body: string) => void;
}) {
  return (
    <table className="min-w-full border-collapse">
      <tbody>
        {parsed.hunks.map((hunk, hi) =>
          hunk.lines.map((line, li) => {
            const lineAnnotations = annotations.filter(
              (a) =>
                (line.newLineNumber !== null &&
                  line.newLineNumber === a.end_line) ||
                (line.oldLineNumber !== null &&
                  line.type === "deletion" &&
                  line.newLineNumber === null &&
                  line.oldLineNumber === a.end_line)
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
                filePath={filePath}
                onAddComment={onAddComment}
                onRemoveComment={onRemoveComment}
                onUpdateComment={onUpdateComment}
              />
            );
          })
        )}
      </tbody>
    </table>
  );
});

// -- Split pane row (one side of a single row) -------------------------------

const SplitPaneRow = memo(function SplitPaneRow({
  side,
  line,
  tokens,
  otherSideLine,
  annotations,
  draftComments,
  filePath,
  onAddComment,
  onRemoveComment,
  onUpdateComment,
}: {
  side: "LEFT" | "RIGHT";
  line: DiffLine | null;
  tokens: ThemedToken[] | null;
  otherSideLine: DiffLine | null;
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

  const lineNum = side === "LEFT"
    ? (line?.oldLineNumber ?? null)
    : (line?.newLineNumber ?? null);

  const otherLineNum = side === "LEFT"
    ? (otherSideLine?.newLineNumber ?? null)
    : (otherSideLine?.oldLineNumber ?? null);

  const isAddition = line?.type === "addition";
  const isDeletion = line?.type === "deletion";
  const bg = isDeletion ? "bg-red-500/10" : isAddition ? "bg-green-500/10" : "";
  const stickyBg = isDeletion
    ? "bg-red-50 dark:bg-red-950"
    : isAddition
      ? "bg-green-50 dark:bg-green-950"
      : "bg-background";

  const myAnnotations = useMemo(
    () =>
      lineNum
        ? annotations.filter((a) => lineNum === a.end_line)
        : EMPTY_ANNOTATIONS,
    [lineNum, annotations]
  );

  // Check if other side has annotations (to render matching empty row)
  const otherHasAnnotations = useMemo(() => {
    if (!otherLineNum) return false;
    return annotations.some((a) => otherLineNum === a.end_line);
  }, [otherLineNum, annotations]);

  const myDrafts = useMemo(
    () =>
      lineNum
        ? draftComments.filter((c) => c.line === lineNum && c.side === side)
        : EMPTY_DRAFTS,
    [lineNum, side, draftComments]
  );

  const otherHasDrafts = useMemo(() => {
    if (!otherLineNum) return false;
    const otherSide = side === "LEFT" ? "RIGHT" : "LEFT";
    return draftComments.some((c) => c.line === otherLineNum && c.side === otherSide);
  }, [otherLineNum, side, draftComments]);

  const hasAnnotationsBelow =
    myAnnotations.length > 0 ||
    myDrafts.length > 0 ||
    otherHasAnnotations ||
    otherHasDrafts;

  const handleSubmitComment = useCallback(() => {
    if (!commentText.trim() || lineNum === null) return;
    onAddComment(filePath, lineNum, side, commentText.trim());
    setCommentText("");
    setShowCommentForm(false);
  }, [commentText, lineNum, side, filePath, onAddComment]);

  const colorClass =
    !tokens
      ? isDeletion
        ? "text-red-700 dark:text-red-400"
        : isAddition
          ? "text-green-700 dark:text-green-400"
          : ""
      : "";

  const prefix = isDeletion ? "-" : isAddition ? "+" : " ";

  return (
    <>
      <tr className="group/row">
        <td
          className={`sticky left-0 z-10 w-10 select-none border-r px-1.5 text-right font-mono text-xs text-muted-foreground ${stickyBg}`}
        >
          {lineNum ?? ""}
          {line && lineNum !== null && (
            <button
              onClick={() => setShowCommentForm(true)}
              className="absolute left-0 top-1/2 -translate-y-1/2 rounded px-0.5 text-blue-500 opacity-0 transition-opacity hover:bg-blue-100 dark:hover:bg-blue-900 group-hover/row:opacity-100"
              title="Add comment"
            >
              +
            </button>
          )}
        </td>
        <td className={`whitespace-pre pl-1 font-mono text-xs ${bg}`}>
          {line && (
            <span className={colorClass}>
              {prefix}
              <TokenizedLine tokens={tokens} fallback={line.content} />
            </span>
          )}
        </td>
      </tr>

      {/* Annotations / drafts -- render row on both sides to keep alignment */}
      {hasAnnotationsBelow && (
        <tr>
          <td colSpan={2} className="align-top">
            {myAnnotations.map((ann, i) => (
              <div
                key={`ann-${i}`}
                className="border-l-2 border-yellow-500 bg-yellow-500/10 px-3 py-1.5"
              >
                <div className="flex items-start gap-2">
                  <SeverityBadge severity={ann.severity} />
                  <div className="text-xs">
                    {ann.start_line !== ann.end_line && (
                      <span className="text-[10px] text-muted-foreground">
                        Lines {ann.start_line}--{ann.end_line}
                      </span>
                    )}
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
            {myDrafts.map((draft) => (
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
      {showCommentForm && (
        <tr>
          <td colSpan={2} className="border-l-2 border-blue-500 bg-blue-500/5 px-4 py-2">
            <p className="mb-1 text-[10px] text-muted-foreground">
              Comment on {side === "LEFT" ? "old" : "new"} line {lineNum}
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
});

// -- Unified diff row --------------------------------------------------------

const UnifiedDiffRow = memo(function UnifiedDiffRow({
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

  const stickyBg =
    type === "addition"
      ? "bg-green-50 dark:bg-green-950"
      : type === "deletion"
        ? "bg-red-50 dark:bg-red-950"
        : "bg-background";

  const prefix =
    type === "addition" ? "+" : type === "deletion" ? "-" : " ";

  const lineNumber =
    type === "deletion" ? oldLineNumber : newLineNumber;
  const side: "LEFT" | "RIGHT" = type === "deletion" ? "LEFT" : "RIGHT";

  const handleSubmitComment = useCallback(() => {
    if (!commentText.trim() || lineNumber === null) return;
    onAddComment(filePath, lineNumber, side, commentText.trim());
    setCommentText("");
    setShowCommentForm(false);
  }, [commentText, lineNumber, side, filePath, onAddComment]);

  return (
    <>
      <tr className={`group/row ${rowClass}`}>
        <td className={`sticky left-0 z-10 w-12 select-none border-r px-2 text-right font-mono text-xs text-muted-foreground ${stickyBg}`}>
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
        <td className={`sticky left-12 z-10 w-12 select-none border-r px-2 text-right font-mono text-xs text-muted-foreground ${stickyBg}`}>
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
                {ann.start_line !== ann.end_line && (
                  <span className="text-[10px] text-muted-foreground">
                    Lines {ann.start_line}--{ann.end_line}
                  </span>
                )}
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
});

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
