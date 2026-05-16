import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { FORMAT_OPTIONS, PROMPT_PRESETS, getPresetConfig, type ColumnFormat } from "@/lib/columnPresets";

export interface ColumnConfig {
  index: number;
  name: string;
  prompt: string;
  format?: string;
  tags?: string[];
}

interface ColumnDraft {
  name: string;
  prompt: string;
  format: ColumnFormat;
  tags: string[];
  tagInput: string;
}

const EMPTY: ColumnDraft = { name: "", prompt: "", format: "text", tags: [], tagInput: "" };

interface Props {
  open: boolean;
  existingCount: number;
  onClose: () => void;
  onAdd: (cols: ColumnConfig[]) => void;
  editingColumn?: ColumnConfig;
  onSave?: (col: ColumnConfig) => void;
  onDelete?: () => void;
}

export function AddColumnModal({ open, existingCount, onClose, onAdd, editingColumn, onSave, onDelete }: Props) {
  const isEditing = !!editingColumn;
  const [columns, setColumns] = useState<ColumnDraft[]>([{ ...EMPTY }]);
  const [presetsOpen, setPresetsOpen] = useState<number | null>(null);
  const presetsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    if (editingColumn) {
      setColumns([{ name: editingColumn.name, prompt: editingColumn.prompt, format: (editingColumn.format ?? "text") as ColumnFormat, tags: editingColumn.tags ?? [], tagInput: "" }]);
    } else {
      setColumns([{ ...EMPTY }]);
    }
  }, [open, editingColumn]);

  useEffect(() => {
    if (presetsOpen === null) return;
    const onClick = (e: MouseEvent) => { if (presetsRef.current && !presetsRef.current.contains(e.target as Node)) setPresetsOpen(null); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [presetsOpen]);

  if (!open) return null;

  const update = (i: number, patch: Partial<ColumnDraft>) => setColumns((p) => p.map((c, j) => j === i ? { ...c, ...patch } : c));
  const remove = (i: number) => setColumns((p) => p.length === 1 ? [{ ...EMPTY }] : p.filter((_, j) => j !== i));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (columns.some((c) => !c.name.trim() || !c.prompt.trim())) return;
    if (isEditing && onSave && editingColumn) {
      const c = columns[0];
      onSave({ index: editingColumn.index, name: c.name.trim(), prompt: c.prompt.trim(), format: c.format, tags: c.format === "tag" ? c.tags : undefined });
    } else {
      onAdd(columns.map((c, i) => ({ index: existingCount + i, name: c.name.trim(), prompt: c.prompt.trim(), format: c.format, tags: c.format === "tag" ? c.tags : undefined })));
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[101] flex items-center justify-center bg-ink/30 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-md bg-canvas shadow-xl border border-hairline flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <p className="mono-label-sm">Tabular Review › {isEditing ? "Edit column" : "New column"}</p>
          <button onClick={onClose} className="p-1.5 text-muted hover:text-ink hover:bg-surface-strong rounded-md transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
          <div className="px-6 pt-3 pb-5 space-y-4 overflow-y-auto flex-1">
            {columns.map((col, i) => (
              <div key={i} className="rounded-md border border-hairline p-4">
                <div className="flex items-start gap-2">
                  <div className="relative flex-1" ref={presetsOpen === i ? presetsRef : undefined}>
                    <input value={col.name} onChange={(e) => { const name = e.target.value; const preset = getPresetConfig(name); update(i, { name, ...(preset ? { prompt: preset.prompt, format: preset.format, tags: preset.tags ?? [] } : {}) }); }} placeholder="Column name" className="w-full font-display text-2xl text-ink placeholder:text-muted-soft focus:outline-none bg-transparent" style={{ fontWeight: 500, letterSpacing: "-0.4px" }} autoFocus={i === 0} />
                    <button type="button" onClick={() => setPresetsOpen(presetsOpen === i ? null : i)} className="absolute right-0 top-1.5 p-1.5 text-muted hover:text-ink rounded-md hover:bg-surface-strong transition-colors">
                      <ChevronDown className={`w-4 h-4 transition-transform ${presetsOpen === i ? "rotate-180" : ""}`} />
                    </button>
                    {presetsOpen === i && (
                      <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border border-hairline bg-canvas shadow-lg max-h-64 overflow-y-auto">
                        <button type="button" onClick={() => { update(i, { ...EMPTY }); setPresetsOpen(null); }} className="w-full px-3 py-2 text-left text-[12px] text-muted-soft hover:bg-canvas-soft transition-colors border-b border-hairline-soft">No Preset</button>
                        {PROMPT_PRESETS.map((p) => (
                          <button key={p.name} type="button" onClick={() => { update(i, { name: p.name, prompt: p.prompt, format: p.format, tags: p.tags ?? [] }); setPresetsOpen(null); }} className="w-full px-3 py-2 text-left text-[12px] text-ink hover:bg-canvas-soft transition-colors">{p.name}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  {columns.length > 1 && <button type="button" onClick={() => remove(i)} className="mt-1.5 p-1.5 text-muted-soft hover:text-ink rounded-md hover:bg-surface-strong transition-colors"><X className="w-3.5 h-3.5" /></button>}
                </div>
                <div className="mt-4">
                  <label className="mono-label-sm mb-1.5 block">Format</label>
                  <select value={col.format} onChange={(e) => update(i, { format: e.target.value as ColumnFormat, tags: [] })} className="w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-[13px] text-ink focus:outline-none focus:border-accent-blue">
                    {FORMAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                {col.format === "tag" && (
                  <div className="mt-3">
                    <label className="mono-label-sm mb-1.5 block">Tags</label>
                    <div className="flex flex-wrap gap-1.5 rounded-md border border-hairline px-2 py-1.5 focus-within:border-accent-blue">
                      {col.tags.map((t) => (
                        <span key={t} className="inline-flex items-center gap-1 rounded-full bg-surface-strong px-2 py-0.5 text-[11px] text-body">
                          {t}<button type="button" onClick={() => update(i, { tags: col.tags.filter((x) => x !== t) })} className="text-muted-soft hover:text-ink"><X className="w-2.5 h-2.5" /></button>
                        </span>
                      ))}
                      <input value={col.tagInput} onChange={(e) => update(i, { tagInput: e.target.value })} onKeyDown={(e) => { if ((e.key === "Enter" || e.key === ",") && col.tagInput.trim()) { e.preventDefault(); update(i, { tags: [...col.tags, col.tagInput.trim()], tagInput: "" }); } }} placeholder="Add tag…" className="min-w-[80px] flex-1 bg-transparent text-[12px] text-ink placeholder:text-muted-soft focus:outline-none" />
                    </div>
                  </div>
                )}
                <div className="mt-4">
                  <label className="mono-label-sm mb-1.5 block">Prompt</label>
                  <textarea rows={5} value={col.prompt} onChange={(e) => update(i, { prompt: e.target.value })} placeholder="Describe what Holmes should extract from each document for this column…" className="w-full rounded-md border border-hairline px-3 py-2 text-[13px] text-ink placeholder:text-muted-soft focus:outline-none focus:border-accent-blue bg-canvas resize-none leading-relaxed" />
                </div>
              </div>
            ))}
            {!isEditing && (
              <button type="button" onClick={() => setColumns((p) => [...p, { ...EMPTY }])} className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-ink transition-colors">
                <Plus className="w-3.5 h-3.5" /> Add another column
              </button>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-hairline px-6 py-4">
            <div>{isEditing && onDelete && <button type="button" onClick={onDelete} className="text-[13px] text-error hover:text-error/80 transition-colors">Delete column</button>}</div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-[13px] text-muted hover:text-ink hover:bg-surface-strong rounded-md transition-colors">Cancel</button>
              <button type="submit" disabled={columns.some((c) => !c.name.trim() || !c.prompt.trim())} className="px-5 py-2 text-[13px] font-medium text-on-primary bg-primary hover:bg-primary-active rounded-full disabled:opacity-40 transition-colors">{isEditing ? "Save" : "Add columns"}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
