use crate::commands::git_provider::{MergeStatus, ReviewComment};
use crate::models::github::{
    AssignedPullRequest, CombinedCheckStatus, FileDiff, PullRequest, Repo,
};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitProviderType {
    GitHub,
    GitLab,
    Bitbucket,
}

impl Default for GitProviderType {
    fn default() -> Self {
        GitProviderType::GitHub
    }
}

#[derive(Error, Debug)]
pub enum GitProviderError {
    #[error("HTTP request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("API error ({status}): {message}")]
    Api { status: u16, message: String },
    #[error("No token configured")]
    NoToken,
    #[error("Provider not yet implemented: {0}")]
    NotImplemented(String),
}

impl serde::Serialize for GitProviderError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[async_trait]
pub trait GitProvider: Send + Sync {
    fn name(&self) -> &str;

    async fn get_authenticated_user(&self) -> Result<String, GitProviderError>;

    async fn list_repos(&self) -> Result<Vec<Repo>, GitProviderError>;

    async fn list_open_pull_requests(
        &self,
        owner: &str,
        repo: &str,
    ) -> Result<Vec<PullRequest>, GitProviderError>;

    async fn list_assigned_prs(&self) -> Result<Vec<AssignedPullRequest>, GitProviderError>;

    async fn get_pr_detail(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<PullRequest, GitProviderError>;

    async fn submit_review(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
        event: &str,
        body: &str,
        comments: &[ReviewComment],
    ) -> Result<(), GitProviderError>;

    async fn get_merge_status(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<MergeStatus, GitProviderError>;

    async fn merge_pr(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
        commit_title: &str,
        commit_message: &str,
        merge_method: &str,
    ) -> Result<(), GitProviderError>;

    async fn get_pr_files(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<Vec<FileDiff>, GitProviderError>;

    async fn get_check_status(
        &self,
        owner: &str,
        repo: &str,
        git_ref: &str,
    ) -> Result<CombinedCheckStatus, GitProviderError>;
}

/// Create a git provider instance based on the provider type.
pub fn create_git_provider(
    provider_type: GitProviderType,
    token: String,
) -> Box<dyn GitProvider> {
    match provider_type {
        GitProviderType::GitHub => {
            Box::new(crate::services::github::GitHubProvider::new(token))
        }
        GitProviderType::GitLab => {
            Box::new(crate::services::gitlab::GitLabProvider::new(token))
        }
        GitProviderType::Bitbucket => {
            Box::new(crate::services::bitbucket::BitbucketProvider::new(token))
        }
    }
}
