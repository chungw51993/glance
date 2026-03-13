import { useCallback, useState } from "react";
import type { DiffViewMode } from "@/components/pr-review/diff-pane";
import type { DiffScope } from "@/hooks/use-review";

const STORAGE_KEY = "glance-layout";

export type CodeTheme =
  | "auto"
  | "andromeeda"
  | "aurora-x"
  | "ayu-dark"
  | "catppuccin-frappe"
  | "catppuccin-latte"
  | "catppuccin-macchiato"
  | "catppuccin-mocha"
  | "dark-plus"
  | "dracula"
  | "dracula-soft"
  | "everforest-dark"
  | "everforest-light"
  | "github-dark"
  | "github-dark-dimmed"
  | "github-light"
  | "gruvbox-dark-medium"
  | "gruvbox-light-medium"
  | "houston"
  | "kanagawa-wave"
  | "light-plus"
  | "material-theme"
  | "material-theme-ocean"
  | "material-theme-palenight"
  | "min-dark"
  | "min-light"
  | "monokai"
  | "night-owl"
  | "nord"
  | "one-dark-pro"
  | "one-light"
  | "poimandres"
  | "rose-pine"
  | "rose-pine-dawn"
  | "rose-pine-moon"
  | "slack-dark"
  | "solarized-dark"
  | "solarized-light"
  | "synthwave-84"
  | "tokyo-night"
  | "vesper"
  | "vitesse-dark"
  | "vitesse-light";

interface LayoutPreferences {
  sidebarCollapsed: boolean;
  appSidebarCollapsed: boolean;
  diffViewMode: DiffViewMode;
  hideMerges: boolean;
  linearPanelExpanded: boolean;
  descriptionPanelExpanded: boolean;
  fileTreeCollapsed: boolean;
  diffScope: DiffScope;
  codeTheme: CodeTheme;
}

const DEFAULTS: LayoutPreferences = {
  sidebarCollapsed: false,
  appSidebarCollapsed: false,
  diffViewMode: "unified",
  hideMerges: false,
  linearPanelExpanded: true,
  descriptionPanelExpanded: false,
  fileTreeCollapsed: true,
  diffScope: "commit",
  codeTheme: "auto",
};

function load(): LayoutPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

function save(prefs: LayoutPreferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

/**
 * Persisted layout preferences backed by localStorage.
 * Reads synchronously on mount to avoid layout flicker.
 */
export function useLayoutPreferences() {
  const [prefs, setPrefs] = useState<LayoutPreferences>(load);

  const update = useCallback(
    <K extends keyof LayoutPreferences>(key: K, value: LayoutPreferences[K]) => {
      setPrefs((prev) => {
        const next = { ...prev, [key]: value };
        save(next);
        return next;
      });
    },
    []
  );

  return { prefs, update } as const;
}
