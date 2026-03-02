use crate::models::provider::{AiModelInfo, AiProviderType, ProviderConfig};
use crate::providers::factory::create_provider;
use crate::services::preferences;
use crate::services::token_manager::{self, TokenType};
use tauri_plugin_store::StoreExt;

fn token_type_for_provider(provider_type: AiProviderType) -> Option<TokenType> {
    match provider_type {
        AiProviderType::Anthropic => Some(TokenType::AnthropicApiKey),
        AiProviderType::OpenAi => Some(TokenType::OpenAiApiKey),
        AiProviderType::Ollama => None,
    }
}

#[tauri::command]
pub fn save_api_key(
    app_handle: tauri::AppHandle,
    provider_type: AiProviderType,
    key: String,
) -> Result<(), String> {
    let token_type = token_type_for_provider(provider_type)
        .ok_or_else(|| "Ollama does not use API keys".to_string())?;
    let store = app_handle
        .store(token_manager::tokens_store_path())
        .map_err(|e| e.to_string())?;
    token_manager::store_token(&store, token_type, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn has_api_key(app_handle: tauri::AppHandle, provider_type: AiProviderType) -> bool {
    match token_type_for_provider(provider_type) {
        Some(token_type) => {
            let Ok(store) = app_handle.store(token_manager::tokens_store_path()) else {
                return false;
            };
            token_manager::has_token(&store, token_type)
        }
        None => false,
    }
}

#[tauri::command]
pub fn delete_api_key(
    app_handle: tauri::AppHandle,
    provider_type: AiProviderType,
) -> Result<(), String> {
    let token_type = token_type_for_provider(provider_type)
        .ok_or_else(|| "Ollama does not use API keys".to_string())?;
    let store = app_handle
        .store(token_manager::tokens_store_path())
        .map_err(|e| e.to_string())?;
    token_manager::delete_token(&store, token_type).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_provider_connection(
    app_handle: tauri::AppHandle,
    provider_type: AiProviderType,
    model_id: String,
) -> Result<(), String> {
    let api_key_or_url = match provider_type {
        AiProviderType::Ollama => {
            let store = app_handle
                .store(preferences::store_path())
                .map_err(|e| e.to_string())?;
            preferences::get_ollama_url(&store)
        }
        _ => {
            let token_type = token_type_for_provider(provider_type).unwrap();
            let store = app_handle
                .store(token_manager::tokens_store_path())
                .map_err(|e| e.to_string())?;
            token_manager::get_token(&store, token_type).map_err(|e| e.to_string())?
        }
    };
    let provider = create_provider(provider_type, api_key_or_url, model_id);
    provider
        .test_connection()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_provider_config(app_handle: tauri::AppHandle) -> Result<ProviderConfig, String> {
    let store = app_handle
        .store(preferences::store_path())
        .map_err(|e| e.to_string())?;
    Ok(preferences::get_provider_config(&store))
}

#[tauri::command]
pub fn set_provider_config(
    app_handle: tauri::AppHandle,
    config: ProviderConfig,
) -> Result<(), String> {
    let store = app_handle
        .store(preferences::store_path())
        .map_err(|e| e.to_string())?;
    preferences::set_provider_config(&store, &config)
}

#[tauri::command]
pub fn list_provider_models(provider_type: AiProviderType) -> Vec<AiModelInfo> {
    provider_type.default_models()
}

#[tauri::command]
pub fn save_ollama_url(app_handle: tauri::AppHandle, url: String) -> Result<(), String> {
    let store = app_handle
        .store(preferences::store_path())
        .map_err(|e| e.to_string())?;
    preferences::set_ollama_url(&store, &url)
}

#[tauri::command]
pub fn get_ollama_url(app_handle: tauri::AppHandle) -> Result<String, String> {
    let store = app_handle
        .store(preferences::store_path())
        .map_err(|e| e.to_string())?;
    Ok(preferences::get_ollama_url(&store))
}

#[tauri::command]
pub fn save_github_token(app_handle: tauri::AppHandle, token: String) -> Result<(), String> {
    let store = app_handle
        .store(token_manager::tokens_store_path())
        .map_err(|e| e.to_string())?;
    token_manager::store_token(&store, TokenType::GitHub, &token).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn has_github_token(app_handle: tauri::AppHandle) -> bool {
    let Ok(store) = app_handle.store(token_manager::tokens_store_path()) else {
        return false;
    };
    token_manager::has_token(&store, TokenType::GitHub)
}

#[tauri::command]
pub fn delete_github_token(app_handle: tauri::AppHandle) -> Result<(), String> {
    let store = app_handle
        .store(token_manager::tokens_store_path())
        .map_err(|e| e.to_string())?;
    token_manager::delete_token(&store, TokenType::GitHub).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_linear_token(app_handle: tauri::AppHandle, token: String) -> Result<(), String> {
    let store = app_handle
        .store(token_manager::tokens_store_path())
        .map_err(|e| e.to_string())?;
    token_manager::store_token(&store, TokenType::Linear, &token).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn has_linear_token(app_handle: tauri::AppHandle) -> bool {
    let Ok(store) = app_handle.store(token_manager::tokens_store_path()) else {
        return false;
    };
    token_manager::has_token(&store, TokenType::Linear)
}

#[tauri::command]
pub fn delete_linear_token(app_handle: tauri::AppHandle) -> Result<(), String> {
    let store = app_handle
        .store(token_manager::tokens_store_path())
        .map_err(|e| e.to_string())?;
    token_manager::delete_token(&store, TokenType::Linear).map_err(|e| e.to_string())
}
