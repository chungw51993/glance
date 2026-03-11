use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiProviderType {
    Anthropic,
    #[serde(rename = "openai")]
    OpenAi,
    Ollama,
}

impl AiProviderType {
    pub fn default_models(&self) -> Vec<AiModelInfo> {
        match self {
            AiProviderType::Anthropic => vec![
                AiModelInfo {
                    id: "claude-opus-4-6-20250709".into(),
                    name: "Claude Opus 4.6".into(),
                    max_context_tokens: 200_000,
                },
                AiModelInfo {
                    id: "claude-sonnet-4-6-20250514".into(),
                    name: "Claude Sonnet 4.6".into(),
                    max_context_tokens: 200_000,
                },
                AiModelInfo {
                    id: "claude-sonnet-4-20250514".into(),
                    name: "Claude Sonnet 4".into(),
                    max_context_tokens: 200_000,
                },
                AiModelInfo {
                    id: "claude-haiku-4-5-20251001".into(),
                    name: "Claude Haiku 4.5".into(),
                    max_context_tokens: 200_000,
                },
            ],
            AiProviderType::OpenAi => vec![
                AiModelInfo {
                    id: "o3".into(),
                    name: "o3".into(),
                    max_context_tokens: 200_000,
                },
                AiModelInfo {
                    id: "o4-mini".into(),
                    name: "o4-mini".into(),
                    max_context_tokens: 200_000,
                },
                AiModelInfo {
                    id: "gpt-4.1".into(),
                    name: "GPT-4.1".into(),
                    max_context_tokens: 1_047_576,
                },
                AiModelInfo {
                    id: "gpt-4.1-mini".into(),
                    name: "GPT-4.1 Mini".into(),
                    max_context_tokens: 1_047_576,
                },
                AiModelInfo {
                    id: "gpt-4.1-nano".into(),
                    name: "GPT-4.1 Nano".into(),
                    max_context_tokens: 1_047_576,
                },
                AiModelInfo {
                    id: "gpt-4o".into(),
                    name: "GPT-4o".into(),
                    max_context_tokens: 128_000,
                },
                AiModelInfo {
                    id: "gpt-4o-mini".into(),
                    name: "GPT-4o Mini".into(),
                    max_context_tokens: 128_000,
                },
                AiModelInfo {
                    id: "o3-mini".into(),
                    name: "o3-mini".into(),
                    max_context_tokens: 200_000,
                },
            ],
            AiProviderType::Ollama => vec![
                AiModelInfo {
                    id: "qwen3.5:35b-a3b".into(),
                    name: "Qwen3.5 35B-A3B".into(),
                    max_context_tokens: 128_000,
                },
                AiModelInfo {
                    id: "qwen3.5:27b".into(),
                    name: "Qwen3.5 27B".into(),
                    max_context_tokens: 128_000,
                },
                AiModelInfo {
                    id: "qwen3:32b".into(),
                    name: "Qwen3 32B".into(),
                    max_context_tokens: 128_000,
                },
                AiModelInfo {
                    id: "qwen3:8b".into(),
                    name: "Qwen3 8B".into(),
                    max_context_tokens: 128_000,
                },
                AiModelInfo {
                    id: "qwen3-coder:latest".into(),
                    name: "Qwen3 Coder".into(),
                    max_context_tokens: 128_000,
                },
                AiModelInfo {
                    id: "llama3.3:latest".into(),
                    name: "Llama 3.3".into(),
                    max_context_tokens: 128_000,
                },
            ],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiModelInfo {
    pub id: String,
    pub name: String,
    pub max_context_tokens: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub provider_type: AiProviderType,
    pub model_id: String,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            provider_type: AiProviderType::Anthropic,
            model_id: "claude-sonnet-4-6-20250514".into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_type_serde() {
        let json = serde_json::to_string(&AiProviderType::Anthropic).unwrap();
        assert_eq!(json, "\"anthropic\"");
        let json = serde_json::to_string(&AiProviderType::OpenAi).unwrap();
        assert_eq!(json, "\"openai\"");
        let json = serde_json::to_string(&AiProviderType::Ollama).unwrap();
        assert_eq!(json, "\"ollama\"");
    }

    #[test]
    fn test_provider_type_deserialize() {
        let anthropic: AiProviderType = serde_json::from_str("\"anthropic\"").unwrap();
        assert_eq!(anthropic, AiProviderType::Anthropic);
        let openai: AiProviderType = serde_json::from_str("\"openai\"").unwrap();
        assert_eq!(openai, AiProviderType::OpenAi);
        let ollama: AiProviderType = serde_json::from_str("\"ollama\"").unwrap();
        assert_eq!(ollama, AiProviderType::Ollama);
    }

    #[test]
    fn test_default_models_anthropic() {
        let models = AiProviderType::Anthropic.default_models();
        assert!(models.len() >= 2);
        assert!(models.iter().any(|m| m.id.contains("sonnet")));
        assert!(models.iter().any(|m| m.id.contains("opus-4-6")));
    }

    #[test]
    fn test_default_models_openai() {
        let models = AiProviderType::OpenAi.default_models();
        assert!(models.len() >= 2);
        assert!(models.iter().any(|m| m.id.contains("gpt-4.1")));
        assert!(models.iter().any(|m| m.id == "o3"));
    }

    #[test]
    fn test_default_models_ollama() {
        let models = AiProviderType::Ollama.default_models();
        assert!(models.len() >= 2);
        assert!(models.iter().any(|m| m.id.contains("qwen3.5")));
        assert!(models.iter().any(|m| m.id.contains("qwen3:")));
    }

    #[test]
    fn test_provider_config_default() {
        let config = ProviderConfig::default();
        assert_eq!(config.provider_type, AiProviderType::Anthropic);
        assert!(config.model_id.contains("sonnet-4-6"));
    }

    #[test]
    fn test_provider_config_roundtrip() {
        let config = ProviderConfig {
            provider_type: AiProviderType::OpenAi,
            model_id: "gpt-4.1".into(),
        };
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: ProviderConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.provider_type, AiProviderType::OpenAi);
        assert_eq!(deserialized.model_id, "gpt-4.1");
    }
}
