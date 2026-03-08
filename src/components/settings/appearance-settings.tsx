import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CodeTheme } from "@/hooks/use-layout-preferences";
import { useHighlighter, tokenizeLines } from "@/hooks/use-highlighter";
import type { ThemedToken } from "@/hooks/use-highlighter";

interface ThemeOption {
  value: CodeTheme;
  label: string;
}

const THEME_GROUPS: { label: string; themes: ThemeOption[] }[] = [
  {
    label: "Auto",
    themes: [{ value: "auto", label: "Auto (match app theme)" }],
  },
  {
    label: "Dark",
    themes: [
      { value: "andromeeda", label: "Andromeeda" },
      { value: "aurora-x", label: "Aurora X" },
      { value: "ayu-dark", label: "Ayu Dark" },
      { value: "catppuccin-frappe", label: "Catppuccin Frapp\u00e9" },
      { value: "catppuccin-macchiato", label: "Catppuccin Macchiato" },
      { value: "catppuccin-mocha", label: "Catppuccin Mocha" },
      { value: "dark-plus", label: "Dark+ (VS Code)" },
      { value: "dracula", label: "Dracula" },
      { value: "dracula-soft", label: "Dracula Soft" },
      { value: "everforest-dark", label: "Everforest Dark" },
      { value: "github-dark", label: "GitHub Dark" },
      { value: "github-dark-dimmed", label: "GitHub Dark Dimmed" },
      { value: "gruvbox-dark-medium", label: "Gruvbox Dark" },
      { value: "houston", label: "Houston" },
      { value: "kanagawa-wave", label: "Kanagawa Wave" },
      { value: "material-theme", label: "Material" },
      { value: "material-theme-ocean", label: "Material Ocean" },
      { value: "material-theme-palenight", label: "Material Palenight" },
      { value: "min-dark", label: "Min Dark" },
      { value: "monokai", label: "Monokai" },
      { value: "night-owl", label: "Night Owl" },
      { value: "nord", label: "Nord" },
      { value: "one-dark-pro", label: "One Dark Pro" },
      { value: "poimandres", label: "Poimandres" },
      { value: "rose-pine", label: "Ros\u00e9 Pine" },
      { value: "rose-pine-moon", label: "Ros\u00e9 Pine Moon" },
      { value: "slack-dark", label: "Slack Dark" },
      { value: "solarized-dark", label: "Solarized Dark" },
      { value: "synthwave-84", label: "Synthwave '84" },
      { value: "tokyo-night", label: "Tokyo Night" },
      { value: "vesper", label: "Vesper" },
      { value: "vitesse-dark", label: "Vitesse Dark" },
    ],
  },
  {
    label: "Light",
    themes: [
      { value: "catppuccin-latte", label: "Catppuccin Latte" },
      { value: "everforest-light", label: "Everforest Light" },
      { value: "github-light", label: "GitHub Light" },
      { value: "gruvbox-light-medium", label: "Gruvbox Light" },
      { value: "light-plus", label: "Light+ (VS Code)" },
      { value: "min-light", label: "Min Light" },
      { value: "one-light", label: "One Light" },
      { value: "rose-pine-dawn", label: "Ros\u00e9 Pine Dawn" },
      { value: "solarized-light", label: "Solarized Light" },
      { value: "vitesse-light", label: "Vitesse Light" },
    ],
  },
];

const SAMPLE_CODE = [
  'import { useState } from "react";',
  "",
  "interface Props {",
  "  initial?: number;",
  "}",
  "",
  "export function Counter({ initial = 0 }: Props) {",
  "  const [count, setCount] = useState(initial);",
  "  const label = `Count: ${count}`;",
  "",
  "  return (",
  '    <button onClick={() => setCount((c) => c + 1)}>',
  "      {label}",
  "    </button>",
  "  );",
  "}",
];

interface AppearanceSettingsProps {
  codeTheme: CodeTheme;
  onChangeCodeTheme: (theme: CodeTheme) => void;
}

export function AppearanceSettings({
  codeTheme,
  onChangeCodeTheme,
}: AppearanceSettingsProps) {
  const { highlighter } = useHighlighter();
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
  const [bg, setBg] = useState<string>("#1e1e1e");
  const [fg, setFg] = useState<string>("#d4d4d4");

  const resolvedTheme =
    codeTheme === "auto"
      ? document.documentElement.classList.contains("dark")
        ? "github-dark"
        : "github-light"
      : codeTheme;

  useEffect(() => {
    if (!highlighter) return;
    let cancelled = false;

    tokenizeLines(highlighter, SAMPLE_CODE, "tsx", resolvedTheme).then(
      (result) => {
        if (!cancelled) setTokens(result);
      }
    );

    try {
      const theme = highlighter.getTheme(resolvedTheme);
      setBg(theme.bg || "#1e1e1e");
      setFg(theme.fg || "#d4d4d4");
    } catch {
      setBg("#1e1e1e");
      setFg("#d4d4d4");
    }

    return () => {
      cancelled = true;
    };
  }, [highlighter, resolvedTheme]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="code-theme-select">Code Theme</Label>
          <Select value={codeTheme} onValueChange={onChangeCodeTheme}>
            <SelectTrigger id="code-theme-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THEME_GROUPS.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.themes.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Syntax highlighting theme for the diff viewer.
          </p>
        </div>

        {/* Theme preview */}
        <div
          className="rounded-md border overflow-hidden text-[13px] leading-[22px] font-mono"
          style={{ background: bg, color: fg }}
        >
          <div className="px-4 py-3 overflow-x-auto">
            <pre className="m-0">
              {(tokens ?? null)
                ? tokens!.map((lineTokens, i) => (
                    <div key={i} className="flex">
                      <span
                        className="select-none shrink-0 text-right opacity-30 inline-block"
                        style={{ width: "2ch", marginRight: "1.5ch" }}
                      >
                        {i + 1}
                      </span>
                      <code className="whitespace-pre">
                        {lineTokens.length > 0
                          ? lineTokens.map((token, j) => (
                              <span
                                key={j}
                                style={
                                  token.color
                                    ? { color: token.color }
                                    : undefined
                                }
                              >
                                {token.content}
                              </span>
                            ))
                          : "\u00a0"}
                      </code>
                    </div>
                  ))
                : SAMPLE_CODE.map((line, i) => (
                    <div key={i} className="flex opacity-40">
                      <span
                        className="select-none shrink-0 text-right opacity-30 inline-block"
                        style={{ width: "2ch", marginRight: "1.5ch" }}
                      >
                        {i + 1}
                      </span>
                      <code className="whitespace-pre">
                        {line || "\u00a0"}
                      </code>
                    </div>
                  ))}
            </pre>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
