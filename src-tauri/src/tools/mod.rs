//! Tool definitions + executors invoked by the chat agent loop.
//!
//! Each tool is:
//!  - A JSON schema entry Gemini consumes (emitted by [`tool_definitions`])
//!  - A synchronous executor that reads from SQLite / the filesystem and
//!    returns a JSON result (emitted by [`execute_tool`])
//!
//! Tool calls are scoped to the project the chat belongs to, so the LLM
//! cannot enumerate documents in other matters even if it hallucinates IDs.

use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{json, Value};

/// Gemini-shaped tool declarations. Wrapped in the `tools` array the
/// REST API expects.
pub fn tool_definitions() -> Value {
    json!([{
        "functionDeclarations": [
            {
                "name": "list_project_docs",
                "description": "List all documents available in the current project. Use this first to discover what files are available before reading or searching them.",
                "parameters": { "type": "object", "properties": {} }
            },
            {
                "name": "search_documents",
                "description": "BM25 lexical search across every document in the current project. Returns the top-K passages with their document_id, filename, page (for PDFs), and a short snippet. USE THIS FIRST when the project has many documents or when you need to find a specific clause/phrase without reading each document end-to-end. Cheaper and faster than `read_document` for large projects.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search terms. Multi-word queries are OR'd under BM25 scoring."
                        },
                        "k": {
                            "type": "integer",
                            "description": "Number of top results to return. Default 5, max 15."
                        }
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "read_document",
                "description": "Read the extracted text of a specific document by ID. Returns the full text with [Page N] markers for PDFs. Use when the user asks about a specific document. Text is truncated to max_chars (default 60000) — use find_in_document for targeted search in long documents.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "The document ID from list_project_docs or search_documents."
                        },
                        "max_chars": {
                            "type": "integer",
                            "description": "Optional cap on characters returned. Default 60000."
                        }
                    },
                    "required": ["document_id"]
                }
            },
            {
                "name": "find_in_document",
                "description": "Search a single document for a substring or phrase. Returns up to 10 matching passages with surrounding context and the page number each match appears on. Prefer this over read_document when you already know which document to search.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "document_id": { "type": "string" },
                        "query": {
                            "type": "string",
                            "description": "The substring to search for. Matching is case-insensitive."
                        },
                        "context_chars": {
                            "type": "integer",
                            "description": "Characters of context before and after each match. Default 240."
                        }
                    },
                    "required": ["document_id", "query"]
                }
            }
        ]
    }])
}

#[derive(Deserialize)]
struct ReadArgs {
    document_id: String,
    max_chars: Option<usize>,
}

#[derive(Deserialize)]
struct FindArgs {
    document_id: String,
    query: String,
    context_chars: Option<usize>,
}

fn load_document_text(db: &Connection, doc_id: &str) -> Result<String, String> {
    let (file_type, path): (Option<String>, String) = db
        .query_row(
            "SELECT d.file_type, dv.storage_path
             FROM documents d
             JOIN document_versions dv ON dv.id = d.current_version_id
             WHERE d.id = ?1",
            [&doc_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| format!("document not found: {}", e))?;

    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    match file_type.as_deref() {
        Some("pdf") => crate::documents::extract::extract_pdf_text(&bytes),
        Some("docx") => crate::documents::extract::extract_docx_text(&bytes),
        _ => Ok(String::from_utf8_lossy(&bytes).to_string()),
    }
}

pub fn execute_tool(
    db: &Connection,
    search: &crate::search::Cache,
    project_id: Option<&str>,
    name: &str,
    args_json: &str,
) -> Result<Value, String> {
    match name {
        "list_project_docs" => {
            let pid = project_id
                .ok_or("This chat is not bound to a project — no documents available.")?;
            let mut stmt = db
                .prepare(
                    "SELECT id, filename, file_type, size_bytes, current_version_id
                     FROM documents WHERE project_id = ?1 AND status = 'ready'
                     ORDER BY created_at DESC",
                )
                .map_err(|e| e.to_string())?;
            let docs: Vec<Value> = stmt
                .query_map([pid], |row| {
                    Ok(json!({
                        "document_id": row.get::<_, String>(0)?,
                        "filename": row.get::<_, String>(1)?,
                        "file_type": row.get::<_, Option<String>>(2)?,
                        "size_bytes": row.get::<_, i64>(3)?,
                        "has_current_version": row.get::<_, Option<String>>(4)?.is_some(),
                    }))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            Ok(json!({
                "document_count": docs.len(),
                "documents": docs,
            }))
        }

        "search_documents" => {
            #[derive(Deserialize)]
            struct Args {
                query: String,
                k: Option<usize>,
            }
            let a: Args = serde_json::from_str(args_json).map_err(|e| e.to_string())?;
            let pid = project_id
                .ok_or("This chat is not bound to a project — nothing to search.")?;
            if a.query.trim().is_empty() {
                return Err("query is empty".into());
            }
            let k = a.k.unwrap_or(5).clamp(1, 15);
            let hits = search.search(db, pid, &a.query, k);
            let out: Vec<Value> = hits
                .into_iter()
                .map(|h| {
                    json!({
                        "document_id": h.document_id,
                        "filename": h.filename,
                        "page": h.page,
                        "score": (h.score * 1000.0).round() / 1000.0,
                        "snippet": h.snippet,
                    })
                })
                .collect();
            Ok(json!({
                "query": a.query,
                "hit_count": out.len(),
                "hits": out,
            }))
        }

        "read_document" => {
            let a: ReadArgs = serde_json::from_str(args_json).map_err(|e| e.to_string())?;
            let text = load_document_text(db, &a.document_id)?;
            let limit = a.max_chars.unwrap_or(60_000);
            let truncated = if text.len() > limit {
                let mut s: String = text.chars().take(limit).collect();
                s.push_str("\n\n[TRUNCATED. Use find_in_document for targeted lookup.]");
                s
            } else {
                text
            };
            Ok(json!({
                "document_id": a.document_id,
                "text": truncated,
            }))
        }

        "find_in_document" => {
            let a: FindArgs = serde_json::from_str(args_json).map_err(|e| e.to_string())?;
            let text = load_document_text(db, &a.document_id)?;
            let context = a.context_chars.unwrap_or(240);
            let needle = a.query.to_lowercase();

            if needle.is_empty() {
                return Err("query is empty".into());
            }

            let haystack_lower = text.to_lowercase();
            let mut matches: Vec<Value> = Vec::new();
            let mut search_start = 0usize;

            while let Some(pos) = haystack_lower[search_start..].find(&needle) {
                let abs = search_start + pos;

                // Snap to char boundaries so `&text[start..end]` does not panic
                // on multi-byte chars (e.g. smart quotes in docx output).
                let raw_start = abs.saturating_sub(context);
                let raw_end = (abs + needle.len() + context).min(text.len());
                let start = (0..=raw_start)
                    .rev()
                    .find(|i| text.is_char_boundary(*i))
                    .unwrap_or(0);
                let end = (raw_end..=text.len())
                    .find(|i| text.is_char_boundary(*i))
                    .unwrap_or(text.len());

                // Page inferred by counting [Page N] markers before this hit.
                let page = text[..abs].matches("[Page ").count().max(1);

                matches.push(json!({
                    "page": page,
                    "context": text[start..end].trim(),
                }));

                search_start = abs + needle.len();
                if matches.len() >= 10 {
                    break;
                }
            }

            Ok(json!({
                "document_id": a.document_id,
                "query": a.query,
                "match_count": matches.len(),
                "matches": matches,
            }))
        }

        _ => Err(format!("Unknown tool: {}", name)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::SCHEMA;
    use rusqlite::Connection;

    fn memdb() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn
    }

    #[test]
    fn list_project_docs_empty() {
        let db = memdb();
        db.execute(
            "INSERT INTO projects (id, name) VALUES ('p1', 'Test')",
            [],
        )
        .unwrap();
        let cache = crate::search::Cache::new();
        let r = execute_tool(&db, &cache, Some("p1"), "list_project_docs", "{}").unwrap();
        assert_eq!(r["document_count"], 0);
    }

    #[test]
    fn list_project_docs_without_project_errors() {
        let db = memdb();
        let cache = crate::search::Cache::new();
        let err = execute_tool(&db, &cache, None, "list_project_docs", "{}").unwrap_err();
        assert!(err.contains("not bound to a project"));
    }

    #[test]
    fn unknown_tool_errors() {
        let db = memdb();
        let cache = crate::search::Cache::new();
        let err = execute_tool(&db, &cache, None, "does_not_exist", "{}").unwrap_err();
        assert!(err.contains("Unknown tool"));
    }

    #[test]
    fn find_in_document_empty_query_errors() {
        let db = memdb();
        // Insert a doc + version pointing at a temp file we can read.
        let tmp = std::env::temp_dir().join("holmes_tool_find_empty.txt");
        std::fs::write(&tmp, "some text").unwrap();
        db.execute("INSERT INTO projects (id, name) VALUES ('p1', 'X')", [])
            .unwrap();
        db.execute(
            "INSERT INTO documents (id, project_id, filename, file_type, size_bytes, status, current_version_id) VALUES ('d1', 'p1', 'a.txt', 'txt', 9, 'ready', 'v1')",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO document_versions (id, document_id, storage_path, source, version_number, display_name) VALUES ('v1', 'd1', ?1, 'upload', 1, 'a.txt')",
            [tmp.to_string_lossy().to_string()],
        )
        .unwrap();

        let cache = crate::search::Cache::new();
        let err = execute_tool(
            &db,
            &cache,
            Some("p1"),
            "find_in_document",
            r#"{"document_id":"d1","query":""}"#,
        )
        .unwrap_err();
        assert!(err.contains("empty"));
    }
}
