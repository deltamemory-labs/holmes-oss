use serde::Serialize;
use std::path::Path;
use tauri::State;
use uuid::Uuid;

use crate::error::AppError;
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub cm_number: Option<String>,
    pub document_count: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub async fn create_project(
    state: State<'_, AppState>,
    name: String,
    cm_number: Option<String>,
) -> Result<Project, AppError> {
    let id = Uuid::new_v4().to_string();
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;

    db.execute(
        "INSERT INTO projects (id, name, cm_number) VALUES (?1, ?2, ?3)",
        rusqlite::params![id, name, cm_number],
    )?;

    // Create document directory
    let data_dir = db.path().and_then(|p| Path::new(p).parent().map(|p| p.to_path_buf()));
    if let Some(dir) = data_dir {
        std::fs::create_dir_all(dir.join("documents").join(&id)).ok();
    }

    Ok(Project {
        id,
        name,
        cm_number,
        document_count: 0,
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub async fn list_projects(state: State<'_, AppState>) -> Result<Vec<Project>, AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    let mut stmt = db.prepare(
        "SELECT p.id, p.name, p.cm_number, p.created_at, p.updated_at,
                (SELECT COUNT(*) FROM documents d WHERE d.project_id = p.id) as doc_count
         FROM projects p ORDER BY p.updated_at DESC",
    )?;

    let projects = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                cm_number: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                document_count: row.get(5)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(projects)
}

#[tauri::command]
pub async fn get_project(state: State<'_, AppState>, id: String) -> Result<Project, AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    let project = db.query_row(
        "SELECT p.id, p.name, p.cm_number, p.created_at, p.updated_at,
                (SELECT COUNT(*) FROM documents d WHERE d.project_id = p.id) as doc_count
         FROM projects p WHERE p.id = ?1",
        [&id],
        |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                cm_number: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                document_count: row.get(5)?,
            })
        },
    )?;
    Ok(project)
}

#[tauri::command]
pub async fn delete_project(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    db.execute("DELETE FROM projects WHERE id = ?1", [&id])?;
    Ok(())
}

#[tauri::command]
pub async fn rename_project(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<(), AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    db.execute(
        "UPDATE projects SET name = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![name, id],
    )?;
    Ok(())
}
