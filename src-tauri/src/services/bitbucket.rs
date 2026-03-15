use crate::commands::git_provider::{MergeStatus, ReviewComment};
use crate::models::github::{
    AssignedPullRequest, AssignmentSource, CheckRun, CombinedCheckStatus, Commit, FileDiff,
    FileStatus, PullRequest, Repo,
};
use crate::services::git_provider::{GitProvider, GitProviderError};
use async_trait::async_trait;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use serde::Deserialize;
use thiserror::Error;

const BITBUCKET_API_BASE: &str = "https://api.bitbucket.org/2.0";
const APP_USER_AGENT: &str = "pr-reviewer/0.1.0";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Error, Debug)]
pub enum BitbucketError {
    #[error("HTTP request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("Bitbucket API error ({status}): {message}")]
    Api { status: u16, message: String },
    #[error("No Bitbucket token configured")]
    NoToken,
}

impl serde::Serialize for BitbucketError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<BitbucketError> for GitProviderError {
    fn from(err: BitbucketError) -> Self {
        match err {
            BitbucketError::Request(e) => GitProviderError::Request(e),
            BitbucketError::Api { status, message } => GitProviderError::Api { status, message },
            BitbucketError::NoToken => GitProviderError::NoToken,
        }
    }
}

// ---------------------------------------------------------------------------
// Bitbucket API response structs
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct BbPaginated<T> {
    values: Vec<T>,
    next: Option<String>,
}

#[derive(Deserialize)]
struct BbUser {
    username: Option<String>,
    nickname: Option<String>,
    display_name: Option<String>,
}

#[derive(Deserialize)]
struct BbRepository {
    full_name: String,
    slug: String,
    mainbranch: Option<BbBranchRef>,
    updated_on: Option<String>,
    is_private: Option<bool>,
}

#[derive(Deserialize)]
struct BbBranchRef {
    name: String,
}

#[derive(Deserialize)]
struct BbPullRequest {
    id: u64,
    title: String,
    description: Option<String>,
    author: BbPrAuthor,
    destination: BbPrEndpoint,
    source: BbPrSource,
    state: String,
    created_on: String,
    updated_on: String,
}

#[derive(Deserialize)]
struct BbPrAuthor {
    nickname: Option<String>,
    display_name: Option<String>,
    username: Option<String>,
}

#[derive(Deserialize)]
struct BbPrEndpoint {
    branch: BbBranchRef,
}

#[derive(Deserialize)]
struct BbPrSource {
    branch: BbBranchRef,
    repository: Option<BbSourceRepo>,
}

#[derive(Deserialize)]
struct BbSourceRepo {
    full_name: Option<String>,
}

#[derive(Deserialize)]
struct BbCommit {
    hash: String,
    message: Option<String>,
    author: Option<BbCommitAuthor>,
    date: Option<String>,
    parents: Option<Vec<BbParentRef>>,
}

#[derive(Deserialize)]
struct BbCommitAuthor {
    raw: Option<String>,
}

#[derive(Deserialize)]
struct BbParentRef {
    hash: String,
}

#[derive(Deserialize)]
struct BbDiffStatEntry {
    new: Option<BbDiffStatFile>,
    old: Option<BbDiffStatFile>,
    status: Option<String>,
    lines_added: Option<u32>,
    lines_removed: Option<u32>,
}

#[derive(Deserialize)]
struct BbDiffStatFile {
    path: Option<String>,
}

#[derive(Deserialize)]
struct BbCommitStatus {
    state: Option<String>,
    name: Option<String>,
    url: Option<String>,
    description: Option<String>,
}

#[derive(Deserialize)]
struct BbAssignedPr {
    id: u64,
    title: String,
    author: BbPrAuthor,
    state: String,
    created_on: String,
    updated_on: String,
    source: BbPrSource,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn parse_bb_file_status(s: &str) -> FileStatus {
    match s {
        "added" => FileStatus::Added,
        "removed" => FileStatus::Removed,
        "renamed" => FileStatus::Renamed,
        _ => FileStatus::Modified,
    }
}

fn is_trunk_merge(message: &str, parent_count: usize) -> bool {
    if parent_count > 1 {
        return true;
    }
    let first_line = message.lines().next().unwrap_or("");
    first_line.starts_with("Merge branch") || first_line.starts_with("Merge pull request")
}

fn extract_ticket_prefix(message: &str) -> Option<String> {
    let first_line = message.lines().next().unwrap_or("");
    let mut chars = first_line.chars().peekable();
    let mut key = String::new();

    while let Some(&c) = chars.peek() {
        if c.is_ascii_uppercase() {
            key.push(c);
            chars.next();
        } else {
            break;
        }
    }
    if key.is_empty() {
        return None;
    }
    if chars.next() != Some('-') {
        return None;
    }
    key.push('-');
    let mut has_digit = false;
    while let Some(&c) = chars.peek() {
        if c.is_ascii_digit() {
            key.push(c);
            chars.next();
            has_digit = true;
        } else {
            break;
        }
    }
    if has_digit {
        Some(key)
    } else {
        None
    }
}

/// Extract the author name from the raw author string (e.g. "Name <email>").
fn parse_author_raw(raw: &str) -> String {
    if let Some(idx) = raw.find('<') {
        let name = raw[..idx].trim();
        if !name.is_empty() {
            return name.to_string();
        }
    }
    raw.to_string()
}

fn bb_author_name(author: &BbPrAuthor) -> String {
    author
        .nickname
        .clone()
        .or_else(|| author.username.clone())
        .or_else(|| author.display_name.clone())
        .unwrap_or_else(|| "unknown".to_string())
}

// ---------------------------------------------------------------------------
// BitbucketClient
// ---------------------------------------------------------------------------

pub struct BitbucketClient {
    http: reqwest::Client,
    token: String,
}

impl BitbucketClient {
    pub fn new(token: String) -> Self {
        let http = reqwest::Client::new();
        Self { http, token }
    }

    // -- HTTP helpers -------------------------------------------------------

    async fn get_json<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
    ) -> Result<T, BitbucketError> {
        let resp = self
            .http
            .get(url)
            .header(AUTHORIZATION, format!("Bearer {}", self.token))
            .header(USER_AGENT, APP_USER_AGENT)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let message = resp.text().await.unwrap_or_default();
            return Err(BitbucketError::Api {
                status: status.as_u16(),
                message,
            });
        }

        Ok(resp.json().await?)
    }

    async fn get_text(&self, url: &str) -> Result<String, BitbucketError> {
        let resp = self
            .http
            .get(url)
            .header(AUTHORIZATION, format!("Bearer {}", self.token))
            .header(USER_AGENT, APP_USER_AGENT)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let message = resp.text().await.unwrap_or_default();
            return Err(BitbucketError::Api {
                status: status.as_u16(),
                message,
            });
        }

        Ok(resp.text().await?)
    }

    async fn post_json_raw(
        &self,
        url: &str,
        body: &serde_json::Value,
    ) -> Result<(), BitbucketError> {
        let resp = self
            .http
            .post(url)
            .header(AUTHORIZATION, format!("Bearer {}", self.token))
            .header(USER_AGENT, APP_USER_AGENT)
            .header(CONTENT_TYPE, "application/json")
            .body(body.to_string())
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let message = resp.text().await.unwrap_or_default();
            return Err(BitbucketError::Api {
                status: status.as_u16(),
                message,
            });
        }
        Ok(())
    }

    async fn post_empty(&self, url: &str) -> Result<(), BitbucketError> {
        let resp = self
            .http
            .post(url)
            .header(AUTHORIZATION, format!("Bearer {}", self.token))
            .header(USER_AGENT, APP_USER_AGENT)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let message = resp.text().await.unwrap_or_default();
            return Err(BitbucketError::Api {
                status: status.as_u16(),
                message,
            });
        }
        Ok(())
    }

    // -- API methods --------------------------------------------------------

    pub async fn get_authenticated_user(&self) -> Result<String, BitbucketError> {
        let url = format!("{}/user", BITBUCKET_API_BASE);
        let user: BbUser = self.get_json(&url).await?;
        Ok(user
            .username
            .or(user.nickname)
            .or(user.display_name)
            .unwrap_or_else(|| "unknown".to_string()))
    }

    pub async fn list_repos(&self) -> Result<Vec<Repo>, BitbucketError> {
        let mut all_repos = Vec::new();
        let mut page = 1u32;

        loop {
            let url = format!(
                "{}/repositories?role=member&sort=-updated_on&pagelen=100&page={}",
                BITBUCKET_API_BASE, page
            );

            let response: BbPaginated<BbRepository> = self.get_json(&url).await?;
            let has_next = response.next.is_some();

            for bb_repo in response.values {
                // Extract owner from full_name (format: "workspace/repo")
                let parts: Vec<&str> = bb_repo.full_name.splitn(2, '/').collect();
                let owner = if parts.len() == 2 {
                    parts[0].to_string()
                } else {
                    "unknown".to_string()
                };

                let default_branch = bb_repo
                    .mainbranch
                    .map(|b| b.name)
                    .unwrap_or_else(|| "main".to_string());

                all_repos.push(Repo {
                    owner,
                    name: bb_repo.slug,
                    full_name: bb_repo.full_name,
                    default_branch,
                    open_pr_count: 0, // Bitbucket doesn't include this in the repo listing
                    updated_at: bb_repo.updated_on.unwrap_or_default(),
                });
            }

            if !has_next {
                break;
            }
            page += 1;
        }

        Ok(all_repos)
    }

    pub async fn list_open_pull_requests(
        &self,
        owner: &str,
        repo: &str,
    ) -> Result<Vec<PullRequest>, BitbucketError> {
        let mut all_prs = Vec::new();
        let mut page = 1u32;

        loop {
            let url = format!(
                "{}/repositories/{}/{}/pullrequests?state=OPEN&sort=-updated_on&pagelen=50&page={}",
                BITBUCKET_API_BASE, owner, repo, page
            );

            let response: BbPaginated<BbPullRequest> = self.get_json(&url).await?;
            let has_next = response.next.is_some();

            for bb_pr in response.values {
                all_prs.push(PullRequest {
                    number: bb_pr.id,
                    title: bb_pr.title,
                    body: bb_pr.description,
                    author: bb_author_name(&bb_pr.author),
                    base_branch: bb_pr.destination.branch.name,
                    head_branch: bb_pr.source.branch.name,
                    state: bb_pr.state.to_lowercase(),
                    created_at: bb_pr.created_on,
                    updated_at: bb_pr.updated_on,
                    commits: vec![],
                    linear_tickets: vec![],
                });
            }

            if !has_next {
                break;
            }
            page += 1;
        }

        Ok(all_prs)
    }

    pub async fn get_pr_detail(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<PullRequest, BitbucketError> {
        // 1. PR metadata
        let pr_url = format!(
            "{}/repositories/{}/{}/pullrequests/{}",
            BITBUCKET_API_BASE, owner, repo, pr_number
        );
        let bb_pr: BbPullRequest = self.get_json(&pr_url).await?;

        // 2. Commits (paginated)
        let mut all_commits: Vec<BbCommit> = Vec::new();
        let mut page = 1u32;
        loop {
            let url = format!(
                "{}/repositories/{}/{}/pullrequests/{}/commits?pagelen=100&page={}",
                BITBUCKET_API_BASE, owner, repo, pr_number, page
            );
            let response: BbPaginated<BbCommit> = self.get_json(&url).await?;
            let has_next = response.next.is_some();
            all_commits.extend(response.values);
            if !has_next {
                break;
            }
            page += 1;
        }

        // 3. Per-commit file diffs via diffstat
        let mut commits = Vec::with_capacity(all_commits.len());
        for bb_commit in &all_commits {
            let diffstat_url = format!(
                "{}/repositories/{}/{}/diffstat/{}?pagelen=100",
                BITBUCKET_API_BASE, owner, repo, bb_commit.hash
            );

            let files: Vec<FileDiff> = match self
                .get_json::<BbPaginated<BbDiffStatEntry>>(&diffstat_url)
                .await
            {
                Ok(response) => {
                    let mut file_diffs: Vec<FileDiff> = response
                        .values
                        .into_iter()
                        .map(|entry| diffstat_to_file_diff(entry))
                        .collect();

                    // Paginate remaining diffstat pages if any
                    let mut next_url = response.next;
                    while let Some(url) = next_url {
                        match self.get_json::<BbPaginated<BbDiffStatEntry>>(&url).await {
                            Ok(resp) => {
                                file_diffs.extend(
                                    resp.values
                                        .into_iter()
                                        .map(|entry| diffstat_to_file_diff(entry)),
                                );
                                next_url = resp.next;
                            }
                            Err(_) => break,
                        }
                    }
                    file_diffs
                }
                Err(_) => vec![],
            };

            let message = bb_commit.message.as_deref().unwrap_or("");
            let parents = bb_commit
                .parents
                .as_ref()
                .map(|p| p.iter().map(|pr| pr.hash.clone()).collect::<Vec<_>>())
                .unwrap_or_default();
            let parent_count = parents.len();

            let author_name = bb_commit
                .author
                .as_ref()
                .and_then(|a| a.raw.as_deref())
                .map(parse_author_raw)
                .unwrap_or_else(|| "unknown".to_string());

            commits.push(Commit {
                sha: bb_commit.hash.clone(),
                message: message.to_string(),
                author: author_name,
                timestamp: bb_commit.date.clone().unwrap_or_default(),
                parents,
                is_trunk_merge: is_trunk_merge(message, parent_count),
                ticket_prefix: extract_ticket_prefix(message),
                files,
            });
        }

        Ok(PullRequest {
            number: bb_pr.id,
            title: bb_pr.title,
            body: bb_pr.description,
            author: bb_author_name(&bb_pr.author),
            base_branch: bb_pr.destination.branch.name,
            head_branch: bb_pr.source.branch.name,
            state: bb_pr.state.to_lowercase(),
            created_at: bb_pr.created_on,
            updated_at: bb_pr.updated_on,
            commits,
            linear_tickets: vec![],
        })
    }

    pub async fn submit_review(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
        event: &str,
        body: &str,
        comments: &[ReviewComment],
    ) -> Result<(), BitbucketError> {
        // Handle the review event (approve / request_changes)
        match event.to_uppercase().as_str() {
            "APPROVE" => {
                let url = format!(
                    "{}/repositories/{}/{}/pullrequests/{}/approve",
                    BITBUCKET_API_BASE, owner, repo, pr_number
                );
                self.post_empty(&url).await?;
            }
            "REQUEST_CHANGES" => {
                let url = format!(
                    "{}/repositories/{}/{}/pullrequests/{}/request-changes",
                    BITBUCKET_API_BASE, owner, repo, pr_number
                );
                self.post_empty(&url).await?;
            }
            _ => {
                // COMMENT or any other event — no special action needed
            }
        }

        // Post the general body comment if non-empty
        if !body.is_empty() {
            let url = format!(
                "{}/repositories/{}/{}/pullrequests/{}/comments",
                BITBUCKET_API_BASE, owner, repo, pr_number
            );
            let comment_body = serde_json::json!({
                "content": { "raw": body }
            });
            self.post_json_raw(&url, &comment_body).await?;
        }

        // Post inline comments
        for comment in comments {
            let url = format!(
                "{}/repositories/{}/{}/pullrequests/{}/comments",
                BITBUCKET_API_BASE, owner, repo, pr_number
            );
            let comment_body = serde_json::json!({
                "content": { "raw": comment.body },
                "inline": {
                    "path": comment.path,
                    "to": comment.line
                }
            });
            self.post_json_raw(&url, &comment_body).await?;
        }

        Ok(())
    }

    pub async fn get_merge_status(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<MergeStatus, BitbucketError> {
        let url = format!(
            "{}/repositories/{}/{}/pullrequests/{}",
            BITBUCKET_API_BASE, owner, repo, pr_number
        );

        let resp: serde_json::Value = self.get_json(&url).await?;

        let state = resp["state"]
            .as_str()
            .unwrap_or("UNKNOWN")
            .to_uppercase();

        // Bitbucket doesn't have a direct "mergeable" field.
        // Approximate: if state is OPEN, consider it potentially mergeable.
        let mergeable = state == "OPEN";

        let mergeable_state = if state == "OPEN" {
            "clean".to_string()
        } else if state == "MERGED" {
            "merged".to_string()
        } else if state == "DECLINED" || state == "SUPERSEDED" {
            "closed".to_string()
        } else {
            "unknown".to_string()
        };

        Ok(MergeStatus {
            mergeable,
            mergeable_state,
        })
    }

    pub async fn merge_pr(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
        commit_title: &str,
        commit_message: &str,
        merge_method: &str,
    ) -> Result<(), BitbucketError> {
        let url = format!(
            "{}/repositories/{}/{}/pullrequests/{}/merge",
            BITBUCKET_API_BASE, owner, repo, pr_number
        );

        // Map GitHub-style merge methods to Bitbucket strategies
        let strategy = match merge_method {
            "squash" => "squash",
            "rebase" => "fast_forward",
            _ => "merge_commit",
        };

        let full_message = if commit_message.is_empty() {
            commit_title.to_string()
        } else {
            format!("{}\n\n{}", commit_title, commit_message)
        };

        let request_body = serde_json::json!({
            "message": full_message,
            "merge_strategy": strategy,
        });

        self.post_json_raw(&url, &request_body).await
    }

    pub async fn get_pr_files(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<Vec<FileDiff>, BitbucketError> {
        let mut all_files = Vec::new();
        let mut page = 1u32;

        loop {
            let url = format!(
                "{}/repositories/{}/{}/pullrequests/{}/diffstat?pagelen=100&page={}",
                BITBUCKET_API_BASE, owner, repo, pr_number, page
            );

            let response: BbPaginated<BbDiffStatEntry> = self.get_json(&url).await?;
            let has_next = response.next.is_some();

            for entry in response.values {
                all_files.push(diffstat_to_file_diff(entry));
            }

            if !has_next {
                break;
            }
            page += 1;
        }

        // Optionally fetch the raw unified diff and attach patches per file
        let diff_url = format!(
            "{}/repositories/{}/{}/pullrequests/{}/diff",
            BITBUCKET_API_BASE, owner, repo, pr_number
        );

        if let Ok(raw_diff) = self.get_text(&diff_url).await {
            let patches = parse_unified_diff_patches(&raw_diff);
            for file in &mut all_files {
                if let Some(patch) = patches.get(&file.path) {
                    file.patch = Some(patch.clone());
                }
            }
        }

        Ok(all_files)
    }

    pub async fn get_check_status(
        &self,
        owner: &str,
        repo: &str,
        git_ref: &str,
    ) -> Result<CombinedCheckStatus, BitbucketError> {
        let mut all_statuses: Vec<BbCommitStatus> = Vec::new();
        let mut page = 1u32;

        loop {
            let url = format!(
                "{}/repositories/{}/{}/commit/{}/statuses?pagelen=100&page={}",
                BITBUCKET_API_BASE, owner, repo, git_ref, page
            );

            let response: BbPaginated<BbCommitStatus> = self.get_json(&url).await?;
            let has_next = response.next.is_some();
            all_statuses.extend(response.values);

            if !has_next {
                break;
            }
            page += 1;
        }

        let total = all_statuses.len();
        let mut passed = 0usize;
        let mut failed = 0usize;
        let mut pending = 0usize;

        let checks: Vec<CheckRun> = all_statuses
            .into_iter()
            .map(|cs| {
                let state_str = cs.state.as_deref().unwrap_or("UNKNOWN");
                match state_str {
                    "SUCCESSFUL" => passed += 1,
                    "FAILED" | "STOPPED" => failed += 1,
                    "INPROGRESS" => pending += 1,
                    _ => pending += 1,
                }

                // Map Bitbucket status to GitHub-compatible status/conclusion
                let (status, conclusion) = match state_str {
                    "SUCCESSFUL" => ("completed".to_string(), Some("success".to_string())),
                    "FAILED" => ("completed".to_string(), Some("failure".to_string())),
                    "STOPPED" => ("completed".to_string(), Some("cancelled".to_string())),
                    "INPROGRESS" => ("in_progress".to_string(), None),
                    _ => ("queued".to_string(), None),
                };

                CheckRun {
                    name: cs.name.unwrap_or_else(|| "unknown".to_string()),
                    status,
                    conclusion,
                    details_url: cs.url,
                }
            })
            .collect();

        let state = if failed > 0 {
            "failure".to_string()
        } else if pending > 0 {
            "pending".to_string()
        } else {
            "success".to_string()
        };

        Ok(CombinedCheckStatus {
            state,
            total,
            passed,
            failed,
            pending,
            checks,
        })
    }

    pub async fn list_assigned_prs(&self) -> Result<Vec<AssignedPullRequest>, BitbucketError> {
        let username = self.get_authenticated_user().await?;

        let mut all_prs = Vec::new();
        let mut page = 1u32;

        loop {
            let url = format!(
                "{}/pullrequests/{}?state=OPEN&pagelen=50&page={}",
                BITBUCKET_API_BASE, username, page
            );

            let response: BbPaginated<BbAssignedPr> = self.get_json(&url).await?;
            let has_next = response.next.is_some();

            for bb_pr in response.values {
                let full_name = bb_pr
                    .source
                    .repository
                    .and_then(|r| r.full_name)
                    .unwrap_or_default();

                let parts: Vec<&str> = full_name.splitn(2, '/').collect();
                let (repo_owner, repo_name) = if parts.len() == 2 {
                    (parts[0].to_string(), parts[1].to_string())
                } else {
                    ("unknown".to_string(), full_name.clone())
                };

                all_prs.push(AssignedPullRequest {
                    repo_owner,
                    repo_name,
                    repo_full_name: full_name,
                    number: bb_pr.id,
                    title: bb_pr.title,
                    author: bb_author_name(&bb_pr.author),
                    state: bb_pr.state.to_lowercase(),
                    created_at: bb_pr.created_on,
                    updated_at: bb_pr.updated_on,
                    assignment_source: AssignmentSource::Direct,
                    team_name: None,
                });
            }

            if !has_next {
                break;
            }
            page += 1;
        }

        // Sort by updated_at descending
        all_prs.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

        Ok(all_prs)
    }
}

// ---------------------------------------------------------------------------
// Diff parsing helpers
// ---------------------------------------------------------------------------

fn diffstat_to_file_diff(entry: BbDiffStatEntry) -> FileDiff {
    let path = entry
        .new
        .as_ref()
        .and_then(|f| f.path.clone())
        .or_else(|| entry.old.as_ref().and_then(|f| f.path.clone()))
        .unwrap_or_else(|| "unknown".to_string());

    let status = entry
        .status
        .as_deref()
        .map(parse_bb_file_status)
        .unwrap_or(FileStatus::Modified);

    FileDiff {
        path,
        status,
        additions: entry.lines_added.unwrap_or(0),
        deletions: entry.lines_removed.unwrap_or(0),
        patch: None,
    }
}

/// Parse a unified diff text and extract per-file patches keyed by filename.
fn parse_unified_diff_patches(raw_diff: &str) -> std::collections::HashMap<String, String> {
    let mut patches = std::collections::HashMap::new();
    let mut current_file: Option<String> = None;
    let mut current_patch = String::new();

    for line in raw_diff.lines() {
        if line.starts_with("diff --git ") {
            // Flush previous file patch
            if let Some(ref file) = current_file {
                if !current_patch.is_empty() {
                    patches.insert(file.clone(), current_patch.clone());
                }
            }
            current_patch.clear();
            current_file = None;
        } else if line.starts_with("+++ b/") {
            current_file = Some(line[6..].to_string());
        } else if line.starts_with("+++ /dev/null") {
            // File was deleted — keep the current_file from the --- line
        } else if line.starts_with("--- a/") && current_file.is_none() {
            // For deleted files, capture from --- line
            current_file = Some(line[6..].to_string());
        } else if current_file.is_some()
            && (line.starts_with("@@")
                || line.starts_with('+')
                || line.starts_with('-')
                || line.starts_with(' '))
        {
            if !current_patch.is_empty() {
                current_patch.push('\n');
            }
            current_patch.push_str(line);
        }
    }

    // Flush last file
    if let Some(ref file) = current_file {
        if !current_patch.is_empty() {
            patches.insert(file.clone(), current_patch);
        }
    }

    patches
}

// ---------------------------------------------------------------------------
// BitbucketProvider: trait implementation wrapping BitbucketClient
// ---------------------------------------------------------------------------

pub struct BitbucketProvider {
    client: BitbucketClient,
}

impl BitbucketProvider {
    pub fn new(token: String) -> Self {
        Self {
            client: BitbucketClient::new(token),
        }
    }
}

#[async_trait]
impl GitProvider for BitbucketProvider {
    fn name(&self) -> &str {
        "Bitbucket"
    }

    async fn get_authenticated_user(&self) -> Result<String, GitProviderError> {
        Ok(self.client.get_authenticated_user().await?)
    }

    async fn list_repos(&self) -> Result<Vec<Repo>, GitProviderError> {
        Ok(self.client.list_repos().await?)
    }

    async fn list_open_pull_requests(
        &self,
        owner: &str,
        repo: &str,
    ) -> Result<Vec<PullRequest>, GitProviderError> {
        Ok(self.client.list_open_pull_requests(owner, repo).await?)
    }

    async fn list_assigned_prs(&self) -> Result<Vec<AssignedPullRequest>, GitProviderError> {
        Ok(self.client.list_assigned_prs().await?)
    }

    async fn get_pr_detail(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<PullRequest, GitProviderError> {
        Ok(self.client.get_pr_detail(owner, repo, pr_number).await?)
    }

    async fn submit_review(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
        event: &str,
        body: &str,
        comments: &[ReviewComment],
    ) -> Result<(), GitProviderError> {
        Ok(self
            .client
            .submit_review(owner, repo, pr_number, event, body, comments)
            .await?)
    }

    async fn get_merge_status(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<MergeStatus, GitProviderError> {
        Ok(self.client.get_merge_status(owner, repo, pr_number).await?)
    }

    async fn merge_pr(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
        commit_title: &str,
        commit_message: &str,
        merge_method: &str,
    ) -> Result<(), GitProviderError> {
        Ok(self
            .client
            .merge_pr(
                owner,
                repo,
                pr_number,
                commit_title,
                commit_message,
                merge_method,
            )
            .await?)
    }

    async fn get_pr_files(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<Vec<FileDiff>, GitProviderError> {
        Ok(self.client.get_pr_files(owner, repo, pr_number).await?)
    }

    async fn get_check_status(
        &self,
        owner: &str,
        repo: &str,
        git_ref: &str,
    ) -> Result<CombinedCheckStatus, GitProviderError> {
        Ok(self.client.get_check_status(owner, repo, git_ref).await?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bitbucket_error_display() {
        let err = BitbucketError::Api {
            status: 401,
            message: "Unauthorized".into(),
        };
        assert!(err.to_string().contains("401"));
        assert!(err.to_string().contains("Unauthorized"));
    }

    #[test]
    fn test_bitbucket_error_no_token() {
        let err = BitbucketError::NoToken;
        assert!(err.to_string().contains("No Bitbucket token"));
    }

    #[test]
    fn test_parse_author_raw_with_email() {
        assert_eq!(
            parse_author_raw("John Doe <john@example.com>"),
            "John Doe"
        );
    }

    #[test]
    fn test_parse_author_raw_no_email() {
        assert_eq!(parse_author_raw("John Doe"), "John Doe");
    }

    #[test]
    fn test_parse_author_raw_empty_name() {
        assert_eq!(
            parse_author_raw("<john@example.com>"),
            "<john@example.com>"
        );
    }

    #[test]
    fn test_parse_bb_file_status() {
        assert!(matches!(parse_bb_file_status("added"), FileStatus::Added));
        assert!(matches!(
            parse_bb_file_status("removed"),
            FileStatus::Removed
        ));
        assert!(matches!(
            parse_bb_file_status("renamed"),
            FileStatus::Renamed
        ));
        assert!(matches!(
            parse_bb_file_status("modified"),
            FileStatus::Modified
        ));
        assert!(matches!(
            parse_bb_file_status("anything_else"),
            FileStatus::Modified
        ));
    }

    #[test]
    fn test_extract_ticket_prefix_valid() {
        assert_eq!(
            extract_ticket_prefix("CPT-123: fix login"),
            Some("CPT-123".into())
        );
        assert_eq!(
            extract_ticket_prefix("AB-1 some change"),
            Some("AB-1".into())
        );
    }

    #[test]
    fn test_extract_ticket_prefix_invalid() {
        assert_eq!(extract_ticket_prefix("fix: something"), None);
        assert_eq!(extract_ticket_prefix(""), None);
    }

    #[test]
    fn test_is_trunk_merge() {
        assert!(is_trunk_merge("normal message", 2));
        assert!(is_trunk_merge("Merge branch 'main' into feature", 1));
        assert!(!is_trunk_merge("feat: add login", 1));
    }

    #[test]
    fn test_parse_unified_diff_patches() {
        let diff = "\
diff --git a/src/main.rs b/src/main.rs
--- a/src/main.rs
+++ b/src/main.rs
@@ -1,3 +1,4 @@
 fn main() {
+    println!(\"hello\");
 }
diff --git a/src/lib.rs b/src/lib.rs
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,2 +1,3 @@
+pub mod utils;
 pub mod core;
";
        let patches = parse_unified_diff_patches(diff);
        assert!(patches.contains_key("src/main.rs"));
        assert!(patches.contains_key("src/lib.rs"));
        assert!(patches["src/main.rs"].contains("println"));
        assert!(patches["src/lib.rs"].contains("pub mod utils"));
    }

    #[test]
    fn test_diffstat_to_file_diff() {
        let entry = BbDiffStatEntry {
            new: Some(BbDiffStatFile {
                path: Some("src/main.rs".into()),
            }),
            old: Some(BbDiffStatFile {
                path: Some("src/main.rs".into()),
            }),
            status: Some("modified".into()),
            lines_added: Some(10),
            lines_removed: Some(5),
        };
        let diff = diffstat_to_file_diff(entry);
        assert_eq!(diff.path, "src/main.rs");
        assert!(matches!(diff.status, FileStatus::Modified));
        assert_eq!(diff.additions, 10);
        assert_eq!(diff.deletions, 5);
        assert!(diff.patch.is_none());
    }

    #[test]
    fn test_diffstat_to_file_diff_added() {
        let entry = BbDiffStatEntry {
            new: Some(BbDiffStatFile {
                path: Some("new_file.rs".into()),
            }),
            old: None,
            status: Some("added".into()),
            lines_added: Some(20),
            lines_removed: None,
        };
        let diff = diffstat_to_file_diff(entry);
        assert_eq!(diff.path, "new_file.rs");
        assert!(matches!(diff.status, FileStatus::Added));
        assert_eq!(diff.additions, 20);
        assert_eq!(diff.deletions, 0);
    }

    #[test]
    fn test_diffstat_to_file_diff_removed() {
        let entry = BbDiffStatEntry {
            new: None,
            old: Some(BbDiffStatFile {
                path: Some("old_file.rs".into()),
            }),
            status: Some("removed".into()),
            lines_added: None,
            lines_removed: Some(15),
        };
        let diff = diffstat_to_file_diff(entry);
        assert_eq!(diff.path, "old_file.rs");
        assert!(matches!(diff.status, FileStatus::Removed));
        assert_eq!(diff.additions, 0);
        assert_eq!(diff.deletions, 15);
    }

    #[test]
    fn test_bb_author_name_prefers_nickname() {
        let author = BbPrAuthor {
            nickname: Some("jdoe".into()),
            display_name: Some("John Doe".into()),
            username: Some("john_doe".into()),
        };
        assert_eq!(bb_author_name(&author), "jdoe");
    }

    #[test]
    fn test_bb_author_name_fallback_to_username() {
        let author = BbPrAuthor {
            nickname: None,
            display_name: Some("John Doe".into()),
            username: Some("john_doe".into()),
        };
        assert_eq!(bb_author_name(&author), "john_doe");
    }

    #[test]
    fn test_bb_author_name_fallback_to_display() {
        let author = BbPrAuthor {
            nickname: None,
            display_name: Some("John Doe".into()),
            username: None,
        };
        assert_eq!(bb_author_name(&author), "John Doe");
    }

    #[test]
    fn test_bb_author_name_unknown() {
        let author = BbPrAuthor {
            nickname: None,
            display_name: None,
            username: None,
        };
        assert_eq!(bb_author_name(&author), "unknown");
    }
}
