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
    fn name(&self) -> &str;
    fn extract_identifiers(&self, text: &str) -> Vec<String>;
    async fn fetch_tickets(&self, identifiers: &[String]) -> Result<Vec<Ticket>, TicketError>;
}

/// Extract and deduplicate ticket identifiers from PR metadata across all providers.
pub fn collect_identifiers(
    providers: &[&dyn TicketProvider],
    title: &str,
    body: Option<&str>,
    commit_messages: &[String],
) -> Vec<(usize, Vec<String>)> {
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
        .filter(|(_, ids): &(usize, Vec<String>)| !ids.is_empty())
        .collect()
}
