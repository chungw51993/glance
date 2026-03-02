export interface DiffLine {
  type: "addition" | "deletion" | "context";
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface ParsedFileDiff {
  hunks: DiffHunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parsePatch(patch: string | null): ParsedFileDiff {
  if (!patch) return { hunks: [] };

  const rawLines = patch.split("\n");
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of rawLines) {
    const headerMatch = raw.match(HUNK_HEADER);
    if (headerMatch) {
      currentHunk = {
        oldStart: parseInt(headerMatch[1], 10),
        oldCount: headerMatch[2] !== undefined ? parseInt(headerMatch[2], 10) : 1,
        newStart: parseInt(headerMatch[3], 10),
        newCount: headerMatch[4] !== undefined ? parseInt(headerMatch[4], 10) : 1,
        lines: [],
      };
      hunks.push(currentHunk);
      oldLine = currentHunk.oldStart;
      newLine = currentHunk.newStart;
      continue;
    }

    if (!currentHunk) continue;

    if (raw.startsWith("+")) {
      currentHunk.lines.push({
        type: "addition",
        content: raw.slice(1),
        oldLineNumber: null,
        newLineNumber: newLine,
      });
      newLine++;
    } else if (raw.startsWith("-")) {
      currentHunk.lines.push({
        type: "deletion",
        content: raw.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: null,
      });
      oldLine++;
    } else if (raw.startsWith(" ") || raw === "") {
      // Context line (or trailing empty line within a hunk)
      if (raw === "" && rawLines.indexOf(raw) === rawLines.length - 1) {
        // Skip trailing empty line at end of patch
        continue;
      }
      currentHunk.lines.push({
        type: "context",
        content: raw.startsWith(" ") ? raw.slice(1) : raw,
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      });
      oldLine++;
      newLine++;
    } else if (raw.startsWith("\\")) {
      // "\ No newline at end of file" -- skip
      continue;
    }
  }

  return { hunks };
}
