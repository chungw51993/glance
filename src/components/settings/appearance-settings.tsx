import { useEffect, useState } from "react";
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
import { useHighlighter, tokenizeLines } from "@/hooks/use-highlighter";
import type { ThemedToken } from "@/hooks/use-highlighter";

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

const SAMPLE_CODE = [
  'import { useState } from "react";',
  "",
  "function Counter({ initial = 0 }) {",
  "  const [count, setCount] = useState(initial);",
  "",
  "  return (",
  '    <button onClick={() => setCount(c => c + 1)}>',
  "      Count: {count}",
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
    } catch {
      setBg("#1e1e1e");
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

        {/* Theme preview */}
        <div
          className="rounded-md border overflow-hidden text-xs leading-5 font-mono"
          style={{ background: bg }}
        >
          <div className="px-4 py-3 overflow-x-auto">
            {tokens
              ? tokens.map((lineTokens, i) => (
                  <div key={i} className="flex">
                    <span className="select-none w-6 shrink-0 text-right mr-4 opacity-30">
                      {i + 1}
                    </span>
                    <span>
                      {lineTokens.map((token, j) => (
                        <span
                          key={j}
                          style={
                            token.color ? { color: token.color } : undefined
                          }
                        >
                          {token.content}
                        </span>
                      ))}
                      {lineTokens.length === 0 && "\u00a0"}
                    </span>
                  </div>
                ))
              : SAMPLE_CODE.map((line, i) => (
                  <div key={i} className="flex opacity-40">
                    <span className="select-none w-6 shrink-0 text-right mr-4 opacity-30">
                      {i + 1}
                    </span>
                    <span>{line || "\u00a0"}</span>
                  </div>
                ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
