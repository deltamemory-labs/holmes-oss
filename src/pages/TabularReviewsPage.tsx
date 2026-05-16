import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Table2, Plus, Trash2, Search, FileText, Clock, X } from "lucide-react";
import { api, type TabularReview } from "@/lib/tauri";

export function TabularReviewsPage() {
  const navigate = useNavigate();
  const [reviews, setReviews] = useState<TabularReview[]>([]);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [title, setTitle] = useState("");

  const load = () => api.listReviews().then(setReviews);
  useEffect(() => { load(); }, []);

  const filtered = search.trim()
    ? reviews.filter((r) => (r.title ?? "").toLowerCase().includes(search.toLowerCase()))
    : reviews;

  const handleCreate = async () => {
    if (!title.trim()) return;
    const defaultColumns = JSON.stringify([
      { index: 0, name: "Summary", prompt: "Summarize the key terms of this document.", format: "text" },
      { index: 1, name: "Parties", prompt: "List all parties to this agreement.", format: "bulleted_list" },
      { index: 2, name: "Governing Law", prompt: "What is the governing law?", format: "text" },
    ]);
    const review = await api.createReview(undefined, title.trim(), defaultColumns);
    setTitle(""); setShowModal(false);
    navigate({ to: "/tabular-reviews/$id", params: { id: review.id } });
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.preventDefault(); e.stopPropagation();
    await api.deleteReview(id); load();
  };

  const getColumnCount = (r: TabularReview): number => {
    try { return r.columnsConfig ? JSON.parse(r.columnsConfig).length : 0; } catch { return 0; }
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="px-6 py-4 border-b border-hairline-soft flex items-center gap-3">
        <Table2 className="w-5 h-5 text-accent-blue" strokeWidth={1.5} />
        <h1 className="font-display text-[22px] text-ink" style={{ fontWeight: 500, letterSpacing: "-0.4px" }}>Reviews</h1>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-soft" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="pl-8 pr-3 py-1.5 w-40 rounded-md border border-hairline text-[12px] text-ink placeholder:text-muted-soft focus:outline-none focus:border-accent-blue bg-canvas" />
          </div>
          <button onClick={() => setShowModal(true)} className="flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-medium text-on-primary bg-primary rounded-full hover:bg-primary-active transition-colors">
            <Plus className="w-3.5 h-3.5" /> New
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Table2 className="w-8 h-8 text-muted-soft mb-3" strokeWidth={1} />
            <p className="text-sm text-muted mb-2">{search ? "No reviews match" : "No reviews yet"}</p>
            {!search && <button onClick={() => setShowModal(true)} className="text-[12px] text-accent-blue hover:text-primary-active underline underline-offset-2">Create your first review</button>}
          </div>
        ) : (
          <div className="divide-y divide-hairline-soft">
            {filtered.map((r) => {
              const cols = getColumnCount(r);
              return (
                <Link key={r.id} to="/tabular-reviews/$id" params={{ id: r.id }} className="flex items-center gap-4 px-6 py-3.5 hover:bg-canvas-soft transition-colors group">
                  <div className="w-9 h-9 rounded-md bg-surface-wash-blue border border-hairline-soft flex items-center justify-center shrink-0">
                    <Table2 className="w-4 h-4 text-accent-blue" strokeWidth={1.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-ink font-medium truncate">{r.title || "Untitled Review"}</p>
                    <div className="flex items-center gap-3 text-[11px] text-muted-soft mt-0.5">
                      <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{cols} column{cols !== 1 ? "s" : ""}</span>
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                    </div>
                  </div>
                  <button onClick={(e) => handleDelete(e, r.id)} className="opacity-0 group-hover:opacity-100 p-1.5 text-muted-soft hover:text-error rounded-md hover:bg-surface-strong transition-all">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Create modal */}
      {showModal && (
        <div className="fixed inset-0 z-[101] flex items-center justify-center bg-ink/30 backdrop-blur-sm animate-fade-in" onClick={() => setShowModal(false)}>
          <div className="w-full max-w-md rounded-md bg-canvas shadow-xl border border-hairline p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-display text-[22px] text-ink" style={{ fontWeight: 500, letterSpacing: "-0.4px" }}>New review</h3>
              <button onClick={() => setShowModal(false)} className="p-1 text-muted hover:text-ink transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <div>
              <label className="mono-label-sm mb-1.5 block">Review title</label>
              <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreate()} placeholder="e.g. NDA Comparison" className="w-full px-3 py-2.5 rounded-md border border-hairline bg-canvas text-[13px] text-ink placeholder:text-muted-soft focus:outline-none focus:border-accent-blue" />
              <p className="text-[10px] text-muted-soft mt-1.5">Starts with 3 default columns. You can add more after creation.</p>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-[12px] text-muted hover:text-ink rounded-md hover:bg-surface-strong transition-colors">Cancel</button>
              <button onClick={handleCreate} disabled={!title.trim()} className="px-5 py-2 text-[12px] font-medium text-on-primary bg-primary rounded-full hover:bg-primary-active disabled:opacity-40 transition-colors">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
