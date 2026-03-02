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
  onSave: (token: string) => Promise<void>;
}

function TokenField({ label, hasToken, placeholder, onSave }: TokenFieldProps) {
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
      <div className="flex gap-2">
        <Input
          type="password"
          placeholder={hasToken ? "Token saved in keychain" : placeholder}
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
  onSaveGithubToken: (token: string) => Promise<void>;
  onSaveLinearToken: (token: string) => Promise<void>;
}

export function AccountSettings({
  hasGithubToken,
  hasLinearToken,
  onSaveGithubToken,
  onSaveLinearToken,
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
          onSave={onSaveGithubToken}
        />
        <TokenField
          label="Linear API Key"
          hasToken={hasLinearToken}
          placeholder="lin_api_..."
          onSave={onSaveLinearToken}
        />
      </CardContent>
    </Card>
  );
}
