#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};

    fn test_db() -> Arc<Mutex<Connection>> {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(crate::db::SCHEMA).unwrap();
        Arc::new(Mutex::new(conn))
    }

    #[test]
    fn schema_creates_all_tables() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(tables.contains(&"settings".to_string()));
        assert!(tables.contains(&"projects".to_string()));
        assert!(tables.contains(&"documents".to_string()));
        assert!(tables.contains(&"chats".to_string()));
        assert!(tables.contains(&"workflows".to_string()));
        assert!(tables.contains(&"observations".to_string()));
        assert!(tables.contains(&"concepts".to_string()));
        assert!(tables.contains(&"relations".to_string()));
    }

    #[test]
    fn settings_row_seeded() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM settings", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn settings_defaults() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let model: String = conn
            .query_row("SELECT default_main_model FROM settings WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(model, "gemini-3-flash-preview");
    }

    #[test]
    fn seed_workflows_inserts_fourteen() {
        let db = test_db();
        crate::db::seed_workflows(&db).unwrap();
        let conn = db.lock().unwrap();
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM workflows WHERE is_system = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 14);
    }

    #[test]
    fn seed_workflows_idempotent() {
        let db = test_db();
        crate::db::seed_workflows(&db).unwrap();
        crate::db::seed_workflows(&db).unwrap();
        let conn = db.lock().unwrap();
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM workflows WHERE is_system = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 14);
    }

    #[test]
    fn foreign_key_cascade() {
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute("INSERT INTO projects (id, name) VALUES ('p1', 'P')", []).unwrap();
        conn.execute("INSERT INTO chats (id, project_id, title) VALUES ('c1', 'p1', 'Chat')", []).unwrap();
        conn.execute("INSERT INTO chat_messages (id, chat_id, role, content) VALUES ('m1', 'c1', 'user', 'hi')", []).unwrap();

        conn.execute("DELETE FROM projects WHERE id = 'p1'", []).unwrap();

        let chat_count: i32 = conn.query_row("SELECT COUNT(*) FROM chats", [], |r| r.get(0)).unwrap();
        let msg_count: i32 = conn.query_row("SELECT COUNT(*) FROM chat_messages", [], |r| r.get(0)).unwrap();
        assert_eq!(chat_count, 0);
        assert_eq!(msg_count, 0);
    }
}
