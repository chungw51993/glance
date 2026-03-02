use crate::models::provider::ProviderConfig;
use tauri_plugin_store::Store;

const STORE_FILE: &str = "settings.json";
const PROVIDER_CONFIG_KEY: &str = "provider_config";
const OLLAMA_URL_KEY: &str = "ollama_url";

pub fn get_provider_config<R: tauri::Runtime>(store: &Store<R>) -> ProviderConfig {
    store
        .get(PROVIDER_CONFIG_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

pub fn set_provider_config<R: tauri::Runtime>(
    store: &Store<R>,
    config: &ProviderConfig,
) -> Result<(), String> {
    let value = serde_json::to_value(config).map_err(|e| e.to_string())?;
    store.set(PROVIDER_CONFIG_KEY, value);
    store.save().map_err(|e| e.to_string())
}

pub fn get_ollama_url<R: tauri::Runtime>(store: &Store<R>) -> String {
    store
        .get(OLLAMA_URL_KEY)
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "http://localhost:11434".to_string())
}

pub fn set_ollama_url<R: tauri::Runtime>(
    store: &Store<R>,
    url: &str,
) -> Result<(), String> {
    store.set(OLLAMA_URL_KEY, serde_json::Value::String(url.to_string()));
    store.save().map_err(|e| e.to_string())
}

pub fn store_path() -> &'static str {
    STORE_FILE
}
