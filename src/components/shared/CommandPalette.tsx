import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Search,
  FolderOpen,
  MessageSquare,
  Table2,
  Zap,
  Settings,
  ArrowUpRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "@/lib/tauri";

/**
 * Command palette invoked with ⌘K / Ctrl+K. Searches across projects,
 * chats, reviews, workflows, and app routes in memory. Loads everything
 * at mount rather than per keystroke — the datasets are small (we're
 * a single-user desktop app) and keystroke filtering stays snappy.
 */
type Kind = "route" | "project" | "chat" | "review" | "workflow";

interface Item {
  id: string;
  kind: Kind;
  label: string;
  sublabel?: string;
  icon: LucideIcon;
  onRun: () => void;
}

const ROUTES: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/", label: "Go to Chat", icon: MessageSquare },
  { to: "/projects", label: "Go to Projects", icon: FolderOpen },
  { to: "/tabular-reviews", label: "Go to Tabular Reviews", icon: Table2 },
  { to: "/workflows", label: "Go to Workflows", icon: Zap },
  { to: "/settings", label: "Go to Settings", icon: Settings },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Bind keyboard shortcuts for open / close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isCmdK) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Load index on mount. Refresh on open.
  const loadIndex = async () => {
    try {
      const [projects, chats, reviews, workflows] = await Promise.all([
        api.listProjects(),
        api.listChats(),
        api.listReviews(),
        api.listWorkflows(),
      ]);

      const list: Item[] = [
        ...ROUTES.map((r) => ({
          id: `route:${r.to}`,
          kind: "route" as Kind,
          label: r.label,
          icon: r.icon,
          onRun: () => navigate({ to: r.to }),
        })),
        ...projects.map((p) => ({
          id: `project:${p.id}`,
          kind: "project" as Kind,
          label: p.name,
          sublabel: `Project / ${p.documentCount} documents`,
          icon: FolderOpen,
          onRun: () => navigate({ to: "/projects/$id", params: { id: p.id } }),
        })),
        ...chats.map((c) => ({
          id: `chat:${c.id}`,
          kind: "chat" as Kind,
          label: c.title ?? "New chat",
          sublabel: "Chat",
          icon: MessageSquare,
          onRun: () => navigate({ to: "/chat/$id", params: { id: c.id } }),
        })),
        ...reviews.map((r) => ({
          id: `review:${r.id}`,
          kind: "review" as Kind,
          label: r.title ?? "Untitled review",
          sublabel: "Tabular review",
          icon: Table2,
          onRun: () =>
            navigate({ to: "/tabular-reviews/$id", params: { id: r.id } }),
        })),
        ...workflows.map((w) => ({
          id: `workflow:${w.id}`,
          kind: "workflow" as Kind,
          label: w.title,
          sublabel: `Workflow${w.practice ? ` / ${w.practice}` : ""}`,
          icon: Zap,
          onRun: () => navigate({ to: "/workflows" }),
        })),
      ];
      setItems(list);
    } catch {
      /* noop */
    }
  };

  useEffect(() => {
    loadIndex();
  }, []);

  useEffect(() => {
    if (open) {
      loadIndex();
      setQuery("");
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 50);
    return items
      .filter((it) => {
        const hay = `${it.label} ${it.sublabel ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 50);
  }, [items, query]);

  // Keep cursor in range when filter shrinks.
  useEffect(() => {
    if (cursor >= filtered.length) setCursor(Math.max(0, filtered.length - 1));
  }, [filtered.length, cursor]);

  const run = (item: Item | undefined) => {
    if (!item) return;
    setOpen(false);
    item.onRun();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4 bg-ink/30 backdrop-blur-sm animate-fade-in"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl bg-canvas rounded-md border border-hairline shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-hairline-soft">
          <Search className="w-4 h-4 text-muted" strokeWidth={1.5} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(filtered[cursor]);
              }
            }}
            placeholder="Search projects, chats, reviews, workflows..."
            className="flex-1 bg-transparent text-sm text-ink placeholder:text-muted-soft focus:outline-none"
          />
          <kbd className="text-[10px] font-mono text-muted-soft px-1.5 py-0.5 bg-surface-strong rounded border border-hairline-soft">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-muted-soft">No matches</p>
            </div>
          ) : (
            filtered.map((it, i) => {
              const active = i === cursor;
              return (
                <button
                  key={it.id}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => run(it)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    active ? "bg-surface-strong" : "hover:bg-canvas-soft"
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 border border-hairline-soft ${
                      active ? "bg-canvas" : "bg-canvas-soft"
                    }`}
                  >
                    <it.icon
                      className="w-3.5 h-3.5 text-body"
                      strokeWidth={1.5}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-ink truncate">{it.label}</p>
                    {it.sublabel && (
                      <p className="text-[11px] text-muted-soft truncate">
                        {it.sublabel}
                      </p>
                    )}
                  </div>
                  {active && (
                    <ArrowUpRight
                      className="w-3.5 h-3.5 text-muted-soft shrink-0"
                      strokeWidth={1.5}
                    />
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-hairline-soft bg-canvas-soft">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-soft">
            <kbd className="font-mono px-1.5 py-0.5 bg-canvas rounded border border-hairline-soft">
              ↑
            </kbd>
            <kbd className="font-mono px-1.5 py-0.5 bg-canvas rounded border border-hairline-soft">
              ↓
            </kbd>
            <span>navigate</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-soft">
            <kbd className="font-mono px-1.5 py-0.5 bg-canvas rounded border border-hairline-soft">
              ↵
            </kbd>
            <span>open</span>
          </div>
          <div className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-soft">
            <kbd className="font-mono px-1.5 py-0.5 bg-canvas rounded border border-hairline-soft">
              ⌘ K
            </kbd>
            <span>toggle</span>
          </div>
        </div>
      </div>
    </div>
  );
}
