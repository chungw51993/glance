use crate::models::github::{AssignedPullRequest, CombinedCheckStatus, FileDiff, PullRequest, Repo};
use crate::models::provider::AiProviderType;
use crate::models::review::AiReviewSummary;
use crate::providers::factory::create_provider;
use crate::services::github::GitHubClient;
use crate::services::tickets::asana::AsanaProvider;
use crate::services::tickets::github_issues::GitHubIssuesProvider;
use crate::services::tickets::jira::JiraProvider;
use crate::services::tickets::linear::LinearProvider;
use crate::services::tickets::{self, Ticket, TicketProvider};
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

/// Build all configured ticket providers based on stored tokens.
fn build_ticket_providers(
    app_handle: &tauri::AppHandle,
    owner: &str,
    repo: &str,
) -> Vec<Box<dyn TicketProvider>> {
    let mut providers: Vec<Box<dyn TicketProvider>> = Vec::new();

    if let Ok(token) = get_token_from_store(app_handle, TokenType::Linear) {
        providers.push(Box::new(LinearProvider::new(token)));
    }
    if let Ok(creds) = get_token_from_store(app_handle, TokenType::JiraCredentials) {
        if let Ok(store) = app_handle.store(preferences::store_path()) {
            let domain = preferences::get_jira_domain(&store);
            if !domain.is_empty() {
                providers.push(Box::new(JiraProvider::new(creds, domain)));
            }
        }
    }
    if let Ok(token) = get_token_from_store(app_handle, TokenType::GitHub) {
        providers.push(Box::new(GitHubIssuesProvider::new(
            token,
            owner.to_string(),
            repo.to_string(),
        )));
    }
    if let Ok(token) = get_token_from_store(app_handle, TokenType::Asana) {
        providers.push(Box::new(AsanaProvider::new(token)));
    }

    providers
}

/// Fetch tickets from all configured providers concurrently.
async fn fetch_all_tickets(
    providers: &[Box<dyn TicketProvider>],
    title: &str,
    body: Option<&str>,
    commit_messages: &[String],
) -> Vec<Ticket> {
    let provider_refs: Vec<&dyn TicketProvider> =
        providers.iter().map(|p| p.as_ref()).collect();
    let id_groups = tickets::collect_identifiers(
        &provider_refs,
        title,
        body,
        commit_messages,
    );

    if id_groups.is_empty() {
        return vec![];
    }

    let mut all_tickets = Vec::new();
    // Fetch sequentially per provider to avoid lifetime issues with trait objects.
    // Typical PR has 1-3 providers configured, so this is fast enough.
    for (idx, ids) in id_groups {
        match providers[idx].fetch_tickets(&ids).await {
            Ok(t) => all_tickets.extend(t),
            Err(e) => eprintln!("Ticket fetch error: {}", e),
        }
    }

    all_tickets
}

#[tauri::command]
pub async fn get_authenticated_user(app_handle: tauri::AppHandle) -> Result<String, String> {
    let token = get_token_from_store(&app_handle, TokenType::GitHub)?;
    let client = GitHubClient::new(token);
    client.get_authenticated_user().await.map_err(|e| e.to_string())
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

    // Best-effort: fetch tickets from all configured providers for AI context.
    let providers = build_ticket_providers(&app_handle, &owner, &repo);
    let commit_messages: Vec<String> = pr.commits.iter().map(|c| c.message.clone()).collect();
    let all_tickets = fetch_all_tickets(
        &providers,
        &pr.title,
        pr.body.as_deref(),
        &commit_messages,
    )
    .await;

    let prompt = review::build_review_prompt(&pr, &all_tickets);

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

#[tauri::command]
pub async fn get_check_status(
    app_handle: tauri::AppHandle,
    owner: String,
    repo: String,
    head_sha: String,
) -> Result<CombinedCheckStatus, String> {
    let token = get_token_from_store(&app_handle, TokenType::GitHub)?;
    let client = GitHubClient::new(token);
    client
        .get_check_status(&owner, &repo, &head_sha)
        .await
        .map_err(|e| e.to_string())
}

/// Fetch tickets from all configured providers for the given PR metadata.
///
/// Returns an error string starting with "NO_TOKEN:" when no ticket provider
/// tokens are configured, so the frontend can show a targeted message.
#[tauri::command]
pub async fn fetch_tickets(
    app_handle: tauri::AppHandle,
    owner: String,
    repo: String,
    title: String,
    body: Option<String>,
    commit_messages: Vec<String>,
) -> Result<Vec<Ticket>, String> {
    let providers = build_ticket_providers(&app_handle, &owner, &repo);
    if providers.is_empty() {
        return Err("NO_TOKEN: No ticket provider tokens configured. Add one in Settings to see ticket context.".into());
    }

    let result = fetch_all_tickets(
        &providers,
        &title,
        body.as_deref(),
        &commit_messages,
    )
    .await;

    Ok(result)
}
