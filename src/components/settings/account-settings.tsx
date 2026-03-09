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

interface TokenFieldProps {
  label: string;
  hasToken: boolean;
  placeholder: string;
  hint?: string;
  type?: string;
  onSave: (token: string) => Promise<void>;
}

function TokenField({ label, hasToken, placeholder, hint, type = "password", onSave }: TokenFieldProps) {
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
      </div>
    </div>
  );
}

interface AccountSettingsProps {
  hasGithubToken: boolean;
  hasLinearToken: boolean;
  hasJiraCredentials: boolean;
  jiraDomain: string;
  hasAsanaToken: boolean;
  onSaveGithubToken: (token: string) => Promise<void>;
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
  hasGithubToken,
  hasLinearToken,
  hasJiraCredentials,
  jiraDomain,
  hasAsanaToken,
  onSaveGithubToken,
  onSaveLinearToken,
  onSaveJiraCredentials,
  onSaveJiraDomain,
  onSaveAsanaToken,
}: AccountSettingsProps) {
  const [selectedProvider, setSelectedProvider] = useState<TicketProviderKey>("linear");

  const configuredCount = [hasLinearToken, hasJiraCredentials, hasAsanaToken].filter(Boolean).length;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>GitHub</CardTitle>
        </CardHeader>
        <CardContent>
          <TokenField
            label="Personal Access Token"
            hasToken={hasGithubToken}
            placeholder="ghp_..."
            hint="Requires repo scope. Add read:org to also see PRs assigned to your teams."
            onSave={onSaveGithubToken}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Ticket Providers</CardTitle>
            {configuredCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                {configuredCount} configured
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Provider</Label>
            <Select value={selectedProvider} onValueChange={(v) => setSelectedProvider(v as TicketProviderKey)}>
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
            provider={selectedProvider}
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
