use super::anthropic::AnthropicProvider;
use super::ollama::OllamaProvider;
use super::openai::OpenAiProvider;
use super::traits::AiProvider;
use crate::models::provider::AiProviderType;

/// Create the appropriate AI provider based on type, API key, and model.
/// For Ollama, api_key is treated as the base URL (no auth needed).
pub fn create_provider(
    provider_type: AiProviderType,
    api_key: String,
    model: String,
) -> Box<dyn AiProvider> {
    match provider_type {
        AiProviderType::Anthropic => Box::new(AnthropicProvider::new(api_key, model)),
        AiProviderType::OpenAi => Box::new(OpenAiProvider::new(api_key, model)),
        AiProviderType::Ollama => Box::new(OllamaProvider::new(api_key, model)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_anthropic_provider() {
        let provider = create_provider(
            AiProviderType::Anthropic,
            "test-key".into(),
            "claude-sonnet-4-20250514".into(),
        );
        assert_eq!(provider.name(), "Anthropic");
        assert_eq!(provider.max_context_tokens(), 200_000);
    }

    #[test]
    fn test_create_openai_provider() {
        let provider = create_provider(
            AiProviderType::OpenAi,
            "test-key".into(),
            "gpt-4o".into(),
        );
        assert_eq!(provider.name(), "OpenAI");
        assert_eq!(provider.max_context_tokens(), 128_000);
    }

    #[test]
    fn test_create_ollama_provider() {
        let provider = create_provider(
            AiProviderType::Ollama,
            "http://localhost:11434".into(),
            "qwen3:32b".into(),
        );
        assert_eq!(provider.name(), "Ollama");
        assert_eq!(provider.max_context_tokens(), 128_000);
    }
}
