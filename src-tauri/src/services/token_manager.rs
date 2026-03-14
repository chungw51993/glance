use serde::{Deserialize, Serialize};
use tauri_plugin_store::Store;
use thiserror::Error;

const TOKENS_STORE_FILE: &str = "tokens.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TokenType {
    GitHub,
    GitLab,
    Bitbucket,
    Linear,
    AnthropicApiKey,
    OpenAiApiKey,
    JiraCredentials,
    Asana,
}

impl TokenType {
    pub fn store_key(&self) -> &'static str {
        match self {
            TokenType::GitHub => "github-pat",
            TokenType::GitLab => "gitlab-pat",
            TokenType::Bitbucket => "bitbucket-pat",
            TokenType::Linear => "linear-pat",
            TokenType::AnthropicApiKey => "anthropic-api-key",
            TokenType::OpenAiApiKey => "openai-api-key",
            TokenType::JiraCredentials => "jira-credentials",
            TokenType::Asana => "asana-pat",
        }
    }
}

#[derive(Error, Debug)]
pub enum TokenError {
    #[error("Failed to access token store: {0}")]
    StoreError(String),
    #[error("Token not found")]
    NotFound,
}

impl serde::Serialize for TokenError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub fn tokens_store_path() -> &'static str {
    TOKENS_STORE_FILE
}

pub fn store_token<R: tauri::Runtime>(
    store: &Store<R>,
    token_type: TokenType,
    value: &str,
) -> Result<(), TokenError> {
    store.set(
        token_type.store_key(),
        serde_json::Value::String(value.to_string()),
    );
    store
        .save()
        .map_err(|e| TokenError::StoreError(e.to_string()))
}

pub fn get_token<R: tauri::Runtime>(
    store: &Store<R>,
    token_type: TokenType,
) -> Result<String, TokenError> {
    store
        .get(token_type.store_key())
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .ok_or(TokenError::NotFound)
}

pub fn delete_token<R: tauri::Runtime>(
    store: &Store<R>,
    token_type: TokenType,
) -> Result<(), TokenError> {
    if !store.has(token_type.store_key()) {
        return Err(TokenError::NotFound);
    }
    store.delete(token_type.store_key());
    store
        .save()
        .map_err(|e| TokenError::StoreError(e.to_string()))
}

pub fn has_token<R: tauri::Runtime>(store: &Store<R>, token_type: TokenType) -> bool {
    store
        .get(token_type.store_key())
        .and_then(|v| v.as_str().map(|s| !s.is_empty()))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_store_keys() {
        assert_eq!(TokenType::GitHub.store_key(), "github-pat");
        assert_eq!(TokenType::Linear.store_key(), "linear-pat");
        assert_eq!(
            TokenType::AnthropicApiKey.store_key(),
            "anthropic-api-key"
        );
        assert_eq!(TokenType::OpenAiApiKey.store_key(), "openai-api-key");
        assert_eq!(TokenType::JiraCredentials.store_key(), "jira-credentials");
        assert_eq!(TokenType::Asana.store_key(), "asana-pat");
    }

    #[test]
    fn test_token_type_serde() {
        let json = serde_json::to_string(&TokenType::AnthropicApiKey).unwrap();
        assert_eq!(json, "\"anthropic_api_key\"");
        let deserialized: TokenType = serde_json::from_str("\"open_ai_api_key\"").unwrap();
        assert_eq!(deserialized, TokenType::OpenAiApiKey);
    }
}
