use crate::models::github::{AssignedPullRequest, FileDiff, PullRequest, Repo};
use crate::models::linear::LinearTicket;
use crate::models::provider::AiProviderType;
use crate::models::review::AiReviewSummary;
use crate::providers::factory::create_provider;
use crate::services::github::GitHubClient;
use crate::services::linear::{self, LinearClient};
use crate::services::{preferences, review, token_manager};
use crate::services::token_manager::TokenType;
use serde::{Deserialize, Serialize};
use tauri_plugin_store::StoreExt;

/// Helper to get a token from the store, returning a user-friendly error.
fn get_token_from_store(
    app_handle: &tauri::AppHandle,
    token_type: TokenType,
) -> Result<String, String> {
    let store = app_handle
        .store(token_manager::tokens_store_path())
        .map_err(|e| e.to_string())?;
    token_manager::get_token(&store, token_type).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_repos(app_handle: tauri::AppHandle) -> Result<Vec<Repo>, String> {
    let token = get_token_from_store(&app_handle, TokenType::GitHub)?;
    let client = GitHubClient::new(token);
    client.list_repos().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_open_pull_requests(
    app_handle: tauri::AppHandle,
    owner: String,
    repo: String,
) -> Result<Vec<PullRequest>, String> {
    let token = get_token_from_store(&app_handle, TokenType::GitHub)?;
    let client = GitHubClient::new(token);
    client
        .list_open_pull_requests(&owner, &repo)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_assigned_prs(
    app_handle: tauri::AppHandle,
) -> Result<Vec<AssignedPullRequest>, String> {
    let token = get_token_from_store(&app_handle, TokenType::GitHub)?;
    let client = GitHubClient::new(token);
    client
        .list_assigned_prs()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_pull_request_detail(
    app_handle: tauri::AppHandle,
    owner: String,
    repo: String,
    pr_number: u64,
) -> Result<PullRequest, String> {
    let token = get_token_from_store(&app_handle, TokenType::GitHub)?;
    let client = GitHubClient::new(token);
    client
        .get_pr_detail(&owner, &repo, pr_number)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn run_ai_review(
    app_handle: tauri::AppHandle,
    owner: String,
    repo: String,
    pr_number: u64,
) -> Result<AiReviewSummary, String> {
    let token = get_token_from_store(&app_handle, TokenType::GitHub)?;
    let client = GitHubClient::new(token);
    let pr = client
        .get_pr_detail(&owner, &repo, pr_number)
        .await
        .map_err(|e| e.to_string())?;

    // Best-effort: fetch Linear tickets for AI context. If no token or fetch
    // fails, proceed with empty context -- the review still runs.
    let linear_tickets = (|| async {
        let linear_token = get_token_from_store(&app_handle, TokenType::Linear).ok()?;
        let commit_messages: Vec<String> = pr.commits.iter().map(|c| c.message.clone()).collect();
        let identifiers = linear::collect_ticket_identifiers(
            &pr.title,
            pr.body.as_deref(),
            &commit_messages,
        );
        if identifiers.is_empty() {
            return Some(vec![]);
        }
        let linear_client = LinearClient::new(linear_token);
        linear_client.get_tickets_by_identifiers(&identifiers).await.ok()
    })()
    .await
    .unwrap_or_default();

    let prompt = review::build_review_prompt(&pr, &linear_tickets);

    let store = app_handle
        .store(preferences::store_path())
        .map_err(|e| e.to_string())?;
    let config = preferences::get_provider_config(&store);

    let api_key_or_url = match config.provider_type {
        AiProviderType::Ollama => preferences::get_ollama_url(&store),
        _ => {
            let api_token_type = match config.provider_type {
                AiProviderType::Anthropic => TokenType::AnthropicApiKey,
                AiProviderType::OpenAi => TokenType::OpenAiApiKey,
                AiProviderType::Ollama => unreachable!(),
            };
            get_token_from_store(&app_handle, api_token_type)?
        }
    };

    let provider = create_provider(config.provider_type, api_key_or_url, config.model_id);
    provider.review(&prompt).await.map_err(|e| e.to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReviewComment {
    pub path: String,
    pub line: u64,
    pub start_line: Option<u64>,
    pub side: String,
    pub body: String,
}

#[tauri::command]
pub async fn submit_pr_review(
    app_handle: tauri::AppHandle,
    owner: String,
    repo: String,
    pr_number: u64,
    event: String,
    body: String,
    comments: Vec<ReviewComment>,
) -> Result<(), String> {
    let token = get_token_from_store(&app_handle, TokenType::GitHub)?;
    let client = GitHubClient::new(token);
    client
        .submit_review(&owner, &repo, pr_number, &event, &body, &comments)
        .await
        .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MergeStatus {
    pub mergeable: bool,
    pub mergeable_state: String,
}

#[tauri::command]
pub async fn get_pr_merge_status(
    app_handle: tauri::AppHandle,
    owner: String,
    repo: String,
    pr_number: u64,
) -> Result<MergeStatus, String> {
    let token = get_token_from_store(&app_handle, TokenType::GitHub)?;
    let client = GitHubClient::new(token);
    client
        .get_merge_status(&owner, &repo, pr_number)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn merge_pull_request(
    app_handle: tauri::AppHandle,
    owner: String,
    repo: String,
    pr_number: u64,
    commit_title: String,
    commit_message: String,
    merge_method: String,
) -> Result<(), String> {
    let token = get_token_from_store(&app_handle, TokenType::GitHub)?;
    let client = GitHubClient::new(token);
    client
        .merge_pr(
            &owner,
            &repo,
            pr_number,
            &commit_title,
            &commit_message,
            &merge_method,
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_pr_files(
    app_handle: tauri::AppHandle,
    owner: String,
    repo: String,
    pr_number: u64,
) -> Result<Vec<FileDiff>, String> {
    let token = get_token_from_store(&app_handle, TokenType::GitHub)?;
    let client = GitHubClient::new(token);
    client
        .get_pr_files(&owner, &repo, pr_number)
        .await
        .map_err(|e| e.to_string())
}

/// Extract ticket identifiers from PR title, body, and commit messages,
/// then fetch their details from Linear.
///
/// Returns an error string starting with "NO_TOKEN:" when no Linear token
/// is configured, so the frontend can show a targeted message.
#[tauri::command]
pub async fn fetch_linear_tickets(
    app_handle: tauri::AppHandle,
    title: String,
    body: Option<String>,
    commit_messages: Vec<String>,
) -> Result<Vec<LinearTicket>, String> {
    let token = match get_token_from_store(&app_handle, TokenType::Linear) {
        Ok(t) => t,
        Err(_) => return Err("NO_TOKEN: No Linear API token configured. Add one in Settings to see ticket context.".into()),
    };

    let identifiers = linear::collect_ticket_identifiers(
        &title,
        body.as_deref(),
        &commit_messages,
    );

    if identifiers.is_empty() {
        return Ok(vec![]);
    }

    let client = LinearClient::new(token);
    client
        .get_tickets_by_identifiers(&identifiers)
        .await
        .map_err(|e| e.to_string())
}
