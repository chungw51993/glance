import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { AiModelInfo, AiProviderType, ProviderConfig } from "@/types";

interface ProviderSettingsProps {
  providerConfig: ProviderConfig | null;
  models: AiModelInfo[];
  hasAnthropicKey: boolean;
  hasOpenAiKey: boolean;
  ollamaUrl: string;
  onChangeProvider: (provider: AiProviderType) => Promise<void>;
  onChangeModel: (modelId: string) => Promise<void>;
  onSaveApiKey: (provider: AiProviderType, key: string) => Promise<void>;
  onDeleteApiKey: (provider: AiProviderType) => Promise<void>;
  onTestConnection: (
    provider: AiProviderType,
    modelId: string
  ) => Promise<void>;
  onSaveOllamaUrl: (url: string) => Promise<void>;
}

export function ProviderSettings({
  providerConfig,
  models,
  hasAnthropicKey,
  hasOpenAiKey,
  ollamaUrl,
  onChangeProvider,
  onChangeModel,
  onSaveApiKey,
  onDeleteApiKey,
  onTestConnection,
  onSaveOllamaUrl,
}: ProviderSettingsProps) {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [ollamaUrlInput, setOllamaUrlInput] = useState(ollamaUrl);
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [testError, setTestError] = useState("");

  const currentProvider = providerConfig?.provider_type ?? "anthropic";
  const currentModel = providerConfig?.model_id ?? "";
  const isOllama = currentProvider === "ollama";
  const hasKey =
    currentProvider === "anthropic"
      ? hasAnthropicKey
      : currentProvider === "openai"
        ? hasOpenAiKey
        : false;

  const handleSaveKey = async () => {
    if (!apiKeyInput.trim()) return;
    try {
      await onSaveApiKey(currentProvider, apiKeyInput.trim());
      setApiKeyInput("");
    } catch (err) {
      console.error("Failed to save API key:", err);
    }
  };

  const handleSaveOllamaUrl = async () => {
    try {
      await onSaveOllamaUrl(ollamaUrlInput.trim());
    } catch (err) {
      console.error("Failed to save Ollama URL:", err);
    }
  };

  const handleTestConnection = async () => {
    setTestStatus("testing");
    setTestError("");
    try {
      await onTestConnection(currentProvider, currentModel);
      setTestStatus("success");
    } catch (err) {
      setTestStatus("error");
      setTestError(String(err));
    }
  };

  const canTest = isOllama || hasKey;

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Provider</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Provider</Label>
          <Select value={currentProvider} onValueChange={onChangeProvider}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
              <SelectItem value="openai">OpenAI (GPT)</SelectItem>
              <SelectItem value="ollama">Ollama (Local)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Model</Label>
          <Select value={currentModel} onValueChange={onChangeModel}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {models.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isOllama ? (
          <div className="space-y-2">
            <Label>Ollama URL</Label>
            <div className="flex gap-2">
              <Input
                placeholder="http://localhost:11434"
                value={ollamaUrlInput}
                onChange={(e) => setOllamaUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveOllamaUrl();
                }}
              />
              <Button variant="outline" onClick={handleSaveOllamaUrl}>
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              No API key needed. Make sure Ollama is running locally.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>API Key</Label>
              {hasKey && (
                <Badge variant="secondary" className="text-xs">
                  Stored
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder={
                  hasKey ? "Key saved locally" : "Enter API key"
                }
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveKey();
                }}
              />
              <Button
                variant="outline"
                onClick={handleSaveKey}
                disabled={!apiKeyInput.trim()}
              >
                Save
              </Button>
              {hasKey && (
                <Button
                  variant="outline"
                  onClick={() => onDeleteApiKey(currentProvider)}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={!canTest || testStatus === "testing"}
          >
            {testStatus === "testing" ? "Testing..." : "Test Connection"}
          </Button>
          {testStatus === "success" && (
            <span className="text-sm text-green-600">Connected</span>
          )}
          {testStatus === "error" && (
            <span className="text-sm text-red-600">{testError}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
