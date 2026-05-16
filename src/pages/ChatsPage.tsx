import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { MessageSquare, Search, Trash2 } from "lucide-react";
import { api, type Chat } from "@/lib/tauri";

export function ChatsPage() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.listChats().then(setChats);
  }, []);

  const filtered = search.trim()
    ? chats.filter((c) => (c.title ?? "").toLowerCase().includes(search.toLowerCase()))
    : chats;

  const handleDelete = async (id: string) => {
    await api.deleteChat(id);
    setChats((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="px-6 py-4 border-b border-hairline-soft flex items-center gap-3">
        <MessageSquare className="w-5 h-5 text-ink" strokeWidth={1.5} />
        <h1 className="font-display text-[22px] text-ink" style={{ fontWeight: 500, letterSpacing: "-0.4px" }}>Chats</h1>
        <div className="ml-auto relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-soft" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats…"
            className="pl-8 pr-3 py-1.5 w-56 rounded-md border border-hairline text-[12px] text-ink placeholder:text-muted-soft focus:outline-none focus:border-accent-blue bg-canvas"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <MessageSquare className="w-8 h-8 text-muted-soft mb-3" strokeWidth={1} />
            <p className="text-sm text-muted">{search ? "No chats match your search" : "No chats yet"}</p>
          </div>
        ) : (
          <div className="divide-y divide-hairline-soft">
            {filtered.map((chat) => (
              <Link
                key={chat.id}
                to="/chat/$id"
                params={{ id: chat.id }}
                className="flex items-center gap-4 px-6 py-3.5 hover:bg-canvas-soft transition-colors group"
              >
                <div className="w-9 h-9 rounded-md bg-surface-strong border border-hairline-soft flex items-center justify-center shrink-0">
                  <MessageSquare className="w-4 h-4 text-ink" strokeWidth={1.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-ink font-medium truncate">{chat.title || "New chat"}</p>
                  <p className="text-[11px] text-muted-soft">{new Date(chat.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p>
                </div>
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(chat.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-muted-soft hover:text-error rounded-md hover:bg-surface-strong transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
