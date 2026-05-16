use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::error::AppError;
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Subfolder {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub parent_folder_id: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub async fn create_subfolder(
    state: State<'_, AppState>,
    project_id: String,
    name: String,
    parent_folder_id: Option<String>,
) -> Result<Subfolder, AppError> {
    let id = Uuid::new_v4().to_string();
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;

    db.execute(
        "INSERT INTO project_subfolders (id, project_id, name, parent_folder_id) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, project_id, name, parent_folder_id],
    )?;

    Ok(Subfolder {
        id,
        project_id,
        name,
        parent_folder_id,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub async fn list_subfolders(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<Subfolder>, AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    let mut stmt = db.prepare(
        "SELECT id, project_id, name, parent_folder_id, created_at
         FROM project_subfolders WHERE project_id = ?1 ORDER BY name ASC",
    )?;
    let rows = stmt
        .query_map([&project_id], |row| {
            Ok(Subfolder {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                parent_folder_id: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub async fn rename_subfolder(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<(), AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    db.execute(
        "UPDATE project_subfolders SET name = ?1 WHERE id = ?2",
        rusqlite::params![name, id],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn move_subfolder(
    state: State<'_, AppState>,
    id: String,
    parent_folder_id: Option<String>,
) -> Result<(), AppError> {
    // Guard against moving a folder into itself or its descendants.
    if parent_folder_id.as_deref() == Some(id.as_str()) {
        return Err(AppError::Validation("Cannot move folder into itself".into()));
    }

    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;

    if let Some(ref parent) = parent_folder_id {
        // Walk up the parent chain from the proposed new parent — if we encounter `id`, reject.
        let mut cursor = Some(parent.clone());
        while let Some(cur) = cursor {
            if cur == id {
                return Err(AppError::Validation("Cannot move folder into its descendant".into()));
            }
            cursor = db
                .query_row(
                    "SELECT parent_folder_id FROM project_subfolders WHERE id = ?1",
                    [&cur],
                    |r| r.get::<_, Option<String>>(0),
                )
                .ok()
                .flatten();
        }
    }

    db.execute(
        "UPDATE project_subfolders SET parent_folder_id = ?1 WHERE id = ?2",
        rusqlite::params![parent_folder_id, id],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn delete_subfolder(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    // Any documents inside this folder become unfoliered (folder_id NULL via ON DELETE SET NULL).
    db.execute("DELETE FROM project_subfolders WHERE id = ?1", [&id])?;
    Ok(())
}

#[tauri::command]
pub async fn move_document_to_folder(
    state: State<'_, AppState>,
    doc_id: String,
    folder_id: Option<String>,
) -> Result<(), AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    db.execute(
        "UPDATE documents SET folder_id = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![folder_id, doc_id],
    )?;
    Ok(())
}
