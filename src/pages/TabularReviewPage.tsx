import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import { Download, FileText, Loader2, Plus, Play, Search, Table2, Pencil, Check, X } from "lucide-react";
import { api, type TabularReview, type TabularCell, type Document as Doc, type CellEvent } from "@/lib/tauri";
import { AddColumnModal, type ColumnConfig } from "@/components/tabular/AddColumnModal";
import { EditColumnMenu } from "@/components/tabular/EditColumnMenu";
import { TRSidePanel } from "@/components/tabular/TRSidePanel";
import { exportToExcel } from "@/lib/exportToExcel";

export function TabularReviewPage() {
  const { id } = useParams({ strict: false });
  const navigate = useNavigate();
  const [review, setReview] = useState<TabularReview | null>(null);
  const [cells, setCells] = useState<TabularCell[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [columns, setColumns] = useState<ColumnConfig[]>([]);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [addColOpen, setAddColOpen] = useState(false);
  const [expandedCell, setExpandedCell] = useState<{ cell: TabularCell; doc: Doc; col: ColumnConfig } | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    const [r, c] = await Promise.all([api.listReviews(), api.getReviewCells(id)]);
    const rev = r.find((x) => x.id === id);
    if (!rev) { navigate({ to: "/tabular-reviews" }); return; }
    setReview(rev);
    setCells(c);
    const cols: ColumnConfig[] = rev.columnsConfig ? JSON.parse(rev.columnsConfig) : [];
    setColumns(cols);
    // Resolve doc filenames
    if (rev.projectId) {
      const d = await api.listDocuments(rev.projectId);
      setDocs(d);
    } else {
      // Gather unique doc ids from cells and resolve across all projects
      const ids = [...new Set(c.map((x) => x.documentId))];
      const projects = await api.listProjects();
      const allDocs: Doc[] = [];
      for (const p of projects) { try { allDocs.push(...await api.listDocuments(p.id)); } catch {} }
      setDocs(allDocs.filter((d) => ids.includes(d.id)));
    }
  }, [id, navigate]);

  useEffect(() => { load(); }, [load]);

  const docMap = new Map(docs.map((d) => [d.id, d]));
  const cellMap = new Map(cells.map((c) => [`${c.documentId}:${c.columnIndex}`, c]));
  const uniqueDocIds = [...new Set(cells.map((c) => c.documentId))];
  const filteredDocIds = search.trim()
    ? uniqueDocIds.filter((did) => (docMap.get(did)?.filename ?? "").toLowerCase().includes(search.toLowerCase()))
    : uniqueDocIds;

  const handleExtractAll = async () => {
    if (!id) return;
    setGenerating(true);
    setProgress(null);
    await api.extractAllCells(id, (ev: CellEvent) => {
      if (ev.event === "Complete") {
        setCells((prev) => prev.map((c) => c.documentId === ev.data.document_id && c.columnIndex === ev.data.column_index ? { ...c, content: ev.data.content, status: "complete" } : c));
      } else if (ev.event === "Error") {
        setCells((prev) => prev.map((c) => c.documentId === ev.data.document_id && c.columnIndex === ev.data.column_index ? { ...c, status: "error" } : c));
      } else if (ev.event === "BatchProgress") {
        setProgress({ done: ev.data.completed, total: ev.data.total });
      }
    });
    setGenerating(false);
    setProgress(null);
  };

  const handleAddColumns = async (newCols: ColumnConfig[]) => {
    if (!id) return;
    const merged = [...columns, ...newCols];
    await api.updateReviewColumns(id, JSON.stringify(merged));
    load();
  };

  const handleUpdateColumn = async (col: ColumnConfig) => {
    if (!id) return;
    const updated = columns.map((c) => c.index === col.index ? col : c);
    await api.updateReviewColumns(id, JSON.stringify(updated));
    setColumns(updated);
  };

  const handleDeleteColumn = async (colIndex: number) => {
    if (!id) return;
    const updated = columns.filter((c) => c.index !== colIndex).map((c, i) => ({ ...c, index: i }));
    await api.updateReviewColumns(id, JSON.stringify(updated));
    load();
  };

  const handleRename = async () => {
    if (!id || !titleDraft.trim()) { setEditingTitle(false); return; }
    await api.renameReview(id, titleDraft.trim());
    setReview((r) => r ? { ...r, title: titleDraft.trim() } : r);
    setEditingTitle(false);
  };

  const handleRegenerate = async (cellId: string) => {
    await api.extractSingleCell(cellId);
    load();
  };

  const handleExport = () => {
    if (!review) return;
    exportToExcel({ reviewTitle: review.title ?? "Review", columns, documents: docs, cells });
  };

  if (!review) return <div className="flex items-center justify-center h-full"><Loader2 className="w-5 h-5 text-muted animate-spin" /></div>;

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="px-6 py-4 border-b border-hairline-soft flex items-center gap-3">
        <Table2 className="w-5 h-5 text-accent-blue" strokeWidth={1.5} />
        {editingTitle ? (
          <div className="flex items-center gap-2">
            <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setEditingTitle(false); }} autoFocus className="font-display text-[22px] text-ink bg-transparent border-b border-hairline-strong focus:outline-none" style={{ fontWeight: 500, letterSpacing: "-0.4px" }} />
            <button onClick={handleRename} className="p-1 text-success"><Check className="w-4 h-4" /></button>
            <button onClick={() => setEditingTitle(false)} className="p-1 text-muted"><X className="w-4 h-4" /></button>
          </div>
        ) : (
          <h1 className="font-display text-[22px] text-ink cursor-pointer hover:text-body transition-colors group flex items-center gap-1.5" style={{ fontWeight: 500, letterSpacing: "-0.4px" }} onClick={() => { setTitleDraft(review.title ?? ""); setEditingTitle(true); }}>
            {review.title ?? "Untitled Review"} <Pencil className="w-3 h-3 text-muted-soft opacity-0 group-hover:opacity-100 transition-opacity" />
          </h1>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-soft" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter docs…" className="pl-8 pr-3 py-1.5 w-44 rounded-md border border-hairline text-[12px] text-ink placeholder:text-muted-soft focus:outline-none focus:border-accent-blue bg-canvas" />
          </div>
          <button onClick={() => setAddColOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-ink border border-hairline rounded-md hover:border-ink bg-canvas transition-colors"><Plus className="w-3.5 h-3.5" /> Column</button>
          <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-ink border border-hairline rounded-md hover:border-ink bg-canvas transition-colors"><Download className="w-3.5 h-3.5" /> Export</button>
          <button onClick={handleExtractAll} disabled={generating} className="flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-medium text-on-primary bg-primary rounded-full hover:bg-primary-active disabled:opacity-50 transition-colors">
            {generating ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {progress ? `${progress.done}/${progress.total}` : "Extracting…"}</> : <><Play className="w-3.5 h-3.5" /> Extract all</>}
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        {columns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Table2 className="w-8 h-8 text-muted-soft mb-3" strokeWidth={1} />
            <p className="text-sm text-muted mb-2">No columns yet</p>
            <button onClick={() => setAddColOpen(true)} className="text-[12px] text-accent-blue hover:text-primary-active underline underline-offset-2">Add your first column</button>
          </div>
        ) : (
          <table className="w-full text-[12px] border-collapse">
            <thead className="sticky top-0 z-10 bg-canvas">
              <tr className="border-b border-hairline">
                <th className="sticky left-0 z-20 bg-canvas px-4 py-2.5 text-left mono-label-sm w-[200px] min-w-[200px]">Document</th>
                {columns.map((col) => (
                  <th key={col.index} className="px-4 py-2.5 text-left mono-label-sm min-w-[260px]">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">{col.name}</span>
                      <EditColumnMenu column={col} onSave={handleUpdateColumn} onDelete={() => handleDeleteColumn(col.index)} />
                    </div>
                  </th>
                ))}
                <th className="px-2 py-2.5 w-10">
                  <button onClick={() => setAddColOpen(true)} className="p-1 text-muted-soft hover:text-ink rounded transition-colors"><Plus className="w-3.5 h-3.5" /></button>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredDocIds.map((docId) => {
                const doc = docMap.get(docId);
                return (
                  <tr key={docId} className="border-b border-hairline-soft hover:bg-canvas-soft transition-colors">
                    <td className="sticky left-0 z-10 bg-canvas px-4 py-2.5 font-medium text-ink truncate max-w-[200px]">
                      <div className="flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-muted-soft shrink-0" strokeWidth={1.5} />
                        <span className="truncate">{doc?.filename ?? docId.slice(0, 8)}</span>
                      </div>
                    </td>
                    {columns.map((col) => {
                      const cell = cellMap.get(`${docId}:${col.index}`);
                      return (
                        <td key={col.index} className="px-4 py-2.5 align-top cursor-pointer hover:bg-surface-strong transition-colors" onClick={() => { if (cell && doc) setExpandedCell({ cell, doc, col }); }}>
                          {!cell || cell.status === "pending" ? (
                            <span className="text-muted-soft italic">—</span>
                          ) : cell.status === "error" ? (
                            <span className="text-error text-[11px]">Error</span>
                          ) : (
                            <p className="text-body line-clamp-3 leading-relaxed">{cell.content}</p>
                          )}
                        </td>
                      );
                    })}
                    <td />
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modals + panels */}
      <AddColumnModal open={addColOpen} existingCount={columns.length} onClose={() => setAddColOpen(false)} onAdd={handleAddColumns} />
      {expandedCell && (
        <TRSidePanel
          cell={expandedCell.cell}
          doc={expandedCell.doc}
          column={expandedCell.col}
          columns={columns}
          onClose={() => setExpandedCell(null)}
          onNavigate={(colIdx) => {
            const col = columns.find((c) => c.index === colIdx);
            const cell = cellMap.get(`${expandedCell.doc.id}:${colIdx}`);
            if (col && cell) setExpandedCell({ cell, doc: expandedCell.doc, col });
          }}
          onRegenerate={() => handleRegenerate(expandedCell.cell.id)}
        />
      )}
    </div>
  );
}
