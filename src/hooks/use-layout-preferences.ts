import { useCallback, useState } from "react";
import type { DiffViewMode } from "@/components/pr-review/diff-pane";
import type { DiffScope } from "@/hooks/use-review";

const STORAGE_KEY = "glance-layout";

export type CodeTheme = "auto" | "github-dark" | "github-light" | "one-dark-pro" | "dracula" | "nord" | "min-light" | "solarized-dark" | "solarized-light" | "monokai" | "slack-dark" | "vitesse-dark" | "vitesse-light";

interface LayoutPreferences {
  sidebarCollapsed: boolean;
  appSidebarCollapsed: boolean;
  diffViewMode: DiffViewMode;
  hideMerges: boolean;
  linearPanelExpanded: boolean;
  diffScope: DiffScope;
  codeTheme: CodeTheme;
}

const DEFAULTS: LayoutPreferences = {
  sidebarCollapsed: false,
  appSidebarCollapsed: false,
  diffViewMode: "unified",
  hideMerges: false,
  linearPanelExpanded: true,
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
