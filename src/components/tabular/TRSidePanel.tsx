import { useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TabularCell, Document } from "@/lib/tauri";
import type { ColumnConfig } from "@/components/tabular/AddColumnModal";
import { PdfView } from "@/components/shared/PdfView";
import { DocxView } from "@/components/shared/DocxView";
import { api } from "@/lib/tauri";
import { useEffect } from "react";

interface Props {
  cell: TabularCell;
  doc: Document;
  column: ColumnConfig;
  columns: ColumnConfig[];
  onClose: () => void;
  onNavigate: (colIndex: number) => void;
  onRegenerate?: () => Promise<void>;
}

export function TRSidePanel({ cell, doc, column, columns, onClose, onNavigate, onRegenerate }: Props) {
  const sorted = [...columns].sort((a, b) => a.index - b.index);
  const pos = sorted.findIndex((c) => c.index === column.index);
  const prev = pos > 0 ? sorted[pos - 1] : null;
  const next = pos < sorted.length - 1 ? sorted[pos + 1] : null;
  const [regenerating, setRegenerating] = useState(false);
  const [showDoc, setShowDoc] = useState(false);
  const [docBytes, setDocBytes] = useState<Uint8Array | null>(null);

  useEffect(() => {
    if (!showDoc) return;
    api.readDocumentBytes(doc.id).then((b) => setDocBytes(new Uint8Array(b))).catch(() => {});
  }, [showDoc, doc.id]);

  return (
    <div className="fixed right-0 top-0 bottom-0 z-[90] flex shadow-xl border-l border-hairline animate-slide-in-right">
      {/* Doc viewer panel */}
      {showDoc && (
        <div className="w-[500px] border-r border-hairline bg-canvas flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-hairline-soft">
            <p className="text-[12px] font-medium text-ink truncate">{doc.filename}</p>
            <button onClick={() => setShowDoc(false)} className="p-1 text-muted hover:text-ink rounded transition-colors"><X className="w-3.5 h-3.5" /></button>
          </div>
          <div className="flex-1 overflow-auto p-3">
            {doc.fileType === "pdf" && docBytes ? (
              <PdfView bytes={docBytes} highlightQuote={cell.content?.slice(0, 80)} />
            ) : (doc.fileType === "docx" || doc.fileType === "doc") ? (
              <DocxView docId={doc.id} highlightQuote={cell.content?.slice(0, 80)} />
            ) : (
              <p className="text-[12px] text-muted-soft text-center py-8">Preview not available</p>
            )}
          </div>
        </div>
      )}

      {/* Info panel */}
      <div className="w-[320px] bg-canvas flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-hairline-soft">
          <div className="flex items-center gap-1 mr-auto">
            <button onClick={() => prev && onNavigate(prev.index)} disabled={!prev} className="p-0.5 text-muted hover:text-ink disabled:opacity-30 rounded transition-colors"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-[11px] text-muted tabular-nums">{pos + 1}/{sorted.length}</span>
            <button onClick={() => next && onNavigate(next.index)} disabled={!next} className="p-0.5 text-muted hover:text-ink disabled:opacity-30 rounded transition-colors"><ChevronRight className="w-4 h-4" /></button>
          </div>
          {onRegenerate && (
            <button onClick={async () => { setRegenerating(true); try { await onRegenerate(); } finally { setRegenerating(false); } }} disabled={regenerating} className="p-1.5 text-muted hover:text-ink hover:bg-surface-strong rounded-md disabled:opacity-40 transition-colors">
              {regenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </button>
          )}
          <button onClick={onClose} className="p-1.5 text-muted hover:text-ink hover:bg-surface-strong rounded-md transition-colors"><X className="w-3.5 h-3.5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <h3 className="font-display text-[22px] text-ink mb-1" style={{ fontWeight: 500, letterSpacing: "-0.4px" }}>{column.name}</h3>
          <button onClick={() => setShowDoc(true)} className="text-[11px] text-accent-blue hover:text-primary-active underline underline-offset-2 mb-4 block">{doc.filename}</button>

          {cell.status === "pending" ? (
            <p className="text-[12px] text-muted-soft italic">Pending extraction…</p>
          ) : cell.status === "error" ? (
            <p className="text-[12px] text-error">Extraction failed.</p>
          ) : (
            <div className="prose-holmes text-[12.5px]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{cell.content ?? ""}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
