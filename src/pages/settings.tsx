import { useSettings } from "@/hooks/use-settings";
import { useLayoutPreferences } from "@/hooks/use-layout-preferences";
import type { CodeTheme } from "@/hooks/use-layout-preferences";
import { ProviderSettings } from "@/components/settings/provider-settings";
import { AccountSettings } from "@/components/settings/account-settings";
import { AppearanceSettings } from "@/components/settings/appearance-settings";

export function SettingsPage() {
  const {
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
  } = useSettings();

  const { prefs, update } = useLayoutPreferences();

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <AppearanceSettings
        codeTheme={prefs.codeTheme}
        onChangeCodeTheme={(theme: CodeTheme) => update("codeTheme", theme)}
      />
      <ProviderSettings
        providerConfig={providerConfig}
        models={models}
        hasAnthropicKey={hasAnthropicKey}
        hasOpenAiKey={hasOpenAiKey}
        ollamaUrl={ollamaUrl}
        onChangeProvider={changeProvider}
        onChangeModel={changeModel}
        onSaveApiKey={saveApiKey}
        onDeleteApiKey={deleteApiKey}
        onTestConnection={testConnection}
        onSaveOllamaUrl={saveOllamaUrl}
      />
      <AccountSettings
        hasGithubToken={hasGithubToken}
        hasLinearToken={hasLinearToken}
        onSaveGithubToken={saveGithubToken}
        onSaveLinearToken={saveLinearToken}
      />
    </div>
  );
}
