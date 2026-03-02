use crate::models::linear::LinearTicket;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use thiserror::Error;

const LINEAR_API_URL: &str = "https://api.linear.app/graphql";

#[derive(Error, Debug)]
pub enum LinearError {
    #[error("HTTP request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("Linear API error: {0}")]
    Api(String),
    #[error("No Linear token configured")]
    NoToken,
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

    /// Fetch Linear tickets by their identifiers (e.g. ["CPT-2324", "DATA-5343"]).
    /// Returns tickets that were found; silently skips identifiers that don't match.
    pub async fn get_tickets_by_identifiers(
        &self,
        identifiers: &[String],
    ) -> Result<Vec<LinearTicket>, LinearError> {
        if identifiers.is_empty() {
            return Ok(vec![]);
        }

        let mut tickets = Vec::new();

        // Linear's issueSearch doesn't support OR on identifiers in a single query easily.
        // We batch by fetching each identifier individually. Linear's API is fast enough
        // for a handful of tickets (typical PR has 1-5 ticket refs).
        for identifier in identifiers {
            match self.fetch_issue_by_identifier(identifier).await {
                Ok(Some(ticket)) => tickets.push(ticket),
                Ok(None) => {} // not found, skip
                Err(e) => {
                    // Log but don't fail the whole batch for one bad identifier
                    eprintln!("Failed to fetch Linear ticket {}: {}", identifier, e);
                }
            }
        }

        Ok(tickets)
    }

    async fn fetch_issue_by_identifier(
        &self,
        identifier: &str,
    ) -> Result<Option<LinearTicket>, LinearError> {
        let query = r#"
            query IssueById($id: String!) {
                issue(id: $id) {
                    id
                    identifier
                    title
                    description
                    url
                    state {
                        name
                    }
                    labels {
                        nodes {
                            name
                        }
                    }
                }
            }
        "#;

        let variables = serde_json::json!({
            "id": identifier
        });

        let body = serde_json::json!({
            "query": query,
            "variables": variables,
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
            return Err(LinearError::Api(format!("{}: {}", status, text)));
        }

        let json: serde_json::Value = resp.json().await?;

        // Check for GraphQL errors
        if let Some(errors) = json.get("errors") {
            return Err(LinearError::Api(errors.to_string()));
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

        Ok(Some(LinearTicket {
            id: node["id"].as_str().unwrap_or("").to_string(),
            identifier: node["identifier"].as_str().unwrap_or("").to_string(),
            title: node["title"].as_str().unwrap_or("").to_string(),
            description: node["description"].as_str().map(String::from),
            state: node["state"]["name"].as_str().unwrap_or("").to_string(),
            labels,
            url: node["url"].as_str().unwrap_or("").to_string(),
        }))
    }
}

/// Extract all ticket identifiers from a string (e.g. "CPT-2324", "DATA-5343").
/// Matches the pattern: 2-10 uppercase letters, dash, 1+ digits.
pub fn extract_ticket_identifiers(text: &str) -> Vec<String> {
    let re = regex::Regex::new(r"[A-Z]{2,10}-\d+").unwrap();
    re.find_iter(text)
        .map(|m| m.as_str().to_string())
        .collect()
}

/// Extract and deduplicate ticket identifiers from PR title, body, and commit messages.
pub fn collect_ticket_identifiers(
    title: &str,
    body: Option<&str>,
    commit_messages: &[String],
) -> Vec<String> {
    let mut seen = indexmap::IndexSet::new();

    for id in extract_ticket_identifiers(title) {
        seen.insert(id);
    }
    if let Some(body_text) = body {
        for id in extract_ticket_identifiers(body_text) {
            seen.insert(id);
        }
    }
    for msg in commit_messages {
        for id in extract_ticket_identifiers(msg) {
            seen.insert(id);
        }
    }

    seen.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_ticket_identifiers_single() {
        let ids = extract_ticket_identifiers("CPT-2324: fix login bug");
        assert_eq!(ids, vec!["CPT-2324"]);
    }

    #[test]
    fn test_extract_ticket_identifiers_multiple() {
        let ids = extract_ticket_identifiers("CPT-12 PA-2342 DATA-5343: combined fix");
        assert_eq!(ids, vec!["CPT-12", "PA-2342", "DATA-5343"]);
    }

    #[test]
    fn test_extract_ticket_identifiers_none() {
        let ids = extract_ticket_identifiers("fix: something broke");
        assert!(ids.is_empty());
    }

    #[test]
    fn test_extract_ticket_identifiers_various_prefixes() {
        let ids = extract_ticket_identifiers("AI-1 ALPHA-234 XY-99999");
        assert_eq!(ids, vec!["AI-1", "ALPHA-234", "XY-99999"]);
    }

    #[test]
    fn test_collect_deduplicates() {
        let ids = collect_ticket_identifiers(
            "CPT-123: fix login",
            Some("Related to CPT-123 and DATA-5"),
            &["CPT-123: commit 1".into(), "DATA-5: commit 2".into()],
        );
        assert_eq!(ids, vec!["CPT-123", "DATA-5"]);
    }

    #[test]
    fn test_collect_empty() {
        let ids = collect_ticket_identifiers("no tickets here", None, &[]);
        assert!(ids.is_empty());
    }
}
