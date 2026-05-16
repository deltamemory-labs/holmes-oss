import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { Loader2, FileWarning } from "lucide-react";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { matchQuote, mapRangeToSpans } from "@/lib/quote-match";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

interface Props {
  bytes: Uint8Array;
  targetPage?: number | null;
  highlightQuote?: string | null;
  reloadKey?: number;
}

/**
 * Size at which we cap high-DPI oversampling. `window.devicePixelRatio`
 * can report 2 or 3 on Retina screens, which multiplies the canvas
 * pixel count and RAM usage. Clamp at 2× for sharpness without blowing
 * memory on large docs.
 */
const MAX_DPR = 2;

/**
 * Minimum page-width delta (in CSS px) before we re-render on a
 * container resize. Prevents a cascade of canvas rebuilds while the
 * user is actively dragging a splitter / resizing the window.
 */
const RESIZE_EPSILON = 12;

/**
 * PDF viewer that renders pages to CSS-width of the parent column with
 * a selectable text layer on top for quote highlighting. Replaces the
 * earlier iframe approach (which fails `#page=N` on Tauri's WKWebView).
 *
 * Resizes with the container via `ResizeObserver`; re-renders at the
 * new scale when the width delta crosses RESIZE_EPSILON.
 */
export function PdfView({ bytes, targetPage, highlightQuote, reloadKey }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderWidth, setRenderWidth] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pages, setPages] = useState<number | null>(null);

  // Observe the wrapper (the scroll viewport) for width changes and
  // push them into state, debounced by RESIZE_EPSILON so we don't
  // rebuild canvases on every pixel.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const initial = el.clientWidth;
    setRenderWidth((prev) => (prev === 0 ? initial : prev));

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setRenderWidth((prev) => (Math.abs(w - prev) > RESIZE_EPSILON ? w : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container || renderWidth <= 0) return;

    setError(null);
    setLoading(true);
    setPages(null);
    container.innerHTML = "";

    // pdf.js mutates the input buffer; give it a fresh copy so repeated
    // renders (after reloadKey bumps) don't throw "data is detached".
    const pdfBytes = bytes.slice();

    (async () => {
      try {
        const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        setPages(pdf.numPages);

        // Account for the wrapper's horizontal padding — don't render to
        // full container width or the page hits the scrollbar. 32px total
        // matches the `px-4` wrapper + a bit of breathing room.
        const availableCssWidth = Math.max(240, renderWidth - 32);
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

        // Collect which pages actually matched the quote. If the model's
        // cited `page` is wrong (happens when text extraction shifts
        // pagination), we still scroll to a page that contains the
        // passage rather than a blank target page.
        const matchedPages: number[] = [];

        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i);

          const baseViewport = page.getViewport({ scale: 1 });
          const cssScale = availableCssWidth / baseViewport.width;
          const viewport = page.getViewport({ scale: cssScale });

          const pageEl = document.createElement("div");
          pageEl.className = "pdf-page";
          pageEl.id = `pdf-page-${i}`;
          pageEl.style.width = `${viewport.width}px`;
          pageEl.style.height = `${viewport.height}px`;
          container.appendChild(pageEl);

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          pageEl.appendChild(canvas);

          const ctx = canvas.getContext("2d");
          if (!ctx) continue;

          await page.render({
            canvasContext: ctx,
            viewport,
            canvas,
            transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
          } as Parameters<typeof page.render>[0]).promise;

          const textLayerEl = document.createElement("div");
          textLayerEl.className = "textLayer";
          textLayerEl.style.width = `${viewport.width}px`;
          textLayerEl.style.height = `${viewport.height}px`;
          pageEl.appendChild(textLayerEl);

          const textContent = await page.getTextContent();
          const textLayer = new pdfjsLib.TextLayer({
            textContentSource: textContent,
            container: textLayerEl,
            viewport,
          });
          await textLayer.render();

          if (highlightQuote) {
            const hit = highlightOnPage(textLayerEl, highlightQuote);
            if (hit) matchedPages.push(i);
          }
        }

        setLoading(false);

        // Pick the page to scroll to:
        //   1. Target page if it matched the quote
        //   2. Target page anyway (so the user lands somewhere)
        //   3. First page where we found a hit
        //   4. Do nothing
        requestAnimationFrame(() => {
          const scrollTo =
            (targetPage && matchedPages.includes(targetPage) && targetPage) ||
            targetPage ||
            matchedPages[0] ||
            null;
          if (!scrollTo) return;
          const el = document.getElementById(`pdf-page-${scrollTo}`);
          el?.scrollIntoView({ behavior: "smooth", block: "start" });

          // If we scrolled somewhere that actually matched, also nudge the
          // first matched span into view so the highlight is centered.
          if (matchedPages.includes(scrollTo)) {
            const firstHit = document
              .getElementById(`pdf-page-${scrollTo}`)
              ?.querySelector<HTMLElement>(".pdf-highlight");
            firstHit?.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        });
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bytes, targetPage, highlightQuote, reloadKey, renderWidth]);

  if (error) {
    return (
      <div className="bg-surface-card rounded-xl border border-hairline p-8 text-center">
        <FileWarning
          className="w-6 h-6 text-error/70 mx-auto mb-2"
          strokeWidth={1.5}
        />
        <p className="text-sm text-body">Could not render PDF</p>
        <p className="text-[11px] text-muted-soft mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="relative w-full">
      {loading && (
        <div className="flex items-center gap-2 justify-center py-8 text-muted-soft">
          <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />
          <span className="text-[12px]">Rendering PDF…</span>
        </div>
      )}
      <div ref={containerRef} className="pdf-container" />
      {pages !== null && !loading && (
        <p className="text-[10px] text-muted-soft text-center pt-2 pb-4">
          {pages} page{pages === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}

/**
 * Run the shared fuzzy matcher against the text of a single page's
 * text layer and add `.pdf-highlight` to the spans that overlap the
 * matched range.
 *
 * Returns `true` if a match was found on this page, so the caller can
 * decide which page to scroll to after all pages render.
 */
function highlightOnPage(
  textLayer: HTMLDivElement,
  quote: string,
): boolean {
  const spans = Array.from(
    textLayer.querySelectorAll<HTMLSpanElement>("span"),
  );
  if (spans.length === 0) return false;

  const pageText = spans.map((s) => s.textContent ?? "").join("");
  const match = matchQuote(pageText, quote);
  if (!match) return false;

  const hitSpanIdxs = mapRangeToSpans(match, spans);
  if (hitSpanIdxs.length === 0) return false;

  for (const idx of hitSpanIdxs) {
    const span = spans[idx];
    if (!span || span.dataset.holmesHighlighted === "1") continue;
    span.dataset.holmesHighlighted = "1";
    span.classList.add("pdf-highlight");
    if (match.stage !== "exact") span.classList.add("pdf-highlight-fuzzy");
  }
  return true;
}
