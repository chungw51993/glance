import { useEffect, useRef, useState } from "react";
import {
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
  type ThemedToken,
} from "shiki";

/** Map file extensions to shiki language IDs. */
const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  rs: "rust",
  py: "python",
  go: "go",
  rb: "ruby",
  java: "java",
  kt: "kotlin",
  cs: "csharp",
  cpp: "cpp",
  cc: "cpp",
  c: "c",
  h: "c",
  hpp: "cpp",
  swift: "swift",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  md: "markdown",
  mdx: "mdx",
  html: "html",
  css: "css",
  scss: "scss",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  dockerfile: "dockerfile",
  xml: "xml",
  vue: "vue",
  svelte: "svelte",
  graphql: "graphql",
  gql: "graphql",
  tf: "hcl",
  hcl: "hcl",
  lua: "lua",
  zig: "zig",
  proto: "proto",
};

/** Commonly used languages to preload. Others are loaded on demand. */
const PRELOAD_LANGS = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "rust",
  "python",
  "go",
  "json",
  "yaml",
  "html",
  "css",
  "bash",
  "sql",
  "markdown",
];

let highlighterPromise: Promise<Highlighter> | null = null;

const ALL_THEMES = [
  "github-dark",
  "github-light",
  "one-dark-pro",
  "dracula",
  "nord",
  "min-light",
  "solarized-dark",
  "solarized-light",
  "monokai",
  "slack-dark",
  "vitesse-dark",
  "vitesse-light",
] as const;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [...ALL_THEMES],
      langs: PRELOAD_LANGS,
    });
  }
  return highlighterPromise;
}

export function useHighlighter() {
  const [ready, setReady] = useState(false);
  const hlRef = useRef<Highlighter | null>(null);

  useEffect(() => {
    let cancelled = false;
    getHighlighter().then((hl) => {
      if (!cancelled) {
        hlRef.current = hl;
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { highlighter: hlRef.current, ready };
}

/** Resolve a file path to a shiki language ID, or null if unsupported. */
export function getLangFromPath(filePath: string): string | null {
  const parts = filePath.split("/");
  const filename = parts[parts.length - 1].toLowerCase();

  // Handle special filenames
  if (filename === "dockerfile") return "dockerfile";
  if (filename === "makefile") return "makefile";
  if (filename === "cmakelists.txt") return "cmake";

  const ext = filename.split(".").pop();
  if (!ext) return null;
  return EXT_TO_LANG[ext] ?? null;
}

export type { ThemedToken };

/**
 * Tokenize a block of lines for a given language.
 * Returns an array of token arrays, one per input line.
 * Falls back to untokenized content if the language is unsupported.
 */
export async function tokenizeLines(
  highlighter: Highlighter,
  lines: string[],
  lang: string | null,
  theme: string
): Promise<ThemedToken[][]> {
  if (!lang || lines.length === 0) {
    // Return plain tokens with no color info
    return lines.map((line) => [{ content: line, offset: 0 }] as ThemedToken[]);
  }

  // Load language on demand if not preloaded
  const loadedLangs = highlighter.getLoadedLanguages();
  if (!loadedLangs.includes(lang)) {
    try {
      await highlighter.loadLanguage(lang as BundledLanguage);
    } catch {
      // Language not supported by shiki -- fall back to plain text
      return lines.map((line) => [{ content: line, offset: 0 }] as ThemedToken[]);
    }
  }

  const code = lines.join("\n");
  const result = highlighter.codeToTokens(code, { lang: lang as BundledLanguage, theme });
  return result.tokens;
}
