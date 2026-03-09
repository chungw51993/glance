use super::{Ticket, TicketError, TicketProvider};
use async_trait::async_trait;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};

pub struct JiraProvider {
    http: reqwest::Client,
    domain: String,
    auth_header: String,
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
            return Err(TicketError::Api(text));
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
    fn extract_adf_text(value: Option<&serde_json::Value>) -> Option<String> {
        let val = value?;
        if val.is_null() {
            return None;
        }
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
