#![allow(dead_code)]

use rusqlite::Connection;
use uuid::Uuid;

pub struct Concept {
    pub id: String,
    pub name: String,
    pub concept_type: Option<String>,
    pub importance: f64,
}

pub struct Relation {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    pub relation_type: String,
    pub confidence: f64,
}

pub fn add_concept(conn: &Connection, name: &str, concept_type: &str, importance: f64) -> String {
    // Upsert: if concept with same name exists, update importance
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM concepts WHERE name = ?1",
            [name],
            |row| row.get(0),
        )
        .ok();

    if let Some(id) = existing {
        conn.execute(
            "UPDATE concepts SET importance = MAX(importance, ?1) WHERE id = ?2",
            rusqlite::params![importance, id],
        )
        .ok();
        return id;
    }

    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO concepts (id, name, concept_type, importance) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, name, concept_type, importance],
    )
    .ok();
    id
}

pub fn add_relation(
    conn: &Connection,
    source_id: &str,
    target_id: &str,
    relation_type: &str,
    confidence: f64,
) {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO relations (id, source_id, target_id, relation_type, confidence)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, source_id, target_id, relation_type, confidence],
    )
    .ok();
}

/// Find concepts connected within N hops of a given concept.
pub fn traverse(conn: &Connection, concept_id: &str, max_hops: usize) -> Vec<Concept> {
    let mut visited = std::collections::HashSet::new();
    let mut frontier = vec![concept_id.to_string()];
    let mut results = Vec::new();

    for _ in 0..max_hops {
        let mut next_frontier = Vec::new();
        for cid in &frontier {
            if !visited.insert(cid.clone()) {
                continue;
            }
            // Find neighbors
            let mut stmt = conn
                .prepare(
                    "SELECT c.id, c.name, c.concept_type, c.importance FROM concepts c
                     JOIN relations r ON (r.target_id = c.id AND r.source_id = ?1)
                        OR (r.source_id = c.id AND r.target_id = ?1)",
                )
                .unwrap();
            let neighbors: Vec<Concept> = stmt
                .query_map([cid], |row| {
                    Ok(Concept {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        concept_type: row.get(2)?,
                        importance: row.get(3)?,
                    })
                })
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();

            for n in neighbors {
                if !visited.contains(&n.id) {
                    next_frontier.push(n.id.clone());
                    results.push(n);
                }
            }
        }
        frontier = next_frontier;
    }

    results
}

/// Get all concepts (for display/debug).
pub fn all_concepts(conn: &Connection) -> Vec<Concept> {
    let mut stmt = conn
        .prepare("SELECT id, name, concept_type, importance FROM concepts ORDER BY importance DESC")
        .unwrap();
    stmt.query_map([], |row| {
        Ok(Concept {
            id: row.get(0)?,
            name: row.get(1)?,
            concept_type: row.get(2)?,
            importance: row.get(3)?,
        })
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
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
    fn add_and_retrieve_concept() {
        let conn = test_conn();
        let id = add_concept(&conn, "Acme Corp", "party", 0.9);
        assert!(!id.is_empty());

        let concepts = all_concepts(&conn);
        assert_eq!(concepts.len(), 1);
        assert_eq!(concepts[0].name, "Acme Corp");
        assert_eq!(concepts[0].concept_type, Some("party".into()));
    }

    #[test]
    fn add_concept_upserts() {
        let conn = test_conn();
        let id1 = add_concept(&conn, "Acme Corp", "party", 0.5);
        let id2 = add_concept(&conn, "Acme Corp", "party", 0.9);
        assert_eq!(id1, id2);

        let concepts = all_concepts(&conn);
        assert_eq!(concepts.len(), 1);
        assert!(concepts[0].importance >= 0.9);
    }

    #[test]
    fn add_relation_and_traverse() {
        let conn = test_conn();
        let acme = add_concept(&conn, "Acme Corp", "party", 0.9);
        let parent = add_concept(&conn, "ParentCo", "party", 0.8);
        let beta = add_concept(&conn, "Beta Holdings", "party", 0.7);

        add_relation(&conn, &acme, &parent, "subsidiary_of", 0.95);
        add_relation(&conn, &parent, &beta, "counterparty_in", 0.8);

        // 1-hop from Acme should find ParentCo
        let one_hop = traverse(&conn, &acme, 1);
        assert_eq!(one_hop.len(), 1);
        assert_eq!(one_hop[0].name, "ParentCo");

        // 2-hop from Acme should find ParentCo and Beta
        let two_hop = traverse(&conn, &acme, 2);
        assert_eq!(two_hop.len(), 2);
        let names: Vec<&str> = two_hop.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains(&"ParentCo"));
        assert!(names.contains(&"Beta Holdings"));
    }

    #[test]
    fn traverse_empty() {
        let conn = test_conn();
        let id = add_concept(&conn, "Lonely", "entity", 0.5);
        let result = traverse(&conn, &id, 3);
        assert!(result.is_empty());
    }
}
