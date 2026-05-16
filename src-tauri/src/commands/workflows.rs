use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::error::AppError;
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workflow {
    pub id: String,
    pub title: String,
    pub r#type: String,
    pub prompt_md: Option<String>,
    pub columns_config: Option<String>,
    pub practice: Option<String>,
    pub is_system: bool,
    pub created_at: String,
}

#[tauri::command]
pub async fn list_workflows(state: State<'_, AppState>) -> Result<Vec<Workflow>, AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    let mut stmt = db.prepare(
        "SELECT id, title, type, prompt_md, columns_config, practice, is_system, created_at
         FROM workflows ORDER BY is_system DESC, created_at DESC",
    )?;
    let workflows = stmt
        .query_map([], |row| {
            Ok(Workflow {
                id: row.get(0)?,
                title: row.get(1)?,
                r#type: row.get(2)?,
                prompt_md: row.get(3)?,
                columns_config: row.get(4)?,
                practice: row.get(5)?,
                is_system: row.get::<_, i32>(6)? == 1,
                created_at: row.get(7)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(workflows)
}

#[tauri::command]
pub async fn create_workflow(
    state: State<'_, AppState>,
    title: String,
    r#type: Option<String>,
    prompt_md: Option<String>,
    columns_config: Option<String>,
    practice: Option<String>,
) -> Result<Workflow, AppError> {
    let id = Uuid::new_v4().to_string();
    let wf_type = r#type.unwrap_or_else(|| "chat".into());
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    db.execute(
        "INSERT INTO workflows (id, title, type, prompt_md, columns_config, practice, is_system) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
        rusqlite::params![id, title, wf_type, prompt_md, columns_config, practice],
    )?;
    Ok(Workflow {
        id,
        title,
        r#type: wf_type,
        prompt_md,
        columns_config,
        practice,
        is_system: false,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub async fn get_workflow(state: State<'_, AppState>, id: String) -> Result<Workflow, AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    let wf = db.query_row(
        "SELECT id, title, type, prompt_md, columns_config, practice, is_system, created_at FROM workflows WHERE id = ?1",
        [&id],
        |row| Ok(Workflow {
            id: row.get(0)?,
            title: row.get(1)?,
            r#type: row.get(2)?,
            prompt_md: row.get(3)?,
            columns_config: row.get(4)?,
            practice: row.get(5)?,
            is_system: row.get::<_, i32>(6)? == 1,
            created_at: row.get(7)?,
        }),
    )?;
    Ok(wf)
}

#[tauri::command]
pub async fn update_workflow(
    state: State<'_, AppState>,
    id: String,
    title: Option<String>,
    prompt_md: Option<String>,
    columns_config: Option<String>,
    practice: Option<String>,
) -> Result<(), AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    if let Some(t) = title {
        db.execute("UPDATE workflows SET title = ?1 WHERE id = ?2", rusqlite::params![t, id])?;
    }
    if let Some(p) = prompt_md {
        db.execute("UPDATE workflows SET prompt_md = ?1 WHERE id = ?2", rusqlite::params![p, id])?;
    }
    if let Some(c) = columns_config {
        db.execute("UPDATE workflows SET columns_config = ?1 WHERE id = ?2", rusqlite::params![c, id])?;
    }
    if let Some(pr) = practice {
        db.execute("UPDATE workflows SET practice = ?1 WHERE id = ?2", rusqlite::params![pr, id])?;
    }
    Ok(())
}

/// Create a tabular review pre-populated from a workflow's columns_config.
#[tauri::command]
pub async fn create_review_from_workflow(
    state: State<'_, AppState>,
    workflow_id: String,
    project_id: String,
    doc_ids: Vec<String>,
    title: Option<String>,
) -> Result<String, AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;

    let (wf_title, wf_columns): (String, Option<String>) = db.query_row(
        "SELECT title, columns_config FROM workflows WHERE id = ?1",
        [&workflow_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;

    let columns_json = wf_columns.unwrap_or_else(|| "[]".into());
    let columns: Vec<serde_json::Value> = serde_json::from_str(&columns_json).unwrap_or_default();
    let col_count = columns.len() as i32;

    let review_id = Uuid::new_v4().to_string();
    let review_title = title.unwrap_or(wf_title);

    db.execute(
        "INSERT INTO tabular_reviews (id, project_id, title, columns_config, workflow_id) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![review_id, project_id, review_title, columns_json, workflow_id],
    )?;

    // Create pending cells for each doc × column
    for doc_id in &doc_ids {
        for col in 0..col_count {
            let cell_id = Uuid::new_v4().to_string();
            db.execute(
                "INSERT INTO tabular_cells (id, review_id, document_id, column_index, status) VALUES (?1, ?2, ?3, ?4, 'pending')",
                rusqlite::params![cell_id, review_id, doc_id, col],
            )?;
        }
    }

    Ok(review_id)
}

#[tauri::command]
pub async fn delete_workflow(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    db.execute(
        "DELETE FROM workflows WHERE id = ?1 AND is_system = 0",
        [&id],
    )?;
    Ok(())
}
