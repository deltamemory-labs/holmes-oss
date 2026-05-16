/**
 * Fuzzy quote matcher shared by `PdfView` and `DocxView`.
 *
 * The models we work with rarely echo a document's text byte-for-byte
 * in their citations:
 *   - PDF text extraction replaces ligatures ("ﬁ" → "fi"), introduces
 *     stray newlines at page boundaries, and sometimes collapses
 *     whitespace.
 *   - Models paraphrase slightly, truncate with "…", or switch smart
 *     quotes to straight quotes.
 *   - DOCX text includes tab / soft-break sequences the model won't
 *     reproduce.
 *
 * A plain `indexOf` on normalized strings misses most of these. The
 * matcher below runs three progressively more forgiving passes:
 *
 *   Stage 1 — exact match on an NFKD-normalized, alphanumeric-only
 *             representation. Catches every case where the quote is
 *             copied verbatim modulo punctuation / whitespace.
 *   Stage 2 — anchor match: try the prefix, suffix, and middle slice
 *             of the normalized quote as substrings. The hit's range
 *             is extended to roughly cover the full quote length.
 *   Stage 3 — word-bag: tokenize the quote into 4+ character words,
 *             scan the doc with a sliding window, pick the window that
 *             shares the most quote words in-order. Accepted only if
 *             ≥ 60% of quote words are covered.
 *
 * All three stages return positions in the *normalized* string plus
 * a map back to the original character offsets, so callers can find
 * the corresponding DOM span(s) without re-walking the text.
 */

export interface NormalizedText {
  /** Normalized (NFKD, lowercase, alphanumerics only) string. */
  norm: string;
  /**
   * `map[i]` is the offset in the original (un-normalized) string where
   * the i-th character of `norm` originated. Always monotonic.
   */
  map: number[];
}

/** NFKD → lowercase → drop non-letter/digit, with position tracking. */
export function normalizeWithMap(s: string): NormalizedText {
  const nfkd = s.normalize("NFKD");
  let norm = "";
  const map: number[] = [];
  let origIdx = 0;
  for (const ch of nfkd) {
    const lower = ch.toLowerCase();
    // `\p{L}` = letters (incl. non-latin), `\p{N}` = numbers.
    if (/[\p{L}\p{N}]/u.test(lower)) {
      norm += lower;
      map.push(origIdx);
    }
    origIdx += ch.length;
  }
  return { norm, map };
}

/** Character range in the ORIGINAL (un-normalized) text of the source. */
export interface QuoteMatch {
  /** Inclusive start index in the original text. */
  start: number;
  /** Exclusive end index in the original text. */
  end: number;
  /** Which stage produced the match — useful for logging + tests. */
  stage: "exact" | "anchor" | "wordbag";
  /**
   * Confidence from 0..1. Exact = 1.0, anchor scales with anchor length,
   * wordbag scales with word coverage.
   */
  score: number;
}

/**
 * Find the quote inside the source text, tolerating normalization and
 * minor paraphrase. Returns `null` if no stage finds a plausible hit.
 */
export function matchQuote(source: string, quote: string): QuoteMatch | null {
  const trimmed = quote.trim();
  if (trimmed.length < 4) return null;

  const src = normalizeWithMap(source);
  const q = normalizeWithMap(trimmed);
  if (q.norm.length < 4 || src.norm.length === 0) return null;

  // ---- Stage 1: exact normalized substring --------------------------------
  const exactHit = src.norm.indexOf(q.norm);
  if (exactHit >= 0) {
    const startOrig = src.map[exactHit];
    const endOrig = (src.map[exactHit + q.norm.length - 1] ?? startOrig) + 1;
    return { start: startOrig, end: endOrig, stage: "exact", score: 1 };
  }

  // ---- Stage 2: anchor matching -------------------------------------------
  // Try several slices of the quote; accept the longest anchor that hits.
  const anchors = buildAnchors(q.norm);
  let bestAnchor: { hit: number; len: number } | null = null;
  for (const a of anchors) {
    const idx = src.norm.indexOf(a);
    if (idx >= 0 && (!bestAnchor || a.length > bestAnchor.len)) {
      bestAnchor = { hit: idx, len: a.length };
    }
  }
  if (bestAnchor) {
    // Expand around the anchor to roughly cover the full quote length,
    // clamped to source bounds. This produces a highlight that spans the
    // whole cited passage even when we only anchored at one end.
    const { hit, len } = bestAnchor;
    const halfExtra = Math.max(0, Math.floor((q.norm.length - len) / 2));
    const start = Math.max(0, hit - halfExtra);
    const end = Math.min(src.norm.length, hit + len + halfExtra);
    const startOrig = src.map[start] ?? 0;
    const endOrig = (src.map[end - 1] ?? startOrig) + 1;
    return {
      start: startOrig,
      end: endOrig,
      stage: "anchor",
      score: len / q.norm.length,
    };
  }

  // ---- Stage 3: word-bag sliding window -----------------------------------
  const quoteWords = tokenizeWords(trimmed);
  if (quoteWords.length >= 5) {
    const match = wordBagMatch(source, quoteWords);
    if (match) {
      return {
        start: match.start,
        end: match.end,
        stage: "wordbag",
        score: match.coverage,
      };
    }
  }

  return null;
}

/** Produce anchor candidates, longest first. */
function buildAnchors(normQuote: string): string[] {
  const n = normQuote.length;
  const out: string[] = [];
  // Prefer a longer anchor first — it disambiguates better on common phrases.
  const sizes = n > 80 ? [40, 28, 20] : n > 40 ? [28, 20, 14] : [n];
  for (const size of sizes) {
    if (size >= n) {
      out.push(normQuote);
      continue;
    }
    // Prefix
    out.push(normQuote.slice(0, size));
    // Suffix
    out.push(normQuote.slice(n - size));
    // Middle
    const midStart = Math.floor((n - size) / 2);
    out.push(normQuote.slice(midStart, midStart + size));
  }
  // De-duplicate while preserving insertion order.
  return Array.from(new Set(out));
}

/**
 * Tokenize a string into lowercased words of at least 3 characters.
 * Stopwords (the/and/of/…) are dropped because they're noise in the
 * sliding-window scoring and make every window look equally good.
 */
const STOPWORDS = new Set<string>([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
  "not",
  "but",
  "any",
  "all",
  "may",
  "shall",
  "will",
  "would",
  "could",
  "should",
  "its",
  "their",
  "there",
]);

function tokenizeWords(s: string): string[] {
  const nfkd = s.normalize("NFKD").toLowerCase();
  return Array.from(nfkd.matchAll(/[\p{L}\p{N}]+/gu))
    .map((m) => m[0])
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/**
 * Scan `source` with a sliding window over its words. The window size
 * is 1.5× the quote word count (so anchors can breathe inside). Score
 * each window by how many quote words it contains, weighted by order
 * preservation. Accept only if coverage ≥ 60%.
 */
function wordBagMatch(
  source: string,
  quoteWords: string[],
): { start: number; end: number; coverage: number } | null {
  // Build a flat list of { word, start, end } tokens for source.
  interface Tok {
    word: string;
    start: number;
    end: number;
  }
  const toks: Tok[] = [];
  const nfkd = source.normalize("NFKD").toLowerCase();
  const re = /[\p{L}\p{N}]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(nfkd)) !== null) {
    const w = m[0];
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    toks.push({ word: w, start: m.index, end: m.index + w.length });
  }
  if (toks.length === 0) return null;

  const windowSize = Math.max(quoteWords.length, Math.ceil(quoteWords.length * 1.5));
  const quoteSet = new Set(quoteWords);

  let best: { start: number; end: number; score: number; coverage: number } | null = null;
  for (let i = 0; i + windowSize <= toks.length; i++) {
    const slice = toks.slice(i, i + windowSize);
    const sliceWords = slice.map((t) => t.word);
    const matched = sliceWords.filter((w) => quoteSet.has(w));
    if (matched.length === 0) continue;

    const coverage = matched.length / quoteWords.length;
    // Order-preservation bonus: length of the longest common subsequence
    // between quote words and slice words (normalized by quote length).
    const order = lcsLength(quoteWords, sliceWords) / quoteWords.length;
    const score = coverage * 0.6 + order * 0.4;
    if (!best || score > best.score) {
      const first = slice[0];
      const last = slice[slice.length - 1];
      best = {
        start: first.start,
        end: last.end,
        coverage,
        score,
      };
    }
  }

  if (!best || best.coverage < 0.6) return null;
  return { start: best.start, end: best.end, coverage: best.coverage };
}

/** Length of the longest common subsequence between two string arrays. */
function lcsLength(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  // 1-D DP rolling across rows of a 2-D table.
  const prev: number[] = new Array(b.length + 1).fill(0);
  const curr: number[] = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/**
 * Given a matched range in the ORIGINAL source and an array of DOM spans
 * with known text content, return the set of span indexes that overlap
 * the range. Caller handles DOM mutation.
 */
export function mapRangeToSpans(
  range: { start: number; end: number },
  spans: HTMLElement[],
): number[] {
  const hits: number[] = [];
  let cursor = 0;
  for (let i = 0; i < spans.length; i++) {
    const text = spans[i].textContent ?? "";
    const spanStart = cursor;
    const spanEnd = cursor + text.length;
    const overlaps = spanEnd > range.start && spanStart < range.end;
    if (overlaps) hits.push(i);
    cursor = spanEnd;
    if (cursor >= range.end) break;
  }
  return hits;
}
