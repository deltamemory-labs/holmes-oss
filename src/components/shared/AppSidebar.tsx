import { useEffect, useState } from "react";
import { Link, useMatchRoute } from "@tanstack/react-router";
import {
  MessageSquare,
  FolderOpen,
  Table2,
  Zap,
  Settings,
  Search,
  Moon,
  Sun,
  SquarePen,
  PanelLeftClose,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, type Chat, type Project, type TabularReview } from "@/lib/tauri";
import { useTheme } from "@/lib/useTheme";
import logoImg from "@/assets/logo-t.png";

const links: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/", label: "New chat", icon: SquarePen },
  { to: "/projects", label: "Projects", icon: FolderOpen },
  { to: "/tabular-reviews", label: "Reviews", icon: Table2 },
  { to: "/workflows", label: "Workflows", icon: Zap },
  { to: "/settings", label: "Settings", icon: Settings },
];

/**
 * Left nav. Cohere's navigation aesthetic is three-zone and restrained:
 * logo, centered menu, actions. We adapt that for a persistent sidebar —
 * white surface, hairline separators, mono uppercase section labels, and
 * subdued hover states. No gradient chrome.
 */
export function AppSidebar({ onCollapse }: { onCollapse?: () => void }) {
  const matchRoute = useMatchRoute();
  const [chats, setChats] = useState<Chat[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [reviews, setReviews] = useState<TabularReview[]>([]);
  const { theme, setTheme } = useTheme();

  // Poll everything so the sidebar stays fresh while the user works in other
  // surfaces (e.g. creating a new chat from the assistant page).
  useEffect(() => {
    const refresh = () => {
      api.listChats().then((c) => setChats(c.slice(0, 6))).catch(() => {});
      api.listProjects().then((p) => setProjects(p.slice(0, 4))).catch(() => {});
      api.listReviews().then((r) => setReviews(r.slice(0, 4))).catch(() => {});
    };
    refresh();
    const i = setInterval(refresh, 5000);
    return () => clearInterval(i);
  }, []);

  const fireCmdK = () => {
    // Dispatch a synthetic ⌘K to let the CommandPalette (which listens at the
    // window level) open without us importing its open/close state.
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        metaKey: true,
        ctrlKey: true,
      }),
    );
  };

  return (
    <aside className="w-60 h-full flex flex-col shrink-0 bg-canvas border-r border-hairline-soft relative z-20">
      {/* Logo */}
      <div className="px-5 pt-4 pb-4">
        <div className="flex items-center gap-2.5">
          <img src={logoImg} alt="" className="w-6 h-6 rounded-[4px] sidebar-logo" />
          <span
            className="font-display text-[17px] text-ink tracking-tight"
            style={{ fontWeight: 500, letterSpacing: "-0.3px" }}
          >
            Holmes
          </span>
        </div>
      </div>

      {/* Search trigger */}
      <div className="px-3 pb-3">
        <button
          onClick={fireCmdK}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[12px] text-muted hover:text-ink bg-canvas-soft border border-hairline-soft hover:border-hairline transition-all"
        >
          <Search className="w-3.5 h-3.5" strokeWidth={1.5} />
          <span className="flex-1 text-left">Search</span>
          <kbd className="text-[9px] font-mono text-muted-soft px-1.5 py-0.5 bg-canvas border border-hairline-soft rounded">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Nav */}
      <nav className="px-3 space-y-0.5">
        {links.map((link) => {
          const active =
            link.to === "/"
              ? matchRoute({ to: "/", fuzzy: false })
              : matchRoute({ to: link.to, fuzzy: true });
          return (
            <Link
              key={link.to}
              to={link.to}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] transition-all duration-150 ${
                active
                  ? "bg-surface-strong text-ink font-medium"
                  : "text-muted hover:text-ink hover:bg-canvas-soft"
              }`}
            >
              <link.icon className="w-4 h-4" strokeWidth={1.5} />
              {link.label}
            </Link>
          );
        })}
      </nav>

      {/* Recents */}
      <div className="mt-5 flex-1 overflow-auto px-3 pb-3 space-y-4">
        {chats.length > 0 && (
          <Group
            title="Recent chats"
            action={
              <Link
                to="/chats"
                className="mono-label-sm hover:text-ink transition-colors"
              >
                View all
              </Link>
            }
          >
            {chats.map((c) => {
              const active = matchRoute({
                to: "/chat/$id",
                params: { id: c.id },
                fuzzy: false,
              });
              return (
                <Link
                  key={c.id}
                  to="/chat/$id"
                  params={{ id: c.id }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] truncate transition-all duration-150 ${
                    active
                      ? "bg-surface-strong text-ink font-medium"
                      : "text-muted hover:text-ink hover:bg-canvas-soft"
                  }`}
                >
                  <MessageSquare
                    className="w-3 h-3 shrink-0 text-muted-soft"
                    strokeWidth={1.5}
                  />
                  <span className="truncate">{c.title || "New chat"}</span>
                </Link>
              );
            })}
          </Group>
        )}

        {projects.length > 0 && (
          <Group title="Projects">
            {projects.map((p) => {
              const active = matchRoute({
                to: "/projects/$id",
                params: { id: p.id },
                fuzzy: false,
              });
              return (
                <Link
                  key={p.id}
                  to="/projects/$id"
                  params={{ id: p.id }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] truncate transition-all duration-150 ${
                    active
                      ? "bg-surface-strong text-ink font-medium"
                      : "text-muted hover:text-ink hover:bg-canvas-soft"
                  }`}
                >
                  <FolderOpen
                    className="w-3 h-3 shrink-0 text-muted-soft"
                    strokeWidth={1.5}
                  />
                  <span className="truncate">{p.name}</span>
                </Link>
              );
            })}
          </Group>
        )}

        {reviews.length > 0 && (
          <Group title="Reviews">
            {reviews.map((r) => {
              const active = matchRoute({
                to: "/tabular-reviews/$id",
                params: { id: r.id },
                fuzzy: false,
              });
              return (
                <Link
                  key={r.id}
                  to="/tabular-reviews/$id"
                  params={{ id: r.id }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] truncate transition-all duration-150 ${
                    active
                      ? "bg-surface-strong text-ink font-medium"
                      : "text-muted hover:text-ink hover:bg-canvas-soft"
                  }`}
                >
                  <Table2
                    className="w-3 h-3 shrink-0 text-muted-soft"
                    strokeWidth={1.5}
                  />
                  <span className="truncate">{r.title || "Untitled review"}</span>
                </Link>
              );
            })}
          </Group>
        )}
      </div>

      <div className="px-4 py-3 border-t border-hairline-soft flex items-center justify-between">
        {onCollapse && (
          <button
            onClick={onCollapse}
            className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-surface-strong transition-colors"
            title="Collapse sidebar"
          >
            <PanelLeftClose className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
        )}
        {!onCollapse && <p className="mono-label-sm">v0.1.0</p>}
        {/* Theme pill toggle */}
        <div className="flex items-center bg-surface-strong rounded-full p-0.5">
          <button
            onClick={() => setTheme("light")}
            className={`flex items-center justify-center w-6 h-6 rounded-full transition-all duration-300 ${theme === "light" ? "bg-canvas shadow-sm text-ink" : "text-muted-soft hover:text-muted"}`}
            title="Light"
          >
            <Sun className="w-3 h-3" strokeWidth={2} />
          </button>
          <button
            onClick={() => setTheme("system")}
            className={`flex items-center justify-center w-6 h-6 rounded-full transition-all duration-300 text-[9px] font-bold ${theme === "system" ? "bg-canvas shadow-sm text-ink" : "text-muted-soft hover:text-muted"}`}
            title="System"
          >
            A
          </button>
          <button
            onClick={() => setTheme("dark")}
            className={`flex items-center justify-center w-6 h-6 rounded-full transition-all duration-300 ${theme === "dark" ? "bg-canvas shadow-sm text-ink" : "text-muted-soft hover:text-muted"}`}
            title="Dark"
          >
            <Moon className="w-3 h-3" strokeWidth={2} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function Group({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between px-3 mb-2">
        <p className="mono-label-sm">{title}</p>
        {action}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
