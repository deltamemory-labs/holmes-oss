import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Lock, MessageSquare, Plus, Table2, Trash2 } from "lucide-react";
import { api, type Workflow } from "@/lib/tauri";
import { AddColumnModal, type ColumnConfig } from "@/components/tabular/AddColumnModal";
import { FORMAT_OPTIONS } from "@/lib/columnPresets";

export function WorkflowEditorPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const [wf, setWf] = useState<Workflow | null>(null);
  const [promptMd, setPromptMd] = useState("");
  const [columns, setColumns] = useState<ColumnConfig[]>([]);
  const [saving, setSaving] = useState(false);
  const [addColOpen, setAddColOpen] = useState(false);
  const [editCol, setEditCol] = useState<ColumnConfig | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const readOnly = wf?.isSystem ?? false;

  useEffect(() => {
    if (!id) return;
    api.getWorkflow(id).then((w) => {
      setWf(w);
      setPromptMd(w.promptMd ?? "");
      setColumns(w.columnsConfig ? JSON.parse(w.columnsConfig) : []);
    }).catch(() => navigate({ to: "/workflows" }));
  }, [id, navigate]);

  const save = useCallback((patch: { promptMd?: string; columnsConfig?: string }) => {
    if (readOnly || !id) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaving(true);
    debounceRef.current = setTimeout(async () => {
      await api.updateWorkflow(id, {
        promptMd: patch.promptMd,
        columnsConfig: patch.columnsConfig,
      });
      setSaving(false);
    }, 600);
  }, [id, readOnly]);

  const handlePromptChange = (val: string) => {
    setPromptMd(val);
    save({ promptMd: val });
  };

  const handleColumnsChange = (next: ColumnConfig[]) => {
    setColumns(next);
    save({ columnsConfig: JSON.stringify(next) });
  };

  const handleAddColumns = (added: ColumnConfig[]) => {
    const next = [...columns, ...added.map((c, i) => ({ ...c, index: columns.length + i }))];
    handleColumnsChange(next);
  };

  const handleSaveColumn = (col: ColumnConfig) => {
    const next = columns.map((c) => c.index === col.index ? col : c);
    handleColumnsChange(next);
    setEditCol(null);
  };

  const handleDeleteColumn = (idx: number) => {
    const next = columns.filter((c) => c.index !== idx).map((c, i) => ({ ...c, index: i }));
    handleColumnsChange(next);
    setEditCol(null);
  };

  if (!wf) return null;

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="px-6 py-4 border-b border-hairline-soft flex items-center gap-3">
        <button onClick={() => navigate({ to: "/workflows" })} className="p-1 text-muted hover:text-body rounded transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 border border-hairline-soft ${wf.type === "tabular" ? "bg-surface-wash-blue" : "bg-surface-strong"}`}>
            {wf.type === "tabular" ? <Table2 className="w-3.5 h-3.5 text-accent-blue" strokeWidth={1.5} /> : <MessageSquare className="w-3.5 h-3.5 text-ink" strokeWidth={1.5} />}
          </div>
          <h1 className="font-display text-[22px] text-ink truncate" style={{ fontWeight: 500, letterSpacing: "-0.4px" }}>{wf.title}</h1>
          {wf.isSystem && <Lock className="w-3 h-3 text-muted-soft shrink-0" />}
        </div>
        <div className="flex items-center gap-2">
          {saving && <span className="text-[11px] text-muted-soft">Saving…</span>}
          {wf.practice && <span className="mono-label-sm bg-surface-strong px-2 py-0.5 rounded-full">{wf.practice}</span>}
          <span className="mono-label-sm bg-surface-strong px-2 py-0.5 rounded-full">{wf.type}</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {wf.type === "assistant" || wf.type === "chat" ? (
          /* Prompt editor */
          <div className="max-w-3xl mx-auto px-6 py-8">
            <label className="mono-label mb-2 block">Prompt</label>
            {readOnly ? (
              <div className="prose-holmes text-[13px] bg-canvas border border-hairline rounded-md p-6">
                <pre className="whitespace-pre-wrap font-body text-body bg-transparent p-0 m-0">{promptMd}</pre>
              </div>
            ) : (
              <textarea
                value={promptMd}
                onChange={(e) => handlePromptChange(e.target.value)}
                rows={24}
                className="w-full rounded-md border border-hairline bg-canvas px-5 py-4 text-[14px] text-ink leading-relaxed focus:outline-none focus:border-accent-blue resize-none font-body"
                placeholder="Write the workflow prompt. Use markdown for formatting…"
              />
            )}
          </div>
        ) : (
          /* Column table for tabular workflows */
          <div className="px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <p className="mono-label">{columns.length} Columns</p>
              {!readOnly && (
                <button onClick={() => setAddColOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-ink border border-hairline rounded-md hover:border-ink bg-canvas transition-colors">
                  <Plus className="w-3.5 h-3.5" /> Add column
                </button>
              )}
            </div>

            {columns.length === 0 ? (
              <div className="text-center py-12">
                <Table2 className="w-8 h-8 text-muted-soft mx-auto mb-3" strokeWidth={1} />
                <p className="text-sm text-muted mb-2">No columns defined</p>
                {!readOnly && <button onClick={() => setAddColOpen(true)} className="text-[12px] text-accent-blue hover:text-primary-active underline underline-offset-2">Add your first column</button>}
              </div>
            ) : (
              <div className="rounded-md border border-hairline overflow-hidden">
                {/* Table header */}
                <div className="flex items-center bg-canvas-soft border-b border-hairline mono-label-sm">
                  <div className="w-10 shrink-0 px-3 py-2.5">#</div>
                  <div className="w-[200px] shrink-0 px-3 py-2.5">Name</div>
                  <div className="w-[100px] shrink-0 px-3 py-2.5">Format</div>
                  <div className="flex-1 px-3 py-2.5">Prompt</div>
                  {!readOnly && <div className="w-10 shrink-0" />}
                </div>
                {/* Rows */}
                {columns.map((col, i) => (
                  <div
                    key={col.index}
                    className="flex items-center border-b border-hairline-soft hover:bg-canvas-soft transition-colors cursor-pointer group"
                    onClick={() => readOnly ? undefined : setEditCol(col)}
                  >
                    <div className="w-10 shrink-0 px-3 py-3 text-[11px] text-muted-soft font-mono">{i + 1}</div>
                    <div className="w-[200px] shrink-0 px-3 py-3 text-[12.5px] text-ink font-medium truncate">{col.name}</div>
                    <div className="w-[100px] shrink-0 px-3 py-3 text-[11px] text-muted">
                      {FORMAT_OPTIONS.find((f) => f.value === col.format)?.label ?? "Text"}
                    </div>
                    <div className="flex-1 px-3 py-3 text-[11.5px] text-muted truncate">{col.prompt}</div>
                    {!readOnly && (
                      <div className="w-10 shrink-0 flex items-center justify-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteColumn(col.index); }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-muted-soft hover:text-error rounded transition-all"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      <AddColumnModal
        open={addColOpen || !!editCol}
        existingCount={columns.length}
        onClose={() => { setAddColOpen(false); setEditCol(null); }}
        onAdd={handleAddColumns}
        editingColumn={editCol ?? undefined}
        onSave={handleSaveColumn}
        onDelete={editCol ? () => handleDeleteColumn(editCol.index) : undefined}
      />
    </div>
  );
}
