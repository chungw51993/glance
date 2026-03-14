import { useState } from "react";
import { Palette, Bot, KeyRound, Download } from "lucide-react";
import { useSettings } from "@/hooks/use-settings";
import { useLayoutPreferences } from "@/hooks/use-layout-preferences";
import type { CodeTheme } from "@/hooks/use-layout-preferences";
import { ProviderSettings } from "@/components/settings/provider-settings";
import { AccountSettings } from "@/components/settings/account-settings";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { UpdateSettings } from "@/components/settings/update-settings";
import { cn } from "@/lib/utils";

type SettingsTab = "appearance" | "ai-provider" | "accounts" | "updates";

const tabs: { key: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { key: "appearance", label: "Appearance", icon: <Palette className="h-4 w-4" /> },
  { key: "ai-provider", label: "AI Provider", icon: <Bot className="h-4 w-4" /> },
  { key: "accounts", label: "Accounts", icon: <KeyRound className="h-4 w-4" /> },
  { key: "updates", label: "Updates", icon: <Download className="h-4 w-4" /> },
];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("appearance");
  const {
    providerConfig,
    models,
    hasAnthropicKey,
    hasOpenAiKey,
    hasGithubToken,
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
    saveGithubToken,
    saveLinearToken,
    saveJiraCredentials,
    saveJiraDomain,
    saveAsanaToken,
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
    <div className="flex h-full">
      {/* Side nav */}
      <nav className="w-48 shrink-0 border-r bg-muted/30 p-3 space-y-1">
        <h1 className="px-2 pb-2 text-sm font-semibold text-muted-foreground">Settings</h1>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
              activeTab === tab.key
                ? "bg-background font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/50 hover:text-foreground"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Content panel */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-2xl">
          {activeTab === "appearance" && (
            <AppearanceSettings
              codeTheme={prefs.codeTheme}
              onChangeCodeTheme={(theme: CodeTheme) => update("codeTheme", theme)}
            />
          )}
          {activeTab === "ai-provider" && (
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
          )}
          {activeTab === "accounts" && (
            <AccountSettings
              hasGithubToken={hasGithubToken}
              hasLinearToken={hasLinearToken}
              hasJiraCredentials={hasJiraCredentials}
              jiraDomain={jiraDomain}
              hasAsanaToken={hasAsanaToken}
              onSaveGithubToken={saveGithubToken}
              onSaveLinearToken={saveLinearToken}
              onSaveJiraCredentials={saveJiraCredentials}
              onSaveJiraDomain={saveJiraDomain}
              onSaveAsanaToken={saveAsanaToken}
            />
          )}
          {activeTab === "updates" && <UpdateSettings />}
        </div>
      </div>
    </div>
  );
}
