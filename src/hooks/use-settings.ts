import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type { AiModelInfo, AiProviderType, GitProviderType, ProviderConfig } from "@/types";

export function useSettings() {
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(
    null
  );
  const [models, setModels] = useState<AiModelInfo[]>([]);
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false);
  const [hasOpenAiKey, setHasOpenAiKey] = useState(false);
  const [gitProviderType, setGitProviderTypeState] = useState<GitProviderType>("git_hub");
  const [hasGitHubToken, setHasGitHubToken] = useState(false);
  const [hasGitLabToken, setHasGitLabToken] = useState(false);
  const [hasBitbucketToken, setHasBitbucketToken] = useState(false);
  const [hasLinearToken, setHasLinearToken] = useState(false);
  const [hasJiraCredentials, setHasJiraCredentials] = useState(false);
  const [jiraDomain, setJiraDomainState] = useState("");
  const [hasAsanaToken, setHasAsanaToken] = useState(false);
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
    const [anthropic, openai, github, gitlab, bitbucket, linear, jira, asana] = await Promise.all([
      invoke<boolean>("has_api_key", { providerType: "anthropic" }),
      invoke<boolean>("has_api_key", { providerType: "openai" }),
      invoke<boolean>("has_git_provider_token", { providerType: "git_hub" }),
      invoke<boolean>("has_git_provider_token", { providerType: "git_lab" }),
      invoke<boolean>("has_git_provider_token", { providerType: "bitbucket" }),
      invoke<boolean>("has_linear_token"),
      invoke<boolean>("has_jira_credentials"),
      invoke<boolean>("has_asana_token"),
    ]);
    setHasAnthropicKey(anthropic);
    setHasOpenAiKey(openai);
    setHasGitHubToken(github);
    setHasGitLabToken(gitlab);
    setHasBitbucketToken(bitbucket);
    setHasLinearToken(linear);
    setHasJiraCredentials(jira);
    setHasAsanaToken(asana);
  }, []);

  const loadGitProviderType = useCallback(async () => {
    try {
      const pt = await invoke<GitProviderType>("get_git_provider_type");
      setGitProviderTypeState(pt);
    } catch {
      // default already set
    }
  }, []);

  const loadOllamaUrl = useCallback(async () => {
    try {
      const url = await invoke<string>("get_ollama_url");
      setOllamaUrlState(url);
    } catch {
      // default already set
    }
  }, []);

  const loadJiraDomain = useCallback(async () => {
    try {
      const domain = await invoke<string>("get_jira_domain");
      setJiraDomainState(domain);
    } catch {
      // default already set
    }
  }, []);

  useEffect(() => {
    Promise.all([
      loadConfig(),
      loadKeyStatus(),
      loadGitProviderType(),
      loadOllamaUrl(),
      loadJiraDomain(),
    ]).finally(() => setLoading(false));
  }, [loadConfig, loadKeyStatus, loadGitProviderType, loadOllamaUrl, loadJiraDomain]);

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

  const changeGitProvider = useCallback(
    async (providerType: GitProviderType) => {
      await invoke("set_git_provider_type", { providerType });
      setGitProviderTypeState(providerType);
    },
    []
  );

  const saveGitToken = useCallback(
    async (providerType: GitProviderType, token: string) => {
      await invoke("save_git_token", { providerType, token });
      await loadKeyStatus();
    },
    [loadKeyStatus]
  );

  const deleteGitToken = useCallback(
    async (providerType: GitProviderType) => {
      await invoke("delete_git_token", { providerType });
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

  const saveJiraCredentials = useCallback(
    async (credentials: string) => {
      await invoke("save_jira_credentials", { credentials });
      await loadKeyStatus();
    },
    [loadKeyStatus]
  );

  const saveJiraDomain = useCallback(
    async (domain: string) => {
      await invoke("save_jira_domain", { domain });
      setJiraDomainState(domain);
    },
    []
  );

  const saveAsanaToken = useCallback(
    async (token: string) => {
      await invoke("save_asana_token", { token });
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
    gitProviderType,
    hasGitHubToken,
    hasGitLabToken,
    hasBitbucketToken,
    hasLinearToken,
    hasJiraCredentials,
    jiraDomain,
    hasAsanaToken,
    ollamaUrl,
    loading,
    changeProvider,
    changeModel,
    saveApiKey,
    deleteApiKey,
    testConnection,
    changeGitProvider,
    saveGitToken,
    deleteGitToken,
    saveLinearToken,
    saveJiraCredentials,
    saveJiraDomain,
    saveAsanaToken,
    saveOllamaUrl,
  };
}
