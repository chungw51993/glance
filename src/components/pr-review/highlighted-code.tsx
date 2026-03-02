import { memo, useEffect, useRef, useState } from "react";
import type { Highlighter, ThemedToken } from "shiki";
import { getLangFromPath, tokenizeLines } from "@/hooks/use-highlighter";
import type { DiffHunk } from "@/lib/diff-parser";

export interface TokenizedHunk {
  /** Tokens per line, indexed the same as the hunk's lines array. */
  lineTokens: ThemedToken[][];
}

/**
 * Hook that tokenizes all hunks for a file.
 * Returns null while loading, or an array of TokenizedHunk (one per hunk).
 *
 * Uses `patch` (the raw diff string) as the stable cache key to avoid
 * re-tokenizing on every render when the hunks array reference changes.
 */
export function useTokenizedHunks(
  filePath: string,
  hunks: DiffHunk[],
  patch: string | null,
  highlighter: Highlighter | null
): TokenizedHunk[] | null {
  const [result, setResult] = useState<TokenizedHunk[] | null>(null);
  // Keep a ref to hunks so the effect can read them without re-firing
  const hunksRef = useRef(hunks);
  hunksRef.current = hunks;

  useEffect(() => {
    if (!highlighter || !patch) {
      setResult(null);
      return;
    }

    let cancelled = false;
    const lang = getLangFromPath(filePath);
    const isDark = document.documentElement.classList.contains("dark");
    const theme = isDark ? "github-dark" : "github-light";
    const currentHunks = hunksRef.current;

    async function run() {
      const tokenized: TokenizedHunk[] = [];
      for (const hunk of currentHunks) {
        const rawLines = hunk.lines.map((l) => l.content);
        const tokens = await tokenizeLines(highlighter!, rawLines, lang, theme);
        tokenized.push({ lineTokens: tokens });
      }
      if (!cancelled) {
        setResult(tokenized);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // patch is the stable string representation of the diff content.
    // filePath determines the language. highlighter readiness triggers first run.
  }, [filePath, patch, highlighter]);

  return result;
}

/**
 * Renders a single line of code with syntax highlighting tokens.
 * Falls back to plain text if no tokens are provided.
 */
export const TokenizedLine = memo(function TokenizedLine({
  tokens,
  fallback,
}: {
  tokens: ThemedToken[] | null;
  fallback: string;
}) {
  if (!tokens || tokens.length === 0) {
    return <>{fallback}</>;
  }

  return (
    <>
      {tokens.map((token, i) => (
        <span key={i} style={token.color ? { color: token.color } : undefined}>
          {token.content}
        </span>
      ))}
    </>
  );
});
