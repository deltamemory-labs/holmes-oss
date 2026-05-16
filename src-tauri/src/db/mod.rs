use rusqlite::{Connection, Result};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Manager;

pub(crate) const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    display_name TEXT,
    organisation TEXT,
    ollama_base_url TEXT DEFAULT 'http://localhost:11434',
    default_main_model TEXT DEFAULT 'gemini-3-flash-preview',
    default_tabular_model TEXT DEFAULT 'gemini-3-flash-preview',
    default_title_model TEXT DEFAULT 'gemini-3.1-flash-lite-preview',
    onboarding_complete INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cm_number TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_subfolders (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    parent_folder_id TEXT REFERENCES project_subfolders(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    file_type TEXT,
    size_bytes INTEGER DEFAULT 0,
    page_count INTEGER,
    status TEXT DEFAULT 'pending',
    folder_id TEXT REFERENCES project_subfolders(id) ON DELETE SET NULL,
    current_version_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS document_versions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    pdf_storage_path TEXT,
    source TEXT NOT NULL DEFAULT 'upload'
        CHECK (source IN ('upload','user_upload','assistant_edit','user_accept','user_reject','generated')),
    version_number INTEGER,
    display_name TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS document_edits (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chat_message_id TEXT,
    version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
    change_id TEXT NOT NULL,
    deleted_text TEXT DEFAULT '',
    inserted_text TEXT DEFAULT '',
    context_before TEXT,
    context_after TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
    created_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT,
    files TEXT,
    annotations TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tabular_reviews (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT,
    columns_config TEXT,
    workflow_id TEXT,
    practice TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tabular_cells (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES tabular_reviews(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    column_index INTEGER NOT NULL,
    content TEXT,
    citations TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'chat',
    prompt_md TEXT,
    columns_config TEXT,
    practice TEXT,
    is_system INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS observations (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    content TEXT NOT NULL,
    priority TEXT DEFAULT 'medium',
    observation_date TEXT,
    referenced_date TEXT,
    relative_date TEXT,
    embedding_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS concepts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    concept_type TEXT,
    importance REAL DEFAULT 0.5,
    embedding_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS relations (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL,
    confidence REAL DEFAULT 0.5,
    created_at TEXT DEFAULT (datetime('now'))
);
"#;

pub fn data_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .expect("failed to resolve app data dir");
    dir
}

pub fn init(app: &tauri::AppHandle) -> Result<Arc<Mutex<Connection>>> {
    let dir = data_dir(app);
    fs::create_dir_all(&dir).expect("failed to create data dir");
    fs::create_dir_all(dir.join("documents")).ok();
    fs::create_dir_all(dir.join("memory")).ok();
    fs::create_dir_all(dir.join("memory/observations")).ok();
    fs::create_dir_all(dir.join("memory/vectors")).ok();

    let db_path = dir.join("holmes.db");
    let conn = Connection::open(&db_path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    conn.execute_batch(SCHEMA)?;
    Ok(Arc::new(Mutex::new(conn)))
}


pub fn seed_workflows(db: &Arc<Mutex<Connection>>) -> Result<()> {
    let conn = db.lock().unwrap();
    let count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM workflows WHERE is_system = 1",
        [],
        |r| r.get(0),
    )?;
    if count >= 14 {
        return Ok(());
    }

    // Load the full builtin library from the embedded JSON.
    let json_bytes = include_str!("builtin_workflows.json");
    let workflows: Vec<serde_json::Value> = serde_json::from_str(json_bytes)
        .expect("builtin_workflows.json is invalid");

    for wf in &workflows {
        let id = wf["id"].as_str().unwrap_or("");
        let title = wf["title"].as_str().unwrap_or("");
        let wf_type = wf["type"].as_str().unwrap_or("chat");
        let practice = wf["practice"].as_str();
        let prompt_md = if wf["prompt_md"].is_null() { None } else { wf["prompt_md"].as_str() };
        let columns_config = if wf["columns_config"].is_null() {
            None
        } else {
            Some(wf["columns_config"].to_string())
        };

        conn.execute(
            "INSERT OR REPLACE INTO workflows (id, title, type, prompt_md, columns_config, practice, is_system) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)",
            rusqlite::params![id, title, wf_type, prompt_md, columns_config, practice],
        )?;
    }

    Ok(())
}


#[cfg(test)]
#[path = "tests.rs"]
mod tests;
