use crate::commands::git_provider::{MergeStatus, ReviewComment};
use crate::models::github::{
    AssignedPullRequest, AssignmentSource, CheckRun, CombinedCheckStatus, Commit, FileDiff,
    FileStatus, PullRequest, Repo,
};
use crate::services::git_provider::{GitProvider, GitProviderError};
use async_trait::async_trait;
use reqwest::header::{CONTENT_TYPE, USER_AGENT};
use serde::Deserialize;

const GITLAB_API_BASE: &str = "https://gitlab.com/api/v4";
const APP_USER_AGENT: &str = "pr-reviewer/0.1.0";

// ---------------------------------------------------------------------------
// GitLab API response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct GlUser {
    username: String,
}

#[derive(Deserialize)]
struct GlProject {
    #[allow(dead_code)]
    id: u64,
    path_with_namespace: String,
    namespace: GlNamespace,
    path: String,
    default_branch: Option<String>,
    open_issues_count: Option<u32>,
    last_activity_at: Option<String>,
    forked_from_project: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct GlNamespace {
    path: String,
}

#[derive(Deserialize)]
struct GlMergeRequest {
    iid: u64,
    #[allow(dead_code)]
    project_id: u64,
    title: String,
    description: Option<String>,
    author: GlAuthor,
    target_branch: String,
    source_branch: String,
    state: String,
    created_at: String,
    updated_at: String,
    diff_refs: Option<GlDiffRefs>,
    merge_status: Option<String>,
    #[allow(dead_code)]
    sha: Option<String>,
}

#[derive(Deserialize)]
struct GlAuthor {
    username: String,
}

#[derive(Deserialize)]
struct GlDiffRefs {
    base_sha: String,
    head_sha: String,
    start_sha: String,
}

#[derive(Deserialize)]
struct GlCommit {
    id: String,
    title: String,
    author_name: String,
    created_at: String,
    parent_ids: Vec<String>,
}

#[derive(Deserialize)]
struct GlMrChanges {
    changes: Option<Vec<GlDiff>>,
}

#[derive(Deserialize)]
struct GlDiff {
    new_path: String,
    new_file: bool,
    renamed_file: bool,
    deleted_file: bool,
    diff: String,
}

#[derive(Deserialize)]
struct GlPipeline {
    id: u64,
    #[allow(dead_code)]
    status: String,
}

#[derive(Deserialize)]
struct GlJob {
    name: String,
    status: String,
    web_url: Option<String>,
}

/// Response type for the `/merge_requests` list endpoints which include
/// `web_url` for deriving the project path.
#[derive(Deserialize)]
struct GlAssignedMergeRequest {
    iid: u64,
    project_id: u64,
    title: String,
    #[allow(dead_code)]
    description: Option<String>,
    author: GlAuthor,
    #[allow(dead_code)]
    target_branch: String,
    #[allow(dead_code)]
    source_branch: String,
    state: String,
    created_at: String,
    updated_at: String,
    web_url: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// URL-encode a GitLab project path (owner/repo -> owner%2Frepo).
fn encode_project_path(owner: &str, repo: &str) -> String {
    format!("{}%2F{}", owner, repo)
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

fn gl_file_status(diff: &GlDiff) -> FileStatus {
    if diff.new_file {
        FileStatus::Added
    } else if diff.deleted_file {
        FileStatus::Removed
    } else if diff.renamed_file {
        FileStatus::Renamed
    } else {
        FileStatus::Modified
    }
}

/// Count additions and deletions from a unified diff string.
/// Lines starting with `+` (but not `+++`) are additions.
/// Lines starting with `-` (but not `---`) are deletions.
fn count_diff_stats(diff: &str) -> (u32, u32) {
    let mut additions: u32 = 0;
    let mut deletions: u32 = 0;
    for line in diff.lines() {
        if line.starts_with('+') && !line.starts_with("+++") {
            additions += 1;
        } else if line.starts_with('-') && !line.starts_with("---") {
            deletions += 1;
        }
    }
    (additions, deletions)
}

/// Map a GitLab pipeline job status to a (status, conclusion) pair compatible
/// with the CheckRun model.
fn map_job_status(gl_status: &str) -> (String, Option<String>) {
    match gl_status {
        "success" => ("completed".to_string(), Some("success".to_string())),
        "failed" => ("completed".to_string(), Some("failure".to_string())),
        "canceled" | "cancelled" => ("completed".to_string(), Some("cancelled".to_string())),
        "skipped" => ("completed".to_string(), Some("skipped".to_string())),
        "running" => ("in_progress".to_string(), None),
        "pending" | "waiting_for_resource" | "created" => ("queued".to_string(), None),
        "manual" => ("queued".to_string(), Some("action_required".to_string())),
        _ => ("queued".to_string(), None),
    }
}

/// Parse (owner, repo_name) from a GitLab MR web_url.
/// Format: `https://gitlab.com/owner/repo/-/merge_requests/123`
/// For subgroups: `https://gitlab.com/group/subgroup/repo/-/merge_requests/123`
fn parse_project_from_web_url(web_url: &str) -> (String, String) {
    if let Some(idx) = web_url.find("/-/") {
        let before = &web_url[..idx];
        if let Some(path_start) = before.find("://") {
            let after_proto = &before[path_start + 3..];
            if let Some(slash_idx) = after_proto.find('/') {
                let project_path = &after_proto[slash_idx + 1..];
                if let Some(last_slash) = project_path.rfind('/') {
                    let owner = &project_path[..last_slash];
                    let name = &project_path[last_slash + 1..];
                    return (owner.to_string(), name.to_string());
                }
                return (project_path.to_string(), String::new());
            }
        }
    }
    ("unknown".to_string(), "unknown".to_string())
}

fn diff_to_file_diff(d: &GlDiff) -> FileDiff {
    let (additions, deletions) = count_diff_stats(&d.diff);
    FileDiff {
        path: d.new_path.clone(),
        status: gl_file_status(d),
        additions,
        deletions,
        patch: if d.diff.is_empty() {
            None
        } else {
            Some(d.diff.clone())
        },
    }
}

// ---------------------------------------------------------------------------
// GitLabClient
// ---------------------------------------------------------------------------

struct GitLabClient {
    http: reqwest::Client,
    token: String,
}

impl GitLabClient {
    fn new(token: String) -> Self {
        let http = reqwest::Client::new();
        Self { http, token }
    }

    async fn get_json<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
    ) -> Result<T, GitProviderError> {
        let resp = self
            .http
            .get(url)
            .header("PRIVATE-TOKEN", &self.token)
            .header(USER_AGENT, APP_USER_AGENT)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let message = resp.text().await.unwrap_or_default();
            return Err(GitProviderError::Api {
                status: status.as_u16(),
                message,
            });
        }

        Ok(resp.json().await?)
    }

    async fn post_json(
        &self,
        url: &str,
        body: &serde_json::Value,
    ) -> Result<(), GitProviderError> {
        let resp = self
            .http
            .post(url)
            .header("PRIVATE-TOKEN", &self.token)
            .header(USER_AGENT, APP_USER_AGENT)
            .header(CONTENT_TYPE, "application/json")
            .body(body.to_string())
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let message = resp.text().await.unwrap_or_default();
            return Err(GitProviderError::Api {
                status: status.as_u16(),
                message,
            });
        }

        Ok(())
    }

    async fn put_json(
        &self,
        url: &str,
        body: &serde_json::Value,
    ) -> Result<(), GitProviderError> {
        let resp = self
            .http
            .put(url)
            .header("PRIVATE-TOKEN", &self.token)
            .header(USER_AGENT, APP_USER_AGENT)
            .header(CONTENT_TYPE, "application/json")
            .body(body.to_string())
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let message = resp.text().await.unwrap_or_default();
            return Err(GitProviderError::Api {
                status: status.as_u16(),
                message,
            });
        }

        Ok(())
    }

    // -- API methods --------------------------------------------------------

    async fn get_authenticated_user(&self) -> Result<String, GitProviderError> {
        let url = format!("{}/user", GITLAB_API_BASE);
        let user: GlUser = self.get_json(&url).await?;
        Ok(user.username)
    }

    async fn list_repos(&self) -> Result<Vec<Repo>, GitProviderError> {
        let mut all_repos = Vec::new();
        let mut page = 1u32;

        loop {
            let url = format!(
                "{}/projects?membership=true&archived=false&sort=desc&order_by=updated_at&per_page=100&page={}",
                GITLAB_API_BASE, page
            );

            let gl_projects: Vec<GlProject> = self.get_json(&url).await?;
            let batch_len = gl_projects.len();

            for proj in gl_projects {
                if proj.forked_from_project.is_some() {
                    continue;
                }

                all_repos.push(Repo {
                    owner: proj.namespace.path,
                    name: proj.path,
                    full_name: proj.path_with_namespace,
                    default_branch: proj.default_branch.unwrap_or_else(|| "main".to_string()),
                    open_pr_count: proj.open_issues_count.unwrap_or(0),
                    updated_at: proj.last_activity_at.unwrap_or_default(),
                });
            }

            if batch_len < 100 {
                break;
            }
            page += 1;
        }

        Ok(all_repos)
    }

    async fn list_open_pull_requests(
        &self,
        owner: &str,
        repo: &str,
    ) -> Result<Vec<PullRequest>, GitProviderError> {
        let encoded_path = encode_project_path(owner, repo);
        let mut all_prs = Vec::new();
        let mut page = 1u32;

        loop {
            let url = format!(
                "{}/projects/{}/merge_requests?state=opened&sort=desc&order_by=updated_at&per_page=100&page={}",
                GITLAB_API_BASE, encoded_path, page
            );

            let gl_mrs: Vec<GlMergeRequest> = self.get_json(&url).await?;
            let batch_len = gl_mrs.len();

            for mr in gl_mrs {
                all_prs.push(PullRequest {
                    number: mr.iid,
                    title: mr.title,
                    body: mr.description,
                    author: mr.author.username,
                    base_branch: mr.target_branch,
                    head_branch: mr.source_branch,
                    state: mr.state,
                    created_at: mr.created_at,
                    updated_at: mr.updated_at,
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

    async fn get_pr_detail(
        &self,
        owner: &str,
        repo: &str,
        mr_iid: u64,
    ) -> Result<PullRequest, GitProviderError> {
        let encoded_path = encode_project_path(owner, repo);

        // 1. MR metadata
        let mr_url = format!(
            "{}/projects/{}/merge_requests/{}",
            GITLAB_API_BASE, encoded_path, mr_iid
        );
        let gl_mr: GlMergeRequest = self.get_json(&mr_url).await?;

        // 2. Commits (paginated)
        let mut all_gl_commits = Vec::new();
        let mut page = 1u32;
        loop {
            let url = format!(
                "{}/projects/{}/merge_requests/{}/commits?per_page=100&page={}",
                GITLAB_API_BASE, encoded_path, mr_iid, page
            );
            let gl_commits: Vec<GlCommit> = self.get_json(&url).await?;
            let batch_len = gl_commits.len();
            all_gl_commits.extend(gl_commits);
            if batch_len < 100 {
                break;
            }
            page += 1;
        }

        // 3. Per-commit file diffs
        let mut commits = Vec::with_capacity(all_gl_commits.len());
        for gl_commit in &all_gl_commits {
            let diff_url = format!(
                "{}/projects/{}/repository/commits/{}/diff?per_page=100",
                GITLAB_API_BASE, encoded_path, gl_commit.id
            );
            let diffs: Vec<GlDiff> = self.get_json(&diff_url).await?;

            let files: Vec<FileDiff> = diffs.iter().map(diff_to_file_diff).collect();

            let message = &gl_commit.title;
            let parent_count = gl_commit.parent_ids.len();

            commits.push(Commit {
                sha: gl_commit.id.clone(),
                message: message.clone(),
                author: gl_commit.author_name.clone(),
                timestamp: gl_commit.created_at.clone(),
                parents: gl_commit.parent_ids.clone(),
                is_trunk_merge: is_trunk_merge(message, parent_count),
                ticket_prefix: extract_ticket_prefix(message),
                files,
            });
        }

        Ok(PullRequest {
            number: gl_mr.iid,
            title: gl_mr.title,
            body: gl_mr.description,
            author: gl_mr.author.username,
            base_branch: gl_mr.target_branch,
            head_branch: gl_mr.source_branch,
            state: gl_mr.state,
            created_at: gl_mr.created_at,
            updated_at: gl_mr.updated_at,
            commits,
            linear_tickets: vec![],
        })
    }

    async fn submit_review(
        &self,
        owner: &str,
        repo: &str,
        mr_iid: u64,
        event: &str,
        body: &str,
        comments: &[ReviewComment],
    ) -> Result<(), GitProviderError> {
        let encoded_path = encode_project_path(owner, repo);

        // For APPROVE, call the approve endpoint
        if event == "APPROVE" {
            let url = format!(
                "{}/projects/{}/merge_requests/{}/approve",
                GITLAB_API_BASE, encoded_path, mr_iid
            );
            self.post_json(&url, &serde_json::json!({})).await?;
        }

        // Post the body as a note (for all event types when body is non-empty)
        if !body.is_empty() {
            let note_url = format!(
                "{}/projects/{}/merge_requests/{}/notes",
                GITLAB_API_BASE, encoded_path, mr_iid
            );
            self.post_json(&note_url, &serde_json::json!({ "body": body }))
                .await?;
        }

        // Post inline comments as discussions
        if !comments.is_empty() {
            // Fetch diff_refs from the MR for positional comments
            let mr_url = format!(
                "{}/projects/{}/merge_requests/{}",
                GITLAB_API_BASE, encoded_path, mr_iid
            );
            let gl_mr: GlMergeRequest = self.get_json(&mr_url).await?;

            let diff_refs = gl_mr.diff_refs.ok_or_else(|| GitProviderError::Api {
                status: 422,
                message: "MR has no diff_refs; cannot post inline comments".to_string(),
            })?;

            for comment in comments {
                let discussion_url = format!(
                    "{}/projects/{}/merge_requests/{}/discussions",
                    GITLAB_API_BASE, encoded_path, mr_iid
                );

                let discussion_body = serde_json::json!({
                    "body": comment.body,
                    "position": {
                        "base_sha": diff_refs.base_sha,
                        "head_sha": diff_refs.head_sha,
                        "start_sha": diff_refs.start_sha,
                        "position_type": "text",
                        "new_path": comment.path,
                        "new_line": comment.line,
                    }
                });

                self.post_json(&discussion_url, &discussion_body).await?;
            }
        }

        Ok(())
    }

    async fn get_merge_status(
        &self,
        owner: &str,
        repo: &str,
        mr_iid: u64,
    ) -> Result<MergeStatus, GitProviderError> {
        let encoded_path = encode_project_path(owner, repo);
        let url = format!(
            "{}/projects/{}/merge_requests/{}",
            GITLAB_API_BASE, encoded_path, mr_iid
        );

        let gl_mr: GlMergeRequest = self.get_json(&url).await?;
        let merge_status_str = gl_mr.merge_status.unwrap_or_else(|| "unknown".to_string());
        let mergeable = merge_status_str == "can_be_merged";

        Ok(MergeStatus {
            mergeable,
            mergeable_state: merge_status_str,
        })
    }

    async fn merge_pr(
        &self,
        owner: &str,
        repo: &str,
        mr_iid: u64,
        commit_title: &str,
        commit_message: &str,
        merge_method: &str,
    ) -> Result<(), GitProviderError> {
        let encoded_path = encode_project_path(owner, repo);
        let url = format!(
            "{}/projects/{}/merge_requests/{}/merge",
            GITLAB_API_BASE, encoded_path, mr_iid
        );

        let full_message = if commit_message.is_empty() {
            commit_title.to_string()
        } else {
            format!("{}\n\n{}", commit_title, commit_message)
        };

        let request_body = match merge_method {
            "squash" => serde_json::json!({
                "merge_commit_message": full_message,
                "squash": true,
                "squash_commit_message": full_message,
            }),
            "rebase" => serde_json::json!({
                "merge_commit_message": full_message,
                "merge_method": "rebase",
            }),
            _ => serde_json::json!({
                "merge_commit_message": full_message,
            }),
        };

        self.put_json(&url, &request_body).await
    }

    async fn get_pr_files(
        &self,
        owner: &str,
        repo: &str,
        mr_iid: u64,
    ) -> Result<Vec<FileDiff>, GitProviderError> {
        let encoded_path = encode_project_path(owner, repo);
        let url = format!(
            "{}/projects/{}/merge_requests/{}/changes",
            GITLAB_API_BASE, encoded_path, mr_iid
        );

        let changes: GlMrChanges = self.get_json(&url).await?;
        let diffs = changes.changes.unwrap_or_default();
        let files = diffs.iter().map(diff_to_file_diff).collect();

        Ok(files)
    }

    async fn get_check_status(
        &self,
        owner: &str,
        repo: &str,
        git_ref: &str,
    ) -> Result<CombinedCheckStatus, GitProviderError> {
        let encoded_path = encode_project_path(owner, repo);

        // Fetch pipelines for the given SHA
        let pipelines_url = format!(
            "{}/projects/{}/pipelines?sha={}&per_page=100",
            GITLAB_API_BASE, encoded_path, git_ref
        );
        let pipelines: Vec<GlPipeline> = self.get_json(&pipelines_url).await?;

        if pipelines.is_empty() {
            return Ok(CombinedCheckStatus {
                state: "success".to_string(),
                total: 0,
                passed: 0,
                failed: 0,
                pending: 0,
                checks: vec![],
            });
        }

        // Use the latest (first) pipeline
        let latest_pipeline = &pipelines[0];

        // Fetch jobs for the latest pipeline
        let mut all_jobs = Vec::new();
        let mut page = 1u32;
        loop {
            let jobs_url = format!(
                "{}/projects/{}/pipelines/{}/jobs?per_page=100&page={}",
                GITLAB_API_BASE, encoded_path, latest_pipeline.id, page
            );
            let jobs: Vec<GlJob> = self.get_json(&jobs_url).await?;
            let batch_len = jobs.len();
            all_jobs.extend(jobs);
            if batch_len < 100 {
                break;
            }
            page += 1;
        }

        let total = all_jobs.len();
        let mut passed = 0usize;
        let mut failed = 0usize;
        let mut pending = 0usize;

        let checks: Vec<CheckRun> = all_jobs
            .into_iter()
            .map(|job| {
                let (status, conclusion) = map_job_status(&job.status);

                match status.as_str() {
                    "completed" => match conclusion.as_deref() {
                        Some("success") | Some("skipped") => passed += 1,
                        _ => failed += 1,
                    },
                    _ => pending += 1,
                }

                CheckRun {
                    name: job.name,
                    status,
                    conclusion,
                    details_url: job.web_url,
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

    async fn list_assigned_prs(&self) -> Result<Vec<AssignedPullRequest>, GitProviderError> {
        let username = self.get_authenticated_user().await?;

        let mut seen = std::collections::HashSet::new();
        let mut merged = Vec::new();

        // 1. Directly assigned MRs
        let mut page = 1u32;
        loop {
            let url = format!(
                "{}/merge_requests?state=opened&scope=assigned_to_me&per_page=100&page={}",
                GITLAB_API_BASE, page
            );
            let mrs: Vec<GlAssignedMergeRequest> = self.get_json(&url).await?;
            let batch_len = mrs.len();

            for mr in mrs {
                let key = format!("{}:{}", mr.project_id, mr.iid);
                if seen.insert(key) {
                    let (owner, name) = mr
                        .web_url
                        .as_deref()
                        .map(parse_project_from_web_url)
                        .unwrap_or_else(|| (mr.project_id.to_string(), "unknown".to_string()));

                    merged.push(AssignedPullRequest {
                        repo_full_name: format!("{}/{}", owner, name),
                        repo_owner: owner,
                        repo_name: name,
                        number: mr.iid,
                        title: mr.title,
                        author: mr.author.username,
                        state: mr.state,
                        created_at: mr.created_at,
                        updated_at: mr.updated_at,
                        assignment_source: AssignmentSource::Direct,
                        team_name: None,
                    });
                }
            }

            if batch_len < 100 {
                break;
            }
            page += 1;
        }

        // 2. MRs where user is a reviewer
        page = 1;
        loop {
            let url = format!(
                "{}/merge_requests?state=opened&reviewer_username={}&per_page=100&page={}",
                GITLAB_API_BASE, username, page
            );
            let mrs: Vec<GlAssignedMergeRequest> = self.get_json(&url).await?;
            let batch_len = mrs.len();

            for mr in mrs {
                let key = format!("{}:{}", mr.project_id, mr.iid);
                if seen.insert(key) {
                    let (owner, name) = mr
                        .web_url
                        .as_deref()
                        .map(parse_project_from_web_url)
                        .unwrap_or_else(|| (mr.project_id.to_string(), "unknown".to_string()));

                    merged.push(AssignedPullRequest {
                        repo_full_name: format!("{}/{}", owner, name),
                        repo_owner: owner,
                        repo_name: name,
                        number: mr.iid,
                        title: mr.title,
                        author: mr.author.username,
                        state: mr.state,
                        created_at: mr.created_at,
                        updated_at: mr.updated_at,
                        assignment_source: AssignmentSource::Direct,
                        team_name: None,
                    });
                }
            }

            if batch_len < 100 {
                break;
            }
            page += 1;
        }

        // Sort by updated_at descending
        merged.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

        Ok(merged)
    }
}

// ---------------------------------------------------------------------------
// GitLabProvider: trait implementation
// ---------------------------------------------------------------------------

pub struct GitLabProvider {
    client: GitLabClient,
}

impl GitLabProvider {
    pub fn new(token: String) -> Self {
        Self {
            client: GitLabClient::new(token),
        }
    }
}

#[async_trait]
impl GitProvider for GitLabProvider {
    fn name(&self) -> &str {
        "GitLab"
    }

    async fn get_authenticated_user(&self) -> Result<String, GitProviderError> {
        self.client.get_authenticated_user().await
    }

    async fn list_repos(&self) -> Result<Vec<Repo>, GitProviderError> {
        self.client.list_repos().await
    }

    async fn list_open_pull_requests(
        &self,
        owner: &str,
        repo: &str,
    ) -> Result<Vec<PullRequest>, GitProviderError> {
        self.client.list_open_pull_requests(owner, repo).await
    }

    async fn list_assigned_prs(&self) -> Result<Vec<AssignedPullRequest>, GitProviderError> {
        self.client.list_assigned_prs().await
    }

    async fn get_pr_detail(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<PullRequest, GitProviderError> {
        self.client.get_pr_detail(owner, repo, pr_number).await
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
        self.client
            .submit_review(owner, repo, pr_number, event, body, comments)
            .await
    }

    async fn get_merge_status(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<MergeStatus, GitProviderError> {
        self.client.get_merge_status(owner, repo, pr_number).await
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
        self.client
            .merge_pr(owner, repo, pr_number, commit_title, commit_message, merge_method)
            .await
    }

    async fn get_pr_files(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<Vec<FileDiff>, GitProviderError> {
        self.client.get_pr_files(owner, repo, pr_number).await
    }

    async fn get_check_status(
        &self,
        owner: &str,
        repo: &str,
        git_ref: &str,
    ) -> Result<CombinedCheckStatus, GitProviderError> {
        self.client.get_check_status(owner, repo, git_ref).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_project_path() {
        assert_eq!(encode_project_path("owner", "repo"), "owner%2Frepo");
        assert_eq!(
            encode_project_path("my-org", "my-project"),
            "my-org%2Fmy-project"
        );
    }

    #[test]
    fn test_count_diff_stats() {
        let diff = r#"@@ -1,3 +1,5 @@
 unchanged
-removed line
+added line
+another added
 still unchanged
+third added
"#;
        let (additions, deletions) = count_diff_stats(diff);
        assert_eq!(additions, 3);
        assert_eq!(deletions, 1);
    }

    #[test]
    fn test_count_diff_stats_with_file_markers() {
        let diff = "--- a/file.rs\n+++ b/file.rs\n@@ -1,2 +1,3 @@\n line\n+new\n";
        let (additions, deletions) = count_diff_stats(diff);
        assert_eq!(additions, 1);
        assert_eq!(deletions, 0);
    }

    #[test]
    fn test_count_diff_stats_empty() {
        let (additions, deletions) = count_diff_stats("");
        assert_eq!(additions, 0);
        assert_eq!(deletions, 0);
    }

    #[test]
    fn test_gl_file_status_new() {
        let diff = GlDiff {
            new_path: "file.rs".into(),
            new_file: true,
            renamed_file: false,
            deleted_file: false,
            diff: String::new(),
        };
        assert!(matches!(gl_file_status(&diff), FileStatus::Added));
    }

    #[test]
    fn test_gl_file_status_deleted() {
        let diff = GlDiff {
            new_path: "file.rs".into(),
            new_file: false,
            renamed_file: false,
            deleted_file: true,
            diff: String::new(),
        };
        assert!(matches!(gl_file_status(&diff), FileStatus::Removed));
    }

    #[test]
    fn test_gl_file_status_renamed() {
        let diff = GlDiff {
            new_path: "file.rs".into(),
            new_file: false,
            renamed_file: true,
            deleted_file: false,
            diff: String::new(),
        };
        assert!(matches!(gl_file_status(&diff), FileStatus::Renamed));
    }

    #[test]
    fn test_gl_file_status_modified() {
        let diff = GlDiff {
            new_path: "file.rs".into(),
            new_file: false,
            renamed_file: false,
            deleted_file: false,
            diff: String::new(),
        };
        assert!(matches!(gl_file_status(&diff), FileStatus::Modified));
    }

    #[test]
    fn test_map_job_status_success() {
        let (status, conclusion) = map_job_status("success");
        assert_eq!(status, "completed");
        assert_eq!(conclusion, Some("success".to_string()));
    }

    #[test]
    fn test_map_job_status_failed() {
        let (status, conclusion) = map_job_status("failed");
        assert_eq!(status, "completed");
        assert_eq!(conclusion, Some("failure".to_string()));
    }

    #[test]
    fn test_map_job_status_running() {
        let (status, conclusion) = map_job_status("running");
        assert_eq!(status, "in_progress");
        assert_eq!(conclusion, None);
    }

    #[test]
    fn test_map_job_status_pending() {
        let (status, conclusion) = map_job_status("pending");
        assert_eq!(status, "queued");
        assert_eq!(conclusion, None);
    }

    #[test]
    fn test_map_job_status_manual() {
        let (status, conclusion) = map_job_status("manual");
        assert_eq!(status, "queued");
        assert_eq!(conclusion, Some("action_required".to_string()));
    }

    #[test]
    fn test_map_job_status_skipped() {
        let (status, conclusion) = map_job_status("skipped");
        assert_eq!(status, "completed");
        assert_eq!(conclusion, Some("skipped".to_string()));
    }

    #[test]
    fn test_map_job_status_canceled() {
        let (status, conclusion) = map_job_status("canceled");
        assert_eq!(status, "completed");
        assert_eq!(conclusion, Some("cancelled".to_string()));
    }

    #[test]
    fn test_parse_project_from_web_url() {
        let (owner, name) = parse_project_from_web_url(
            "https://gitlab.com/myowner/myrepo/-/merge_requests/42",
        );
        assert_eq!(owner, "myowner");
        assert_eq!(name, "myrepo");
    }

    #[test]
    fn test_parse_project_from_web_url_subgroup() {
        let (owner, name) = parse_project_from_web_url(
            "https://gitlab.com/group/subgroup/myrepo/-/merge_requests/7",
        );
        assert_eq!(owner, "group/subgroup");
        assert_eq!(name, "myrepo");
    }

    #[test]
    fn test_parse_project_from_web_url_invalid() {
        let (owner, name) = parse_project_from_web_url("https://example.com/no-dash-slash");
        assert_eq!(owner, "unknown");
        assert_eq!(name, "unknown");
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
    fn test_diff_to_file_diff() {
        let d = GlDiff {
            new_path: "src/main.rs".into(),
            new_file: true,
            renamed_file: false,
            deleted_file: false,
            diff: "+fn main() {}\n+println!(\"hello\");\n".into(),
        };
        let fd = diff_to_file_diff(&d);
        assert_eq!(fd.path, "src/main.rs");
        assert!(matches!(fd.status, FileStatus::Added));
        assert_eq!(fd.additions, 2);
        assert_eq!(fd.deletions, 0);
        assert!(fd.patch.is_some());
    }

    #[test]
    fn test_diff_to_file_diff_empty_patch() {
        let d = GlDiff {
            new_path: "empty.txt".into(),
            new_file: false,
            renamed_file: false,
            deleted_file: false,
            diff: String::new(),
        };
        let fd = diff_to_file_diff(&d);
        assert!(fd.patch.is_none());
    }
}
