import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

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
  return (
    <Card>
      <CardHeader>
        <CardTitle>Accounts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <TokenField
          label="GitHub Personal Access Token"
          hasToken={hasGithubToken}
          placeholder="ghp_..."
          hint="Requires repo scope. Add read:org to also see PRs assigned to your teams."
          onSave={onSaveGithubToken}
        />
        <div className="border-t pt-4">
          <p className="text-xs font-medium text-muted-foreground mb-3">Ticket Providers</p>
          <div className="space-y-4">
            <TokenField
              label="Linear API Key"
              hasToken={hasLinearToken}
              placeholder="lin_api_..."
              onSave={onSaveLinearToken}
            />
            <TokenField
              label="Jira Credentials"
              hasToken={hasJiraCredentials}
              placeholder="email@company.com:api_token"
              hint="Format: email:api_token. Generate an API token from id.atlassian.com."
              onSave={onSaveJiraCredentials}
            />
            <TokenField
              label="Jira Domain"
              hasToken={!!jiraDomain}
              placeholder="mycompany.atlassian.net"
              hint="Your Jira Cloud domain (e.g. mycompany.atlassian.net)"
              type="text"
              onSave={onSaveJiraDomain}
            />
            <TokenField
              label="Asana Personal Access Token"
              hasToken={hasAsanaToken}
              placeholder="1/1234567890..."
              hint="Generate from Settings > Apps > Developer Apps in Asana."
              onSave={onSaveAsanaToken}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
