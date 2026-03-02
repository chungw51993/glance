use super::traits::{build_review_user_message, review_system_prompt, AiError, AiProvider};
use crate::models::provider::AiModelInfo;
use crate::models::review::{AiReviewSummary, ReviewPrompt};
use async_trait::async_trait;
use reqwest::header::CONTENT_TYPE;
use serde::Deserialize;

const DEFAULT_OLLAMA_URL: &str = "http://localhost:11434";

pub struct OllamaProvider {
    http: reqwest::Client,
    base_url: String,
    model: String,
}

impl OllamaProvider {
    pub fn new(base_url: String, model: String) -> Self {
        let url = if base_url.is_empty() {
            DEFAULT_OLLAMA_URL.to_string()
        } else {
            base_url.trim_end_matches('/').to_string()
        };
        Self {
            http: reqwest::Client::new(),
            base_url: url,
            model,
        }
    }
}

#[async_trait]
impl AiProvider for OllamaProvider {
    async fn review(&self, prompt: &ReviewPrompt) -> Result<AiReviewSummary, AiError> {
        let url = format!("{}/api/chat", self.base_url);
        let body = serde_json::json!({
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": review_system_prompt()
                },
                {
                    "role": "user",
                    "content": build_review_user_message(prompt)
                }
            ],
            "stream": false
        });

        let resp = self
            .http
            .post(&url)
            .header(CONTENT_TYPE, "application/json")
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| AiError::Http(e.to_string()))?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(AiError::Api {
                status: status.as_u16(),
                message: text,
            });
        }

        let api_resp: OllamaResponse = resp
            .json()
            .await
            .map_err(|e| AiError::Parse(e.to_string()))?;

        let content = &api_resp.message.content;

        // Ollama models sometimes wrap JSON in markdown fences -- strip them
        let json_str = strip_markdown_fences(content);

        serde_json::from_str(json_str)
            .map_err(|e| AiError::Parse(format!("Failed to parse review JSON: {e}")))
    }

    async fn test_connection(&self) -> Result<(), AiError> {
        let url = format!("{}/api/chat", self.base_url);
        let body = serde_json::json!({
            "model": self.model,
            "messages": [{
                "role": "user",
                "content": "ping"
            }],
            "stream": false
        });

        let resp = self
            .http
            .post(&url)
            .header(CONTENT_TYPE, "application/json")
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| AiError::Http(e.to_string()))?;

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
        crate::models::provider::AiProviderType::Ollama.default_models()
    }

    fn max_context_tokens(&self) -> usize {
        128_000
    }

    fn name(&self) -> &str {
        "Ollama"
    }
}

/// Strip markdown code fences if the response is wrapped in them.
fn strip_markdown_fences(s: &str) -> &str {
    let trimmed = s.trim();
    let without_prefix = if let Some(rest) = trimmed.strip_prefix("```json") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("```") {
        rest
    } else {
        return trimmed;
    };
    let without_suffix = without_prefix
        .trim()
        .strip_suffix("```")
        .unwrap_or(without_prefix.trim());
    without_suffix.trim()
}

#[derive(Deserialize)]
struct OllamaResponse {
    message: OllamaMessage,
}

#[derive(Deserialize)]
struct OllamaMessage {
    content: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ollama_provider_name() {
        let provider = OllamaProvider::new("".into(), "qwen3:32b".into());
        assert_eq!(provider.name(), "Ollama");
    }

    #[test]
    fn test_ollama_provider_default_url() {
        let provider = OllamaProvider::new("".into(), "qwen3:32b".into());
        assert_eq!(provider.base_url, "http://localhost:11434");
    }

    #[test]
    fn test_ollama_provider_custom_url() {
        let provider = OllamaProvider::new("http://myhost:1234/".into(), "qwen3:32b".into());
        assert_eq!(provider.base_url, "http://myhost:1234");
    }

    #[test]
    fn test_ollama_provider_max_context() {
        let provider = OllamaProvider::new("".into(), "qwen3:32b".into());
        assert_eq!(provider.max_context_tokens(), 128_000);
    }

    #[test]
    fn test_ollama_provider_list_models() {
        let provider = OllamaProvider::new("".into(), "qwen3:32b".into());
        let models = provider.list_models();
        assert!(models.len() >= 2);
        assert!(models.iter().any(|m| m.id.contains("qwen3")));
    }

    #[test]
    fn test_strip_markdown_fences_json() {
        let input = "```json\n{\"key\": \"value\"}\n```";
        assert_eq!(strip_markdown_fences(input), "{\"key\": \"value\"}");
    }

    #[test]
    fn test_strip_markdown_fences_plain() {
        let input = "```\n{\"key\": \"value\"}\n```";
        assert_eq!(strip_markdown_fences(input), "{\"key\": \"value\"}");
    }

    #[test]
    fn test_strip_markdown_fences_none() {
        let input = "{\"key\": \"value\"}";
        assert_eq!(strip_markdown_fences(input), "{\"key\": \"value\"}");
    }
}
