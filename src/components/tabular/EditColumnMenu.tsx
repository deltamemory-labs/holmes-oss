import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { FORMAT_OPTIONS, getPresetConfig, type ColumnFormat } from "@/lib/columnPresets";
import type { ColumnConfig } from "@/components/tabular/AddColumnModal";

interface Props {
  column: ColumnConfig;
  onSave: (col: ColumnConfig) => void;
  onDelete: () => void;
}

export function EditColumnMenu({ column, onSave, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(column.name);
  const [prompt, setPrompt] = useState(column.prompt);
  const [format, setFormat] = useState<ColumnFormat>((column.format ?? "text") as ColumnFormat);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setName(column.name); setPrompt(column.prompt); setFormat((column.format ?? "text") as ColumnFormat); }, [column]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const handleSave = () => {
    if (!name.trim() || !prompt.trim()) return;
    onSave({ ...column, name: name.trim(), prompt: prompt.trim(), format });
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="p-1 text-muted-soft hover:text-ink rounded transition-colors"><MoreHorizontal className="w-3.5 h-3.5" /></button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-canvas border border-hairline rounded-md shadow-lg z-50 p-4 space-y-3">
          <div>
            <label className="mono-label-sm mb-1 block">Name</label>
            <input value={name} onChange={(e) => { const v = e.target.value; setName(v); const p = getPresetConfig(v); if (p) { setPrompt(p.prompt); setFormat(p.format); } }} className="w-full rounded-md border border-hairline px-2.5 py-1.5 text-[12px] text-ink focus:outline-none focus:border-accent-blue bg-canvas" />
          </div>
          <div>
            <label className="mono-label-sm mb-1 block">Format</label>
            <select value={format} onChange={(e) => setFormat(e.target.value as ColumnFormat)} className="w-full rounded-md border border-hairline px-2.5 py-1.5 text-[12px] text-ink focus:outline-none focus:border-accent-blue bg-canvas">
              {FORMAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mono-label-sm mb-1 block">Prompt</label>
            <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} className="w-full rounded-md border border-hairline px-2.5 py-1.5 text-[12px] text-ink focus:outline-none focus:border-accent-blue bg-canvas resize-none leading-relaxed" />
          </div>
          <div className="flex items-center justify-between pt-1">
            <button onClick={() => { onDelete(); setOpen(false); }} className="text-[11px] text-error hover:text-error/80 flex items-center gap-1 transition-colors"><Trash2 className="w-3 h-3" /> Delete</button>
            <div className="flex gap-2">
              <button onClick={() => setOpen(false)} className="px-3 py-1.5 text-[11px] text-muted hover:text-ink rounded-md hover:bg-surface-strong transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={!name.trim() || !prompt.trim()} className="px-3 py-1.5 text-[11px] font-medium text-on-primary bg-primary rounded-full disabled:opacity-40 transition-colors">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
