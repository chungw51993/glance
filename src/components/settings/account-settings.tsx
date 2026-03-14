import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GitProviderType } from "@/types";

interface TokenFieldProps {
  label: string;
  hasToken: boolean;
  placeholder: string;
  hint?: string;
  type?: string;
  onSave: (token: string) => Promise<void>;
  onDelete?: () => Promise<void>;
}

function TokenField({ label, hasToken, placeholder, hint, type = "password", onSave, onDelete }: TokenFieldProps) {
  const [value, setValue] = useState("");

  const handleSave = async () => {
    if (!value.trim()) return;
    try {
      await onSave(value.trim());
      setValue("");
    } catch (err) {
      console.error(`Failed to save ${label}:`, err);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label>{label}</Label>
        {hasToken && (
          <Badge variant="secondary" className="text-xs">
            Stored
          </Badge>
        )}
      </div>
      {hint && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
      <div className="flex gap-2">
        <Input
          type={type}
          placeholder={hasToken ? "Token saved locally" : placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
        />
        <Button
          variant="outline"
          onClick={handleSave}
          disabled={!value.trim()}
        >
          Save
        </Button>
        {hasToken && onDelete && (
          <Button
            variant="outline"
            onClick={onDelete}
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

// --- Git Provider ---

interface GitProviderInfo {
  key: GitProviderType;
  label: string;
  placeholder: string;
  hint: string;
  comingSoon: boolean;
}

const gitProviders: GitProviderInfo[] = [
  {
    key: "git_hub",
    label: "GitHub",
    placeholder: "ghp_...",
    hint: "Requires repo scope. Add read:org to also see PRs assigned to your teams.",
    comingSoon: false,
  },
  {
    key: "git_lab",
    label: "GitLab",
    placeholder: "glpat-...",
    hint: "Requires api scope. Generate from Settings > Access Tokens in GitLab.",
    comingSoon: true,
  },
  {
    key: "bitbucket",
    label: "Bitbucket",
    placeholder: "ATBB...",
    hint: "Create an App Password with Repositories and Pull Requests permissions.",
    comingSoon: true,
  },
];

// --- Ticket Provider ---

interface AccountSettingsProps {
  gitProviderType: GitProviderType;
  hasGitHubToken: boolean;
  hasGitLabToken: boolean;
  hasBitbucketToken: boolean;
  hasLinearToken: boolean;
  hasJiraCredentials: boolean;
  jiraDomain: string;
  hasAsanaToken: boolean;
  onChangeGitProvider: (provider: GitProviderType) => Promise<void>;
  onSaveGitToken: (provider: GitProviderType, token: string) => Promise<void>;
  onDeleteGitToken: (provider: GitProviderType) => Promise<void>;
  onSaveLinearToken: (token: string) => Promise<void>;
  onSaveJiraCredentials: (credentials: string) => Promise<void>;
  onSaveJiraDomain: (domain: string) => Promise<void>;
  onSaveAsanaToken: (token: string) => Promise<void>;
}

type TicketProviderKey = "linear" | "jira" | "asana";

const ticketProviders: { key: TicketProviderKey; label: string }[] = [
  { key: "linear", label: "Linear" },
  { key: "jira", label: "Jira" },
  { key: "asana", label: "Asana" },
];

function TicketProviderFields({
  provider,
  hasLinearToken,
  hasJiraCredentials,
  jiraDomain,
  hasAsanaToken,
  onSaveLinearToken,
  onSaveJiraCredentials,
  onSaveJiraDomain,
  onSaveAsanaToken,
}: {
  provider: TicketProviderKey;
} & Pick<
  AccountSettingsProps,
  | "hasLinearToken"
  | "hasJiraCredentials"
  | "jiraDomain"
  | "hasAsanaToken"
  | "onSaveLinearToken"
  | "onSaveJiraCredentials"
  | "onSaveJiraDomain"
  | "onSaveAsanaToken"
>) {
  switch (provider) {
    case "linear":
      return (
        <TokenField
          label="API Key"
          hasToken={hasLinearToken}
          placeholder="lin_api_..."
          onSave={onSaveLinearToken}
        />
      );
    case "jira":
      return (
        <div className="space-y-4">
          <TokenField
            label="Credentials"
            hasToken={hasJiraCredentials}
            placeholder="email@company.com:api_token"
            hint="Format: email:api_token. Generate an API token from id.atlassian.com."
            onSave={onSaveJiraCredentials}
          />
          <TokenField
            label="Domain"
            hasToken={!!jiraDomain}
            placeholder="mycompany.atlassian.net"
            hint="Your Jira Cloud domain (e.g. mycompany.atlassian.net)"
            type="text"
            onSave={onSaveJiraDomain}
          />
        </div>
      );
    case "asana":
      return (
        <TokenField
          label="Personal Access Token"
          hasToken={hasAsanaToken}
          placeholder="1/1234567890..."
          hint="Generate from Settings > Apps > Developer Apps in Asana."
          onSave={onSaveAsanaToken}
        />
      );
  }
}

export function AccountSettings({
  gitProviderType,
  hasGitHubToken,
  hasGitLabToken,
  hasBitbucketToken,
  hasLinearToken,
  hasJiraCredentials,
  jiraDomain,
  hasAsanaToken,
  onChangeGitProvider,
  onSaveGitToken,
  onDeleteGitToken,
  onSaveLinearToken,
  onSaveJiraCredentials,
  onSaveJiraDomain,
  onSaveAsanaToken,
}: AccountSettingsProps) {
  const [selectedTicketProvider, setSelectedTicketProvider] = useState<TicketProviderKey>("linear");

  const configuredTicketCount = [hasLinearToken, hasJiraCredentials, hasAsanaToken].filter(Boolean).length;

  const currentGitProvider = gitProviders.find((p) => p.key === gitProviderType) ?? gitProviders[0];

  const hasTokenForProvider = (key: GitProviderType): boolean => {
    switch (key) {
      case "git_hub": return hasGitHubToken;
      case "git_lab": return hasGitLabToken;
      case "bitbucket": return hasBitbucketToken;
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Git Provider</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Provider</Label>
            <Select value={gitProviderType} onValueChange={(v) => onChangeGitProvider(v as GitProviderType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {gitProviders.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    <div className="flex items-center gap-2">
                      {p.label}
                      {p.comingSoon && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0">
                          Coming soon
                        </Badge>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <TokenField
            label="Personal Access Token"
            hasToken={hasTokenForProvider(gitProviderType)}
            placeholder={currentGitProvider.placeholder}
            hint={currentGitProvider.hint}
            onSave={(token) => onSaveGitToken(gitProviderType, token)}
            onDelete={() => onDeleteGitToken(gitProviderType)}
          />

          {currentGitProvider.comingSoon && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {currentGitProvider.label} integration is coming soon. You can save your token now and it will be ready when support is added.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Ticket Providers</CardTitle>
            {configuredTicketCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                {configuredTicketCount} configured
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Provider</Label>
            <Select value={selectedTicketProvider} onValueChange={(v) => setSelectedTicketProvider(v as TicketProviderKey)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ticketProviders.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TicketProviderFields
            provider={selectedTicketProvider}
            hasLinearToken={hasLinearToken}
            hasJiraCredentials={hasJiraCredentials}
            jiraDomain={jiraDomain}
            hasAsanaToken={hasAsanaToken}
            onSaveLinearToken={onSaveLinearToken}
            onSaveJiraCredentials={onSaveJiraCredentials}
            onSaveJiraDomain={onSaveJiraDomain}
            onSaveAsanaToken={onSaveAsanaToken}
          />
        </CardContent>
      </Card>
    </>
  );
}
