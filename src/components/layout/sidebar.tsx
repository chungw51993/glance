import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { getLastReposPath } from "@/lib/repos-cache";
import type { Theme } from "@/hooks/use-theme";

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  theme: Theme;
  onSetTheme: (theme: Theme) => void;
}

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  theme,
  onSetTheme,
}: SidebarProps) {
  const nextTheme = (): Theme => {
    if (theme === "light") return "dark";
    if (theme === "dark") return "system";
    return "light";
  };

  const themeLabel =
    theme === "light" ? "Light" : theme === "dark" ? "Dark" : "System";

  return (
    <aside
      className="flex h-full shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-all duration-200 overflow-hidden"
      style={{ width: collapsed ? 48 : 224 }}
    >
      {/* Nav links */}
      <NavItems collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} />

      {/* Theme toggle at bottom */}
      <Separator />
      <div className="shrink-0 p-2">
        <button
          onClick={() => onSetTheme(nextTheme())}
          title={`Theme: ${themeLabel} (click to cycle)`}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
            "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
            collapsed && "justify-center px-2"
          )}
        >
          <ThemeIcon theme={theme} className="h-4 w-4 shrink-0" />
          {!collapsed && (
            <span className="truncate text-xs">{themeLabel}</span>
          )}
        </button>
      </div>
    </aside>
  );
}

const staticNavItems = [
  { to: "/assigned", label: "Assigned", icon: "@" },
  { to: "/settings", label: "Settings", icon: "{}" },
];

function NavItems({ collapsed, onToggleCollapsed }: { collapsed: boolean; onToggleCollapsed: () => void }) {
  const location = useLocation();
  const reposPath = getLastReposPath();
  const isReposArea = location.pathname === "/" || location.pathname.startsWith("/review/");

  const linkClass = (active: boolean) =>
    cn(
      "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
      collapsed && "justify-center px-2",
      active
        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
    );

  return (
    <nav className="flex flex-1 flex-col gap-1 p-2">
      <button
        onClick={onToggleCollapsed}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className={cn(
          "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
          "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
          collapsed && "justify-center px-2"
        )}
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronLeft className="h-4 w-4 shrink-0" />
        )}
        {!collapsed && <span className="truncate">Collapse</span>}
      </button>
      <NavLink
        to={reposPath}
        title={collapsed ? "Repos" : undefined}
        className={linkClass(isReposArea)}
      >
        <span className="font-mono text-xs opacity-60 shrink-0">[]</span>
        {!collapsed && <span className="truncate">Repos</span>}
      </NavLink>
      {staticNavItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          title={collapsed ? item.label : undefined}
          className={({ isActive }) => linkClass(isActive)}
        >
          <span className="font-mono text-xs opacity-60 shrink-0">
            {item.icon}
          </span>
          {!collapsed && <span className="truncate">{item.label}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

function ThemeIcon({
  theme,
  className,
}: {
  theme: Theme;
  className?: string;
}) {
  if (theme === "dark") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
      >
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      </svg>
    );
  }
  if (theme === "light") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m6.34 17.66-1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
      </svg>
    );
  }
  // system
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </svg>
  );
}

function ChevronLeft({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
