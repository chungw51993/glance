# Ticket Provider Trait + Jira, GitHub Issues, Asana

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the hardcoded Linear integration with a `TicketProvider` trait, then add Jira, GitHub Issues, and Asana as additional providers -- all queryable in parallel.

**Architecture:** A `TicketProvider` async trait mirrors the existing `AiProvider` pattern. Each provider implements ticket ID extraction and fetching. The `run_ai_review` and `fetch_tickets` commands query all configured providers concurrently and merge results into a unified `Ticket` model. The frontend generalizes from "Linear" to "Tickets".

**Tech Stack:** Rust (async-trait, reqwest, serde, regex), TypeScript/React frontend, Tauri IPC

---

## Task 1: Create unified Ticket model and TicketProvider trait

**Files:**
- Create: `src-tauri/src/services/tickets/mod.rs`
- Modify: `src-tauri/src/services/mod.rs:1-5`
- Modify: `src-tauri/src/models/mod.rs:1-4`

**Step 1: Create `src-tauri/src/services/tickets/mod.rs` with trait + model**

```rust
pub mod linear;
pub mod jira;
pub mod github_issues;
pub mod asana;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ticket {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub state: String,
    pub labels: Vec<String>,
    pub url: String,
    pub provider: String,
}

#[derive(Error, Debug)]
pub enum TicketError {
    #[error("HTTP request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("API error: {0}")]
    Api(String),
    #[error("No token configured for {0}")]
    NoToken(String),
}

impl serde::Serialize for TicketError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[async_trait]
pub trait TicketProvider: Send + Sync {
    /// Human-readable provider name (e.g. "Linear", "Jira")
    fn name(&self) -> &str;

    /// Extract ticket identifiers this provider recognizes from free text.
    fn extract_identifiers(&self, text: &str) -> Vec<String>;

    /// Fetch ticket details for the given identifiers.
    async fn fetch_tickets(&self, identifiers: &[String]) -> Result<Vec<Ticket>, TicketError>;
}

/// Extract and deduplicate ticket identifiers from PR metadata across all providers.
pub fn collect_identifiers(
    providers: &[&dyn TicketProvider],
    title: &str,
    body: Option<&str>,
    commit_messages: &[String],
) -> Vec<(usize, Vec<String>)> {
    // Returns (provider_index, identifiers) pairs
    providers
        .iter()
        .enumerate()
        .map(|(i, provider)| {
            let mut seen = indexmap::IndexSet::new();
            for id in provider.extract_identifiers(title) {
                seen.insert(id);
            }
            if let Some(b) = body {
                for id in provider.extract_identifiers(b) {
                    seen.insert(id);
                }
            }
            for msg in commit_messages {
                for id in provider.extract_identifiers(msg) {
                    seen.insert(id);
                }
            }
            (i, seen.into_iter().collect())
        })
        .filter(|(_, ids)| !ids.is_empty())
        .collect()
}
```

**Step 2: Add `tickets` module to `src-tauri/src/services/mod.rs`**

Add `pub mod tickets;` alongside existing modules. Keep `pub mod linear;` temporarily for backward compat during migration.

**Step 3: Remove `linear` from `src-tauri/src/models/mod.rs`**

The `LinearTicket` model moves into `services/tickets/mod.rs` as `Ticket`. Remove `pub mod linear;` from models/mod.rs. Keep the file around until all references are migrated.

**Step 4: Run `cargo check` to verify compilation**

Expected: errors about missing `linear`, `jira`, `github_issues`, `asana` modules -- that's fine, we create them next.

**Step 5: Commit**

```
feat: add TicketProvider trait and unified Ticket model
```

---

## Task 2: Migrate Linear to TicketProvider trait

**Files:**
- Create: `src-tauri/src/services/tickets/linear.rs`
- Remove references: `src-tauri/src/services/linear.rs` (old file stays until all refs migrated)

**Step 1: Create `src-tauri/src/services/tickets/linear.rs`**

```rust
use super::{Ticket, TicketError, TicketProvider};
use async_trait::async_trait;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};

const LINEAR_API_URL: &str = "https://api.linear.app/graphql";

pub struct LinearProvider {
    http: reqwest::Client,
    token: String,
}

impl LinearProvider {
    pub fn new(token: String) -> Self {
        Self {
            http: reqwest::Client::new(),
            token,
        }
    }

    async fn fetch_issue_by_identifier(
        &self,
        identifier: &str,
    ) -> Result<Option<Ticket>, TicketError> {
        // Same GraphQL query as existing linear.rs but returns Ticket instead of LinearTicket
        let query = r#"
            query IssueById($id: String!) {
                issue(id: $id) {
                    id
                    identifier
                    title
                    description
                    url
                    state { name }
                    labels { nodes { name } }
                }
            }
        "#;

        let body = serde_json::json!({
            "query": query,
            "variables": { "id": identifier },
        });

        let resp = self
            .http
            .post(LINEAR_API_URL)
            .header(AUTHORIZATION, &self.token)
            .header(CONTENT_TYPE, "application/json")
            .body(body.to_string())
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(TicketError::Api(format!("{}: {}", status, text)));
        }

        let json: serde_json::Value = resp.json().await?;

        if let Some(errors) = json.get("errors") {
            return Err(TicketError::Api(errors.to_string()));
        }

        let node = &json["data"]["issue"];
        if node.is_null() {
            return Ok(None);
        }

        let labels = node["labels"]["nodes"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|l| l["name"].as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        Ok(Some(Ticket {
            id: node["id"].as_str().unwrap_or("").to_string(),
            identifier: node["identifier"].as_str().unwrap_or("").to_string(),
            title: node["title"].as_str().unwrap_or("").to_string(),
            description: node["description"].as_str().map(String::from),
            state: node["state"]["name"].as_str().unwrap_or("").to_string(),
            labels,
            url: node["url"].as_str().unwrap_or("").to_string(),
            provider: "Linear".to_string(),
        }))
    }
}

#[async_trait]
impl TicketProvider for LinearProvider {
    fn name(&self) -> &str {
        "Linear"
    }

    fn extract_identifiers(&self, text: &str) -> Vec<String> {
        let re = regex::Regex::new(r"[A-Z]{2,10}-\d+").unwrap();
        re.find_iter(text).map(|m| m.as_str().to_string()).collect()
    }

    async fn fetch_tickets(&self, identifiers: &[String]) -> Result<Vec<Ticket>, TicketError> {
        if identifiers.is_empty() {
            return Ok(vec![]);
        }
        let mut tickets = Vec::new();
        for identifier in identifiers {
            match self.fetch_issue_by_identifier(identifier).await {
                Ok(Some(ticket)) => tickets.push(ticket),
                Ok(None) => {}
                Err(e) => {
                    eprintln!("Failed to fetch Linear ticket {}: {}", identifier, e);
                }
            }
        }
        Ok(tickets)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_identifiers_single() {
        let provider = LinearProvider::new("fake".into());
        let ids = provider.extract_identifiers("CPT-2324: fix login bug");
        assert_eq!(ids, vec!["CPT-2324"]);
    }

    #[test]
    fn test_extract_identifiers_multiple() {
        let provider = LinearProvider::new("fake".into());
        let ids = provider.extract_identifiers("CPT-12 PA-2342 DATA-5343: combined fix");
        assert_eq!(ids, vec!["CPT-12", "PA-2342", "DATA-5343"]);
    }

    #[test]
    fn test_extract_identifiers_none() {
        let provider = LinearProvider::new("fake".into());
        let ids = provider.extract_identifiers("fix: something broke");
        assert!(ids.is_empty());
    }
}
```

**Step 2: Run `cargo test` on the new module**

Run: `cargo test --lib services::tickets::linear`
Expected: 3 tests pass

**Step 3: Commit**

```
feat: migrate Linear to TicketProvider trait
```

---

## Task 3: Add Jira provider

**Files:**
- Create: `src-tauri/src/services/tickets/jira.rs`

**Step 1: Create Jira provider**

Jira REST API v3 uses Basic Auth (email:api_token base64-encoded). The token stored is `email:api_token`. The domain is stored separately in preferences.

```rust
use super::{Ticket, TicketError, TicketProvider};
use async_trait::async_trait;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};

pub struct JiraProvider {
    http: reqwest::Client,
    domain: String,       // e.g. "mycompany.atlassian.net"
    auth_header: String,  // "Basic <base64(email:token)>"
}

impl JiraProvider {
    /// `credentials` = "email:api_token", `domain` = "mycompany.atlassian.net"
    pub fn new(credentials: String, domain: String) -> Self {
        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode(credentials.as_bytes());
        Self {
            http: reqwest::Client::new(),
            domain,
            auth_header: format!("Basic {}", encoded),
        }
    }

    async fn fetch_issue(&self, key: &str) -> Result<Option<Ticket>, TicketError> {
        let url = format!(
            "https://{}/rest/api/3/issue/{}?fields=summary,description,status,labels",
            self.domain, key
        );

        let resp = self
            .http
            .get(&url)
            .header(AUTHORIZATION, &self.auth_header)
            .header(ACCEPT, "application/json")
            .header(CONTENT_TYPE, "application/json")
            .send()
            .await?;

        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(TicketError::Api(format!("{}", text)));
        }

        let json: serde_json::Value = resp.json().await?;
        let fields = &json["fields"];

        let description = Self::extract_adf_text(fields.get("description"));

        let labels = fields["labels"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|l| l.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        Ok(Some(Ticket {
            id: json["id"].as_str().unwrap_or("").to_string(),
            identifier: json["key"].as_str().unwrap_or("").to_string(),
            title: fields["summary"].as_str().unwrap_or("").to_string(),
            description,
            state: fields["status"]["name"].as_str().unwrap_or("").to_string(),
            labels,
            url: format!("https://{}/browse/{}", self.domain, key),
            provider: "Jira".to_string(),
        }))
    }

    /// Extract plain text from Jira's Atlassian Document Format (ADF).
    /// ADF is deeply nested JSON; we do a best-effort text extraction.
    fn extract_adf_text(value: Option<&serde_json::Value>) -> Option<String> {
        let val = value?;
        if val.is_null() {
            return None;
        }
        // If it's already a string (API v2 fallback), return directly
        if let Some(s) = val.as_str() {
            return Some(s.to_string());
        }
        let mut parts = Vec::new();
        Self::walk_adf_nodes(val, &mut parts);
        if parts.is_empty() {
            None
        } else {
            Some(parts.join(""))
        }
    }

    fn walk_adf_nodes(node: &serde_json::Value, out: &mut Vec<String>) {
        if let Some(text) = node.get("text").and_then(|t| t.as_str()) {
            out.push(text.to_string());
        }
        if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
            for child in content {
                Self::walk_adf_nodes(child, out);
            }
            // Add newline after paragraph-level nodes
            if node.get("type").and_then(|t| t.as_str()) == Some("paragraph") {
                out.push("\n".to_string());
            }
        }
    }
}

#[async_trait]
impl TicketProvider for JiraProvider {
    fn name(&self) -> &str {
        "Jira"
    }

    fn extract_identifiers(&self, text: &str) -> Vec<String> {
        // Same pattern as Linear -- Jira keys are PROJ-123
        let re = regex::Regex::new(r"[A-Z]{2,10}-\d+").unwrap();
        re.find_iter(text).map(|m| m.as_str().to_string()).collect()
    }

    async fn fetch_tickets(&self, identifiers: &[String]) -> Result<Vec<Ticket>, TicketError> {
        if identifiers.is_empty() {
            return Ok(vec![]);
        }
        let mut tickets = Vec::new();
        for key in identifiers {
            match self.fetch_issue(key).await {
                Ok(Some(ticket)) => tickets.push(ticket),
                Ok(None) => {}
                Err(e) => {
                    eprintln!("Failed to fetch Jira issue {}: {}", key, e);
                }
            }
        }
        Ok(tickets)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_identifiers() {
        let provider = JiraProvider::new("a:b".into(), "x.atlassian.net".into());
        let ids = provider.extract_identifiers("PROJ-123 FIX-456: stuff");
        assert_eq!(ids, vec!["PROJ-123", "FIX-456"]);
    }

    #[test]
    fn test_extract_adf_text_plain_string() {
        let val = serde_json::json!("simple description");
        assert_eq!(
            JiraProvider::extract_adf_text(Some(&val)),
            Some("simple description".into())
        );
    }

    #[test]
    fn test_extract_adf_text_document() {
        let val = serde_json::json!({
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "content": [{ "type": "text", "text": "Hello world" }]
            }]
        });
        let result = JiraProvider::extract_adf_text(Some(&val));
        assert_eq!(result, Some("Hello world\n".into()));
    }

    #[test]
    fn test_extract_adf_text_null() {
        let val = serde_json::Value::Null;
        assert_eq!(JiraProvider::extract_adf_text(Some(&val)), None);
    }
}
```

**Step 2: Add `base64` dependency to `Cargo.toml`**

Add: `base64 = "0.22"` to `[dependencies]`

**Step 3: Run tests**

Run: `cargo test --lib services::tickets::jira`
Expected: 4 tests pass

**Step 4: Commit**

```
feat: add Jira ticket provider
```

---

## Task 4: Add GitHub Issues provider

**Files:**
- Create: `src-tauri/src/services/tickets/github_issues.rs`

**Step 1: Create GitHub Issues provider**

This reuses the existing GitHub PAT. It extracts `#123` patterns and fetches from GitHub's Issues API.

```rust
use super::{Ticket, TicketError, TicketProvider};
use async_trait::async_trait;
use reqwest::header::{ACCEPT, AUTHORIZATION, USER_AGENT};

pub struct GitHubIssuesProvider {
    http: reqwest::Client,
    token: String,
    owner: String,
    repo: String,
}

impl GitHubIssuesProvider {
    pub fn new(token: String, owner: String, repo: String) -> Self {
        Self {
            http: reqwest::Client::new(),
            token,
            owner,
            repo,
        }
    }

    async fn fetch_issue(&self, number: &str) -> Result<Option<Ticket>, TicketError> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/issues/{}",
            self.owner, self.repo, number
        );

        let resp = self
            .http
            .get(&url)
            .header(AUTHORIZATION, format!("Bearer {}", self.token))
            .header(ACCEPT, "application/vnd.github+json")
            .header(USER_AGENT, "glance-pr-reviewer")
            .send()
            .await?;

        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(TicketError::Api(text));
        }

        let json: serde_json::Value = resp.json().await?;

        // Skip pull requests (GitHub Issues API returns PRs too)
        if json.get("pull_request").is_some() {
            return Ok(None);
        }

        let labels = json["labels"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|l| l["name"].as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        let state = json["state"].as_str().unwrap_or("open").to_string();

        Ok(Some(Ticket {
            id: json["id"].to_string(),
            identifier: format!("#{}", number),
            title: json["title"].as_str().unwrap_or("").to_string(),
            description: json["body"].as_str().map(String::from),
            state,
            labels,
            url: json["html_url"].as_str().unwrap_or("").to_string(),
            provider: "GitHub Issues".to_string(),
        }))
    }
}

#[async_trait]
impl TicketProvider for GitHubIssuesProvider {
    fn name(&self) -> &str {
        "GitHub Issues"
    }

    fn extract_identifiers(&self, text: &str) -> Vec<String> {
        // Match #123 but not part of a URL or larger word
        let re = regex::Regex::new(r"(?:^|[\s(])#(\d+)").unwrap();
        re.captures_iter(text)
            .map(|cap| cap[1].to_string())
            .collect()
    }

    async fn fetch_tickets(&self, identifiers: &[String]) -> Result<Vec<Ticket>, TicketError> {
        if identifiers.is_empty() {
            return Ok(vec![]);
        }
        let mut tickets = Vec::new();
        for number in identifiers {
            match self.fetch_issue(number).await {
                Ok(Some(ticket)) => tickets.push(ticket),
                Ok(None) => {}
                Err(e) => {
                    eprintln!("Failed to fetch GitHub issue #{}: {}", number, e);
                }
            }
        }
        Ok(tickets)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_issue_numbers() {
        let provider = GitHubIssuesProvider::new("t".into(), "o".into(), "r".into());
        let ids = provider.extract_identifiers("Fixes #123 and #456");
        assert_eq!(ids, vec!["123", "456"]);
    }

    #[test]
    fn test_extract_issue_at_start() {
        let provider = GitHubIssuesProvider::new("t".into(), "o".into(), "r".into());
        let ids = provider.extract_identifiers("#99 fix bug");
        assert_eq!(ids, vec!["99"]);
    }

    #[test]
    fn test_no_issues() {
        let provider = GitHubIssuesProvider::new("t".into(), "o".into(), "r".into());
        let ids = provider.extract_identifiers("no issues here");
        assert!(ids.is_empty());
    }
}
```

**Step 2: Run tests**

Run: `cargo test --lib services::tickets::github_issues`
Expected: 3 tests pass

**Step 3: Commit**

```
feat: add GitHub Issues ticket provider
```

---

## Task 5: Add Asana provider

**Files:**
- Create: `src-tauri/src/services/tickets/asana.rs`

**Step 1: Create Asana provider**

Asana uses PAT auth and task GIDs. People reference Asana tasks via URL or custom `ASANA-<gid>` tags in commit messages.

```rust
use super::{Ticket, TicketError, TicketProvider};
use async_trait::async_trait;
use reqwest::header::{ACCEPT, AUTHORIZATION};

const ASANA_API_URL: &str = "https://app.asana.com/api/1.0";

pub struct AsanaProvider {
    http: reqwest::Client,
    token: String,
}

impl AsanaProvider {
    pub fn new(token: String) -> Self {
        Self {
            http: reqwest::Client::new(),
            token,
        }
    }

    async fn fetch_task(&self, gid: &str) -> Result<Option<Ticket>, TicketError> {
        let url = format!(
            "{}/tasks/{}?opt_fields=name,notes,completed,memberships.section.name,tags.name,permalink_url",
            ASANA_API_URL, gid
        );

        let resp = self
            .http
            .get(&url)
            .header(AUTHORIZATION, format!("Bearer {}", self.token))
            .header(ACCEPT, "application/json")
            .send()
            .await?;

        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(TicketError::Api(text));
        }

        let json: serde_json::Value = resp.json().await?;
        let data = &json["data"];
        if data.is_null() {
            return Ok(None);
        }

        let completed = data["completed"].as_bool().unwrap_or(false);
        let state = if completed { "Completed" } else { "Open" }.to_string();

        let labels = data["tags"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|t| t["name"].as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        let section = data["memberships"]
            .as_array()
            .and_then(|arr| arr.first())
            .and_then(|m| m["section"]["name"].as_str())
            .unwrap_or("");

        let state_with_section = if !section.is_empty() {
            format!("{} ({})", state, section)
        } else {
            state
        };

        Ok(Some(Ticket {
            id: data["gid"].as_str().unwrap_or("").to_string(),
            identifier: format!("ASANA-{}", gid),
            title: data["name"].as_str().unwrap_or("").to_string(),
            description: data["notes"].as_str().and_then(|s| {
                if s.is_empty() { None } else { Some(s.to_string()) }
            }),
            state: state_with_section,
            labels,
            url: data["permalink_url"].as_str().unwrap_or("").to_string(),
            provider: "Asana".to_string(),
        }))
    }
}

#[async_trait]
impl TicketProvider for AsanaProvider {
    fn name(&self) -> &str {
        "Asana"
    }

    fn extract_identifiers(&self, text: &str) -> Vec<String> {
        let mut ids = Vec::new();

        // Match ASANA-<gid> pattern
        let tag_re = regex::Regex::new(r"ASANA-(\d+)").unwrap();
        for cap in tag_re.captures_iter(text) {
            ids.push(cap[1].to_string());
        }

        // Match Asana task URLs: app.asana.com/0/<project>/<task_gid>
        let url_re = regex::Regex::new(r"app\.asana\.com/0/\d+/(\d+)").unwrap();
        for cap in url_re.captures_iter(text) {
            ids.push(cap[1].to_string());
        }

        ids
    }

    async fn fetch_tickets(&self, identifiers: &[String]) -> Result<Vec<Ticket>, TicketError> {
        if identifiers.is_empty() {
            return Ok(vec![]);
        }
        let mut tickets = Vec::new();
        for gid in identifiers {
            match self.fetch_task(gid).await {
                Ok(Some(ticket)) => tickets.push(ticket),
                Ok(None) => {}
                Err(e) => {
                    eprintln!("Failed to fetch Asana task {}: {}", gid, e);
                }
            }
        }
        Ok(tickets)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_asana_tag() {
        let provider = AsanaProvider::new("fake".into());
        let ids = provider.extract_identifiers("ASANA-1234567890 fix");
        assert_eq!(ids, vec!["1234567890"]);
    }

    #[test]
    fn test_extract_asana_url() {
        let provider = AsanaProvider::new("fake".into());
        let ids = provider.extract_identifiers(
            "See https://app.asana.com/0/111/222 for details"
        );
        assert_eq!(ids, vec!["222"]);
    }

    #[test]
    fn test_no_asana_refs() {
        let provider = AsanaProvider::new("fake".into());
        let ids = provider.extract_identifiers("CPT-123 fix login");
        assert!(ids.is_empty());
    }
}
```

**Step 2: Run tests**

Run: `cargo test --lib services::tickets::asana`
Expected: 3 tests pass

**Step 3: Commit**

```
feat: add Asana ticket provider
```

---

## Task 6: Add token types and preferences for new providers

**Files:**
- Modify: `src-tauri/src/services/token_manager.rs:7-25` (add JiraCredentials, JiraDomain, Asana token types)
- Modify: `src-tauri/src/services/preferences.rs` (add Jira domain storage)

**Step 1: Add new TokenType variants**

In `token_manager.rs`, add to the `TokenType` enum:

```rust
pub enum TokenType {
    GitHub,
    Linear,
    AnthropicApiKey,
    OpenAiApiKey,
    JiraCredentials,  // "email:api_token"
    Asana,
}
```

Add store keys:

```rust
TokenType::JiraCredentials => "jira-credentials",
TokenType::Asana => "asana-pat",
```

**Step 2: Add Jira domain to preferences**

In `preferences.rs`, add `get_jira_domain` / `set_jira_domain` functions using the existing store pattern (similar to `get_ollama_url`/`set_ollama_url`).

**Step 3: Update token store key tests**

**Step 4: Run `cargo test`**

**Step 5: Commit**

```
feat: add Jira and Asana token types and Jira domain preference
```

---

## Task 7: Update commands layer -- generalize fetch_tickets and run_ai_review

**Files:**
- Modify: `src-tauri/src/commands/github.rs:72-126` (run_ai_review) and `:221-248` (fetch_linear_tickets)
- Modify: `src-tauri/src/commands/settings.rs` (add Jira/Asana token commands)
- Modify: `src-tauri/src/lib.rs:11-37` (register new commands)

**Step 1: Replace `fetch_linear_tickets` with `fetch_tickets`**

New command that queries all configured ticket providers:

```rust
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
        return Err("NO_TOKEN: No ticket provider tokens configured. Add one in Settings.".into());
    }

    let provider_refs: Vec<&dyn TicketProvider> = providers.iter().map(|p| p.as_ref()).collect();
    let id_groups = tickets::collect_identifiers(
        &provider_refs,
        &title,
        body.as_deref(),
        &commit_messages,
    );

    // Fetch from all providers concurrently
    let mut all_tickets = Vec::new();
    let futures: Vec<_> = id_groups
        .into_iter()
        .map(|(idx, ids)| providers[idx].fetch_tickets(ids))
        .collect();

    for result in futures::future::join_all(futures).await {
        match result {
            Ok(tickets) => all_tickets.extend(tickets),
            Err(e) => eprintln!("Ticket fetch error: {}", e),
        }
    }

    Ok(all_tickets)
}
```

Helper:

```rust
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
```

**Step 2: Update `run_ai_review` to use new ticket system**

Replace the Linear-specific block with:

```rust
let tickets = build_ticket_providers(&app_handle, &owner, &repo);
// ... same concurrent fetch pattern as fetch_tickets
```

**Step 3: Rename `ReviewPrompt.linear_context` to `ticket_context`**

In `src-tauri/src/models/review.rs:44`: rename field.
In `src-tauri/src/services/review.rs`: update `build_review_prompt` to accept `&[Ticket]` instead of `&[LinearTicket]`.
In `src-tauri/src/providers/traits.rs:79`: rename `linear_context` to `ticket_context` in the user message builder.

**Step 4: Add settings commands for Jira/Asana tokens**

In `settings.rs`, add:
- `save_jira_credentials`, `has_jira_credentials`, `delete_jira_credentials`
- `save_jira_domain`, `get_jira_domain`
- `save_asana_token`, `has_asana_token`, `delete_asana_token`

**Step 5: Register all new commands in `lib.rs`**

**Step 6: Add `futures` crate to `Cargo.toml`**

```toml
futures = "0.3"
```

**Step 7: Run `cargo check` then `cargo test`**

**Step 8: Commit**

```
feat: generalize ticket fetching to support all providers
```

---

## Task 8: Remove old Linear service and model

**Files:**
- Delete: `src-tauri/src/services/linear.rs`
- Delete: `src-tauri/src/models/linear.rs`
- Modify: `src-tauri/src/services/mod.rs` (remove `pub mod linear;`)
- Modify: `src-tauri/src/models/mod.rs` (remove `pub mod linear;`)

**Step 1: Remove old files and module declarations**

**Step 2: Run `cargo build` -- fix any remaining references**

**Step 3: Commit**

```
refactor: remove legacy Linear service, replaced by tickets module
```

---

## Task 9: Update frontend types and hooks

**Files:**
- Modify: `src/types/index.ts:56-78` (replace LinearTicket with Ticket, update PullRequestDetail)
- Modify: `src/hooks/use-review.ts` (rename linearTickets -> tickets, call `fetch_tickets`)
- Modify: `src/lib/review-cache.ts` (rename linearTickets -> tickets)

**Step 1: Update TypeScript types**

In `src/types/index.ts`:

```typescript
// Replace LinearTicket with:
export interface Ticket {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: string;
  labels: string[];
  url: string;
  provider: string;  // "Linear" | "Jira" | "GitHub Issues" | "Asana"
}
```

Update `PullRequestDetail` to use `tickets: Ticket[]` instead of `linear_tickets: LinearTicket[]`.

**Step 2: Update `use-review.ts`**

- Replace all `LinearTicket` with `Ticket`
- Rename `linearTickets` state to `tickets`
- Rename `linearLoading` to `ticketsLoading`
- Rename `linearError` to `ticketsError`
- Change invoke call from `fetch_linear_tickets` to `fetch_tickets` (now needs `owner` and `repo` params too)

**Step 3: Update `review-cache.ts`**

- Rename `linearTickets` to `tickets`
- Rename `linearError` to `ticketsError`

**Step 4: Commit**

```
feat: update frontend types and hooks for multi-provider tickets
```

---

## Task 10: Update frontend components

**Files:**
- Rename: `src/components/pr-review/linear-tickets-panel.tsx` -> `src/components/pr-review/tickets-panel.tsx`
- Modify: `src/pages/review.tsx` (use new TicketsPanel)
- Modify: `src/components/settings/account-settings.tsx` (add Jira/Asana token fields)
- Modify: `src/hooks/use-settings.ts` (add Jira/Asana state)
- Modify: `src/pages/settings.tsx` (wire up new token fields)

**Step 1: Rename and generalize LinearTicketsPanel -> TicketsPanel**

- Change props from `LinearTicket[]` to `Ticket[]`
- Show provider name per ticket (badge next to identifier)
- Change "Linear Context" label to "Ticket Context"
- Change "Open in Linear" link to "Open in {provider}" with dynamic URL
- Group tabs by provider when multiple providers return tickets

**Step 2: Update review.tsx to use TicketsPanel**

Import path change + rename props.

**Step 3: Add Jira and Asana fields to AccountSettings**

Add `TokenField` entries for:
- Jira Credentials (email:api_token)
- Jira Domain (text input, not password)
- Asana Personal Access Token

**Step 4: Update use-settings.ts**

Add `hasJiraCredentials`, `hasAsanaToken` state and corresponding save/delete callbacks.

**Step 5: Commit**

```
feat: generalize ticket UI to support all providers
```

---

## Task 11: Final cleanup and integration test

**Files:**
- All modified files

**Step 1: Run full `cargo test`**

Expected: All existing + new tests pass

**Step 2: Run `cargo clippy`**

Fix any warnings.

**Step 3: Run frontend build**

Run: `npm run build` (or equivalent)
Expected: No TypeScript errors

**Step 4: Manual smoke test**

- Open settings, verify all token fields appear
- Configure Linear token, verify tickets still load for a PR
- Verify "Ticket Context" panel shows provider badge

**Step 5: Commit**

```
chore: cleanup and verify multi-provider ticket integration
```

---

Plan complete and saved to `docs/plans/2026-03-08-ticket-provider-trait.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
