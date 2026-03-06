use super::traits::{build_review_user_message, review_system_prompt, strip_markdown_fences, AiError, AiProvider};
use crate::models::provider::AiModelInfo;
use crate::models::review::{AiReviewSummary, ReviewPrompt};
use async_trait::async_trait;
use reqwest::header::CONTENT_TYPE;
use serde::Deserialize;

const ANTHROPIC_API: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";

pub struct AnthropicProvider {
    http: reqwest::Client,
    api_key: String,
    model: String,
}

impl AnthropicProvider {
    pub fn new(api_key: String, model: String) -> Self {
        Self {
            http: reqwest::Client::new(),
            api_key,
            model,
        }
    }
}

#[async_trait]
impl AiProvider for AnthropicProvider {
    async fn review(&self, prompt: &ReviewPrompt) -> Result<AiReviewSummary, AiError> {
        let body = serde_json::json!({
            "model": self.model,
            "max_tokens": 4096,
            "system": review_system_prompt(),
            "messages": [{
                "role": "user",
                "content": build_review_user_message(prompt)
            }]
        });

        let resp = self
            .http
            .post(ANTHROPIC_API)
            .header(CONTENT_TYPE, "application/json")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| AiError::Http(e.to_string()))?;

        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AiError::Unauthorized);
        }
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(AiError::Api {
                status: status.as_u16(),
                message: text,
            });
        }

        let api_resp: AnthropicResponse = resp
            .json()
            .await
            .map_err(|e| AiError::Parse(e.to_string()))?;

        let content = api_resp
            .content
            .first()
            .ok_or_else(|| AiError::Parse("Empty response from Anthropic".into()))?;

        let json_str = strip_markdown_fences(&content.text);
        serde_json::from_str(json_str)
            .map_err(|e| AiError::Parse(format!("Failed to parse review JSON: {e}")))
    }

    async fn test_connection(&self) -> Result<(), AiError> {
        let body = serde_json::json!({
            "model": self.model,
            "max_tokens": 1,
            "messages": [{
                "role": "user",
                "content": "ping"
            }]
        });

        let resp = self
            .http
            .post(ANTHROPIC_API)
            .header(CONTENT_TYPE, "application/json")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| AiError::Http(e.to_string()))?;

        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AiError::Unauthorized);
        }
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let text = resp.text().await.unwrap_or_default();
            return Err(AiError::Api {
                status,
                message: text,
            });
        }

        Ok(())
    }

    fn list_models(&self) -> Vec<AiModelInfo> {
        crate::models::provider::AiProviderType::Anthropic.default_models()
    }

    fn max_context_tokens(&self) -> usize {
        200_000
    }

    fn name(&self) -> &str {
        "Anthropic"
    }
}

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicContent>,
}

#[derive(Deserialize)]
struct AnthropicContent {
    text: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_anthropic_provider_name() {
        let provider = AnthropicProvider::new("test-key".into(), "claude-sonnet-4-20250514".into());
        assert_eq!(provider.name(), "Anthropic");
    }

    #[test]
    fn test_anthropic_provider_max_context() {
        let provider = AnthropicProvider::new("test-key".into(), "claude-sonnet-4-20250514".into());
        assert_eq!(provider.max_context_tokens(), 200_000);
    }

    #[test]
    fn test_anthropic_provider_list_models() {
        let provider = AnthropicProvider::new("test-key".into(), "claude-sonnet-4-20250514".into());
        let models = provider.list_models();
        assert!(models.len() >= 2);
        assert!(models.iter().any(|m| m.id.contains("sonnet")));
    }
}
