import type { Document as Doc } from "@/lib/tauri";

/**
 * Resolve the `doc_id` from a citation to an actual Document row.
 *
 * The assistant receives the canonical UUID in its prompt + tool
 * output, but in practice it sometimes cites with a truncated UUID,
 * a filename, or something close to a filename. Progressively widen
 * the search rather than hard-erroring on a miss.
 *
 * Priority order (each stops on the first hit):
 *   1. Exact id match
 *   2. `doc-N` legacy positional index (for rehydrated old chats)
 *   3. Id prefix match with ≥ 6 chars — handles truncated UUIDs
 *   4. Case-insensitive filename exact match
 *   5. Filename substring contains (either direction)
 *   6. Levenshtein-nearest filename within a small edit budget
 *
 * Returns the best candidate + a score so the caller can decide whether
 * to surface a low-confidence fallback (e.g. by flashing a warning).
 */
export interface ResolvedDoc {
  doc: Doc;
  strategy:
    | "id-exact"
    | "id-prefix"
    | "legacy-index"
    | "filename-exact"
    | "filename-contains"
    | "filename-fuzzy";
  confidence: number;
}

export function resolveDocFromCitation(
  docIdOrName: string,
  candidates: Doc[],
): ResolvedDoc | null {
  if (!docIdOrName || candidates.length === 0) return null;

  // 1. Exact UUID — canonical path.
  const exact = candidates.find((d) => d.id === docIdOrName);
  if (exact) return { doc: exact, strategy: "id-exact", confidence: 1 };

  // 2. Legacy `doc-N` positional match, in the order listDocuments returned.
  const legacy = docIdOrName.match(/^doc-(\d+)$/);
  if (legacy) {
    const idx = parseInt(legacy[1]);
    if (candidates[idx]) {
      return { doc: candidates[idx], strategy: "legacy-index", confidence: 0.7 };
    }
  }

  // 3. UUID prefix — tolerate truncation like "1b2f3c4d".
  if (docIdOrName.length >= 6 && /^[a-f0-9-]+$/i.test(docIdOrName)) {
    const prefix = candidates.filter((d) =>
      d.id.toLowerCase().startsWith(docIdOrName.toLowerCase()),
    );
    if (prefix.length === 1) {
      return { doc: prefix[0], strategy: "id-prefix", confidence: 0.95 };
    }
    // If multiple candidates share the prefix, fall through rather than
    // guessing — the later filename heuristics might disambiguate.
  }

  const needle = docIdOrName.toLowerCase();

  // 4. Exact filename (case-insensitive).
  const exactName = candidates.find((d) => d.filename.toLowerCase() === needle);
  if (exactName) return { doc: exactName, strategy: "filename-exact", confidence: 0.9 };

  // 5. Filename substring contains — either direction so "NDA.pdf" matches
  //    a cite of "NDA" and "NDA" matches a cite of "firm NDA Smith.pdf".
  const contains = candidates.filter((d) => {
    const f = d.filename.toLowerCase();
    return f.includes(needle) || needle.includes(f);
  });
  if (contains.length === 1) {
    return { doc: contains[0], strategy: "filename-contains", confidence: 0.8 };
  }
  if (contains.length > 1) {
    // Pick the shortest filename as a tiebreaker — it's usually the most
    // specific ("NDA.pdf" beats "NDA Smith v Jones 2024 Redline.pdf"
    // when the cite was just "NDA").
    const best = contains.sort((a, b) => a.filename.length - b.filename.length)[0];
    return { doc: best, strategy: "filename-contains", confidence: 0.6 };
  }

  // 6. Levenshtein fallback — accept if the closest filename is within a
  //    1/3-of-length edit distance.
  let closest: { doc: Doc; dist: number } | null = null;
  for (const d of candidates) {
    const f = d.filename.toLowerCase();
    const dist = levenshtein(f, needle);
    if (!closest || dist < closest.dist) {
      closest = { doc: d, dist };
    }
  }
  if (closest) {
    const normalizedLen = Math.max(needle.length, closest.doc.filename.length);
    const threshold = Math.max(4, Math.floor(normalizedLen / 3));
    if (closest.dist <= threshold) {
      return {
        doc: closest.doc,
        strategy: "filename-fuzzy",
        confidence: 1 - closest.dist / (normalizedLen + 1),
      };
    }
  }

  return null;
}

/** Standard O(n*m) Levenshtein distance. Fine for filename-length strings. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  let curr = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1, // insertion
        prev[j] + 1, // deletion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}
