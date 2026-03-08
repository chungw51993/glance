import { describe, expect, it } from "vitest";
import { parsePatch } from "./diff-parser";

describe("parsePatch", () => {
  it("returns empty hunks for null input", () => {
    const result = parsePatch(null);
    expect(result.hunks).toEqual([]);
  });

  it("returns empty hunks for empty string", () => {
    const result = parsePatch("");
    expect(result.hunks).toEqual([]);
  });

  it("parses a single hunk with additions and deletions", () => {
    const patch = [
      "@@ -1,3 +1,4 @@",
      " line one",
      "-old line",
      "+new line",
      "+extra line",
      " line three",
    ].join("\n");

    const result = parsePatch(patch);
    expect(result.hunks).toHaveLength(1);

    const hunk = result.hunks[0];
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldCount).toBe(3);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newCount).toBe(4);
    expect(hunk.lines).toHaveLength(5);

    expect(hunk.lines[0]).toEqual({
      type: "context",
      content: "line one",
      oldLineNumber: 1,
      newLineNumber: 1,
    });
    expect(hunk.lines[1]).toEqual({
      type: "deletion",
      content: "old line",
      oldLineNumber: 2,
      newLineNumber: null,
    });
    expect(hunk.lines[2]).toEqual({
      type: "addition",
      content: "new line",
      oldLineNumber: null,
      newLineNumber: 2,
    });
    expect(hunk.lines[3]).toEqual({
      type: "addition",
      content: "extra line",
      oldLineNumber: null,
      newLineNumber: 3,
    });
    expect(hunk.lines[4]).toEqual({
      type: "context",
      content: "line three",
      oldLineNumber: 3,
      newLineNumber: 4,
    });
  });

  it("parses multiple hunks", () => {
    const patch = [
      "@@ -1,2 +1,2 @@",
      "-old",
      "+new",
      " ctx",
      "@@ -10,2 +10,3 @@",
      " before",
      "+inserted",
      " after",
    ].join("\n");

    const result = parsePatch(patch);
    expect(result.hunks).toHaveLength(2);
    expect(result.hunks[0].oldStart).toBe(1);
    expect(result.hunks[1].oldStart).toBe(10);
    expect(result.hunks[1].lines).toHaveLength(3);
  });

  it("handles hunk header without comma (single line)", () => {
    const patch = ["@@ -1 +1 @@", "-old", "+new"].join("\n");

    const result = parsePatch(patch);
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0].oldCount).toBe(1);
    expect(result.hunks[0].newCount).toBe(1);
  });

  it("handles empty context lines in the middle of a hunk", () => {
    const patch = [
      "@@ -1,5 +1,5 @@",
      " first",
      "",
      " third",
      "-old",
      "+new",
    ].join("\n");

    const result = parsePatch(patch);
    expect(result.hunks[0].lines).toHaveLength(5);
    expect(result.hunks[0].lines[1]).toEqual({
      type: "context",
      content: "",
      oldLineNumber: 2,
      newLineNumber: 2,
    });
  });

  it("skips 'no newline at end of file' markers", () => {
    const patch = [
      "@@ -1,2 +1,2 @@",
      "-old",
      "\\ No newline at end of file",
      "+new",
    ].join("\n");

    const result = parsePatch(patch);
    expect(result.hunks[0].lines).toHaveLength(2);
  });

  it("handles hunk header with function context", () => {
    const patch = [
      "@@ -10,3 +10,3 @@ function foo() {",
      " before",
      "-old",
      "+new",
    ].join("\n");

    const result = parsePatch(patch);
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0].oldStart).toBe(10);
  });

  it("ignores lines before the first hunk header", () => {
    const patch = [
      "diff --git a/file.ts b/file.ts",
      "index abc123..def456 100644",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,2 +1,2 @@",
      "-old",
      "+new",
      " ctx",
    ].join("\n");

    const result = parsePatch(patch);
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0].lines).toHaveLength(3);
  });

  it("handles trailing newline at end of patch", () => {
    const patch = "@@ -1,1 +1,1 @@\n-old\n+new\n";

    const result = parsePatch(patch);
    expect(result.hunks[0].lines).toHaveLength(2);
  });

  it("handles zero-count old side (new file)", () => {
    const patch = [
      "@@ -0,0 +1,2 @@",
      "+line one",
      "+line two",
    ].join("\n");

    const result = parsePatch(patch);
    expect(result.hunks[0].oldStart).toBe(0);
    expect(result.hunks[0].oldCount).toBe(0);
    expect(result.hunks[0].lines).toHaveLength(2);
  });
});
