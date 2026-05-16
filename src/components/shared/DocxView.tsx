import { useEffect, useState } from "react";
import { FileWarning, Loader2 } from "lucide-react";
import { api } from "@/lib/tauri";
import { matchQuote } from "@/lib/quote-match";

interface Props {
  docId: string;
  versionId?: string | null;
  highlightQuote?: string | null;
}

/**
 * Renders a .docx file as styled HTML using the Rust-side extractor.
 *
 * The backend streams out semantic HTML (`<p>`, `<h1..h4>`, `<table>`,
 * `<strong>`, `<em>`, `<u>`, `<ins>`, `<del>`) from document.xml. We
 * wrap it in a prose-style container and optionally highlight a cited
 * quote via a DOM pass after mount.
 *
 * The Rust extractor HTML-escapes every text node, so
 * `dangerouslySetInnerHTML` is safe against document content. We only
 * ever inject tags we emit ourselves.
 */
export function DocxView({ docId, versionId, highlightQuote }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);
    api
      .extractDocxHtml(docId, versionId ?? undefined)
      .then((h) => {
        if (cancelled) return;
        setHtml(h || "<p><em>Empty document</em></p>");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [docId, versionId]);

  if (error) {
    return (
      <div className="p-6 text-center">
        <FileWarning
          className="w-6 h-6 text-error/70 mx-auto mb-2"
          strokeWidth={1.5}
        />
        <p className="text-sm text-body">Could not render document</p>
        <p className="text-[11px] text-muted-soft mt-1">{error}</p>
      </div>
    );
  }

  if (html === null) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2
          className="w-4 h-4 text-muted-soft animate-spin"
          strokeWidth={1.5}
        />
      </div>
    );
  }

  return (
    <div className="docx-view bg-surface-card rounded-xl border border-hairline px-8 py-10 shadow-sm">
      <div
        className="docx-prose"
        dangerouslySetInnerHTML={{ __html: highlightInHtml(html, highlightQuote) }}
      />
    </div>
  );
}

/**
 * Wrap the fuzzy-matched range of `quote` in the rendered HTML with a
 * `<mark class="docx-highlight">` tag. Runs `matchQuote` against the
 * plain text extracted from the HTML, then translates the matched
 * character range back to the original HTML by walking tag/text
 * alternations and only substituting inside text segments.
 */
function highlightInHtml(html: string, quote?: string | null): string {
  if (!quote) return html;
  const trimmed = quote.trim();
  if (trimmed.length < 4) return html;

  // Segment HTML into alternating text chunks and tag chunks. We walk
  // text chunks to build a flat plain-text string that `matchQuote`
  // can scan, while recording each text chunk's global offset so we
  // can splice the <mark> back into the HTML at the right spot.
  const parts = html.split(/(<[^>]+>)/g);
  interface Text {
    /** Index into `parts`. */
    partIdx: number;
    /** Offset into the flat plain-text string. */
    flatStart: number;
    /** Character length of this text chunk. */
    length: number;
  }
  let flat = "";
  const textChunks: Text[] = [];
  parts.forEach((p, idx) => {
    if (p.startsWith("<")) return;
    textChunks.push({ partIdx: idx, flatStart: flat.length, length: p.length });
    flat += p;
  });
  if (flat.length === 0) return html;

  const match = matchQuote(flat, trimmed);
  if (!match) return html;

  // Splice `<mark>` into the HTML. The matched range may span multiple
  // text chunks (rare in docx, common in pdf but we only call this for
  // docx). We inject an opening tag in the first chunk and a closing
  // tag in the last chunk.
  for (const t of textChunks) {
    const chunkStart = t.flatStart;
    const chunkEnd = t.flatStart + t.length;
    if (chunkEnd <= match.start || chunkStart >= match.end) continue;
    const localStart = Math.max(0, match.start - chunkStart);
    const localEnd = Math.min(t.length, match.end - chunkStart);
    const raw = parts[t.partIdx];
    parts[t.partIdx] =
      raw.slice(0, localStart) +
      '<mark class="docx-highlight">' +
      raw.slice(localStart, localEnd) +
      "</mark>" +
      raw.slice(localEnd);
  }
  return parts.join("");
}
