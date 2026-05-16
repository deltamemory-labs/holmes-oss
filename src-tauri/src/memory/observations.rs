use rusqlite::Connection;
use uuid::Uuid;

#[derive(Clone)]
pub struct Observation {
    pub id: String,
    pub project_id: Option<String>,
    pub content: String,
    pub priority: String,
    pub observation_date: Option<String>,
    pub referenced_date: Option<String>,
}

/// Store a new observation.
pub fn store(conn: &Connection, obs: &Observation) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO observations (id, project_id, content, priority, observation_date, referenced_date)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            obs.id,
            obs.project_id,
            obs.content,
            obs.priority,
            obs.observation_date,
            obs.referenced_date,
        ],
    )?;
    Ok(())
}

/// Load all observations, ordered by date. Optionally filter by project.
pub fn load_all(conn: &Connection, project_id: Option<&str>) -> Vec<Observation> {
    let (sql, params): (&str, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(pid) = project_id {
        (
            "SELECT id, project_id, content, priority, observation_date, referenced_date
             FROM observations WHERE project_id = ?1 ORDER BY created_at ASC",
            vec![Box::new(pid.to_string())],
        )
    } else {
        (
            "SELECT id, project_id, content, priority, observation_date, referenced_date
             FROM observations ORDER BY created_at ASC",
            vec![],
        )
    };

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(sql).unwrap();
    stmt.query_map(param_refs.as_slice(), |row| {
        Ok(Observation {
            id: row.get(0)?,
            project_id: row.get(1)?,
            content: row.get(2)?,
            priority: row.get(3)?,
            observation_date: row.get(4)?,
            referenced_date: row.get(5)?,
        })
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

/// Format all observations into a text block for the system prompt.
/// Groups by date, includes priority markers.
pub fn format_for_context(observations: &[Observation]) -> String {
    if observations.is_empty() {
        return String::new();
    }

    let mut result = String::from("<observations>\n");
    let mut current_date = String::new();

    for obs in observations {
        let date = obs.observation_date.as_deref().unwrap_or("Unknown date");
        if date != current_date {
            if !current_date.is_empty() {
                result.push('\n');
            }
            result.push_str(&format!("## {}\n", date));
            current_date = date.to_string();
        }

        let marker = match obs.priority.as_str() {
            "high" => "🔴",
            "medium" => "🟡",
            "low" => "🟢",
            _ => "🟡",
        };

        result.push_str(&format!("* {} {}\n", marker, obs.content));
    }

    result.push_str("</observations>");
    result
}

/// Replace all observations (used after reflection).
pub fn replace_all(conn: &Connection, observations: &[Observation]) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM observations", [])?;
    for obs in observations {
        store(conn, obs)?;
    }
    Ok(())
}

/// Count total approximate tokens in observations (rough: 1 token ~ 4 chars).
pub fn estimate_tokens(observations: &[Observation]) -> usize {
    observations.iter().map(|o| o.content.len() / 4).sum()
}

/// Create a new observation with a generated ID.
pub fn new_observation(
    project_id: Option<String>,
    content: String,
    priority: &str,
    observation_date: Option<String>,
    referenced_date: Option<String>,
) -> Observation {
    Observation {
        id: Uuid::new_v4().to_string(),
        project_id,
        content,
        priority: priority.to_string(),
        observation_date,
        referenced_date,
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(crate::db::SCHEMA).unwrap();
        conn
    }

    #[test]
    fn store_and_load() {
        let conn = test_conn();
        let obs = new_observation(
            Some("proj-1".into()),
            "Acme Corp SPA executed".into(),
            "high",
            Some("2024-03-15".into()),
            None,
        );
        store(&conn, &obs).unwrap();

        let loaded = load_all(&conn, Some("proj-1"));
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].content, "Acme Corp SPA executed");
        assert_eq!(loaded[0].priority, "high");
    }

    #[test]
    fn load_all_no_filter() {
        let conn = test_conn();
        store(&conn, &new_observation(Some("p1".into()), "obs1".into(), "high", None, None)).unwrap();
        store(&conn, &new_observation(Some("p2".into()), "obs2".into(), "low", None, None)).unwrap();

        let all = load_all(&conn, None);
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn load_filtered_by_project() {
        let conn = test_conn();
        store(&conn, &new_observation(Some("p1".into()), "obs1".into(), "high", None, None)).unwrap();
        store(&conn, &new_observation(Some("p2".into()), "obs2".into(), "low", None, None)).unwrap();

        let p1 = load_all(&conn, Some("p1"));
        assert_eq!(p1.len(), 1);
        assert_eq!(p1[0].content, "obs1");
    }

    #[test]
    fn format_for_context_empty() {
        let result = format_for_context(&[]);
        assert!(result.is_empty());
    }

    #[test]
    fn format_for_context_groups_by_date() {
        let obs = vec![
            new_observation(None, "first".into(), "high", Some("2024-03-15".into()), None),
            new_observation(None, "second".into(), "medium", Some("2024-03-15".into()), None),
            new_observation(None, "third".into(), "low", Some("2024-03-16".into()), None),
        ];
        let text = format_for_context(&obs);
        assert!(text.contains("<observations>"));
        assert!(text.contains("## 2024-03-15"));
        assert!(text.contains("## 2024-03-16"));
        assert!(text.contains("</observations>"));
    }

    #[test]
    fn format_includes_priority_markers() {
        let obs = vec![
            new_observation(None, "high item".into(), "high", Some("2024-01-01".into()), None),
            new_observation(None, "med item".into(), "medium", Some("2024-01-01".into()), None),
            new_observation(None, "low item".into(), "low", Some("2024-01-01".into()), None),
        ];
        let text = format_for_context(&obs);
        assert!(text.contains("\u{1F534}")); // red circle
        assert!(text.contains("\u{1F7E1}")); // yellow circle
        assert!(text.contains("\u{1F7E2}")); // green circle
    }

    #[test]
    fn estimate_tokens_rough() {
        let obs = vec![
            new_observation(None, "a".repeat(400).into(), "high", None, None),
        ];
        let tokens = estimate_tokens(&obs);
        assert_eq!(tokens, 100); // 400 chars / 4
    }

    #[test]
    fn replace_all_clears_and_inserts() {
        let conn = test_conn();
        store(&conn, &new_observation(None, "old".into(), "low", None, None)).unwrap();
        assert_eq!(load_all(&conn, None).len(), 1);

        let new_obs = vec![
            new_observation(None, "new1".into(), "high", None, None),
            new_observation(None, "new2".into(), "medium", None, None),
        ];
        replace_all(&conn, &new_obs).unwrap();

        let all = load_all(&conn, None);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].content, "new1");
    }
}
