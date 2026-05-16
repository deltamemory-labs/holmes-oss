use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, State};
use uuid::Uuid;

use crate::documents::extract;
use crate::error::AppError;
use crate::providers::{GeminiProvider, LlmMessage, LlmProvider, StreamChunk};
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabularReview {
    pub id: String,
    pub project_id: Option<String>,
    pub title: Option<String>,
    pub columns_config: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabularCell {
    pub id: String,
    pub review_id: String,
    pub document_id: String,
    pub column_index: i32,
    pub content: Option<String>,
    pub citations: Option<String>,
    pub status: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum CellEvent {
    Complete {
        document_id: String,
        column_index: i32,
        content: String,
    },
    Error {
        document_id: String,
        column_index: i32,
        message: String,
    },
    BatchProgress {
        completed: i32,
        total: i32,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnConfig {
    pub name: String,
    pub prompt: String,
    pub format: Option<String>,
}

#[tauri::command]
pub async fn create_review(
    state: State<'_, AppState>,
    project_id: Option<String>,
    title: String,
    columns_config: String,
) -> Result<TabularReview, AppError> {
    let id = Uuid::new_v4().to_string();
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    db.execute(
        "INSERT INTO tabular_reviews (id, project_id, title, columns_config) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, project_id, title, columns_config],
    )?;
    Ok(TabularReview {
        id,
        project_id,
        title: Some(title),
        columns_config: Some(columns_config),
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub async fn list_reviews(
    state: State<'_, AppState>,
    project_id: Option<String>,
) -> Result<Vec<TabularReview>, AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    let mut stmt = if project_id.is_some() {
        db.prepare("SELECT id, project_id, title, columns_config, created_at FROM tabular_reviews WHERE project_id = ?1 ORDER BY created_at DESC")?
    } else {
        db.prepare("SELECT id, project_id, title, columns_config, created_at FROM tabular_reviews ORDER BY created_at DESC")?
    };

    let params: Vec<Box<dyn rusqlite::types::ToSql>> = if let Some(ref pid) = project_id {
        vec![Box::new(pid.clone())]
    } else {
        vec![]
    };
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let reviews = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok(TabularReview {
                id: row.get(0)?,
                project_id: row.get(1)?,
                title: row.get(2)?,
                columns_config: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(reviews)
}

#[tauri::command]
pub async fn get_review_cells(
    state: State<'_, AppState>,
    review_id: String,
) -> Result<Vec<TabularCell>, AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    let mut stmt = db.prepare(
        "SELECT id, review_id, document_id, column_index, content, citations, status
         FROM tabular_cells WHERE review_id = ?1",
    )?;
    let cells = stmt
        .query_map([&review_id], |row| {
            Ok(TabularCell {
                id: row.get(0)?,
                review_id: row.get(1)?,
                document_id: row.get(2)?,
                column_index: row.get(3)?,
                content: row.get(4)?,
                citations: row.get(5)?,
                status: row.get(6)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(cells)
}

#[tauri::command]
pub async fn delete_review(state: State<'_, AppState>, review_id: String) -> Result<(), AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    db.execute("DELETE FROM tabular_reviews WHERE id = ?1", [&review_id])?;
    Ok(())
}

#[tauri::command]
pub async fn rename_review(
    state: State<'_, AppState>,
    review_id: String,
    title: String,
) -> Result<(), AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    db.execute(
        "UPDATE tabular_reviews SET title = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![title, review_id],
    )?;
    Ok(())
}

/// Update columns_config and optionally create pending cells for new columns
/// on existing documents.
#[tauri::command]
pub async fn update_review_columns(
    state: State<'_, AppState>,
    review_id: String,
    columns_config: String,
) -> Result<(), AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;

    // Figure out how many columns existed before so we can create cells for new ones.
    let old_json: Option<String> = db.query_row(
        "SELECT columns_config FROM tabular_reviews WHERE id = ?1",
        [&review_id],
        |r| r.get(0),
    )?;
    let old_count: i32 = old_json
        .and_then(|j| serde_json::from_str::<Vec<serde_json::Value>>(&j).ok())
        .map(|v| v.len() as i32)
        .unwrap_or(0);

    let new_cols: Vec<serde_json::Value> = serde_json::from_str(&columns_config).unwrap_or_default();
    let new_count = new_cols.len() as i32;

    db.execute(
        "UPDATE tabular_reviews SET columns_config = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![columns_config, review_id],
    )?;

    // If columns were added, create pending cells for existing docs.
    if new_count > old_count {
        let mut stmt = db.prepare(
            "SELECT DISTINCT document_id FROM tabular_cells WHERE review_id = ?1",
        )?;
        let doc_ids: Vec<String> = stmt
            .query_map([&review_id], |r| r.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);
        for doc_id in &doc_ids {
            for col in old_count..new_count {
                let cell_id = Uuid::new_v4().to_string();
                db.execute(
                    "INSERT OR IGNORE INTO tabular_cells (id, review_id, document_id, column_index, status) VALUES (?1, ?2, ?3, ?4, 'pending')",
                    rusqlite::params![cell_id, review_id, doc_id, col],
                )?;
            }
        }
    }

    // If columns were removed, delete cells for the removed indices.
    if new_count < old_count {
        db.execute(
            "DELETE FROM tabular_cells WHERE review_id = ?1 AND column_index >= ?2",
            rusqlite::params![review_id, new_count],
        )?;
    }

    Ok(())
}

/// Re-extract a single cell. Resets it to pending, runs extraction, returns the updated cell.
#[tauri::command]
pub async fn extract_single_cell(
    state: State<'_, AppState>,
    cell_id: String,
) -> Result<TabularCell, AppError> {
    let (api_key, doc_text, col_name, col_prompt, col_format, doc_id, col_idx, review_id) = {
        let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
        let api_key = crate::commands::settings::get_api_key("gemini_api_key");

        let (review_id, doc_id, col_idx): (String, String, i32) = db.query_row(
            "SELECT review_id, document_id, column_index FROM tabular_cells WHERE id = ?1",
            [&cell_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;

        let columns_json: Option<String> = db.query_row(
            "SELECT columns_config FROM tabular_reviews WHERE id = ?1",
            [&review_id],
            |r| r.get(0),
        )?;
        let columns: Vec<ColumnConfig> = columns_json
            .and_then(|j| serde_json::from_str(&j).ok())
            .unwrap_or_default();
        let col = columns.get(col_idx as usize);
        let col_name = col.map(|c| c.name.clone()).unwrap_or_else(|| "Extract".into());
        let col_prompt = col.map(|c| c.prompt.clone()).unwrap_or_else(|| "Summarize.".into());
        let col_format = col.and_then(|c| c.format.clone());

        let (storage_path, file_type): (String, Option<String>) = db.query_row(
            "SELECT dv.storage_path, d.file_type FROM documents d JOIN document_versions dv ON dv.id = d.current_version_id WHERE d.id = ?1",
            [&doc_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;

        let bytes = std::fs::read(&storage_path).unwrap_or_default();
        let text = match file_type.as_deref() {
            Some("pdf") => extract::extract_pdf_text(&bytes).unwrap_or_default(),
            Some("docx") => extract::extract_docx_text(&bytes).unwrap_or_default(),
            _ => String::from_utf8_lossy(&bytes).to_string(),
        };

        // Reset cell to pending
        db.execute(
            "UPDATE tabular_cells SET status = 'pending', content = NULL WHERE id = ?1",
            [&cell_id],
        )?;

        (api_key, text, col_name, col_prompt, col_format, doc_id, col_idx, review_id)
    };

    let api_key = api_key.ok_or_else(|| AppError::Validation("No Gemini API key".into()))?;

    let prompt = format!(
        "Column: {}\nInstruction: {}{}\n\nDocument text:\n{}",
        col_name,
        col_prompt,
        format_suffix(col_format.as_deref()),
        &doc_text[..doc_text.len().min(100_000)]
    );

    let provider = GeminiProvider::new(api_key, "gemini-3-flash-preview".into());
    let (tx, mut rx) = tokio::sync::mpsc::channel::<StreamChunk>(32);
    let messages = vec![LlmMessage {
        role: "user".into(),
        content: prompt,
        ..Default::default()
    }];
    let system = "You are a legal document extraction assistant. Extract the requested information precisely. Be concise.".to_string();
    tokio::spawn(async move {
        provider.stream_chat(&system, &messages, None, tx).await;
    });

    let mut result = String::new();
    while let Some(chunk) = rx.recv().await {
        match chunk {
            StreamChunk::Delta(t) => result.push_str(&t),
            StreamChunk::Done(t) => { result = t; break; }
            StreamChunk::Error(e) => return Err(AppError::Provider(e)),
            _ => {}
        }
    }

    // Save
    {
        let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
        db.execute(
            "UPDATE tabular_cells SET content = ?1, status = 'complete' WHERE id = ?2",
            rusqlite::params![result, cell_id],
        )?;
    }

    Ok(TabularCell {
        id: cell_id,
        review_id,
        document_id: doc_id,
        column_index: col_idx,
        content: Some(result),
        citations: None,
        status: "complete".into(),
    })
}

#[tauri::command]
pub async fn add_documents_to_review(
    state: State<'_, AppState>,
    review_id: String,
    doc_ids: Vec<String>,
    column_count: i32,
) -> Result<(), AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    for doc_id in &doc_ids {
        for col in 0..column_count {
            let cell_id = Uuid::new_v4().to_string();
            db.execute(
                "INSERT OR IGNORE INTO tabular_cells (id, review_id, document_id, column_index, status)
                 VALUES (?1, ?2, ?3, ?4, 'pending')",
                rusqlite::params![cell_id, review_id, doc_id, col],
            )?;
        }
    }
    Ok(())
}

fn format_suffix(format: Option<&str>) -> &str {
    match format {
        Some("yes_no") => r#" Respond with only "Yes" or "No"."#,
        Some("number") => " Respond with a single number only. No units.",
        Some("percentage") => " Respond with a single percentage value only (e.g. 42%).",
        Some("monetary_amount") => " Respond with the monetary value only, including currency symbol.",
        Some("date") => " Respond with the date only in DD Month YYYY format.",
        Some("bulleted_list") => " Respond with a markdown bulleted list only.",
        _ => "",
    }
}

#[tauri::command]
pub async fn extract_all_cells(
    state: State<'_, AppState>,
    review_id: String,
    on_event: Channel<CellEvent>,
) -> Result<(), AppError> {
    // Gather all pending cells and their document text
    let (api_key, pending, columns) = {
        let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;

        let api_key = crate::commands::settings::get_api_key("gemini_api_key");

        let columns_json: Option<String> = db.query_row(
            "SELECT columns_config FROM tabular_reviews WHERE id = ?1",
            [&review_id],
            |r| r.get(0),
        )?;
        let columns: Vec<ColumnConfig> = columns_json
            .and_then(|j| serde_json::from_str(&j).ok())
            .unwrap_or_default();

        let mut stmt = db.prepare(
            "SELECT tc.id, tc.document_id, tc.column_index, dv.storage_path, d.file_type
             FROM tabular_cells tc
             JOIN documents d ON d.id = tc.document_id
             JOIN document_versions dv ON dv.id = d.current_version_id
             WHERE tc.review_id = ?1 AND tc.status = 'pending'",
        )?;

        let pending: Vec<(String, String, i32, String, Option<String>)> = stmt
            .query_map([&review_id], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        (api_key, pending, columns)
    };

    let api_key = api_key.ok_or_else(|| AppError::Validation("No Gemini API key".into()))?;
    let total = pending.len() as i32;
    let mut completed = 0;

    for (cell_id, doc_id, col_idx, storage_path, file_type) in &pending {
        let col = columns.get(*col_idx as usize);
        let col_name = col.map(|c| c.name.as_str()).unwrap_or("Extract");
        let col_prompt = col.map(|c| c.prompt.as_str()).unwrap_or("Summarize this document.");
        let col_format = col.and_then(|c| c.format.as_deref());

        // Read and extract document text
        let doc_bytes = std::fs::read(storage_path).unwrap_or_default();
        let doc_text = match file_type.as_deref() {
            Some("pdf") => extract::extract_pdf_text(&doc_bytes).unwrap_or_default(),
            Some("docx") => extract::extract_docx_text(&doc_bytes).unwrap_or_default(),
            _ => String::from_utf8_lossy(&doc_bytes).to_string(),
        };

        let prompt = format!(
            "Column: {}\nInstruction: {}{}\n\nDocument text:\n{}",
            col_name,
            col_prompt,
            format_suffix(col_format),
            &doc_text[..doc_text.len().min(100_000)] // cap at 100K chars
        );

        let provider = GeminiProvider::new(api_key.clone(), "gemini-3-flash-preview".into());
        let (tx, mut rx) = tokio::sync::mpsc::channel::<StreamChunk>(32);

        let messages = vec![LlmMessage {
            role: "user".into(),
            content: prompt,
            ..Default::default()
        }];

        let system = "You are a legal document extraction assistant. Extract the requested information precisely. Be concise.".to_string();
        tokio::spawn(async move {
            provider.stream_chat(&system, &messages, None, tx).await;
        });

        let mut result = String::new();
        while let Some(chunk) = rx.recv().await {
            match chunk {
                StreamChunk::Delta(t) => result.push_str(&t),
                StreamChunk::Done(t) => {
                    result = t;
                    break;
                }
                StreamChunk::Error(e) => {
                    let _ = on_event.send(CellEvent::Error {
                        document_id: doc_id.clone(),
                        column_index: *col_idx,
                        message: e,
                    });
                    break;
                }
                _ => {}
            }
        }

        // Save result
        {
            let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
            db.execute(
                "UPDATE tabular_cells SET content = ?1, status = 'complete' WHERE id = ?2",
                rusqlite::params![result, cell_id],
            )?;
        }

        completed += 1;
        let _ = on_event.send(CellEvent::Complete {
            document_id: doc_id.clone(),
            column_index: *col_idx,
            content: result,
        });
        let _ = on_event.send(CellEvent::BatchProgress { completed, total });
    }

    Ok(())
}
