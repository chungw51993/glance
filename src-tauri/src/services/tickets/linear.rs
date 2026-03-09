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
