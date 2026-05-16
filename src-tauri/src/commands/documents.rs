use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;
use uuid::Uuid;

use crate::error::AppError;
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: String,
    pub project_id: Option<String>,
    pub folder_id: Option<String>,
    pub filename: String,
    pub file_type: Option<String>,
    pub size_bytes: i64,
    pub status: String,
    pub current_version_id: Option<String>,
    pub current_version_number: Option<i64>,
    pub version_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentVersion {
    pub id: String,
    pub document_id: String,
    pub storage_path: String,
    pub source: String,
    pub version_number: Option<i64>,
    pub display_name: Option<String>,
    pub created_at: String,
}

fn detect_file_type(filename: &str) -> Option<String> {
    let ext = filename.rsplit('.').next()?.to_lowercase();
    match ext.as_str() {
        "pdf" => Some("pdf".into()),
        "docx" => Some("docx".into()),
        "doc" => Some("doc".into()),
        "png" | "jpg" | "jpeg" => Some(ext),
        "mp3" | "wav" => Some(ext),
        _ => Some(ext),
    }
}

fn docs_dir(db: &rusqlite::Connection, project_id: &str, doc_id: &str) -> Option<PathBuf> {
    db.path()
        .and_then(|p| Path::new(p).parent().map(|p| p.to_path_buf()))
        .map(|dir| dir.join("documents").join(project_id).join(doc_id))
}

/// Select clause that joins documents with its current version + a version count.
/// Used everywhere a `Document` is returned so the frontend gets a stable shape.
const DOC_SELECT: &str = "SELECT d.id, d.project_id, d.folder_id, d.filename, d.file_type, d.size_bytes, d.status,
        d.current_version_id, cv.version_number,
        (SELECT COUNT(*) FROM document_versions dv WHERE dv.document_id = d.id) AS version_count,
        d.created_at, d.updated_at
     FROM documents d
     LEFT JOIN document_versions cv ON cv.id = d.current_version_id";

fn row_to_document(row: &rusqlite::Row<'_>) -> rusqlite::Result<Document> {
    Ok(Document {
        id: row.get(0)?,
        project_id: row.get(1)?,
        folder_id: row.get(2)?,
        filename: row.get(3)?,
        file_type: row.get(4)?,
        size_bytes: row.get(5)?,
        status: row.get(6)?,
        current_version_id: row.get(7)?,
        current_version_number: row.get(8)?,
        version_count: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

#[tauri::command]
pub async fn upload_document(
    state: State<'_, AppState>,
    project_id: String,
    filename: String,
    file_bytes: Vec<u8>,
    folder_id: Option<String>,
) -> Result<Document, AppError> {
    let doc_id = Uuid::new_v4().to_string();
    let version_id = Uuid::new_v4().to_string();
    let file_type = detect_file_type(&filename);
    let size = file_bytes.len() as i64;
    let ext = file_type.as_deref().unwrap_or("bin");

    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;

    if let Some(dir) = docs_dir(&db, &project_id, &doc_id) {
        std::fs::create_dir_all(&dir)?;
        let file_path = dir.join(format!("v1.{}", ext));
        std::fs::write(&file_path, &file_bytes)?;

        let storage_path = file_path.to_string_lossy().to_string();

        db.execute(
            "INSERT INTO documents (id, project_id, folder_id, filename, file_type, size_bytes, status, current_version_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'ready', ?7)",
            rusqlite::params![doc_id, project_id, folder_id, filename, file_type, size, version_id],
        )?;

        db.execute(
            "INSERT INTO document_versions (id, document_id, storage_path, source, version_number, display_name)
             VALUES (?1, ?2, ?3, 'upload', 1, ?4)",
            rusqlite::params![version_id, doc_id, storage_path, filename],
        )?;

        db.execute(
            "UPDATE projects SET updated_at = datetime('now') WHERE id = ?1",
            [&project_id],
        )?;
    }

    let doc = db.query_row(
        &format!("{} WHERE d.id = ?1", DOC_SELECT),
        [&doc_id],
        row_to_document,
    )?;

    // Invalidate this project's BM25 index so the new doc is searchable.
    drop(db);
    state.search.invalidate(&project_id);

    Ok(doc)
}

#[tauri::command]
pub async fn upload_new_version(
    state: State<'_, AppState>,
    doc_id: String,
    filename: String,
    file_bytes: Vec<u8>,
) -> Result<DocumentVersion, AppError> {
    let version_id = Uuid::new_v4().to_string();
    let size = file_bytes.len() as i64;

    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;

    // Look up parent document
    let (project_id, file_type_opt): (String, Option<String>) = db
        .query_row(
            "SELECT project_id, file_type FROM documents WHERE id = ?1",
            [&doc_id],
            |r| Ok((r.get::<_, Option<String>>(0)?.unwrap_or_default(), r.get(1)?)),
        )
        .map_err(|_| AppError::NotFound("document not found".into()))?;

    let ext = detect_file_type(&filename)
        .or(file_type_opt)
        .unwrap_or_else(|| "bin".into());

    // Next version number
    let next_version: i64 = db
        .query_row(
            "SELECT COALESCE(MAX(version_number), 0) + 1 FROM document_versions WHERE document_id = ?1",
            [&doc_id],
            |r| r.get(0),
        )?;

    if let Some(dir) = docs_dir(&db, &project_id, &doc_id) {
        std::fs::create_dir_all(&dir)?;
        let file_path = dir.join(format!("v{}.{}", next_version, ext));
        std::fs::write(&file_path, &file_bytes)?;
        let storage_path = file_path.to_string_lossy().to_string();

        db.execute(
            "INSERT INTO document_versions (id, document_id, storage_path, source, version_number, display_name)
             VALUES (?1, ?2, ?3, 'user_upload', ?4, ?5)",
            rusqlite::params![version_id, doc_id, storage_path, next_version, filename],
        )?;

        // Promote to current
        db.execute(
            "UPDATE documents SET current_version_id = ?1, size_bytes = ?2, filename = ?3, updated_at = datetime('now') WHERE id = ?4",
            rusqlite::params![version_id, size, filename, doc_id],
        )?;

        drop(db);
        // New version text → rebuild the project's index.
        state.search.invalidate(&project_id);

        Ok(DocumentVersion {
            id: version_id,
            document_id: doc_id,
            storage_path,
            source: "user_upload".into(),
            version_number: Some(next_version),
            display_name: Some(filename),
            created_at: chrono::Utc::now().to_rfc3339(),
        })
    } else {
        Err(AppError::Validation("could not resolve documents dir".into()))
    }
}

#[tauri::command]
pub async fn list_document_versions(
    state: State<'_, AppState>,
    doc_id: String,
) -> Result<Vec<DocumentVersion>, AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    let mut stmt = db.prepare(
        "SELECT id, document_id, storage_path, source, version_number, display_name, created_at
         FROM document_versions WHERE document_id = ?1 ORDER BY version_number DESC, created_at DESC",
    )?;
    let rows = stmt
        .query_map([&doc_id], |row| {
            Ok(DocumentVersion {
                id: row.get(0)?,
                document_id: row.get(1)?,
                storage_path: row.get(2)?,
                source: row.get(3)?,
                version_number: row.get(4)?,
                display_name: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub async fn set_active_version(
    state: State<'_, AppState>,
    doc_id: String,
    version_id: String,
) -> Result<(), AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    // Verify the version belongs to this document before promoting.
    let (storage_path, display_name): (String, Option<String>) = db
        .query_row(
            "SELECT storage_path, display_name FROM document_versions WHERE id = ?1 AND document_id = ?2",
            rusqlite::params![version_id, doc_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| AppError::NotFound("version does not belong to document".into()))?;

    let size = std::fs::metadata(&storage_path).map(|m| m.len() as i64).unwrap_or(0);

    db.execute(
        "UPDATE documents SET current_version_id = ?1, filename = COALESCE(?2, filename), size_bytes = ?3, updated_at = datetime('now') WHERE id = ?4",
        rusqlite::params![version_id, display_name, size, doc_id],
    )?;

    // The "current" text of a doc just changed — invalidate index.
    let project_id: Option<String> = db
        .query_row(
            "SELECT project_id FROM documents WHERE id = ?1",
            [&doc_id],
            |r| r.get(0),
        )
        .ok()
        .flatten();
    drop(db);
    if let Some(pid) = project_id {
        state.search.invalidate(&pid);
    }

    Ok(())
}

#[tauri::command]
pub async fn list_documents(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<Document>, AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    let mut stmt = db.prepare(&format!(
        "{} WHERE d.project_id = ?1 ORDER BY d.created_at DESC",
        DOC_SELECT
    ))?;
    let docs = stmt
        .query_map([&project_id], row_to_document)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(docs)
}

#[tauri::command]
pub async fn read_document_bytes(
    state: State<'_, AppState>,
    doc_id: String,
    version_id: Option<String>,
) -> Result<Vec<u8>, AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;

    let storage_path: String = if let Some(vid) = version_id {
        db.query_row(
            "SELECT storage_path FROM document_versions WHERE id = ?1 AND document_id = ?2",
            rusqlite::params![vid, doc_id],
            |row| row.get(0),
        )?
    } else {
        db.query_row(
            "SELECT dv.storage_path FROM document_versions dv
             JOIN documents d ON d.current_version_id = dv.id
             WHERE d.id = ?1",
            [&doc_id],
            |row| row.get(0),
        )?
    };

    let bytes = std::fs::read(&storage_path)?;
    Ok(bytes)
}

#[tauri::command]
pub async fn delete_document(state: State<'_, AppState>, doc_id: String) -> Result<(), AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    // Look up the owning project so we know which index to drop.
    let project_id: Option<String> = db
        .query_row(
            "SELECT project_id FROM documents WHERE id = ?1",
            [&doc_id],
            |r| r.get(0),
        )
        .ok()
        .flatten();

    db.execute("DELETE FROM documents WHERE id = ?1", [&doc_id])?;
    drop(db);
    if let Some(pid) = project_id {
        state.search.invalidate(&pid);
    }
    Ok(())
}

/// Read a DOCX document (current or specified version) and return it as
/// styled HTML the frontend can safely render. Returns an empty string
/// if the document is not a .docx file.
#[tauri::command]
pub async fn extract_docx_html(
    state: State<'_, AppState>,
    doc_id: String,
    version_id: Option<String>,
) -> Result<String, AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;

    let (file_type, storage_path): (Option<String>, String) = if let Some(vid) = version_id {
        db.query_row(
            "SELECT d.file_type, dv.storage_path
             FROM document_versions dv
             JOIN documents d ON d.id = dv.document_id
             WHERE dv.id = ?1 AND dv.document_id = ?2",
            rusqlite::params![vid, doc_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?
    } else {
        db.query_row(
            "SELECT d.file_type, dv.storage_path
             FROM documents d
             JOIN document_versions dv ON dv.id = d.current_version_id
             WHERE d.id = ?1",
            [&doc_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?
    };

    if file_type.as_deref() != Some("docx") && file_type.as_deref() != Some("doc") {
        return Ok(String::new());
    }

    let bytes = std::fs::read(&storage_path)?;
    let html = crate::documents::extract::extract_docx_html(&bytes)
        .map_err(AppError::Validation)?;
    Ok(html)
}
