use crate::commands::git_provider::{MergeStatus, ReviewComment};
use crate::models::github::{
    AssignedPullRequest, CombinedCheckStatus, FileDiff, PullRequest, Repo,
};
use crate::services::git_provider::{GitProvider, GitProviderError};
use async_trait::async_trait;

pub struct GitLabProvider {
    #[allow(dead_code)]
    token: String,
}

impl GitLabProvider {
    pub fn new(token: String) -> Self {
        Self { token }
    }
}

#[async_trait]
impl GitProvider for GitLabProvider {
    fn name(&self) -> &str {
        "GitLab"
    }

    async fn get_authenticated_user(&self) -> Result<String, GitProviderError> {
        Err(GitProviderError::NotImplemented("GitLab".into()))
    }

    async fn list_repos(&self) -> Result<Vec<Repo>, GitProviderError> {
        Err(GitProviderError::NotImplemented("GitLab".into()))
    }

    async fn list_open_pull_requests(
        &self,
        _owner: &str,
        _repo: &str,
    ) -> Result<Vec<PullRequest>, GitProviderError> {
        Err(GitProviderError::NotImplemented("GitLab".into()))
    }

    async fn list_assigned_prs(&self) -> Result<Vec<AssignedPullRequest>, GitProviderError> {
        Err(GitProviderError::NotImplemented("GitLab".into()))
    }

    async fn get_pr_detail(
        &self,
        _owner: &str,
        _repo: &str,
        _pr_number: u64,
    ) -> Result<PullRequest, GitProviderError> {
        Err(GitProviderError::NotImplemented("GitLab".into()))
    }

    async fn submit_review(
        &self,
        _owner: &str,
        _repo: &str,
        _pr_number: u64,
        _event: &str,
        _body: &str,
        _comments: &[ReviewComment],
    ) -> Result<(), GitProviderError> {
        Err(GitProviderError::NotImplemented("GitLab".into()))
    }

    async fn get_merge_status(
        &self,
        _owner: &str,
        _repo: &str,
        _pr_number: u64,
    ) -> Result<MergeStatus, GitProviderError> {
        Err(GitProviderError::NotImplemented("GitLab".into()))
    }

    async fn merge_pr(
        &self,
        _owner: &str,
        _repo: &str,
        _pr_number: u64,
        _commit_title: &str,
        _commit_message: &str,
        _merge_method: &str,
    ) -> Result<(), GitProviderError> {
        Err(GitProviderError::NotImplemented("GitLab".into()))
    }

    async fn get_pr_files(
        &self,
        _owner: &str,
        _repo: &str,
        _pr_number: u64,
    ) -> Result<Vec<FileDiff>, GitProviderError> {
        Err(GitProviderError::NotImplemented("GitLab".into()))
    }

    async fn get_check_status(
        &self,
        _owner: &str,
        _repo: &str,
        _git_ref: &str,
    ) -> Result<CombinedCheckStatus, GitProviderError> {
        Err(GitProviderError::NotImplemented("GitLab".into()))
    }
}
