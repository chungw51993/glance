use crate::commands::github::{MergeStatus, ReviewComment};
use crate::models::github::{AssignedPullRequest, Commit, FileDiff, FileStatus, PullRequest, Repo};
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use serde::Deserialize;
use thiserror::Error;

const GITHUB_API_BASE: &str = "https://api.github.com";
const APP_USER_AGENT: &str = "pr-reviewer/0.1.0";

#[derive(Error, Debug)]
pub enum GitHubError {
    #[error("HTTP request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("GitHub API error ({status}): {message}")]
    Api { status: u16, message: String },
    #[error("No GitHub token configured")]
    NoToken,
}

impl serde::Serialize for GitHubError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub struct GitHubClient {
    http: reqwest::Client,
    token: String,
}

/// Subset of the GitHub API response for repositories.
/// We only deserialize the fields we need rather than pulling the entire response.
#[derive(Deserialize)]
struct GhRepo {
    full_name: String,
    owner: GhOwner,
    name: String,
    default_branch: String,
    open_issues_count: u32,
    updated_at: String,
    fork: bool,
    archived: bool,
}

#[derive(Deserialize)]
struct GhOwner {
    login: String,
}

#[derive(Deserialize)]
struct GhPullRequest {
    number: u64,
    title: String,
    body: Option<String>,
    user: GhUser,
    base: GhRef,
    head: GhRef,
    state: String,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
struct GhUser {
    login: String,
}

#[derive(Deserialize)]
struct GhRef {
    #[serde(rename = "ref")]
    ref_name: String,
}

#[derive(Deserialize)]
struct GhCommit {
    sha: String,
    commit: GhCommitInner,
    parents: Vec<GhParentRef>,
}

#[derive(Deserialize)]
struct GhCommitInner {
    message: String,
    author: GhCommitAuthor,
}

#[derive(Deserialize)]
struct GhCommitAuthor {
    name: String,
    date: String,
}

#[derive(Deserialize)]
struct GhParentRef {
    sha: String,
}

#[derive(Deserialize)]
struct GhCommitDetail {
    files: Option<Vec<GhFile>>,
}

#[derive(Deserialize)]
struct GhFile {
    filename: String,
    status: String,
    additions: u32,
    deletions: u32,
    patch: Option<String>,
}

#[derive(Deserialize)]
struct GhSearchResult {
    items: Vec<GhSearchItem>,
}

#[derive(Deserialize)]
struct GhSearchItem {
    number: u64,
    title: String,
    user: GhUser,
    state: String,
    created_at: String,
    updated_at: String,
    repository_url: String,
}

/// Extract (owner, repo) from a GitHub API repository URL like
/// `https://api.github.com/repos/acme/widget`.
fn parse_repo_from_url(url: &str) -> (String, String) {
    let parts: Vec<&str> = url.rsplitn(3, '/').collect();
    if parts.len() >= 2 {
        (parts[1].to_string(), parts[0].to_string())
    } else {
        ("unknown".to_string(), "unknown".to_string())
    }
}

fn parse_file_status(s: &str) -> FileStatus {
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
    if has_digit { Some(key) } else { None }
}

impl GitHubClient {
    pub fn new(token: String) -> Self {
        let http = reqwest::Client::new();
        Self { http, token }
    }

    /// Fetch all repositories the authenticated user has access to.
    /// Uses the /user/repos endpoint with affiliation=owner,collaborator,organization_member
    /// and paginates through all results.
    pub async fn list_repos(&self) -> Result<Vec<Repo>, GitHubError> {
        let mut all_repos = Vec::new();
        let mut page = 1u32;

        loop {
            let url = format!(
                "{}/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page={}",
                GITHUB_API_BASE, page
            );

            let resp = self
                .http
                .get(&url)
                .header(AUTHORIZATION, format!("Bearer {}", self.token))
                .header(USER_AGENT, APP_USER_AGENT)
                .header(ACCEPT, "application/vnd.github+json")
                .send()
                .await?;

            let status = resp.status();
            if !status.is_success() {
                let message = resp.text().await.unwrap_or_default();
                return Err(GitHubError::Api {
                    status: status.as_u16(),
                    message,
                });
            }

            let gh_repos: Vec<GhRepo> = resp.json().await?;
            let batch_len = gh_repos.len();

            for gh in gh_repos {
                if gh.archived || gh.fork {
                    continue;
                }
                all_repos.push(Repo {
                    owner: gh.owner.login,
                    name: gh.name,
                    full_name: gh.full_name,
                    default_branch: gh.default_branch,
                    open_pr_count: gh.open_issues_count,
                    updated_at: gh.updated_at,
                });
            }

            if batch_len < 100 {
                break;
            }
            page += 1;
        }

        Ok(all_repos)
    }

    /// Fetch open pull requests for a given repository.
    pub async fn list_open_pull_requests(
        &self,
        owner: &str,
        repo: &str,
    ) -> Result<Vec<PullRequest>, GitHubError> {
        let mut all_prs = Vec::new();
        let mut page = 1u32;

        loop {
            let url = format!(
                "{}/repos/{}/{}/pulls?state=open&sort=updated&direction=desc&per_page=100&page={}",
                GITHUB_API_BASE, owner, repo, page
            );

            let resp = self
                .http
                .get(&url)
                .header(AUTHORIZATION, format!("Bearer {}", self.token))
                .header(USER_AGENT, APP_USER_AGENT)
                .header(ACCEPT, "application/vnd.github+json")
                .send()
                .await?;

            let status = resp.status();
            if !status.is_success() {
                let message = resp.text().await.unwrap_or_default();
                return Err(GitHubError::Api {
                    status: status.as_u16(),
                    message,
                });
            }

            let gh_prs: Vec<GhPullRequest> = resp.json().await?;
            let batch_len = gh_prs.len();

            for gh in gh_prs {
                all_prs.push(PullRequest {
                    number: gh.number,
                    title: gh.title,
                    body: gh.body,
                    author: gh.user.login,
                    base_branch: gh.base.ref_name,
                    head_branch: gh.head.ref_name,
                    state: gh.state,
                    created_at: gh.created_at,
                    updated_at: gh.updated_at,
                    commits: vec![],
                    linear_tickets: vec![],
                });
            }

            if batch_len < 100 {
                break;
            }
            page += 1;
        }

        Ok(all_prs)
    }

    /// Fetch full PR detail including commits with file diffs.
    pub async fn get_pr_detail(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<PullRequest, GitHubError> {
        // 1. PR metadata
        let pr_url = format!(
            "{}/repos/{}/{}/pulls/{}",
            GITHUB_API_BASE, owner, repo, pr_number
        );
        let gh_pr: GhPullRequest = self.get_json(&pr_url).await?;

        // 2. Commits (paginated)
        let mut all_commits = Vec::new();
        let mut page = 1u32;
        loop {
            let url = format!(
                "{}/repos/{}/{}/pulls/{}/commits?per_page=100&page={}",
                GITHUB_API_BASE, owner, repo, pr_number, page
            );
            let gh_commits: Vec<GhCommit> = self.get_json(&url).await?;
            let batch_len = gh_commits.len();
            all_commits.extend(gh_commits);
            if batch_len < 100 {
                break;
            }
            page += 1;
        }

        // 3. Per-commit file diffs
        let mut commits = Vec::with_capacity(all_commits.len());
        for gh_commit in &all_commits {
            let detail_url = format!(
                "{}/repos/{}/{}/commits/{}",
                GITHUB_API_BASE, owner, repo, gh_commit.sha
            );
            let detail: GhCommitDetail = self.get_json(&detail_url).await?;

            let files: Vec<FileDiff> = detail
                .files
                .unwrap_or_default()
                .into_iter()
                .map(|f| FileDiff {
                    path: f.filename,
                    status: parse_file_status(&f.status),
                    additions: f.additions,
                    deletions: f.deletions,
                    patch: f.patch,
                })
                .collect();

            let message = &gh_commit.commit.message;
            let parent_count = gh_commit.parents.len();

            commits.push(Commit {
                sha: gh_commit.sha.clone(),
                message: message.clone(),
                author: gh_commit.commit.author.name.clone(),
                timestamp: gh_commit.commit.author.date.clone(),
                parents: gh_commit.parents.iter().map(|p| p.sha.clone()).collect(),
                is_trunk_merge: is_trunk_merge(message, parent_count),
                ticket_prefix: extract_ticket_prefix(message),
                files,
            });
        }

        Ok(PullRequest {
            number: gh_pr.number,
            title: gh_pr.title,
            body: gh_pr.body,
            author: gh_pr.user.login,
            base_branch: gh_pr.base.ref_name,
            head_branch: gh_pr.head.ref_name,
            state: gh_pr.state,
            created_at: gh_pr.created_at,
            updated_at: gh_pr.updated_at,
            commits,
            linear_tickets: vec![],
        })
    }

    /// Submit a review on a pull request with optional comments.
    pub async fn submit_review(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
        event: &str,
        body: &str,
        comments: &[ReviewComment],
    ) -> Result<(), GitHubError> {
        let url = format!(
            "{}/repos/{}/{}/pulls/{}/reviews",
            GITHUB_API_BASE, owner, repo, pr_number
        );

        let gh_comments: Vec<serde_json::Value> = comments
            .iter()
            .map(|c| {
                let mut obj = serde_json::json!({
                    "path": c.path,
                    "line": c.line,
                    "side": c.side,
                    "body": c.body,
                });
                if let Some(start) = c.start_line {
                    obj["start_line"] = serde_json::json!(start);
                    obj["start_side"] = serde_json::json!(c.side);
                }
                obj
            })
            .collect();

        let request_body = serde_json::json!({
            "event": event,
            "body": body,
            "comments": gh_comments,
        });

        let resp = self
            .http
            .post(&url)
            .header(AUTHORIZATION, format!("Bearer {}", self.token))
            .header(USER_AGENT, APP_USER_AGENT)
            .header(ACCEPT, "application/vnd.github+json")
            .header(CONTENT_TYPE, "application/json")
            .body(request_body.to_string())
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let message = resp.text().await.unwrap_or_default();
            return Err(GitHubError::Api {
                status: status.as_u16(),
                message,
            });
        }

        Ok(())
    }

    /// Fetch the aggregate file diffs for a PR (base vs head).
    /// Uses GitHub's `GET /repos/{owner}/{repo}/pulls/{pr_number}/files` endpoint.
    pub async fn get_pr_files(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<Vec<FileDiff>, GitHubError> {
        let mut all_files = Vec::new();
        let mut page = 1u32;
        loop {
            let url = format!(
                "{}/repos/{}/{}/pulls/{}/files?per_page=100&page={}",
                GITHUB_API_BASE, owner, repo, pr_number, page
            );
            let files: Vec<GhFile> = self.get_json(&url).await?;
            let batch_len = files.len();
            all_files.extend(files.into_iter().map(|f| FileDiff {
                path: f.filename,
                status: parse_file_status(&f.status),
                additions: f.additions,
                deletions: f.deletions,
                patch: f.patch,
            }));
            if batch_len < 100 {
                break;
            }
            page += 1;
        }
        Ok(all_files)
    }

    /// Check if a PR is mergeable.
    pub async fn get_merge_status(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<MergeStatus, GitHubError> {
        let url = format!(
            "{}/repos/{}/{}/pulls/{}",
            GITHUB_API_BASE, owner, repo, pr_number
        );

        let resp = self.get_json::<serde_json::Value>(&url).await?;
        let mergeable = resp["mergeable"].as_bool().unwrap_or(false);
        let mergeable_state = resp["mergeable_state"]
            .as_str()
            .unwrap_or("unknown")
            .to_string();

        Ok(MergeStatus {
            mergeable,
            mergeable_state,
        })
    }

    /// Merge a pull request.
    pub async fn merge_pr(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
        commit_title: &str,
        commit_message: &str,
        merge_method: &str,
    ) -> Result<(), GitHubError> {
        let url = format!(
            "{}/repos/{}/{}/pulls/{}/merge",
            GITHUB_API_BASE, owner, repo, pr_number
        );

        let request_body = serde_json::json!({
            "commit_title": commit_title,
            "commit_message": commit_message,
            "merge_method": merge_method,
        });

        let resp = self
            .http
            .put(&url)
            .header(AUTHORIZATION, format!("Bearer {}", self.token))
            .header(USER_AGENT, APP_USER_AGENT)
            .header(ACCEPT, "application/vnd.github+json")
            .header(CONTENT_TYPE, "application/json")
            .body(request_body.to_string())
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let message = resp.text().await.unwrap_or_default();
            return Err(GitHubError::Api {
                status: status.as_u16(),
                message,
            });
        }

        Ok(())
    }

    /// Fetch open pull requests assigned to the authenticated user across all repos.
    /// Uses the GitHub search API with `assignee:@me`.
    pub async fn list_assigned_prs(&self) -> Result<Vec<AssignedPullRequest>, GitHubError> {
        let mut all_prs = Vec::new();
        let mut page = 1u32;

        loop {
            let url = format!(
                "{}/search/issues?q=type:pr+state:open+assignee:@me&sort=updated&order=desc&per_page=100&page={}",
                GITHUB_API_BASE, page
            );

            let result: GhSearchResult = self.get_json(&url).await?;
            let batch_len = result.items.len();

            for item in result.items {
                let (owner, name) = parse_repo_from_url(&item.repository_url);
                let full_name = format!("{}/{}", owner, name);
                all_prs.push(AssignedPullRequest {
                    repo_owner: owner,
                    repo_name: name,
                    repo_full_name: full_name,
                    number: item.number,
                    title: item.title,
                    author: item.user.login,
                    state: item.state,
                    created_at: item.created_at,
                    updated_at: item.updated_at,
                });
            }

            if batch_len < 100 {
                break;
            }
            page += 1;
        }

        Ok(all_prs)
    }

    async fn get_json<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
    ) -> Result<T, GitHubError> {
        let resp = self
            .http
            .get(url)
            .header(AUTHORIZATION, format!("Bearer {}", self.token))
            .header(USER_AGENT, APP_USER_AGENT)
            .header(ACCEPT, "application/vnd.github+json")
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let message = resp.text().await.unwrap_or_default();
            return Err(GitHubError::Api {
                status: status.as_u16(),
                message,
            });
        }

        Ok(resp.json().await?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_github_error_display() {
        let err = GitHubError::Api {
            status: 401,
            message: "Bad credentials".into(),
        };
        assert!(err.to_string().contains("401"));
        assert!(err.to_string().contains("Bad credentials"));
    }

    #[test]
    fn test_github_error_no_token() {
        let err = GitHubError::NoToken;
        assert!(err.to_string().contains("No GitHub token"));
    }

    #[test]
    fn test_extract_ticket_prefix_valid() {
        assert_eq!(extract_ticket_prefix("CPT-123: fix login"), Some("CPT-123".into()));
        assert_eq!(extract_ticket_prefix("AB-1 some change"), Some("AB-1".into()));
        assert_eq!(extract_ticket_prefix("PROJ-9999"), Some("PROJ-9999".into()));
    }

    #[test]
    fn test_extract_ticket_prefix_invalid() {
        assert_eq!(extract_ticket_prefix("fix: something"), None);
        assert_eq!(extract_ticket_prefix("lowercase-123"), None);
        assert_eq!(extract_ticket_prefix("AB-"), None);
        assert_eq!(extract_ticket_prefix(""), None);
        assert_eq!(extract_ticket_prefix("123-ABC"), None);
    }

    #[test]
    fn test_is_trunk_merge_multiple_parents() {
        assert!(is_trunk_merge("normal message", 2));
    }

    #[test]
    fn test_is_trunk_merge_message_pattern() {
        assert!(is_trunk_merge("Merge branch 'main' into feature", 1));
        assert!(is_trunk_merge("Merge pull request #42 from org/branch", 1));
    }

    #[test]
    fn test_is_not_trunk_merge() {
        assert!(!is_trunk_merge("feat: add login page", 1));
        assert!(!is_trunk_merge("CPT-123: fix bug", 1));
    }

    #[test]
    fn test_parse_repo_from_url() {
        let (owner, repo) = parse_repo_from_url("https://api.github.com/repos/acme/widget");
        assert_eq!(owner, "acme");
        assert_eq!(repo, "widget");
    }

    #[test]
    fn test_parse_repo_from_url_org() {
        let (owner, repo) =
            parse_repo_from_url("https://api.github.com/repos/my-org/my-project");
        assert_eq!(owner, "my-org");
        assert_eq!(repo, "my-project");
    }

    #[test]
    fn test_parse_file_status() {
        assert!(matches!(parse_file_status("added"), FileStatus::Added));
        assert!(matches!(parse_file_status("removed"), FileStatus::Removed));
        assert!(matches!(parse_file_status("renamed"), FileStatus::Renamed));
        assert!(matches!(parse_file_status("modified"), FileStatus::Modified));
        assert!(matches!(parse_file_status("changed"), FileStatus::Modified));
    }
}
