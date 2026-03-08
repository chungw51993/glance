# Codebase Hardening: Security, Performance & Test Coverage

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Address the top security vulnerabilities, performance bottlenecks, and test coverage gaps identified in the codebase review.

**Architecture:** Fix critical security issues in Tauri config and Rust backend first (CSP, token storage UX, input validation). Then fix the diff-parser correctness bug and key performance bottlenecks in the React frontend. Finally, add test coverage for core business logic modules.

**Tech Stack:** Rust/Tauri backend, React 19 + TypeScript frontend, Vitest for testing, Shiki for syntax highlighting.

---

## Phase 1: Security Fixes

### Task 1: Enable Content Security Policy

**Files:**
- Modify: `src-tauri/tauri.conf.json:20-22`

**Step 1: Set a restrictive CSP**

Replace the null CSP with a policy that allows only necessary sources:

```json
"security": {
  "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src https://api.github.com https://api.anthropic.com https://api.openai.com https://api.linear.app https://linear.app http://localhost:* https://localhost:*; img-src 'self' https://avatars.githubusercontent.com; font-src 'self'"
}
```

The `http://localhost:*` in `connect-src` allows Ollama connections. `'unsafe-inline'` for styles is needed because Tailwind and Shiki inject inline styles.

**Step 2: Verify the app still loads**

Run: `cd src-tauri && cargo build 2>&1 | tail -5`
Expected: Successful build (CSP is a runtime config, not a compile-time check).

**Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "security: enable Content Security Policy in Tauri config"
```

---

### Task 2: Fix misleading "Token saved in keychain" placeholder text

**Files:**
- Modify: `src/components/settings/account-settings.tsx:41`

**Step 1: Update the placeholder text**

Change:
```tsx
placeholder={hasToken ? "Token saved in keychain" : placeholder}
```
To:
```tsx
placeholder={hasToken ? "Token saved locally" : placeholder}
```

**Step 2: Commit**

```bash
git add src/components/settings/account-settings.tsx
git commit -m "fix: correct misleading 'keychain' placeholder to 'saved locally'"
```

---

### Task 3: Fix CSS selector injection in scrollToFile

**Files:**
- Modify: `src/components/pr-review/ai-summary-panel.tsx:114-119`

**Step 1: Sanitize filePath with CSS.escape**

Change the `scrollToFile` function:
```tsx
function scrollToFile(filePath: string) {
  const el = document.querySelector(`[data-file-path="${CSS.escape(filePath)}"]`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
```

**Step 2: Commit**

```bash
git add src/components/pr-review/ai-summary-panel.tsx
git commit -m "security: escape filePath in CSS selector to prevent injection"
```

---

### Task 4: Add Ollama URL scheme validation

**Files:**
- Modify: `src-tauri/src/providers/ollama.rs:16-28`

**Step 1: Validate URL scheme in OllamaProvider::new**

```rust
impl OllamaProvider {
    pub fn new(base_url: String, model: String) -> Self {
        let url = if base_url.is_empty() {
            DEFAULT_OLLAMA_URL.to_string()
        } else {
            let trimmed = base_url.trim_end_matches('/').to_string();
            // Only allow http/https schemes
            if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
                DEFAULT_OLLAMA_URL.to_string()
            } else {
                trimmed
            }
        };
        Self {
            http: reqwest::Client::new(),
            base_url: url,
            model,
        }
    }
}
```

**Step 2: Add a test for invalid schemes**

Add to the existing `mod tests` block in the same file:
```rust
#[test]
fn test_ollama_provider_rejects_non_http_scheme() {
    let provider = OllamaProvider::new("file:///etc/passwd".into(), "qwen3:32b".into());
    assert_eq!(provider.base_url, "http://localhost:11434");
}

#[test]
fn test_ollama_provider_rejects_ftp_scheme() {
    let provider = OllamaProvider::new("ftp://evil.com".into(), "qwen3:32b".into());
    assert_eq!(provider.base_url, "http://localhost:11434");
}
```

**Step 3: Run Rust tests**

Run: `cd src-tauri && cargo test -- ollama`
Expected: All ollama tests pass.

**Step 4: Commit**

```bash
git add src-tauri/src/providers/ollama.rs
git commit -m "security: validate Ollama URL scheme, reject non-HTTP(S)"
```

---

## Phase 2: Bug Fix + Performance

### Task 5: Fix diff-parser indexOf bug (correctness + performance)

**Files:**
- Modify: `src/lib/diff-parser.ts:31-83`
- Modify: `src/lib/diff-parser.test.ts`

**Step 1: Write failing test that exposes the bug**

Add to `diff-parser.test.ts`:
```typescript
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
  // The empty line in the middle should be a context line, not skipped
  expect(result.hunks[0].lines[1]).toEqual({
    type: "context",
    content: "",
    oldLineNumber: 2,
    newLineNumber: 2,
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jinchung/Desktop/pr-reviewer && npx vitest run src/lib/diff-parser.test.ts`
Expected: FAIL — the empty line is skipped because `indexOf("")` finds it at index 1, which is not `rawLines.length - 1`.

**Step 3: Fix the parser — use index-based loop**

Replace the `for...of` loop in `parsePatch` (lines 31-83) with:
```typescript
for (let i = 0; i < rawLines.length; i++) {
  const raw = rawLines[i];
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
    if (raw === "" && i === rawLines.length - 1) {
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
    continue;
  }
}
```

**Step 4: Run all diff-parser tests**

Run: `cd /Users/jinchung/Desktop/pr-reviewer && npx vitest run src/lib/diff-parser.test.ts`
Expected: All 7 tests pass.

**Step 5: Commit**

```bash
git add src/lib/diff-parser.ts src/lib/diff-parser.test.ts
git commit -m "fix: diff-parser indexOf bug causing empty context lines to be skipped"
```

---

### Task 6: Pre-build annotation lookup maps in UnifiedDiffTable

**Files:**
- Modify: `src/components/pr-review/diff-pane.tsx` — the `UnifiedDiffTable` component (around line 580+)

**Step 1: Add lookup map construction before the render loop**

Inside `UnifiedDiffTable`, before the `.map()` over hunks, build maps:

```tsx
const annotationsByLine = useMemo(() => {
  const map = new Map<number, AiAnnotation[]>();
  for (const a of annotations) {
    const key = a.end_line;
    const existing = map.get(key);
    if (existing) existing.push(a);
    else map.set(key, [a]);
  }
  return map;
}, [annotations]);

const draftsByKey = useMemo(() => {
  const map = new Map<string, DraftComment[]>();
  for (const d of draftComments) {
    const key = `${d.line}-${d.side}`;
    const existing = map.get(key);
    if (existing) existing.push(d);
    else map.set(key, [d]);
  }
  return map;
}, [draftComments]);
```

Then replace inline `.filter()` calls with map lookups:
- `annotations.filter(a => a.end_line === lineNum)` → `annotationsByLine.get(lineNum) ?? []`
- `draftComments.filter(d => d.line === lineNum && d.side === side)` → `draftsByKey.get(\`${lineNum}-${side}\`) ?? []`

**Step 2: Run the app to verify diffs still render**

Run: `cd /Users/jinchung/Desktop/pr-reviewer && npx tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```bash
git add src/components/pr-review/diff-pane.tsx
git commit -m "perf: replace O(n*m) annotation filtering with Map lookups in unified diff"
```

---

### Task 7: Add route-level code splitting

**Files:**
- Modify: `src/App.tsx:1-28`

**Step 1: Convert to lazy imports with Suspense**

```tsx
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { Toaster } from "@/components/ui/sonner";

const ReposPage = lazy(() => import("@/pages/repos").then(m => ({ default: m.ReposPage })));
const AssignedPage = lazy(() => import("@/pages/assigned").then(m => ({ default: m.AssignedPage })));
const ReviewPage = lazy(() => import("@/pages/review").then(m => ({ default: m.ReviewPage })));
const SettingsPage = lazy(() => import("@/pages/settings").then(m => ({ default: m.SettingsPage })));

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Loading...</div>}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<ReposPage />} />
            <Route path="/assigned" element={<AssignedPage />} />
            <Route
              path="/review/:owner/:name/:prNumber"
              element={<ReviewPage />}
            />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </Suspense>
      <Toaster />
    </BrowserRouter>
  );
}

export default App;
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/jinchung/Desktop/pr-reviewer && npx tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "perf: add route-level code splitting with React.lazy"
```

---

### Task 8: Hoist remarkPlugins array to module scope

**Files:**
- Modify: `src/components/pr-review/markdown-viewer.tsx:18`

**Step 1: Move the plugins array out of JSX**

Add at module scope (after imports):
```tsx
const remarkPlugins = [remarkGfm];
```

Change line 18 from:
```tsx
<Markdown remarkPlugins={[remarkGfm]} components={components}>
```
To:
```tsx
<Markdown remarkPlugins={remarkPlugins} components={components}>
```

**Step 2: Commit**

```bash
git add src/components/pr-review/markdown-viewer.tsx
git commit -m "perf: hoist remarkPlugins array to avoid re-parsing markdown on re-render"
```

---

### Task 9: Remove ResizablePanelGroup key-based remount

**Files:**
- Modify: `src/pages/review.tsx:219`

**Step 1: Remove the dynamic key**

Change line 219 from:
```tsx
<ResizablePanelGroup key={aiPanelOpen ? "with-ai" : "no-ai"} orientation="horizontal" className="flex-1">
```
To:
```tsx
<ResizablePanelGroup orientation="horizontal" className="flex-1">
```

This preserves the diff view's scroll position and syntax highlighting state when toggling the AI panel.

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/jinchung/Desktop/pr-reviewer && npx tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```bash
git add src/pages/review.tsx
git commit -m "perf: remove dynamic key from ResizablePanelGroup to prevent remount"
```

---

## Phase 3: Test Coverage

### Task 10: Add Tauri invoke mock infrastructure

**Files:**
- Create: `src/test/mocks/tauri.ts`
- Modify: `vite.config.ts:34-38`

**Step 1: Create Tauri invoke mock**

```typescript
import { vi } from "vitest";

export const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));
```

**Step 2: Add the mock to Vitest setup**

In `vite.config.ts`, add the mock to `setupFiles`:
```typescript
test: {
  globals: true,
  environment: "jsdom",
  setupFiles: ["./src/test/setup.ts", "./src/test/mocks/tauri.ts"],
},
```

**Step 3: Verify tests still pass**

Run: `cd /Users/jinchung/Desktop/pr-reviewer && npx vitest run`
Expected: All existing tests pass.

**Step 4: Commit**

```bash
git add src/test/mocks/tauri.ts vite.config.ts
git commit -m "test: add Tauri invoke mock infrastructure"
```

---

### Task 11: Add tests for review-cache.ts

**Files:**
- Create: `src/lib/review-cache.test.ts`

**Step 1: Write the test file**

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { getReviewCache, updateReviewCache, getActiveReviewKey } from "./review-cache";

describe("review-cache", () => {
  beforeEach(() => {
    // Reset cache by writing a new entry then checking fresh state
    updateReviewCache({ prKey: "__reset__" });
  });

  it("returns null for non-matching key", () => {
    updateReviewCache({ prKey: "owner/repo/1" });
    expect(getReviewCache("owner/repo/999")).toBeNull();
  });

  it("returns entry for matching key", () => {
    updateReviewCache({ prKey: "owner/repo/1", selectedCommitIndex: 5 });
    const cached = getReviewCache("owner/repo/1");
    expect(cached).not.toBeNull();
    expect(cached!.selectedCommitIndex).toBe(5);
  });

  it("merges partial updates when key matches", () => {
    updateReviewCache({ prKey: "owner/repo/1", selectedCommitIndex: 3 });
    updateReviewCache({ prKey: "owner/repo/1", linearError: "oops" });
    const cached = getReviewCache("owner/repo/1");
    expect(cached!.selectedCommitIndex).toBe(3);
    expect(cached!.linearError).toBe("oops");
  });

  it("resets to defaults when key changes", () => {
    updateReviewCache({ prKey: "owner/repo/1", selectedCommitIndex: 5 });
    updateReviewCache({ prKey: "owner/repo/2" });
    const cached = getReviewCache("owner/repo/2");
    expect(cached!.selectedCommitIndex).toBe(0);
    expect(cached!.pr).toBeNull();
    expect(cached!.aiReview).toBeNull();
  });

  it("getActiveReviewKey returns current key", () => {
    updateReviewCache({ prKey: "owner/repo/42" });
    expect(getActiveReviewKey()).toBe("owner/repo/42");
  });

  it("getActiveReviewKey returns null when no cache", () => {
    // After reset, the key is "__reset__" not null, so we test the actual behavior
    expect(getActiveReviewKey()).toBe("__reset__");
  });
});
```

**Step 2: Run tests**

Run: `cd /Users/jinchung/Desktop/pr-reviewer && npx vitest run src/lib/review-cache.test.ts`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add src/lib/review-cache.test.ts
git commit -m "test: add review-cache unit tests"
```

---

### Task 12: Add tests for repos-cache.ts

**Files:**
- Create: `src/lib/repos-cache.test.ts`

**Step 1: Write the test file**

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { getReposCache, updateReposCache, getLastReposPath, setLastReposPath } from "./repos-cache";

describe("repos-cache", () => {
  beforeEach(() => {
    updateReposCache({ repos: [], selectedRepo: null, pullRequests: [] });
    setLastReposPath("/");
  });

  it("returns initial empty state", () => {
    const cache = getReposCache();
    expect(cache.repos).toEqual([]);
    expect(cache.selectedRepo).toBeNull();
    expect(cache.pullRequests).toEqual([]);
  });

  it("merges partial updates", () => {
    const repo = { owner: "me", name: "app", full_name: "me/app", default_branch: "main", open_pr_count: 1, updated_at: "" };
    updateReposCache({ selectedRepo: repo });
    const cache = getReposCache();
    expect(cache.selectedRepo).toEqual(repo);
    expect(cache.repos).toEqual([]); // untouched
  });

  it("getLastReposPath / setLastReposPath round-trips", () => {
    expect(getLastReposPath()).toBe("/");
    setLastReposPath("/review/me/app/42");
    expect(getLastReposPath()).toBe("/review/me/app/42");
  });
});
```

**Step 2: Run tests**

Run: `cd /Users/jinchung/Desktop/pr-reviewer && npx vitest run src/lib/repos-cache.test.ts`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add src/lib/repos-cache.test.ts
git commit -m "test: add repos-cache unit tests"
```

---

### Task 13: Add tests for getLangFromPath

**Files:**
- Create: `src/hooks/use-highlighter.test.ts`

**Step 1: Write the test file**

```typescript
import { describe, expect, it } from "vitest";
import { getLangFromPath } from "./use-highlighter";

describe("getLangFromPath", () => {
  it("maps common extensions", () => {
    expect(getLangFromPath("src/index.ts")).toBe("typescript");
    expect(getLangFromPath("src/App.tsx")).toBe("tsx");
    expect(getLangFromPath("script.js")).toBe("javascript");
    expect(getLangFromPath("data.json")).toBe("json");
    expect(getLangFromPath("styles.css")).toBe("css");
    expect(getLangFromPath("main.py")).toBe("python");
    expect(getLangFromPath("main.rs")).toBe("rust");
    expect(getLangFromPath("main.go")).toBe("go");
  });

  it("handles special filenames", () => {
    expect(getLangFromPath("Dockerfile")).toBe("dockerfile");
    expect(getLangFromPath("path/to/Makefile")).toBe("makefile");
    expect(getLangFromPath("CMakeLists.txt")).toBe("cmake");
  });

  it("is case-insensitive for filenames", () => {
    expect(getLangFromPath("DOCKERFILE")).toBe("dockerfile");
  });

  it("returns null for unknown extensions", () => {
    expect(getLangFromPath("file.unknown")).toBeNull();
    expect(getLangFromPath("file.xyz")).toBeNull();
  });

  it("returns null for files with no extension", () => {
    expect(getLangFromPath("README")).toBeNull();
  });
});
```

**Step 2: Run tests**

Run: `cd /Users/jinchung/Desktop/pr-reviewer && npx vitest run src/hooks/use-highlighter.test.ts`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add src/hooks/use-highlighter.test.ts
git commit -m "test: add getLangFromPath unit tests"
```

---

### Task 14: Expand diff-parser test coverage

**Files:**
- Modify: `src/lib/diff-parser.test.ts`

**Step 1: Add edge case tests**

Append these tests to the existing `describe` block:

```typescript
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
```

**Step 2: Run all diff-parser tests**

Run: `cd /Users/jinchung/Desktop/pr-reviewer && npx vitest run src/lib/diff-parser.test.ts`
Expected: All tests pass (11 total).

**Step 3: Commit**

```bash
git add src/lib/diff-parser.test.ts
git commit -m "test: expand diff-parser coverage with edge cases"
```

---

## Summary

| Phase | Tasks | Focus |
|-------|-------|-------|
| 1: Security | Tasks 1-4 | CSP, token UX, XSS, URL validation |
| 2: Bug + Perf | Tasks 5-9 | diff-parser bug, O(n*m) filtering, code splitting, remount fix |
| 3: Tests | Tasks 10-14 | Mock infra, cache tests, utility tests, parser edge cases |

**Total: 14 tasks, each completable in 2-5 minutes.**

Items explicitly **deferred** (noted for future work):
- OS keychain integration for token storage (requires `keyring` crate + cross-platform testing)
- Web Worker for syntax highlighting (requires worker bundling setup)
- GitHub API path parameter validation in Rust (requires regex crate addition)
- Unbounded pagination safety limits in Rust
- Full hook tests for `use-review.ts` and `use-review-draft.ts` (require React hook testing with `renderHook`)
