import { Outlet } from "react-router-dom";
import { Sidebar } from "./sidebar";
import { useTheme } from "@/hooks/use-theme";
import { useLayoutPreferences } from "@/hooks/use-layout-preferences";

export function AppShell() {
  const { prefs, update } = useLayoutPreferences();
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        collapsed={prefs.appSidebarCollapsed}
        onToggleCollapsed={() => update("appSidebarCollapsed", !prefs.appSidebarCollapsed)}
        theme={theme}
        onSetTheme={setTheme}
      />
      <main className="flex-1 overflow-auto bg-background">
        <Outlet />
      </main>
    </div>
  );
}
