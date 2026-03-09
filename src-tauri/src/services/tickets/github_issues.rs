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
