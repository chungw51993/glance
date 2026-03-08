# Glance

A desktop application for reviewing GitHub pull requests with AI-powered analysis. Built with Tauri 2 (Rust backend) and React (TypeScript frontend).

## What It Does

Glance brings your GitHub PR workflow into a native desktop app. It fetches your repositories and pull requests, displays commit-level diffs with syntax highlighting, and runs AI-powered code reviews to surface issues before you approve.

### Features

- **Repository browser** -- lists your GitHub repos with open PR counts
- **Assigned PRs view** -- shows all PRs assigned to you across repos
- **Commit-by-commit diff viewer** -- resizable split panes with syntax highlighting via Shiki
- **AI code review** -- sends diffs to an LLM and gets back structured findings with severity levels, line-pinned annotations, and fix suggestions
- **Multiple AI providers** -- Anthropic (Claude), OpenAI, or local Ollama
- **Linear integration** -- extracts Linear ticket IDs from branch names and fetches ticket context for AI review
- **PR actions** -- approve, request changes, comment, and merge directly from the app
- **Draft review comments** -- write inline comments on specific lines before submitting
- **42 code themes** -- syntax highlighting themes from Dracula to Catppuccin

## Prerequisites

| Dependency | Version | Purpose |
|------------|---------|---------|
| [Rust](https://www.rust-lang.org/tools/install) | stable (1.77+) | Tauri backend compilation |
| [Bun](https://bun.sh) | 1.0+ | Frontend package manager and runtime |
| [Tauri CLI prerequisites](https://v2.tauri.app/start/prerequisites/) | -- | Platform-specific system libraries (see link for your OS) |

### macOS specifics

Xcode Command Line Tools are required:

```
xcode-select --install
```

### API keys (configured in-app)

| Service | Required | Purpose |
|---------|----------|---------|
| GitHub personal access token | Yes | Fetch repos, PRs, diffs, submit reviews |
| Anthropic / OpenAI API key | One of these, or Ollama | AI-powered code review |
| Ollama (local) | Alternative to cloud AI | Free, local AI review |
| Linear API key | No | Fetch ticket context for richer AI reviews |

## Getting Started

### 1. Install dependencies

```bash
bun install
```

### 2. Run in development mode

```bash
bun run tauri dev
```

This starts the Vite dev server on `http://localhost:1420` and launches the Tauri window with hot-reload enabled.

### 3. Configure the app

Once the window opens, go to **Settings** (gear icon in the sidebar):

1. Add your **GitHub personal access token** (needs `repo` scope)
2. Choose an **AI provider** and add the API key:
   - **Anthropic** -- uses Claude models
   - **OpenAI** -- uses GPT models
   - **Ollama** -- point to your local Ollama instance (no API key needed)
3. Optionally add a **Linear API key** for ticket context

## Downloads

See [GitHub Releases](https://github.com/chungw51993/glance/releases) for pre-built binaries (macOS, Windows, Linux).

## Running Tests

### Frontend (Vitest + React Testing Library)

```bash
bun run test          # single run
bun run test:watch    # watch mode
```

### Backend (Cargo)

```bash
bun run test:rust
```

## Building for Production

```bash
bun run tauri build
```

This compiles the Rust backend in release mode and bundles the frontend into a native application. Output location depends on your platform:

| Platform | Output |
|----------|--------|
| macOS | `src-tauri/target/release/bundle/dmg/` |
| Windows | `src-tauri/target/release/bundle/msi/` |
| Linux | `src-tauri/target/release/bundle/deb/` or `appimage/` |

## Project Structure

```
glance/
  src/                        # React frontend
    components/
      layout/                 # App shell, sidebar navigation
      pr-review/              # Diff viewer, commit sidebar, AI summary panel
      settings/               # Provider and account configuration
      ui/                     # Shared UI primitives (ShadCN)
    hooks/                    # React hooks for GitHub, settings, review state
    pages/                    # Route-level pages (repos, assigned, review, settings)
    lib/                      # Utilities (diff parser, etc.)
    types/                    # TypeScript type definitions
  src-tauri/                  # Rust backend
    src/
      commands/               # Tauri IPC command handlers
      models/                 # Data structures (GitHub, Linear, AI providers)
      providers/              # AI provider implementations (Anthropic, OpenAI, Ollama)
      services/               # Business logic (GitHub API, Linear API, review orchestration)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop runtime | Tauri 2 |
| Backend | Rust (tokio, reqwest, serde) |
| Frontend | React 19, TypeScript, Vite 7 |
| Styling | Tailwind CSS 4, ShadCN UI |
| Syntax highlighting | Shiki (42 themes) |
| Routing | React Router 7 |
| Testing | Vitest, React Testing Library, Cargo test |
| Secure storage | tauri-plugin-store (encrypted key storage) |
