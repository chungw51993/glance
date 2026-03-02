use super::traits::{build_review_user_message, review_system_prompt, AiError, AiProvider};
use crate::models::provider::AiModelInfo;
use crate::models::review::{AiReviewSummary, ReviewPrompt};
use async_trait::async_trait;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::Deserialize;

const OPENAI_API: &str = "https://api.openai.com/v1/chat/completions";

pub struct OpenAiProvider {
    http: reqwest::Client,
    api_key: String,
    model: String,
}

impl OpenAiProvider {
    pub fn new(api_key: String, model: String) -> Self {
        Self {
            http: reqwest::Client::new(),
            api_key,
            model,
        }
    }
}

#[async_trait]
impl AiProvider for OpenAiProvider {
    async fn review(&self, prompt: &ReviewPrompt) -> Result<AiReviewSummary, AiError> {
        let body = serde_json::json!({
            "model": self.model,
            "max_tokens": 4096,
            "messages": [
                {
                    "role": "system",
                    "content": review_system_prompt()
                },
                {
                    "role": "user",
                    "content": build_review_user_message(prompt)
                }
            ]
        });

        let resp = self
            .http
            .post(OPENAI_API)
            .header(CONTENT_TYPE, "application/json")
            .header(AUTHORIZATION, format!("Bearer {}", self.api_key))
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

        let api_resp: OpenAiResponse = resp
            .json()
            .await
            .map_err(|e| AiError::Parse(e.to_string()))?;

        let choice = api_resp
            .choices
            .first()
            .ok_or_else(|| AiError::Parse("Empty response from OpenAI".into()))?;

        serde_json::from_str(&choice.message.content)
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
            .post(OPENAI_API)
            .header(CONTENT_TYPE, "application/json")
            .header(AUTHORIZATION, format!("Bearer {}", self.api_key))
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
        crate::models::provider::AiProviderType::OpenAi.default_models()
    }

    fn max_context_tokens(&self) -> usize {
        128_000
    }

    fn name(&self) -> &str {
        "OpenAI"
    }
}

#[derive(Deserialize)]
struct OpenAiResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
}

#[derive(Deserialize)]
struct OpenAiMessage {
    content: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_openai_provider_name() {
        let provider = OpenAiProvider::new("test-key".into(), "gpt-4o".into());
        assert_eq!(provider.name(), "OpenAI");
    }

    #[test]
    fn test_openai_provider_max_context() {
        let provider = OpenAiProvider::new("test-key".into(), "gpt-4o".into());
        assert_eq!(provider.max_context_tokens(), 128_000);
    }

    #[test]
    fn test_openai_provider_list_models() {
        let provider = OpenAiProvider::new("test-key".into(), "gpt-4o".into());
        let models = provider.list_models();
        assert!(models.len() >= 2);
        assert!(models.iter().any(|m| m.id.contains("gpt-4o")));
    }
}
