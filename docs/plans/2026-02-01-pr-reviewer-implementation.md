# PR Reviewer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Tauri v2 + React desktop app that connects to GitHub, displays PRs commit-by-commit with Linear context, and provides AI-powered code review.

**Architecture:** Three-layer Tauri app. React/TypeScript frontend with ShadCN/Tailwind. Rust backend handling GitHub API, Linear GraphQL API, and AI provider calls. All secrets in OS keychain. No local database.

**Tech Stack:** Tauri v2, React 18, TypeScript, Tailwind CSS, ShadCN UI, Rust, reqwest, serde, Anthropic API (Claude-first, pluggable)

**Design doc:** `docs/plans/2026-02-01-pr-reviewer-design.md`

---

## Task 1: Scaffold Tauri + React Project

**Files:**
- Create: entire project scaffold via `bunx create-tauri-app`
- Modify: `src-tauri/Cargo.toml` (add dependencies)
- Modify: `src-tauri/tauri.conf.json` (app metadata)
- Modify: `package.json` (add dev deps)

**Step 1: Create the Tauri project**

Run the scaffolder interactively:

```bash
cd /Users/jinchung/Desktop
bunx create-tauri-app pr-reviewer
```

Select: TypeScript, bun, React, TypeScript.

If the directory already exists from our design doc commit, remove the docs folder temporarily, scaffold, then move it back.

Alternatively, scaffold into a temp name and move files.

**Step 2: Add Rust dependencies to Cargo.toml**

In `src-tauri/Cargo.toml`, add under `[dependencies]`:

```toml
serde = { version = "1", features = ["derive"] }
serde_json = "1"
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
tokio = { version = "1", features = ["full"] }
regex = "1"
chrono = { version = "0.4", features = ["serde"] }
thiserror = "2"
async-trait = "0.1"
```

**Step 3: Add frontend dev dependencies**

```bash
cd /Users/jinchung/Desktop/pr-reviewer
bun add -d vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
bun add @tauri-apps/api react-router-dom
bun add -d @types/react-router-dom
```

**Step 4: Add ShadCN + Tailwind**

```bash
bunx --bun shadcn@latest init
```

Select defaults. Then add components we'll need:

```bash
bunx --bun shadcn@latest add button input card badge scroll-area separator tabs sheet dialog alert toggle-group tooltip
```

**Step 5: Configure vitest**

Add to `vite.config.ts`:

```typescript
/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

Create `src/test/setup.ts`:

```typescript
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
});
```

Add to `package.json` scripts:

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:rust": "cd src-tauri && cargo test"
}
```

**Step 6: Update tauri.conf.json**

Set `productName` to `"PR Reviewer"`, `identifier` to `"com.pr-reviewer.app"`, window title to `"PR Reviewer"`, width to 1200, height to 800.

**Step 7: Verify scaffold builds**

```bash
cd /Users/jinchung/Desktop/pr-reviewer
bun run build
cd src-tauri && cargo check
```

**Step 8: Commit**

```bash
git add -A
git commit -m "PR-1: scaffold Tauri v2 + React + TypeScript project with deps"
```

---

## Task 2: Rust Data Models

**Files:**
- Create: `src-tauri/src/models/mod.rs`
- Create: `src-tauri/src/models/github.rs`
- Create: `src-tauri/src/models/linear.rs`
- Create: `src-tauri/src/models/review.rs`
- Modify: `src-tauri/src/main.rs` or `src-tauri/src/lib.rs` (add mod)
- Test: inline `#[cfg(test)]` modules

**Step 1: Write tests for GitHub models**

In `src-tauri/src/models/github.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_commit_is_merge_with_multiple_parents() {
        let commit = Commit {
            sha: "abc123".into(),
            message: "Merge branch 'main' into feature".into(),
            author: "dev".into(),
            timestamp: "2026-01-01T00:00:00Z".into(),
            parents: vec!["parent1".into(), "parent2".into()],
            is_trunk_merge: false,
            ticket_prefix: None,
            files: vec![],
        };
        assert!(commit.has_multiple_parents());
    }

    #[test]
    fn test_file_diff_status_display() {
        assert_eq!(FileStatus::Added.as_str(), "added");
        assert_eq!(FileStatus::Modified.as_str(), "modified");
        assert_eq!(FileStatus::Removed.as_str(), "removed");
    }
}
```

**Step 2: Run test to verify it fails**

```bash
cd src-tauri && cargo test
```

Expected: FAIL -- module and structs don't exist yet.

**Step 3: Implement GitHub models**

```rust
// src-tauri/src/models/github.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Repo {
    pub owner: String,
    pub name: String,
    pub full_name: String,
    pub default_branch: String,
    pub open_pr_count: u32,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    pub author: String,
    pub base_branch: String,
    pub head_branch: String,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
    pub commits: Vec<Commit>,
    pub linear_tickets: Vec<super::linear::LinearTicket>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Commit {
    pub sha: String,
    pub message: String,
    pub author: String,
    pub timestamp: String,
    pub parents: Vec<String>,
    pub is_trunk_merge: bool,
    pub ticket_prefix: Option<String>,
    pub files: Vec<FileDiff>,
}

impl Commit {
    pub fn has_multiple_parents(&self) -> bool {
        self.parents.len() > 1
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiff {
    pub path: String,
    pub status: FileStatus,
    pub additions: u32,
    pub deletions: u32,
    pub patch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Added,
    Modified,
    Removed,
    Renamed,
}

impl FileStatus {
    pub fn as_str(&self) -> &str {
        match self {
            FileStatus::Added => "added",
            FileStatus::Modified => "modified",
            FileStatus::Removed => "removed",
            FileStatus::Renamed => "renamed",
        }
    }
}
```

**Step 4: Implement Linear models**

```rust
// src-tauri/src/models/linear.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearTicket {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub state: String,
    pub labels: Vec<String>,
    pub url: String,
}
```

**Step 5: Implement review models**

```rust
// src-tauri/src/models/review.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiAnnotation {
    pub file_path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub severity: Severity,
    pub message: String,
    pub suggestion: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Info,
    Warning,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiReviewSummary {
    pub overall_assessment: String,
    pub risk_level: RiskLevel,
    pub findings: Vec<AiAnnotation>,
    pub recommendations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}
```

**Step 6: Wire up mod.rs**

```rust
// src-tauri/src/models/mod.rs
pub mod github;
pub mod linear;
pub mod review;
```

Add `mod models;` to `lib.rs`.

**Step 7: Run tests**

```bash
cd src-tauri && cargo test
```

Expected: PASS

**Step 8: Commit**

```bash
git add src-tauri/src/models/
git commit -m "PR-1: add Rust data models for GitHub, Linear, and AI review"
```

---

## Task 3: Ticket Extraction Service

**Files:**
- Create: `src-tauri/src/services/mod.rs`
- Create: `src-tauri/src/services/ticket_extraction.rs`
- Test: inline `#[cfg(test)]`

**Step 1: Write failing tests**

```rust
// src-tauri/src/services/ticket_extraction.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_single_prefix() {
        let prefixes = extract_ticket_prefixes("CPT-1234: fix login bug");
        assert_eq!(prefixes, vec!["CPT-1234"]);
    }

    #[test]
    fn test_extract_multiple_prefixes() {
        let prefixes = extract_ticket_prefixes("CPT-1234 DATA-567: combined fix");
        assert_eq!(prefixes, vec!["CPT-1234", "DATA-567"]);
    }

    #[test]
    fn test_extract_various_formats() {
        assert_eq!(extract_ticket_prefixes("AI-2341: stuff"), vec!["AI-2341"]);
        assert_eq!(extract_ticket_prefixes("ALPHA-234: stuff"), vec!["ALPHA-234"]);
        assert_eq!(extract_ticket_prefixes("no ticket here"), Vec::<String>::new());
    }

    #[test]
    fn test_deduplicate_across_messages() {
        let messages = vec![
            "CPT-1234: first commit".to_string(),
            "CPT-1234: second commit".to_string(),
            "DATA-567: third commit".to_string(),
        ];
        let all = deduplicate_tickets(&messages);
        assert_eq!(all, vec!["CPT-1234", "DATA-567"]);
    }
}
```

**Step 2: Run test to verify failure**

```bash
cd src-tauri && cargo test services::ticket_extraction
```

**Step 3: Implement extraction**

```rust
// src-tauri/src/services/ticket_extraction.rs
use regex::Regex;
use std::collections::LinkedHashSet;

pub fn extract_ticket_prefixes(message: &str) -> Vec<String> {
    let re = Regex::new(r"([A-Z]{2,10})-(\d+)").unwrap();
    re.find_iter(message)
        .map(|m| m.as_str().to_string())
        .collect()
}

pub fn deduplicate_tickets(messages: &[String]) -> Vec<String> {
    let mut seen = LinkedHashSet::new();
    for msg in messages {
        for ticket in extract_ticket_prefixes(msg) {
            seen.insert(ticket);
        }
    }
    seen.into_iter().collect()
}
```

Note: `LinkedHashSet` needs the `linked-hash-set` crate, or use `IndexSet` from `indexmap`. Add `indexmap = "2"` to Cargo.toml and use `IndexSet` instead.

**Step 4: Run tests**

```bash
cd src-tauri && cargo test services::ticket_extraction
```

Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/src/services/
git commit -m "PR-1: add ticket prefix extraction service with regex parsing"
```

---

## Task 4: Merge Detection Service

**Files:**
- Create: `src-tauri/src/services/merge_detection.rs`
- Test: inline `#[cfg(test)]`

**Step 1: Write failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::github::Commit;

    #[test]
    fn test_detect_trunk_merge_by_parents() {
        let commit = Commit {
            sha: "abc".into(),
            message: "Merge branch 'main' into feature/xyz".into(),
            author: "dev".into(),
            timestamp: "2026-01-01T00:00:00Z".into(),
            parents: vec!["p1".into(), "p2".into()],
            is_trunk_merge: false,
            ticket_prefix: None,
            files: vec![],
        };
        assert!(is_trunk_merge(&commit, "main"));
    }

    #[test]
    fn test_detect_merge_pull_request() {
        let commit = Commit {
            sha: "def".into(),
            message: "Merge pull request #42 from org/main".into(),
            author: "dev".into(),
            timestamp: "2026-01-01T00:00:00Z".into(),
            parents: vec!["p1".into(), "p2".into()],
            is_trunk_merge: false,
            ticket_prefix: None,
            files: vec![],
        };
        assert!(is_trunk_merge(&commit, "main"));
    }

    #[test]
    fn test_non_merge_commit() {
        let commit = Commit {
            sha: "ghi".into(),
            message: "feat: add login page".into(),
            author: "dev".into(),
            timestamp: "2026-01-01T00:00:00Z".into(),
            parents: vec!["p1".into()],
            is_trunk_merge: false,
            ticket_prefix: None,
            files: vec![],
        };
        assert!(!is_trunk_merge(&commit, "main"));
    }

    #[test]
    fn test_feature_to_feature_merge_not_trunk() {
        let commit = Commit {
            sha: "jkl".into(),
            message: "Merge branch 'feature/auth' into feature/xyz".into(),
            author: "dev".into(),
            timestamp: "2026-01-01T00:00:00Z".into(),
            parents: vec!["p1".into(), "p2".into()],
            is_trunk_merge: false,
            ticket_prefix: None,
            files: vec![],
        };
        assert!(!is_trunk_merge(&commit, "main"));
    }
}
```

**Step 2: Run test to verify failure**

```bash
cd src-tauri && cargo test services::merge_detection
```

**Step 3: Implement detection**

```rust
// src-tauri/src/services/merge_detection.rs
use crate::models::github::Commit;
use regex::Regex;

pub fn is_trunk_merge(commit: &Commit, default_branch: &str) -> bool {
    if !commit.has_multiple_parents() {
        return false;
    }

    let msg = &commit.message;

    // Pattern 1: "Merge branch 'main' into feature/xyz"
    let branch_merge = Regex::new(&format!(
        r"Merge branch '({default_branch}|master|develop|next)'"
    ))
    .unwrap();
    if branch_merge.is_match(msg) {
        return true;
    }

    // Pattern 2: "Merge pull request #N from org/main"
    let pr_merge = Regex::new(&format!(
        r"Merge pull request #\d+ from .*/({default_branch}|master|develop|next)"
    ))
    .unwrap();
    if pr_merge.is_match(msg) {
        return true;
    }

    false
}

pub fn mark_trunk_merges(commits: &mut [Commit], default_branch: &str) {
    for commit in commits.iter_mut() {
        commit.is_trunk_merge = is_trunk_merge(commit, default_branch);
    }
}
```

**Step 4: Run tests**

```bash
cd src-tauri && cargo test services::merge_detection
```

Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/src/services/merge_detection.rs
git commit -m "PR-1: add trunk merge detection service"
```

---

## Task 5: Token Manager (Secure Storage)

**Files:**
- Create: `src-tauri/src/services/token_manager.rs`
- Modify: `src-tauri/Cargo.toml` (add keyring crate)

**Step 1: Add keyring dependency**

Add to `Cargo.toml`:

```toml
keyring = { version = "3", features = ["apple-native", "sync-secret-service"] }
```

Using `keyring` crate directly (not a Tauri plugin) for simpler integration. It uses macOS Keychain, Windows Credential Manager, and Linux Secret Service natively.

**Step 2: Write failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_key_names() {
        assert_eq!(token_key(TokenType::GitHub), "pr-reviewer-github-pat");
        assert_eq!(token_key(TokenType::Linear), "pr-reviewer-linear-pat");
        assert_eq!(token_key(TokenType::AiProvider), "pr-reviewer-ai-key");
    }
}
```

**Step 3: Implement token manager**

```rust
// src-tauri/src/services/token_manager.rs
use keyring::Entry;
use thiserror::Error;

const SERVICE_NAME: &str = "pr-reviewer";

#[derive(Debug, Clone, Copy)]
pub enum TokenType {
    GitHub,
    Linear,
    AiProvider,
}

pub fn token_key(token_type: TokenType) -> &'static str {
    match token_type {
        TokenType::GitHub => "pr-reviewer-github-pat",
        TokenType::Linear => "pr-reviewer-linear-pat",
        TokenType::AiProvider => "pr-reviewer-ai-key",
    }
}

#[derive(Error, Debug)]
pub enum TokenError {
    #[error("Failed to access keychain: {0}")]
    KeychainError(String),
    #[error("Token not found")]
    NotFound,
}

pub fn store_token(token_type: TokenType, value: &str) -> Result<(), TokenError> {
    let entry = Entry::new(SERVICE_NAME, token_key(token_type))
        .map_err(|e| TokenError::KeychainError(e.to_string()))?;
    entry
        .set_password(value)
        .map_err(|e| TokenError::KeychainError(e.to_string()))
}

pub fn get_token(token_type: TokenType) -> Result<String, TokenError> {
    let entry = Entry::new(SERVICE_NAME, token_key(token_type))
        .map_err(|e| TokenError::KeychainError(e.to_string()))?;
    entry.get_password().map_err(|e| match e {
        keyring::Error::NoEntry => TokenError::NotFound,
        other => TokenError::KeychainError(other.to_string()),
    })
}

pub fn delete_token(token_type: TokenType) -> Result<(), TokenError> {
    let entry = Entry::new(SERVICE_NAME, token_key(token_type))
        .map_err(|e| TokenError::KeychainError(e.to_string()))?;
    entry.delete_credential().map_err(|e| match e {
        keyring::Error::NoEntry => TokenError::NotFound,
        other => TokenError::KeychainError(other.to_string()),
    })
}
```

**Step 4: Run tests**

```bash
cd src-tauri && cargo test services::token_manager
```

Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/src/services/token_manager.rs src-tauri/Cargo.toml
git commit -m "PR-1: add token manager with OS keychain storage"
```

---

## Task 6: GitHub API Service

**Files:**
- Create: `src-tauri/src/services/github.rs`
- Test: inline `#[cfg(test)]` (unit tests with mocked responses)

**Step 1: Write tests for response parsing**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_repo_from_github_response() {
        let json = serde_json::json!({
            "full_name": "owner/repo",
            "name": "repo",
            "owner": { "login": "owner" },
            "default_branch": "main",
            "open_issues_count": 5,
            "updated_at": "2026-01-01T00:00:00Z"
        });
        let repo: GithubRepoResponse = serde_json::from_value(json).unwrap();
        let model = repo.into_model();
        assert_eq!(model.full_name, "owner/repo");
        assert_eq!(model.default_branch, "main");
    }

    #[test]
    fn test_parse_commit_from_github_response() {
        let json = serde_json::json!({
            "sha": "abc123",
            "commit": {
                "message": "CPT-1234: fix bug",
                "author": { "name": "dev", "date": "2026-01-01T00:00:00Z" }
            },
            "parents": [{ "sha": "parent1" }],
            "files": [{
                "filename": "src/main.rs",
                "status": "modified",
                "additions": 10,
                "deletions": 2,
                "patch": "@@ -1,3 +1,5 @@\n+new line"
            }]
        });
        let commit: GithubCommitDetailResponse = serde_json::from_value(json).unwrap();
        let model = commit.into_model();
        assert_eq!(model.sha, "abc123");
        assert_eq!(model.ticket_prefix, Some("CPT-1234".into()));
        assert_eq!(model.files.len(), 1);
    }
}
```

**Step 2: Implement GitHub API client**

```rust
// src-tauri/src/services/github.rs
use crate::models::github::*;
use crate::services::ticket_extraction::extract_ticket_prefixes;
use reqwest::header::{ACCEPT, AUTHORIZATION, USER_AGENT};
use serde::Deserialize;
use thiserror::Error;

const GITHUB_API: &str = "https://api.github.com";

#[derive(Error, Debug)]
pub enum GithubError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("GitHub API error: {status} {message}")]
    Api { status: u16, message: String },
    #[error("Auth failed -- check your GitHub PAT")]
    Unauthorized,
}

// Make GithubError serializable for Tauri commands
impl serde::Serialize for GithubError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub struct GithubClient {
    http: reqwest::Client,
    token: String,
}

impl GithubClient {
    pub fn new(token: String) -> Self {
        Self {
            http: reqwest::Client::new(),
            token,
        }
    }

    fn headers(&self) -> reqwest::header::HeaderMap {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(AUTHORIZATION, format!("Bearer {}", self.token).parse().unwrap());
        headers.insert(ACCEPT, "application/vnd.github.v3+json".parse().unwrap());
        headers.insert(USER_AGENT, "pr-reviewer-app".parse().unwrap());
        headers
    }

    pub async fn verify_token(&self) -> Result<String, GithubError> {
        let resp = self.http
            .get(format!("{GITHUB_API}/user"))
            .headers(self.headers())
            .send()
            .await?;
        if resp.status() == 401 {
            return Err(GithubError::Unauthorized);
        }
        let user: GithubUserResponse = resp.json().await?;
        Ok(user.login)
    }

    pub async fn list_repos(&self) -> Result<Vec<Repo>, GithubError> {
        let mut all_repos = Vec::new();
        let mut page = 1u32;

        loop {
            let resp: Vec<GithubRepoResponse> = self.http
                .get(format!("{GITHUB_API}/user/repos"))
                .headers(self.headers())
                .query(&[("per_page", "100"), ("page", &page.to_string()), ("sort", "updated")])
                .send()
                .await?
                .json()
                .await?;

            if resp.is_empty() {
                break;
            }
            all_repos.extend(resp.into_iter().map(|r| r.into_model()));
            page += 1;
        }

        Ok(all_repos)
    }

    pub async fn list_pulls(&self, owner: &str, repo: &str) -> Result<Vec<PullRequestSummary>, GithubError> {
        let resp: Vec<GithubPullResponse> = self.http
            .get(format!("{GITHUB_API}/repos/{owner}/{repo}/pulls"))
            .headers(self.headers())
            .query(&[("state", "open"), ("per_page", "100")])
            .send()
            .await?
            .json()
            .await?;

        Ok(resp.into_iter().map(|p| p.into_model()).collect())
    }

    pub async fn get_pull_commits(&self, owner: &str, repo: &str, pr_number: u64) -> Result<Vec<Commit>, GithubError> {
        let resp: Vec<GithubCommitResponse> = self.http
            .get(format!("{GITHUB_API}/repos/{owner}/{repo}/pulls/{pr_number}/commits"))
            .headers(self.headers())
            .query(&[("per_page", "250")])
            .send()
            .await?
            .json()
            .await?;

        let mut commits = Vec::new();
        for c in resp {
            let detail: GithubCommitDetailResponse = self.http
                .get(format!("{GITHUB_API}/repos/{owner}/{repo}/commits/{}", c.sha))
                .headers(self.headers())
                .send()
                .await?
                .json()
                .await?;
            commits.push(detail.into_model());
        }

        Ok(commits)
    }
}

// --- GitHub API response types (internal) ---

#[derive(Deserialize)]
struct GithubUserResponse {
    login: String,
}

#[derive(Deserialize)]
struct GithubRepoResponse {
    full_name: String,
    name: String,
    owner: GithubOwner,
    default_branch: String,
    open_issues_count: u32,
    updated_at: String,
}

#[derive(Deserialize)]
struct GithubOwner {
    login: String,
}

impl GithubRepoResponse {
    fn into_model(self) -> Repo {
        Repo {
            owner: self.owner.login,
            name: self.name,
            full_name: self.full_name,
            default_branch: self.default_branch,
            open_pr_count: self.open_issues_count,
            updated_at: self.updated_at,
        }
    }
}

#[derive(Deserialize)]
struct GithubPullResponse {
    number: u64,
    title: String,
    user: GithubUser,
    base: GithubRef,
    head: GithubRef,
    state: String,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
struct GithubUser {
    login: String,
}

#[derive(Deserialize)]
struct GithubRef {
    #[serde(rename = "ref")]
    ref_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullRequestSummary {
    pub number: u64,
    pub title: String,
    pub author: String,
    pub base_branch: String,
    pub head_branch: String,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
}

use serde::Serialize;

impl GithubPullResponse {
    fn into_model(self) -> PullRequestSummary {
        PullRequestSummary {
            number: self.number,
            title: self.title,
            author: self.user.login,
            base_branch: self.base.ref_name,
            head_branch: self.head.ref_name,
            state: self.state,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

#[derive(Deserialize)]
struct GithubCommitResponse {
    sha: String,
}

#[derive(Deserialize)]
struct GithubCommitDetailResponse {
    sha: String,
    commit: GithubCommitInfo,
    parents: Vec<GithubParent>,
    #[serde(default)]
    files: Vec<GithubFile>,
}

#[derive(Deserialize)]
struct GithubCommitInfo {
    message: String,
    author: GithubCommitAuthor,
}

#[derive(Deserialize)]
struct GithubCommitAuthor {
    name: String,
    date: String,
}

#[derive(Deserialize)]
struct GithubParent {
    sha: String,
}

#[derive(Deserialize)]
struct GithubFile {
    filename: String,
    status: String,
    additions: u32,
    deletions: u32,
    patch: Option<String>,
}

impl GithubCommitDetailResponse {
    fn into_model(self) -> Commit {
        let ticket = extract_ticket_prefixes(&self.commit.message)
            .into_iter()
            .next();

        Commit {
            sha: self.sha,
            message: self.commit.message,
            author: self.commit.author.name,
            timestamp: self.commit.author.date,
            parents: self.parents.into_iter().map(|p| p.sha).collect(),
            is_trunk_merge: false,
            ticket_prefix: ticket,
            files: self.files.into_iter().map(|f| {
                FileDiff {
                    path: f.filename,
                    status: match f.status.as_str() {
                        "added" => FileStatus::Added,
                        "removed" => FileStatus::Removed,
                        "renamed" => FileStatus::Renamed,
                        _ => FileStatus::Modified,
                    },
                    additions: f.additions,
                    deletions: f.deletions,
                    patch: f.patch,
                }
            }).collect(),
        }
    }
}
```

**Step 3: Run tests**

```bash
cd src-tauri && cargo test services::github
```

**Step 4: Commit**

```bash
git add src-tauri/src/services/github.rs
git commit -m "PR-1: add GitHub API client with repo, PR, and commit fetching"
```

---

## Task 7: Linear API Service

**Files:**
- Create: `src-tauri/src/services/linear.rs`
- Test: inline `#[cfg(test)]`

**Step 1: Write tests for GraphQL response parsing**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_linear_issue_response() {
        let json = serde_json::json!({
            "data": {
                "issue": {
                    "id": "abc-123",
                    "identifier": "CPT-1234",
                    "title": "Fix login bug",
                    "description": "Users cannot log in with SSO",
                    "state": { "name": "In Progress" },
                    "labels": { "nodes": [{ "name": "bug" }] },
                    "url": "https://linear.app/team/issue/CPT-1234"
                }
            }
        });
        let resp: LinearIssueResponse = serde_json::from_value(json).unwrap();
        let ticket = resp.into_model();
        assert_eq!(ticket.identifier, "CPT-1234");
        assert_eq!(ticket.title, "Fix login bug");
        assert_eq!(ticket.labels, vec!["bug"]);
    }

    #[test]
    fn test_build_batch_query() {
        let ids = vec!["CPT-1234".to_string(), "DATA-567".to_string()];
        let query = build_issues_query(&ids);
        assert!(query.contains("CPT-1234"));
        assert!(query.contains("DATA-567"));
    }
}
```

**Step 2: Implement Linear client**

```rust
// src-tauri/src/services/linear.rs
use crate::models::linear::LinearTicket;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const LINEAR_API: &str = "https://api.linear.app/graphql";

#[derive(Error, Debug)]
pub enum LinearError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Linear API error: {0}")]
    Api(String),
    #[error("Auth failed -- check your Linear PAT")]
    Unauthorized,
}

impl serde::Serialize for LinearError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub struct LinearClient {
    http: reqwest::Client,
    token: String,
}

impl LinearClient {
    pub fn new(token: String) -> Self {
        Self {
            http: reqwest::Client::new(),
            token,
        }
    }

    pub async fn verify_token(&self) -> Result<(), LinearError> {
        let query = r#"{ "query": "{ viewer { id } }" }"#;
        let resp = self.http
            .post(LINEAR_API)
            .header(AUTHORIZATION, &self.token)
            .header(CONTENT_TYPE, "application/json")
            .body(query.to_string())
            .send()
            .await?;
        if resp.status() == 401 {
            return Err(LinearError::Unauthorized);
        }
        Ok(())
    }

    pub async fn fetch_issues(&self, identifiers: &[String]) -> Result<Vec<LinearTicket>, LinearError> {
        let mut tickets = Vec::new();
        for id in identifiers {
            match self.fetch_issue(id).await {
                Ok(ticket) => tickets.push(ticket),
                Err(LinearError::Api(_)) => continue,
                Err(e) => return Err(e),
            }
        }
        Ok(tickets)
    }

    async fn fetch_issue(&self, identifier: &str) -> Result<LinearTicket, LinearError> {
        let query = format!(
            r#"{{ "query": "{{ issue(id: \"{identifier}\") {{ id identifier title description state {{ name }} labels {{ nodes {{ name }} }} url }} }}" }}"#
        );
        let resp = self.http
            .post(LINEAR_API)
            .header(AUTHORIZATION, &self.token)
            .header(CONTENT_TYPE, "application/json")
            .body(query)
            .send()
            .await?;

        let body: LinearIssueResponse = resp.json().await?;
        Ok(body.into_model())
    }
}

// --- Linear API response types ---

#[derive(Deserialize)]
struct LinearIssueResponse {
    data: LinearIssueData,
}

#[derive(Deserialize)]
struct LinearIssueData {
    issue: LinearIssueNode,
}

#[derive(Deserialize)]
struct LinearIssueNode {
    id: String,
    identifier: String,
    title: String,
    description: Option<String>,
    state: LinearState,
    labels: LinearLabels,
    url: String,
}

#[derive(Deserialize)]
struct LinearState {
    name: String,
}

#[derive(Deserialize)]
struct LinearLabels {
    nodes: Vec<LinearLabel>,
}

#[derive(Deserialize)]
struct LinearLabel {
    name: String,
}

impl LinearIssueResponse {
    fn into_model(self) -> LinearTicket {
        let issue = self.data.issue;
        LinearTicket {
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            description: issue.description,
            state: issue.state.name,
            labels: issue.labels.nodes.into_iter().map(|l| l.name).collect(),
            url: issue.url,
        }
    }
}

pub fn build_issues_query(identifiers: &[String]) -> String {
    let queries: Vec<String> = identifiers
        .iter()
        .enumerate()
        .map(|(i, id)| {
            format!(r#"issue{i}: issue(id: "{id}") {{ id identifier title description state {{ name }} labels {{ nodes {{ name }} }} url }}"#)
        })
        .collect();
    format!("{{ {} }}", queries.join(" "))
}
```

**Step 3: Run tests and commit**

```bash
cd src-tauri && cargo test services::linear
git add src-tauri/src/services/linear.rs
git commit -m "PR-1: add Linear GraphQL client for ticket context fetching"
```

---

## Task 8: AI Provider Trait + Claude Implementation

**Files:**
- Create: `src-tauri/src/providers/mod.rs`
- Create: `src-tauri/src/providers/traits.rs`
- Create: `src-tauri/src/providers/claude.rs`
- Test: inline `#[cfg(test)]`

**Step 1: Write the trait**

```rust
// src-tauri/src/providers/traits.rs
use crate::models::review::AiReviewSummary;
use async_trait::async_trait;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AiError {
    #[error("HTTP error: {0}")]
    Http(String),
    #[error("API error: {0}")]
    Api(String),
    #[error("Parse error: {0}")]
    Parse(String),
    #[error("Context too large: {tokens} tokens exceeds {max} max")]
    ContextTooLarge { tokens: usize, max: usize },
}

impl serde::Serialize for AiError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub struct ReviewPrompt {
    pub pr_title: String,
    pub pr_author: String,
    pub base_branch: String,
    pub head_branch: String,
    pub linear_context: Vec<String>,
    pub diffs: Vec<FileDiffContext>,
}

pub struct FileDiffContext {
    pub path: String,
    pub patch: String,
}

#[async_trait]
pub trait AiProvider: Send + Sync {
    async fn review(&self, prompt: &ReviewPrompt) -> Result<AiReviewSummary, AiError>;
    fn max_context_tokens(&self) -> usize;
    fn name(&self) -> &str;
}
```

**Step 2: Write tests for Claude prompt building**

```rust
// In src-tauri/src/providers/claude.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_system_prompt() {
        let prompt = ClaudeProvider::system_prompt();
        assert!(prompt.contains("code review"));
        assert!(prompt.contains("JSON"));
    }

    #[test]
    fn test_build_user_prompt() {
        let review_prompt = ReviewPrompt {
            pr_title: "Fix login".into(),
            pr_author: "dev".into(),
            base_branch: "main".into(),
            head_branch: "feature/login".into(),
            linear_context: vec!["CPT-123: Fix SSO login".into()],
            diffs: vec![FileDiffContext {
                path: "src/auth.rs".into(),
                patch: "+ fn login() {}".into(),
            }],
        };
        let user_msg = ClaudeProvider::build_user_message(&review_prompt);
        assert!(user_msg.contains("Fix login"));
        assert!(user_msg.contains("CPT-123"));
        assert!(user_msg.contains("src/auth.rs"));
    }
}
```

**Step 3: Implement Claude provider**

```rust
// src-tauri/src/providers/claude.rs
use super::traits::*;
use crate::models::review::*;
use async_trait::async_trait;
use reqwest::header::{CONTENT_TYPE};
use serde::{Deserialize, Serialize};

const CLAUDE_API: &str = "https://api.anthropic.com/v1/messages";

pub struct ClaudeProvider {
    http: reqwest::Client,
    api_key: String,
    model: String,
}

impl ClaudeProvider {
    pub fn new(api_key: String, model: Option<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            api_key,
            model: model.unwrap_or_else(|| "claude-sonnet-4-20250514".into()),
        }
    }

    pub fn system_prompt() -> String {
        r#"You are a senior code reviewer. Analyze the pull request and provide:
1. An overall assessment of code quality, correctness, and maintainability
2. A risk level (low, medium, high, critical)
3. Specific findings pinned to file paths and line numbers
4. Actionable recommendations

For each finding, specify:
- file_path: the file
- start_line / end_line: approximate line range in the diff
- severity: info, warning, or critical
- message: what the issue is
- suggestion: how to fix it (optional)

Respond in this exact JSON format:
{
  "overall_assessment": "string",
  "risk_level": "low|medium|high|critical",
  "findings": [
    {
      "file_path": "string",
      "start_line": number,
      "end_line": number,
      "severity": "info|warning|critical",
      "message": "string",
      "suggestion": "string or null"
    }
  ],
  "recommendations": ["string"]
}

Only output valid JSON. No markdown fences."#.into()
    }

    pub fn build_user_message(prompt: &ReviewPrompt) -> String {
        let mut msg = format!(
            "## Pull Request\nTitle: {}\nAuthor: {}\nBranch: {} <- {}\n\n",
            prompt.pr_title, prompt.pr_author, prompt.base_branch, prompt.head_branch
        );

        if !prompt.linear_context.is_empty() {
            msg.push_str("## Linear Tickets\n");
            for ctx in &prompt.linear_context {
                msg.push_str(&format!("- {ctx}\n"));
            }
            msg.push('\n');
        }

        msg.push_str("## File Diffs\n\n");
        for diff in &prompt.diffs {
            msg.push_str(&format!("### {}\n```\n{}\n```\n\n", diff.path, diff.patch));
        }

        msg
    }
}

#[async_trait]
impl AiProvider for ClaudeProvider {
    async fn review(&self, prompt: &ReviewPrompt) -> Result<AiReviewSummary, AiError> {
        let body = serde_json::json!({
            "model": self.model,
            "max_tokens": 4096,
            "system": Self::system_prompt(),
            "messages": [{
                "role": "user",
                "content": Self::build_user_message(prompt)
            }]
        });

        let resp = self.http
            .post(CLAUDE_API)
            .header(CONTENT_TYPE, "application/json")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| AiError::Http(e.to_string()))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let text = resp.text().await.unwrap_or_default();
            return Err(AiError::Api(format!("{status}: {text}")));
        }

        let api_resp: ClaudeResponse = resp
            .json()
            .await
            .map_err(|e| AiError::Parse(e.to_string()))?;

        let content = api_resp.content.first()
            .ok_or_else(|| AiError::Parse("Empty response".into()))?;

        let review: AiReviewSummary = serde_json::from_str(&content.text)
            .map_err(|e| AiError::Parse(format!("Failed to parse review JSON: {e}")))?;

        Ok(review)
    }

    fn max_context_tokens(&self) -> usize {
        200_000
    }

    fn name(&self) -> &str {
        "claude"
    }
}

#[derive(Deserialize)]
struct ClaudeResponse {
    content: Vec<ClaudeContent>,
}

#[derive(Deserialize)]
struct ClaudeContent {
    text: String,
}
```

**Step 4: Wire up mod.rs**

```rust
// src-tauri/src/providers/mod.rs
pub mod traits;
pub mod claude;
```

**Step 5: Run tests and commit**

```bash
cd src-tauri && cargo test providers
git add src-tauri/src/providers/
git commit -m "PR-1: add AI provider trait and Claude implementation"
```

---

## Task 9: Tauri Commands (Bridge Layer)

**Files:**
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/github.rs`
- Create: `src-tauri/src/commands/linear.rs`
- Create: `src-tauri/src/commands/review.rs`
- Create: `src-tauri/src/commands/settings.rs`
- Modify: `src-tauri/src/lib.rs` (register commands)

**Step 1: Implement settings commands**

```rust
// src-tauri/src/commands/settings.rs
use crate::services::token_manager::{self, TokenType};

#[tauri::command]
pub fn save_github_token(token: String) -> Result<(), String> {
    token_manager::store_token(TokenType::GitHub, &token)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_linear_token(token: String) -> Result<(), String> {
    token_manager::store_token(TokenType::Linear, &token)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_ai_key(key: String) -> Result<(), String> {
    token_manager::store_token(TokenType::AiProvider, &key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn has_github_token() -> bool {
    token_manager::get_token(TokenType::GitHub).is_ok()
}

#[tauri::command]
pub fn has_linear_token() -> bool {
    token_manager::get_token(TokenType::Linear).is_ok()
}

#[tauri::command]
pub fn has_ai_key() -> bool {
    token_manager::get_token(TokenType::AiProvider).is_ok()
}
```

**Step 2: Implement GitHub commands**

```rust
// src-tauri/src/commands/github.rs
use crate::models::github::Repo;
use crate::services::github::{GithubClient, PullRequestSummary};
use crate::services::merge_detection::mark_trunk_merges;
use crate::services::token_manager::{self, TokenType};
use crate::models::github::Commit;

fn get_github_client() -> Result<GithubClient, String> {
    let token = token_manager::get_token(TokenType::GitHub)
        .map_err(|e| e.to_string())?;
    Ok(GithubClient::new(token))
}

#[tauri::command]
pub async fn verify_github_token() -> Result<String, String> {
    let client = get_github_client()?;
    client.verify_token().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_repos() -> Result<Vec<Repo>, String> {
    let client = get_github_client()?;
    client.list_repos().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_pulls(owner: String, repo: String) -> Result<Vec<PullRequestSummary>, String> {
    let client = get_github_client()?;
    client.list_pulls(&owner, &repo).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_pull_commits(
    owner: String,
    repo: String,
    pr_number: u64,
    default_branch: String,
) -> Result<Vec<Commit>, String> {
    let client = get_github_client()?;
    let mut commits = client
        .get_pull_commits(&owner, &repo, pr_number)
        .await
        .map_err(|e| e.to_string())?;
    mark_trunk_merges(&mut commits, &default_branch);
    Ok(commits)
}
```

**Step 3: Implement Linear commands**

```rust
// src-tauri/src/commands/linear.rs
use crate::models::linear::LinearTicket;
use crate::services::linear::LinearClient;
use crate::services::token_manager::{self, TokenType};

fn get_linear_client() -> Result<LinearClient, String> {
    let token = token_manager::get_token(TokenType::Linear)
        .map_err(|e| e.to_string())?;
    Ok(LinearClient::new(token))
}

#[tauri::command]
pub async fn verify_linear_token() -> Result<(), String> {
    let client = get_linear_client()?;
    client.verify_token().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_linear_tickets(identifiers: Vec<String>) -> Result<Vec<LinearTicket>, String> {
    let client = get_linear_client()?;
    client.fetch_issues(&identifiers).await.map_err(|e| e.to_string())
}
```

**Step 4: Implement review commands**

```rust
// src-tauri/src/commands/review.rs
use crate::models::review::AiReviewSummary;
use crate::providers::claude::ClaudeProvider;
use crate::providers::traits::{AiProvider, ReviewPrompt, FileDiffContext};
use crate::services::token_manager::{self, TokenType};

#[tauri::command]
pub async fn analyze_pr(
    pr_title: String,
    pr_author: String,
    base_branch: String,
    head_branch: String,
    linear_context: Vec<String>,
    diffs: Vec<DiffInput>,
) -> Result<AiReviewSummary, String> {
    let api_key = token_manager::get_token(TokenType::AiProvider)
        .map_err(|e| e.to_string())?;

    let provider = ClaudeProvider::new(api_key, None);

    let prompt = ReviewPrompt {
        pr_title,
        pr_author,
        base_branch,
        head_branch,
        linear_context,
        diffs: diffs.into_iter().map(|d| FileDiffContext {
            path: d.path,
            patch: d.patch,
        }).collect(),
    };

    provider.review(&prompt).await.map_err(|e| e.to_string())
}

#[derive(serde::Deserialize)]
pub struct DiffInput {
    pub path: String,
    pub patch: String,
}
```

**Step 5: Register all commands in lib.rs**

```rust
// src-tauri/src/lib.rs
mod commands;
mod models;
mod providers;
mod services;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::settings::save_github_token,
            commands::settings::save_linear_token,
            commands::settings::save_ai_key,
            commands::settings::has_github_token,
            commands::settings::has_linear_token,
            commands::settings::has_ai_key,
            commands::github::verify_github_token,
            commands::github::list_repos,
            commands::github::list_pulls,
            commands::github::get_pull_commits,
            commands::linear::verify_linear_token,
            commands::linear::fetch_linear_tickets,
            commands::review::analyze_pr,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Step 6: Verify it compiles**

```bash
cd src-tauri && cargo check
```

**Step 7: Commit**

```bash
git add src-tauri/src/commands/ src-tauri/src/lib.rs
git commit -m "PR-1: add Tauri command bridge for GitHub, Linear, AI review, and settings"
```

---

## Task 10: TypeScript Types

**Files:**
- Create: `src/types/index.ts`

**Step 1: Write types mirroring Rust models**

```typescript
// src/types/index.ts
export interface Repo {
  owner: string;
  name: string;
  full_name: string;
  default_branch: string;
  open_pr_count: number;
  updated_at: string;
}

export interface PullRequestSummary {
  number: number;
  title: string;
  author: string;
  base_branch: string;
  head_branch: string;
  state: string;
  created_at: string;
  updated_at: string;
}

export interface Commit {
  sha: string;
  message: string;
  author: string;
  timestamp: string;
  parents: string[];
  is_trunk_merge: boolean;
  ticket_prefix: string | null;
  files: FileDiff[];
}

export interface FileDiff {
  path: string;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface LinearTicket {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: string;
  labels: string[];
  url: string;
}

export interface AiAnnotation {
  file_path: string;
  start_line: number;
  end_line: number;
  severity: "info" | "warning" | "critical";
  message: string;
  suggestion: string | null;
}

export interface AiReviewSummary {
  overall_assessment: string;
  risk_level: "low" | "medium" | "high" | "critical";
  findings: AiAnnotation[];
  recommendations: string[];
}
```

**Step 2: Commit**

```bash
git add src/types/
git commit -m "PR-1: add TypeScript types mirroring Rust data models"
```

---

## Task 11: Tauri Invoke Hooks

**Files:**
- Create: `src/hooks/use-github.ts`
- Create: `src/hooks/use-linear.ts`
- Create: `src/hooks/use-review.ts`
- Create: `src/hooks/use-settings.ts`

**Step 1: Write hooks**

```typescript
// src/hooks/use-settings.ts
import { invoke } from "@tauri-apps/api/core";
import { useState, useEffect } from "react";

export function useSettings() {
  const [hasGithub, setHasGithub] = useState(false);
  const [hasLinear, setHasLinear] = useState(false);
  const [hasAi, setHasAi] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    const [gh, ln, ai] = await Promise.all([
      invoke<boolean>("has_github_token"),
      invoke<boolean>("has_linear_token"),
      invoke<boolean>("has_ai_key"),
    ]);
    setHasGithub(gh);
    setHasLinear(ln);
    setHasAi(ai);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const saveGithubToken = async (token: string) => {
    await invoke("save_github_token", { token });
    await refresh();
  };

  const saveLinearToken = async (token: string) => {
    await invoke("save_linear_token", { token });
    await refresh();
  };

  const saveAiKey = async (key: string) => {
    await invoke("save_ai_key", { key });
    await refresh();
  };

  return {
    hasGithub, hasLinear, hasAi, loading,
    saveGithubToken, saveLinearToken, saveAiKey, refresh,
  };
}
```

```typescript
// src/hooks/use-github.ts
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import type { Repo, PullRequestSummary, Commit } from "@/types";

export function useGithub() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [pulls, setPulls] = useState<PullRequestSummary[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRepos = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<Repo[]>("list_repos");
      setRepos(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const fetchPulls = async (owner: string, repo: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<PullRequestSummary[]>("list_pulls", { owner, repo });
      setPulls(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const fetchCommits = async (owner: string, repo: string, prNumber: number, defaultBranch: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<Commit[]>("get_pull_commits", {
        owner, repo, prNumber, defaultBranch,
      });
      setCommits(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const verifyToken = async (): Promise<string> => {
    return invoke<string>("verify_github_token");
  };

  return {
    repos, pulls, commits, loading, error,
    fetchRepos, fetchPulls, fetchCommits, verifyToken,
  };
}
```

```typescript
// src/hooks/use-linear.ts
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import type { LinearTicket } from "@/types";

export function useLinear() {
  const [tickets, setTickets] = useState<LinearTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTickets = async (identifiers: string[]) => {
    if (identifiers.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<LinearTicket[]>("fetch_linear_tickets", { identifiers });
      setTickets(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const verifyToken = async () => {
    return invoke("verify_linear_token");
  };

  return { tickets, loading, error, fetchTickets, verifyToken };
}
```

```typescript
// src/hooks/use-review.ts
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import type { AiReviewSummary, Commit } from "@/types";

interface DiffInput {
  path: string;
  patch: string;
}

export function useReview() {
  const [review, setReview] = useState<AiReviewSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyzepr = async (
    prTitle: string,
    prAuthor: string,
    baseBranch: string,
    headBranch: string,
    linearContext: string[],
    commits: Commit[],
    hideTrunkMerges: boolean,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const filtered = hideTrunkMerges
        ? commits.filter((c) => !c.is_trunk_merge)
        : commits;

      const diffs: DiffInput[] = filtered.flatMap((c) =>
        c.files
          .filter((f) => f.patch)
          .map((f) => ({ path: f.path, patch: f.patch! }))
      );

      const data = await invoke<AiReviewSummary>("analyze_pr", {
        prTitle,
        prAuthor,
        baseBranch,
        headBranch,
        linearContext,
        diffs,
      });
      setReview(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return { review, loading, error, analyzepr, setReview };
}
```

**Step 2: Commit**

```bash
git add src/hooks/
git commit -m "PR-1: add React hooks for Tauri invoke wrappers"
```

---

## Task 12: App Router + Layout

**Files:**
- Modify: `src/App.tsx` (or create `src/app/layout.tsx` depending on scaffold)
- Create: `src/app/router.tsx`
- Create: `src/pages/repo-browser.tsx`
- Create: `src/pages/pr-review.tsx`
- Create: `src/pages/settings.tsx`
- Create: `src/pages/welcome.tsx`

**Step 1: Set up React Router**

```typescript
// src/app/router.tsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useSettings } from "@/hooks/use-settings";
import { RepoBrowser } from "@/pages/repo-browser";
import { PrReview } from "@/pages/pr-review";
import { Settings } from "@/pages/settings";
import { Welcome } from "@/pages/welcome";

export function AppRouter() {
  const { hasGithub, loading } = useSettings();

  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={hasGithub ? <Navigate to="/repos" /> : <Navigate to="/welcome" />} />
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/repos" element={<RepoBrowser />} />
        <Route path="/review/:owner/:repo/:prNumber" element={<PrReview />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </BrowserRouter>
  );
}
```

**Step 2: Create page stubs**

Each page file gets a minimal skeleton. Full UI is built in subsequent tasks.

```typescript
// src/pages/welcome.tsx
export function Welcome() {
  return <div>Welcome page</div>;
}

// src/pages/repo-browser.tsx
export function RepoBrowser() {
  return <div>Repo browser</div>;
}

// src/pages/pr-review.tsx
export function PrReview() {
  return <div>PR review</div>;
}

// src/pages/settings.tsx
export function Settings() {
  return <div>Settings</div>;
}
```

**Step 3: Wire into App.tsx**

Replace default App.tsx content with:

```typescript
import { AppRouter } from "@/app/router";

function App() {
  return <AppRouter />;
}

export default App;
```

**Step 4: Verify it builds**

```bash
bun run build
```

**Step 5: Commit**

```bash
git add src/
git commit -m "PR-1: add app router with page stubs for all screens"
```

---

## Task 13: Welcome / Onboarding Screen

**Files:**
- Modify: `src/pages/welcome.tsx`
- Test: `src/pages/__tests__/welcome.test.tsx`

Build the welcome screen with three connection cards:
1. GitHub PAT input with "Connect" button and test connection indicator
2. Linear PAT input (optional, with skip option)
3. AI provider key input with provider selector dropdown

Each card shows green check when connected. "Continue" button appears when GitHub is connected. Links to GitHub token creation page with scopes pre-filled.

Use ShadCN Card, Input, Button, Badge components.

**Step 1: Write component test**

```typescript
// src/pages/__tests__/welcome.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Welcome } from "../welcome";
import { MemoryRouter } from "react-router-dom";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("Welcome", () => {
  it("renders three connection cards", () => {
    render(<MemoryRouter><Welcome /></MemoryRouter>);
    expect(screen.getByText(/GitHub/)).toBeInTheDocument();
    expect(screen.getByText(/Linear/)).toBeInTheDocument();
    expect(screen.getByText(/AI Provider/)).toBeInTheDocument();
  });

  it("shows continue button", () => {
    render(<MemoryRouter><Welcome /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /continue/i })).toBeInTheDocument();
  });
});
```

**Step 2: Implement the full welcome page with ShadCN components**

This is a full React component implementation. Build it with the three cards layout, masked PAT inputs, test connection buttons, and navigation.

**Step 3: Run tests and commit**

```bash
bun run test
git add src/pages/
git commit -m "PR-1: build welcome/onboarding screen with connection cards"
```

---

## Task 14: Repo Browser Screen

**Files:**
- Modify: `src/pages/repo-browser.tsx`
- Create: `src/components/repo-browser/repo-list.tsx`
- Create: `src/components/repo-browser/repo-row.tsx`
- Create: `src/components/repo-browser/pr-list.tsx`
- Create: `src/components/layout/app-header.tsx`

Build the repo browser with:
- App header with "Settings" gear icon link
- Search/filter input at top
- Scrollable list of repos from `useGithub().fetchRepos()`
- Each row: repo full_name, open PR count badge, last updated timestamp
- Click repo to expand inline, showing open PRs
- Click PR to navigate to `/review/:owner/:repo/:prNumber`

**Step 1: Write tests for repo list filtering**

```typescript
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RepoList } from "../repo-list";

// Test that search input filters repos by name
// Test that clicking a repo expands to show PRs
// Test that clicking a PR navigates to review route
```

**Step 2: Implement components, run tests, commit**

```bash
bun run test
git add src/components/repo-browser/ src/components/layout/ src/pages/repo-browser.tsx
git commit -m "PR-1: build repo browser screen with search, repo list, and PR expansion"
```

---

## Task 15: PR Review Screen -- Commit Sidebar

**Files:**
- Modify: `src/pages/pr-review.tsx`
- Create: `src/components/pr-review/pr-header.tsx`
- Create: `src/components/pr-review/commit-sidebar.tsx`
- Create: `src/components/pr-review/merge-toggle.tsx`

Build the left sidebar with:
- PR header showing title, number, author, branch direction
- Commit list with sha prefix, message first line
- Linear ticket badge on commits with ticket prefix
- Dimmed styling for trunk merge commits
- Toggle switch at top: "Hide trunk merges" (auto-detected count shown)
- Click commit to select it (highlight in sidebar)
- Next/prev buttons at bottom with "2 of 4" counter

**Step 1: Write tests**

```typescript
// Test commit list renders all commits
// Test merge toggle hides/shows trunk merge commits
// Test next/prev navigation updates selected commit
// Test Linear badge appears for commits with ticket prefix
```

**Step 2: Implement, test, commit**

```bash
bun run test
git add src/components/pr-review/ src/pages/pr-review.tsx
git commit -m "PR-1: build commit sidebar with merge toggle and navigation"
```

---

## Task 16: PR Review Screen -- Diff Pane

**Files:**
- Create: `src/components/pr-review/diff-pane.tsx`
- Create: `src/components/pr-review/diff-line.tsx`
- Create: `src/components/pr-review/diff-file-header.tsx`

Build the diff viewer:
- Parse `patch` string from GitHub API into hunks and lines
- Render unified diff with line numbers (old + new columns)
- Color coding: green background for additions, red for deletions
- File header bar showing filename and +/- stats
- Multiple files per commit, each with collapsible header
- Monospace font, horizontal scroll for long lines

**Step 1: Write tests for patch parsing**

```typescript
// Test parsing a GitHub patch string into structured hunks
// Test line number calculation from @@ headers
// Test rendering additions in green, deletions in red
```

**Step 2: Implement diff parser utility**

```typescript
// src/lib/diff-parser.ts
// Parse GitHub patch format into { hunks: [{ oldStart, newStart, lines: [...] }] }
```

**Step 3: Build diff components, test, commit**

```bash
bun run test
git add src/components/pr-review/diff-*.tsx src/lib/diff-parser.ts
git commit -m "PR-1: build diff pane with patch parsing and unified diff view"
```

---

## Task 17: PR Review Screen -- Linear Context Bar

**Files:**
- Create: `src/components/pr-review/linear-context-bar.tsx`

Build the bottom bar:
- Shows when current commit has a `ticket_prefix` and Linear is connected
- Displays: ticket identifier, title, description (truncated), status badge
- Click to expand full description
- "No Linear context" muted text when no ticket match

**Step 1: Write tests, implement, commit**

```bash
bun run test
git add src/components/pr-review/linear-context-bar.tsx
git commit -m "PR-1: build Linear context bar for commit ticket enrichment"
```

---

## Task 18: PR Review Screen -- AI Summary Panel

**Files:**
- Create: `src/components/pr-review/ai-summary-panel.tsx`
- Create: `src/components/pr-review/ai-annotation.tsx`

Build the AI review UI:
- "AI Review" button in PR header triggers `useReview().analyzepr()`
- Loading state with spinner while AI processes
- Slide-over panel (ShadCN Sheet) from right showing:
  - Risk level badge (color coded: green/yellow/orange/red)
  - Overall assessment text
  - Findings list with severity badges, file:line links
  - Recommendations list
- Clicking a finding scrolls to and highlights the corresponding line in the diff pane
- Inline annotations in diff pane: collapsible AI comment blocks below annotated lines

**Step 1: Write tests**

```typescript
// Test AI Review button triggers analysis
// Test loading spinner shows during analysis
// Test summary panel renders findings and recommendations
// Test clicking finding scrolls to diff line
```

**Step 2: Implement, test, commit**

```bash
bun run test
git add src/components/pr-review/ai-*.tsx
git commit -m "PR-1: build AI review summary panel and inline annotations"
```

---

## Task 19: Settings Screen

**Files:**
- Modify: `src/pages/settings.tsx`
- Create: `src/components/settings/accounts-section.tsx`
- Create: `src/components/settings/ai-provider-section.tsx`
- Create: `src/components/settings/preferences-section.tsx`

Build the settings screen with three sections:
1. Accounts: GitHub PAT (masked), Linear PAT (masked), test connection buttons, status indicators
2. AI Provider: dropdown (Claude/OpenAI), API key input, model selector
3. Preferences: diff view toggle (unified/split), auto-hide merges toggle, trunk branch override input

Use ShadCN Tabs for section navigation. Back button to return to repo browser.

**Step 1: Write tests, implement, commit**

```bash
bun run test
git add src/pages/settings.tsx src/components/settings/
git commit -m "PR-1: build settings screen with accounts, AI, and preferences"
```

---

## Task 20: Integration Wiring + Final Polish

**Files:**
- Modify: various (wiring data flow between components)
- Modify: `src-tauri/tauri.conf.json` (permissions)

**Step 1: Wire the full data flow**

- Repo browser: on mount, call `fetchRepos()`. On repo click, call `fetchPulls()`. On PR click, navigate to review.
- PR review: on mount, call `fetchCommits()`. Extract ticket prefixes, call `fetchTickets()` if Linear connected. Pass commits to diff pane, tickets to context bar.
- AI review: collect all diffs from commits, pass to `analyzepr()`. Map findings back to diff lines.

**Step 2: Add Tauri permissions**

In `src-tauri/capabilities/default.json`, ensure HTTP permissions allow outbound to:
- `https://api.github.com/*`
- `https://api.linear.app/*`
- `https://api.anthropic.com/*`

**Step 3: Full build + smoke test**

```bash
bun run build
cd src-tauri && cargo build
bun tauri dev
```

Manual smoke test:
1. App opens to welcome screen
2. Enter GitHub PAT, click test -- shows green
3. Skip Linear, add AI key
4. Continue to repo browser -- repos load
5. Click repo, PRs expand
6. Click PR, review screen loads with commits
7. Click AI Review, summary appears

**Step 4: Final commit**

```bash
git add -A
git commit -m "PR-1: wire integration data flow and add Tauri permissions"
```
