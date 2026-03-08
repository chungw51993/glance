import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CodeTheme } from "@/hooks/use-layout-preferences";

const CODE_THEMES: { value: CodeTheme; label: string }[] = [
  { value: "auto", label: "Auto (match app theme)" },
  { value: "github-dark", label: "GitHub Dark" },
  { value: "github-light", label: "GitHub Light" },
  { value: "one-dark-pro", label: "One Dark Pro" },
  { value: "dracula", label: "Dracula" },
  { value: "nord", label: "Nord" },
  { value: "monokai", label: "Monokai" },
  { value: "solarized-dark", label: "Solarized Dark" },
  { value: "solarized-light", label: "Solarized Light" },
  { value: "vitesse-dark", label: "Vitesse Dark" },
  { value: "vitesse-light", label: "Vitesse Light" },
  { value: "slack-dark", label: "Slack Dark" },
  { value: "min-light", label: "Min Light" },
];

interface AppearanceSettingsProps {
  codeTheme: CodeTheme;
  onChangeCodeTheme: (theme: CodeTheme) => void;
}

export function AppearanceSettings({
  codeTheme,
  onChangeCodeTheme,
}: AppearanceSettingsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Code Theme</Label>
          <Select value={codeTheme} onValueChange={onChangeCodeTheme}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CODE_THEMES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Syntax highlighting theme for the diff viewer.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
