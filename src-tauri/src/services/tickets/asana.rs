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

        let tag_re = regex::Regex::new(r"ASANA-(\d+)").unwrap();
        for cap in tag_re.captures_iter(text) {
            ids.push(cap[1].to_string());
        }

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
