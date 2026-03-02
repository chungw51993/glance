import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type { AiModelInfo, AiProviderType, ProviderConfig } from "@/types";

export function useSettings() {
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(
    null
  );
  const [models, setModels] = useState<AiModelInfo[]>([]);
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false);
  const [hasOpenAiKey, setHasOpenAiKey] = useState(false);
  const [hasGithubToken, setHasGithubToken] = useState(false);
  const [hasLinearToken, setHasLinearToken] = useState(false);
  const [ollamaUrl, setOllamaUrlState] = useState("http://localhost:11434");
  const [loading, setLoading] = useState(true);

  const loadConfig = useCallback(async () => {
    try {
      const config = await invoke<ProviderConfig>("get_provider_config");
      setProviderConfig(config);
      const modelList = await invoke<AiModelInfo[]>("list_provider_models", {
        providerType: config.provider_type,
      });
      setModels(modelList);
    } catch (err) {
      console.error("Failed to load provider config:", err);
    }
  }, []);

  const loadKeyStatus = useCallback(async () => {
    const [anthropic, openai, github, linear] = await Promise.all([
      invoke<boolean>("has_api_key", { providerType: "anthropic" }),
      invoke<boolean>("has_api_key", { providerType: "openai" }),
      invoke<boolean>("has_github_token"),
      invoke<boolean>("has_linear_token"),
    ]);
    setHasAnthropicKey(anthropic);
    setHasOpenAiKey(openai);
    setHasGithubToken(github);
    setHasLinearToken(linear);
  }, []);

  const loadOllamaUrl = useCallback(async () => {
    try {
      const url = await invoke<string>("get_ollama_url");
      setOllamaUrlState(url);
    } catch {
      // default already set
    }
  }, []);

  useEffect(() => {
    Promise.all([loadConfig(), loadKeyStatus(), loadOllamaUrl()]).finally(() =>
      setLoading(false)
    );
  }, [loadConfig, loadKeyStatus, loadOllamaUrl]);

  const changeProvider = useCallback(
    async (providerType: AiProviderType) => {
      const modelList = await invoke<AiModelInfo[]>("list_provider_models", {
        providerType,
      });
      setModels(modelList);
      const newConfig: ProviderConfig = {
        provider_type: providerType,
        model_id: modelList[0]?.id ?? "",
      };
      await invoke("set_provider_config", { config: newConfig });
      setProviderConfig(newConfig);
    },
    []
  );

  const changeModel = useCallback(
    async (modelId: string) => {
      if (!providerConfig) return;
      const newConfig: ProviderConfig = {
        ...providerConfig,
        model_id: modelId,
      };
      await invoke("set_provider_config", { config: newConfig });
      setProviderConfig(newConfig);
    },
    [providerConfig]
  );

  const saveApiKey = useCallback(
    async (providerType: AiProviderType, key: string) => {
      await invoke("save_api_key", { providerType, key });
      await loadKeyStatus();
    },
    [loadKeyStatus]
  );

  const deleteApiKey = useCallback(
    async (providerType: AiProviderType) => {
      await invoke("delete_api_key", { providerType });
      await loadKeyStatus();
    },
    [loadKeyStatus]
  );

  const testConnection = useCallback(
    async (providerType: AiProviderType, modelId: string) => {
      await invoke("test_provider_connection", { providerType, modelId });
    },
    []
  );

  const saveGithubToken = useCallback(
    async (token: string) => {
      await invoke("save_github_token", { token });
      await loadKeyStatus();
    },
    [loadKeyStatus]
  );

  const saveLinearToken = useCallback(
    async (token: string) => {
      await invoke("save_linear_token", { token });
      await loadKeyStatus();
    },
    [loadKeyStatus]
  );

  const saveOllamaUrl = useCallback(async (url: string) => {
    await invoke("save_ollama_url", { url });
    setOllamaUrlState(url);
  }, []);

  return {
    providerConfig,
    models,
    hasAnthropicKey,
    hasOpenAiKey,
    hasGithubToken,
    hasLinearToken,
    ollamaUrl,
    loading,
    changeProvider,
    changeModel,
    saveApiKey,
    deleteApiKey,
    testConnection,
    saveGithubToken,
    saveLinearToken,
    saveOllamaUrl,
  };
}
