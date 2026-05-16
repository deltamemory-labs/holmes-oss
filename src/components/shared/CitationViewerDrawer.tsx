import { useEffect, useState } from "react";
import { BookOpen, Eye, X } from "lucide-react";
import { api, type Document as Doc } from "@/lib/tauri";
import type { Citation } from "@/lib/citations";
import { PdfView } from "@/components/shared/PdfView";
import { DocxView } from "@/components/shared/DocxView";
import { resolveDocFromCitation } from "@/lib/doc-resolver";

interface Props {
  citation: Citation | null;
  /** Scope the doc lookup to a specific project id when known. */
  projectId?: string;
  onClose: () => void;
}

/**
 * Slide-in right drawer that renders the cited document and scrolls
 * to the quoted passage. Used by `AssistantPage` (standalone chat) so
 * citation click-through works outside the 3-column project layout.
 *
 * Resolution strategy for `citation.doc_id`:
 *   1. Direct UUID match in the project (or all projects if unscoped)
 *   2. Legacy `doc-N` positional match against the same project list
 *   3. Filename prefix match as a last resort
 */
export function CitationViewerDrawer({ citation, projectId, onClose }: Props) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!citation) {
      setDoc(null);
      setBytes(null);
      return;
    }

    let cancelled = false;
    (async () => {
      const resolved = await resolveCitationDoc(citation, projectId);
      if (cancelled) return;
      if (!resolved) {
        setDoc(null);
        setBytes(null);
        return;
      }
      setDoc(resolved);
      const raw = await api.readDocumentBytes(resolved.id);
      if (cancelled) return;
      setBytes(new Uint8Array(raw));
      setReloadKey((k) => k + 1);
    })();

    return () => {
      cancelled = true;
    };
  }, [citation, projectId]);

  if (!citation) return null;

  const page =
    typeof citation.page === "number"
      ? citation.page
      : parseInt(String(citation.page)) || null;

  return (
    <div className="w-[520px] border-l border-hairline flex flex-col shrink-0 bg-canvas animate-slide-in-right h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-hairline-soft">
        <div className="flex items-center gap-2 min-w-0">
          <Eye className="w-4 h-4 text-muted shrink-0" strokeWidth={1.5} />
          <p className="text-[13px] font-medium text-ink truncate">
            {doc?.filename ?? citation.doc_id}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-muted hover:text-ink hover:bg-surface-strong transition-colors rounded-md"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="mx-3 mt-3 p-3 bg-surface-wash-blue border border-hairline-soft rounded-md">
        <div className="flex items-start gap-2">
          <BookOpen
            className="w-4 h-4 text-accent-blue shrink-0 mt-0.5"
            strokeWidth={1.5}
          />
          <div>
            <p className="mono-label-sm mb-1">
              Cited passage{page ? ` / Page ${page}` : ""}
            </p>
            <p className="text-[12px] text-ink leading-relaxed italic">
              "{citation.quote}"
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3">
        {!doc ? (
          <p className="text-[12px] text-muted-soft px-3 py-8 text-center">
            Could not locate the cited document.
          </p>
        ) : !bytes ? (
          <p className="text-[12px] text-muted-soft px-3 py-8 text-center">
            Loading document…
          </p>
        ) : doc.fileType === "pdf" ? (
          <PdfView
            bytes={bytes}
            targetPage={page}
            highlightQuote={citation.quote}
            reloadKey={reloadKey}
          />
        ) : doc.fileType === "docx" || doc.fileType === "doc" ? (
          <DocxView
            key={reloadKey}
            docId={doc.id}
            versionId={doc.currentVersionId}
            highlightQuote={citation.quote}
          />
        ) : (
          <div className="bg-canvas rounded-md border border-hairline p-6 text-center">
            <p className="text-sm text-muted">{doc.filename}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Resolve the cited `doc_id` to a real Document row. */
async function resolveCitationDoc(
  citation: Citation,
  projectId?: string,
): Promise<Doc | null> {
  const candidates = await (async (): Promise<Doc[]> => {
    if (projectId) return api.listDocuments(projectId);
    // No project scope: union of all project docs. We iterate rather
    // than adding a new command — this path only fires when a citation
    // clicked from a non-project chat, which is rare.
    const projects = await api.listProjects();
    const docs: Doc[] = [];
    for (const p of projects) {
      try {
        const list = await api.listDocuments(p.id);
        docs.push(...list);
      } catch {
        /* ignore per-project failures */
      }
    }
    return docs;
  })();

  const resolved = resolveDocFromCitation(citation.doc_id, candidates);
  return resolved?.doc ?? null;
}
