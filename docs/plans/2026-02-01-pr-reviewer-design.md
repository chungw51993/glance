# PR Reviewer Desktop Tool -- Design Document

Date: 2026-02-01

## Summary

A desktop code review tool that connects to GitHub via PAT, displays PRs
commit-by-commit, enriches commits with Linear ticket context, and provides
AI-powered review analysis with inline annotations and a summary panel.

## Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 |
| Frontend | React, TypeScript, Tailwind, ShadCN |
| Backend | Rust (Tauri commands) |
| External services | GitHub REST API, Linear GraphQL API, AI providers (Claude-first, pluggable) |

## Architecture

Three-layer design:

1. **React frontend** -- UI rendering, state management, user interactions.
2. **Rust bridge (Tauri commands)** -- secure API calls, token storage in OS
   keychain, diff processing, AI prompt construction, merge detection.
3. **External services** -- GitHub API, Linear API, AI providers.

All secrets (PATs, AI keys) stored in OS keychain via Tauri secure storage.
Tokens never touch the frontend JavaScript context. No local database for v1;
all data fetched live and held in React state.

### Data Flow

```
React UI
  --> Tauri invoke("fetch_pr", { repo, pr_number })
    --> Rust: GitHub API call (token from OS keychain)
    --> Rust: parse commits, detect merges, extract ticket prefixes
    --> Rust: Linear API call for matched tickets (if configured)
    --> Return structured PR data to frontend

React UI
  --> Tauri invoke("analyze_pr", { pr_data, provider })
    --> Rust: build prompt with diffs + Linear context
    --> Rust: stream AI response back to frontend
    --> Frontend renders summary + inline annotations
```

## Data Model

| Struct | Key Fields |
|--------|------------|
| `Repo` | `owner`, `name`, `default_branch`, `open_pr_count` |
| `PullRequest` | `number`, `title`, `author`, `base_branch`, `head_branch`, `commits: Vec<Commit>`, `linear_tickets: Vec<LinearTicket>` |
| `Commit` | `sha`, `message`, `author`, `timestamp`, `is_merge`, `merge_source: Option<String>`, `ticket_prefix: Option<String>`, `files: Vec<FileDiff>` |
| `FileDiff` | `path`, `status` (added/modified/deleted), `hunks: Vec<Hunk>`, `annotations: Vec<AiAnnotation>` |
| `LinearTicket` | `id`, `title`, `description`, `acceptance_criteria`, `status`, `labels` |
| `AiAnnotation` | `file_path`, `line_range`, `severity` (info/warning/critical), `message`, `suggestion: Option<String>` |
| `AiReviewSummary` | `overall_assessment`, `findings: Vec<AiAnnotation>`, `recommendations: Vec<String>`, `risk_level` |

## UI Layout

### Three screens

1. **Repo browser** -- list repos, see open PRs, click to review.
2. **PR review** -- main workspace with commit sidebar, diff pane, AI panel.
3. **Settings** -- PAT management, AI provider config, preferences.

### PR Review Screen

```
+----------------------------------------------+
|  PR Title                        [AI Review] |
|  #142 by @author  .  main <- feature/xyz     |
+----------+-----------------------------------+
| Commits  |  Diff Pane                        |
|          |                                   |
| [1] feat |  file.ts                          |
| [2] fix  |  - old line                       |
| [3]^skip |  + new line                       |
| [4] ref  |                                   |
|          |  [AI] Consider null check here     |
|  < 2/4 > |                                   |
+----------+-----------------------------------+
| Linear: CPT-142 -- Add export button         |
+----------------------------------------------+
```

- **Left sidebar:** commit list with Linear badges, trunk merge dimming,
  show/hide toggle.
- **Diff pane:** unified or split diff with inline AI annotations
  (collapsible).
- **Bottom bar:** Linear ticket context for current commit.
- **AI Review button:** opens slide-over summary panel with clickable
  references to inline annotations.
- **Next/prev navigation:** sequential commit walkthrough with adjusted
  count when merges are hidden.

## GitHub Integration

- Authentication: Personal Access Token (PAT).
- Required scopes: `repo`, `read:org`.
- Read-only -- no write access needed.
- Endpoints: `/user/repos`, `/user/orgs`, `/orgs/{org}/repos`,
  `/repos/{owner}/{repo}/pulls`, `/repos/{owner}/{repo}/pulls/{n}/commits`,
  `/repos/{owner}/{repo}/commits/{sha}`.
- Rate limiting tracked per-token with backoff in Rust.

## Linear Integration

- Optional enrichment. App works without it.
- Authentication: Personal Access Token.
- Ticket prefix extraction via regex: `([A-Z]{2,10})-(\d+)`.
- Matches: CPT-1234, DATA-234, AI-2341, ALPHA-234, etc.
- Deduplicated across all commits, batch-fetched via GraphQL.

## Merge Commit Detection

Two signals combined:

1. GitHub API `parents` array -- commits with 2+ parents are merges.
2. Message pattern matching: `Merge branch '(main|master|develop|next)'` or
   `Merge pull request` from the default branch.

If a merge commit's non-head parent is on the repo's `default_branch`, it is
flagged as a trunk merge. Auto-detected with user toggle to show/hide.

## AI Review Pipeline

### Two-phase analysis (single API call)

1. **Full PR summary** -- overall assessment, risk level, recommendations.
2. **Inline annotations** -- findings pinned to file:line with severity.

### Prompt construction

1. System prompt: role, review guidelines, output format (JSON schema).
2. PR metadata: title, author, base/head branches, file count.
3. Linear context (if available): ticket descriptions, acceptance criteria.
4. Diffs: filtered (trunk merges excluded if toggle is on).
5. Instruction: analyze for correctness, security, performance,
   maintainability.

### Context window management

| Strategy | When |
|----------|------|
| Full context | Total diff < 100k tokens |
| Prioritized truncation | 100k-180k tokens -- truncate tests, generated code, lock files |
| Chunked review | >180k tokens -- split by file groups, multiple calls, merge in Rust |

### Provider abstraction

```rust
trait AiProvider {
    async fn review(&self, prompt: ReviewPrompt) -> Result<ReviewResponse>;
    fn max_context_tokens(&self) -> usize;
    fn name(&self) -> &str;
}
```

Claude-first. OpenAI stub for v1. Frontend provider-agnostic.

Streaming via Tauri events for real-time response rendering.

## Settings

| Section | Fields |
|---------|--------|
| Accounts | GitHub PAT, Linear PAT (optional). Masked input, OS keychain storage, test connection button. |
| AI Provider | Provider dropdown, API key, model selection. |
| Preferences | Default diff view (unified/split), auto-hide trunk merges (default on), trunk branch override. |

## First-Run Experience

1. Welcome screen with connection cards (not a wizard).
2. GitHub PAT input with link to token creation (scopes pre-filled).
3. Linear PAT (optional, skippable).
4. AI provider config.
5. Once GitHub connected, straight to repo browser.

Each card independently completable. No mandatory ordering.

## Project Structure

```
pr-reviewer/
  src-tauri/
    src/
      main.rs
      commands/     -- Tauri-exposed functions (thin, call services)
      providers/    -- AiProvider trait + implementations
      models/       -- Data structs mirroring the data model above
      services/     -- merge_detection, ticket_extraction, token_manager
      utils/        -- Token counting
    Cargo.toml
    tauri.conf.json
  src/
    app/            -- Layout and routing
    components/     -- Per-screen component folders
    hooks/          -- Tauri invoke wrappers
    lib/            -- Typed invoke helpers
    types/          -- TypeScript types mirroring Rust models
  package.json
  tsconfig.json
  tailwind.config.ts
```
