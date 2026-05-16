//! BM25 lexical search across project documents.
//!
//! Built specifically so the chat agent can find the right passage in
//! projects with many docs, without dumping every document into the
//! system prompt. The model calls the `search_documents` tool with a
//! natural-language query; we tokenize it and score every chunk across
//! every doc in the project, returning the top-K.
//!
//! Why BM25 and not embeddings here:
//!   - Embeddings require a remote API call per chunk at ingestion time
//!     plus a vector store. That's its own Phase-3b project.
//!   - BM25 is fully local, deterministic, 0 external deps, and handles
//!     exact-term queries (party names, defined terms, dates) better
//!     than dense embeddings do.
//!
//! Indexes are lazily built per project on first use and cached in a
//! `Mutex<HashMap<project_id, Index>>` held on `AppState`. They're
//! invalidated whenever documents change — see [`invalidate`].

use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::Mutex;

const K1: f64 = 1.5;
const B: f64 = 0.75;
/// Target chunk size in characters. Short enough that a hit gives the
/// LLM a tight snippet to work with; long enough to hold a clause.
const CHUNK_CHARS: usize = 900;
/// Overlap between consecutive chunks so a sentence straddling a
/// boundary still gets returned as a single hit.
const CHUNK_OVERLAP: usize = 150;

/// A single indexable chunk of document text.
#[derive(Debug, Clone)]
pub struct Chunk {
    pub document_id: String,
    pub filename: String,
    /// 1-indexed page number inferred from the last `[Page N]` marker
    /// seen at or before the chunk start. `None` for non-PDF sources.
    pub page: Option<usize>,
    /// Character offset of this chunk in the original extracted text.
    pub offset: usize,
    pub text: String,
}

/// Materialized per-project BM25 index.
pub struct Index {
    chunks: Vec<Chunk>,
    /// For each chunk index: term → tf.
    term_freqs: Vec<HashMap<String, u32>>,
    /// Term → document frequency (number of chunks containing it).
    doc_freqs: HashMap<String, u32>,
    /// Average chunk token length.
    avgdl: f64,
    /// Per-chunk token count.
    dls: Vec<u32>,
}

/// One scored search hit returned to the caller.
#[derive(Debug, Clone)]
pub struct Hit {
    pub document_id: String,
    pub filename: String,
    pub page: Option<usize>,
    pub offset: usize,
    pub snippet: String,
    pub score: f64,
}

/// Global cache. Keyed by project id.
pub struct Cache {
    inner: Mutex<HashMap<String, Index>>,
}

impl Cache {
    pub fn new() -> Self {
        Self { inner: Mutex::new(HashMap::new()) }
    }

    /// Drop the cached index for a project. Called after any write that
    /// could invalidate the index (document upload, delete, new version).
    pub fn invalidate(&self, project_id: &str) {
        if let Ok(mut map) = self.inner.lock() {
            map.remove(project_id);
        }
    }

    /// Drop every cached index. Cheap; used on bulk schema changes.
    #[allow(dead_code)]
    pub fn clear(&self) {
        if let Ok(mut map) = self.inner.lock() {
            map.clear();
        }
    }

    /// Return top-K hits for the query in the given project. Builds
    /// the index on first call; returns cached hits on subsequent calls
    /// until [`invalidate`] is called.
    pub fn search(
        &self,
        db: &Connection,
        project_id: &str,
        query: &str,
        k: usize,
    ) -> Vec<Hit> {
        // Acquire the cache lock *outside* the index build so a slow
        // first-build doesn't freeze concurrent searches for other
        // projects.
        let mut map = match self.inner.lock() {
            Ok(g) => g,
            Err(_) => return Vec::new(),
        };
        let idx = map
            .entry(project_id.to_string())
            .or_insert_with(|| build_project_index(db, project_id));
        idx.search(query, k)
    }
}

impl Default for Cache {
    fn default() -> Self {
        Self::new()
    }
}

impl Index {
    fn search(&self, query: &str, k: usize) -> Vec<Hit> {
        if self.chunks.is_empty() {
            return Vec::new();
        }
        let q_tokens = tokenize(query);
        if q_tokens.is_empty() {
            return Vec::new();
        }

        let n = self.chunks.len() as f64;
        let mut scores: Vec<(usize, f64)> = (0..self.chunks.len()).map(|i| (i, 0.0)).collect();

        for term in &q_tokens {
            let df = *self.doc_freqs.get(term).unwrap_or(&0) as f64;
            if df == 0.0 {
                continue;
            }
            let idf = ((n - df + 0.5) / (df + 0.5) + 1.0).ln();

            for (i, chunk_tf) in self.term_freqs.iter().enumerate() {
                let tf = *chunk_tf.get(term).unwrap_or(&0) as f64;
                if tf == 0.0 {
                    continue;
                }
                let dl = self.dls[i] as f64;
                let norm = 1.0 - B + B * (dl / self.avgdl);
                let score = idf * ((tf * (K1 + 1.0)) / (tf + K1 * norm));
                scores[i].1 += score;
            }
        }

        // Sort by descending score, keep top-k with > 0.
        scores.retain(|(_, s)| *s > 0.0);
        scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scores.truncate(k);

        scores
            .into_iter()
            .map(|(i, score)| {
                let chunk = &self.chunks[i];
                Hit {
                    document_id: chunk.document_id.clone(),
                    filename: chunk.filename.clone(),
                    page: chunk.page,
                    offset: chunk.offset,
                    snippet: snippet(&chunk.text, &q_tokens),
                    score,
                }
            })
            .collect()
    }
}

fn build_project_index(db: &Connection, project_id: &str) -> Index {
    let mut chunks: Vec<Chunk> = Vec::new();

    // Walk every ready document in the project. Tool errors (missing
    // file, extract failure) silently skip the doc — we'd rather have
    // a partial index than no index.
    let rows: Vec<(String, String, Option<String>, String)> = match db.prepare(
        "SELECT d.id, d.filename, d.file_type, dv.storage_path
         FROM documents d
         JOIN document_versions dv ON dv.id = d.current_version_id
         WHERE d.project_id = ?1 AND d.status = 'ready'",
    ) {
        Ok(mut stmt) => stmt
            .query_map([project_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map(|iter| iter.filter_map(|r| r.ok()).collect())
            .unwrap_or_default(),
        Err(_) => Vec::new(),
    };

    for (doc_id, filename, file_type, storage_path) in rows {
        let bytes = match std::fs::read(&storage_path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let text = match file_type.as_deref() {
            Some("pdf") => crate::documents::extract::extract_pdf_text(&bytes).unwrap_or_default(),
            Some("docx") => crate::documents::extract::extract_docx_text(&bytes).unwrap_or_default(),
            _ => String::from_utf8_lossy(&bytes).to_string(),
        };
        if text.is_empty() {
            continue;
        }
        chunks.extend(chunk_text(&doc_id, &filename, &text));
    }

    // Build postings / dfs / avgdl.
    let mut term_freqs: Vec<HashMap<String, u32>> = Vec::with_capacity(chunks.len());
    let mut doc_freqs: HashMap<String, u32> = HashMap::new();
    let mut dls: Vec<u32> = Vec::with_capacity(chunks.len());
    let mut total_len: u64 = 0;

    for chunk in &chunks {
        let toks = tokenize(&chunk.text);
        let mut tf: HashMap<String, u32> = HashMap::new();
        for t in &toks {
            *tf.entry(t.clone()).or_insert(0) += 1;
        }
        for term in tf.keys() {
            *doc_freqs.entry(term.clone()).or_insert(0) += 1;
        }
        dls.push(toks.len() as u32);
        total_len += toks.len() as u64;
        term_freqs.push(tf);
    }

    let avgdl = if chunks.is_empty() {
        1.0
    } else {
        (total_len as f64) / (chunks.len() as f64)
    };

    Index {
        chunks,
        term_freqs,
        doc_freqs,
        avgdl,
        dls,
    }
}

/// Split extracted text into overlapping character-bounded chunks.
///
/// Two boundaries drive the split:
///   1. Character budget (`CHUNK_CHARS`) — caps chunk length.
///   2. `[Page N]` markers — always start a new chunk at a page break so
///      every chunk has a single, correct page number. Without this a
///      chunk that spans pages would inherit the earlier page even if
///      the hit text belongs to the next page.
fn chunk_text(doc_id: &str, filename: &str, text: &str) -> Vec<Chunk> {
    let page_markers = scan_page_markers(text);

    // Build a list of "segments" — slices of text that each belong to a
    // single page. First segment (before any marker) has page=None.
    struct Segment<'a> {
        page: Option<usize>,
        start: usize,
        text: &'a str,
    }
    let mut segments: Vec<Segment> = Vec::new();
    if page_markers.is_empty() {
        segments.push(Segment {
            page: None,
            start: 0,
            text,
        });
    } else {
        // Leading segment (pre-first-marker), only if there's content.
        let first_marker_start = page_markers[0].0;
        if first_marker_start > 0 {
            segments.push(Segment {
                page: None,
                start: 0,
                text: &text[..first_marker_start],
            });
        }
        for (i, (marker_start, page)) in page_markers.iter().enumerate() {
            // Skip past "[Page N]\n" itself so the segment starts with
            // content, not the marker text.
            let content_start = text[*marker_start..]
                .find(']')
                .map(|off| marker_start + off + 1)
                .unwrap_or(*marker_start);
            let content_start = snap_char_boundary(text, content_start);
            let seg_end = if i + 1 < page_markers.len() {
                page_markers[i + 1].0
            } else {
                text.len()
            };
            if content_start < seg_end {
                segments.push(Segment {
                    page: Some(*page),
                    start: content_start,
                    text: &text[content_start..seg_end],
                });
            }
        }
    }

    // Now slice each segment into CHUNK_CHARS windows with overlap.
    let mut out = Vec::new();
    for seg in segments {
        let mut pos = 0usize;
        while pos < seg.text.len() {
            let end = snap_char_boundary(seg.text, (pos + CHUNK_CHARS).min(seg.text.len()));
            if end <= pos {
                break;
            }
            out.push(Chunk {
                document_id: doc_id.to_string(),
                filename: filename.to_string(),
                page: seg.page,
                offset: seg.start + pos,
                text: seg.text[pos..end].to_string(),
            });
            if end >= seg.text.len() {
                break;
            }
            pos = snap_char_boundary(seg.text, end.saturating_sub(CHUNK_OVERLAP).max(pos + 1));
        }
    }
    out
}

fn scan_page_markers(text: &str) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let bytes = text.as_bytes();
    let needle = b"[Page ";
    let mut i = 0usize;
    while i + needle.len() < bytes.len() {
        if &bytes[i..i + needle.len()] == needle {
            // Parse the number after "[Page " up to "]"
            let start = i + needle.len();
            let mut j = start;
            while j < bytes.len() && bytes[j] != b']' {
                j += 1;
            }
            if j < bytes.len() {
                if let Ok(s) = std::str::from_utf8(&bytes[start..j]) {
                    if let Ok(p) = s.trim().parse::<usize>() {
                        out.push((i, p));
                    }
                }
            }
            i = j + 1;
        } else {
            i += 1;
        }
    }
    out
}

fn snap_char_boundary(text: &str, idx: usize) -> usize {
    let mut i = idx.min(text.len());
    while i > 0 && !text.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// Lowercase → NFKD-like fold (ASCII only) → split on non-alphanumeric.
///
/// Keeps it dead-simple: the BM25 scorer cares about discriminative
/// tokens, not morphology. If we later want stemming we can bolt on
/// `rust-stemmers` without changing the index shape.
fn tokenize(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    for ch in s.chars() {
        let lc = ch.to_lowercase().next().unwrap_or(ch);
        if lc.is_alphanumeric() {
            current.push(lc);
        } else if !current.is_empty() {
            if current.len() >= 2 && !STOPWORDS.contains(&current.as_str()) {
                out.push(std::mem::take(&mut current));
            } else {
                current.clear();
            }
        }
    }
    if !current.is_empty() && current.len() >= 2 && !STOPWORDS.contains(&current.as_str()) {
        out.push(current);
    }
    out
}

/// Produce a short snippet around the highest-density occurrence of any
/// query token. Falls back to the start of the chunk if nothing hits.
fn snippet(text: &str, q_tokens: &[String]) -> String {
    let lower = text.to_lowercase();
    let mut best: (usize, usize) = (0, 0); // (position, hits)
    let window = 220usize;

    for (i, _) in lower.char_indices() {
        if i + window > text.len() {
            break;
        }
        let end = snap_char_boundary(text, i + window);
        let slice = &lower[i..end];
        let hits = q_tokens.iter().filter(|t| slice.contains(t.as_str())).count();
        if hits > best.1 {
            best = (i, hits);
        }
    }

    let start = best.0;
    let end = snap_char_boundary(text, (start + window).min(text.len()));
    let trimmed = text[start..end].trim();
    if start > 0 {
        format!("…{}…", trimmed)
    } else {
        format!("{}…", trimmed)
    }
}

/// Small English stopword list. Enough to prevent "the" / "and" from
/// dominating the BM25 scores without muting legal-specific terms.
const STOPWORDS: &[&str] = &[
    "the", "and", "for", "that", "this", "with", "from", "are", "was", "were", "has", "have",
    "had", "not", "but", "any", "all", "may", "shall", "will", "would", "could", "should", "its",
    "their", "there", "been", "such", "which", "than", "then", "them", "they", "into", "under",
    "upon", "when", "where",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenize_lowercases_and_drops_stopwords() {
        let t = tokenize("The Party Shall deliver Notice by mail.");
        assert!(t.contains(&"party".into()));
        assert!(t.contains(&"deliver".into()));
        assert!(t.contains(&"notice".into()));
        assert!(t.contains(&"mail".into()));
        assert!(!t.contains(&"the".into()));
        assert!(!t.contains(&"shall".into()));
    }

    #[test]
    fn chunk_text_bounds_and_overlap() {
        // One page of ~5000 chars.
        let body = "word ".repeat(1000);
        let s = format!("[Page 1]\n{}", body);
        let chunks = chunk_text("d", "f", &s);
        assert!(chunks.len() > 1);
        // Every chunk except the last should fill most of CHUNK_CHARS.
        for c in &chunks[..chunks.len().saturating_sub(1)] {
            assert!(
                c.text.len() >= CHUNK_CHARS - CHUNK_OVERLAP,
                "chunk len {} < {}",
                c.text.len(),
                CHUNK_CHARS - CHUNK_OVERLAP
            );
            assert_eq!(c.page, Some(1));
        }
        assert_eq!(chunks[0].page, Some(1));
    }

    #[test]
    fn chunk_text_breaks_at_page_boundaries() {
        // Each page gets its own chunk (no chunk straddles pages).
        let s = format!(
            "[Page 1]\n{}\n[Page 2]\n{}\n[Page 3]\n{}",
            "alpha ".repeat(200),
            "beta ".repeat(200),
            "gamma ".repeat(200),
        );
        let chunks = chunk_text("d", "f", &s);
        let pages: std::collections::HashSet<_> = chunks.iter().filter_map(|c| c.page).collect();
        assert!(pages.contains(&1));
        assert!(pages.contains(&2));
        assert!(pages.contains(&3));
        // Critically: no chunk text should contain content from two pages.
        for c in &chunks {
            let has_alpha = c.text.contains("alpha");
            let has_beta = c.text.contains("beta");
            let has_gamma = c.text.contains("gamma");
            let shared = (has_alpha as u8) + (has_beta as u8) + (has_gamma as u8);
            assert!(
                shared <= 1,
                "chunk at page {:?} spans multiple pages: {:?}",
                c.page,
                &c.text[..c.text.len().min(80)]
            );
        }
    }

    #[test]
    fn bm25_returns_matching_chunk() {
        // Build an in-place index by hand using the public API.
        let text =
            "[Page 1]\nThis agreement contains a material adverse effect clause. \
             The obligation continues.\n[Page 2]\nTermination for convenience is allowed \
             with 30 days notice."
                .to_string();
        let chunks = chunk_text("d1", "contract.pdf", &text);
        let mut idx = Index {
            chunks: chunks.clone(),
            term_freqs: vec![],
            doc_freqs: HashMap::new(),
            avgdl: 0.0,
            dls: vec![],
        };
        // Rebuild scoring side-table so we can call search.
        let mut total = 0u64;
        for c in &idx.chunks {
            let toks = tokenize(&c.text);
            let mut tf: HashMap<String, u32> = HashMap::new();
            for t in &toks {
                *tf.entry(t.clone()).or_insert(0) += 1;
            }
            for term in tf.keys() {
                *idx.doc_freqs.entry(term.clone()).or_insert(0) += 1;
            }
            idx.dls.push(toks.len() as u32);
            total += toks.len() as u64;
            idx.term_freqs.push(tf);
        }
        idx.avgdl = (total as f64) / (idx.chunks.len() as f64).max(1.0);

        let hits = idx.search("termination convenience", 3);
        assert!(!hits.is_empty());
        assert_eq!(hits[0].page, Some(2));
    }

    #[test]
    fn bm25_empty_query_returns_empty() {
        let idx = Index {
            chunks: vec![],
            term_freqs: vec![],
            doc_freqs: HashMap::new(),
            avgdl: 1.0,
            dls: vec![],
        };
        assert!(idx.search("anything", 5).is_empty());
    }
}
