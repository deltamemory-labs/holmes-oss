use crate::providers::{GeminiProvider, LlmMessage, LlmProvider, StreamChunk};

use super::observations::{self, Observation};

const OBSERVER_SYSTEM_PROMPT: &str = r#"You are the Observer, a background agent that watches conversations and documents in a legal AI assistant called Holmes. Your job is to produce dense, dated observations about what happened.

Each observation captures a specific event: a clause extracted, a term negotiated, a party identified, a preference expressed, a document reviewed.

FORMAT:
- Use priority markers: 🔴 high (unusual terms, key obligations, important facts), 🟡 medium (standard provisions), 🟢 low (routine details)
- Include timestamps when available
- Three-date model: observation date (when observed), referenced date (date mentioned in content)
- Group by date

OUTPUT FORMAT:
Return ONLY the observations, one per line, prefixed with priority marker.
Each line: * [marker] ([time]) [observation]. (meaning [referenced date] if applicable)

Example:
* 🔴 (14:30) Acme Corp SPA executed, governing law Delaware, change-of-control threshold 50%
* 🔴 (14:30) Seller rep survival period 36 months (unusual, market is 18-24 months)
* 🟡 (14:30) Conditions precedent include FCA regulatory approval, deadline June 30 2024. (meaning 2024-06-30)
* 🟢 (14:31) Standard representations and warranties package

LEGAL DOMAIN FOCUS:
- Extract parties, jurisdictions, governing law, key dates
- Flag unusual or non-market terms as 🔴
- Note financial terms: amounts, rates, fees, thresholds
- Track obligations, covenants, conditions precedent
- Preserve clause references and section numbers
- Note relationships between entities (subsidiary of, guarantor for, etc.)

Be concise but preserve distinguishing details. Each observation should be independently useful."#;

/// Run the Observer on raw content and return parsed observations.
pub async fn observe(
    api_key: &str,
    content: &str,
    project_id: Option<&str>,
    today: &str,
) -> Vec<Observation> {
    let provider = GeminiProvider::new(
        api_key.to_string(),
        "gemini-3.1-flash-lite-preview".to_string(),
    );

    let user_msg = format!(
        "Today's date: {}\n\nContent to observe:\n{}",
        today,
        &content[..content.len().min(80_000)]
    );

    let messages = vec![LlmMessage {
        role: "user".into(),
        content: user_msg,
        ..Default::default()
    }];

    let (tx, mut rx) = tokio::sync::mpsc::channel::<StreamChunk>(32);
    let system = OBSERVER_SYSTEM_PROMPT.to_string();

    tokio::spawn(async move {
        provider.stream_chat(&system, &messages, None, tx).await;
    });

    let mut full_text = String::new();
    while let Some(chunk) = rx.recv().await {
        match chunk {
            StreamChunk::Delta(t) => full_text.push_str(&t),
            StreamChunk::Done(t) => { full_text = t; break; }
            StreamChunk::Error(_) => break,
            _ => {}
        }
    }

    parse_observations(&full_text, project_id, today)
}

/// Parse the observer's text output into structured observations.
fn parse_observations(text: &str, project_id: Option<&str>, today: &str) -> Vec<Observation> {
    text.lines()
        .filter(|line| line.trim_start().starts_with('*'))
        .map(|line| {
            let content = line.trim_start().trim_start_matches('*').trim().to_string();

            let priority = if content.starts_with("🔴") {
                "high"
            } else if content.starts_with("🟢") {
                "low"
            } else {
                "medium"
            };

            // Strip the emoji prefix
            let clean = content
                .trim_start_matches("🔴")
                .trim_start_matches("🟡")
                .trim_start_matches("🟢")
                .trim()
                .to_string();

            // Extract referenced date if present: (meaning DATE) or (estimated DATE)
            let referenced_date = if let Some(pos) = clean.rfind("(meaning ") {
                Some(clean[pos + 9..].trim_end_matches(')').trim().to_string())
            } else if let Some(pos) = clean.rfind("(estimated ") {
                Some(clean[pos + 11..].trim_end_matches(')').trim().to_string())
            } else {
                None
            };

            observations::new_observation(
                project_id.map(|s| s.to_string()),
                clean,
                priority,
                Some(today.to_string()),
                referenced_date,
            )
        })
        .collect()
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_basic_observations() {
        let text = r#"* 🔴 (14:30) Acme Corp SPA executed, governing law Delaware
* 🟡 (14:30) Standard reps and warranties
* 🟢 (14:31) Routine closing conditions"#;

        let obs = parse_observations(text, Some("proj-1"), "2024-03-15");
        assert_eq!(obs.len(), 3);
        assert_eq!(obs[0].priority, "high");
        assert_eq!(obs[1].priority, "medium");
        assert_eq!(obs[2].priority, "low");
        assert_eq!(obs[0].project_id, Some("proj-1".to_string()));
        assert_eq!(obs[0].observation_date, Some("2024-03-15".to_string()));
    }

    #[test]
    fn parse_with_referenced_date() {
        let text = "* 🔴 (14:30) CP deadline for regulatory approval. (meaning 2024-06-30)";
        let obs = parse_observations(text, None, "2024-03-15");
        assert_eq!(obs.len(), 1);
        assert_eq!(obs[0].referenced_date, Some("2024-06-30".to_string()));
    }

    #[test]
    fn parse_with_estimated_date() {
        let text = "* 🟡 (09:15) Client plans to refinance. (estimated Q3 2026)";
        let obs = parse_observations(text, None, "2024-03-15");
        assert_eq!(obs.len(), 1);
        assert_eq!(obs[0].referenced_date, Some("Q3 2026".to_string()));
    }

    #[test]
    fn parse_ignores_non_observation_lines() {
        let text = r#"Here are the observations:

## 2024-03-15
* 🔴 (14:30) Important fact

Some other text that should be ignored.
"#;
        let obs = parse_observations(text, None, "2024-03-15");
        assert_eq!(obs.len(), 1);
        assert_eq!(obs[0].priority, "high");
    }

    #[test]
    fn parse_empty_input() {
        let obs = parse_observations("", None, "2024-03-15");
        assert!(obs.is_empty());
    }

    #[test]
    fn parse_no_emoji_defaults_to_medium() {
        let text = "* (14:30) Some observation without emoji";
        let obs = parse_observations(text, None, "2024-03-15");
        assert_eq!(obs.len(), 1);
        assert_eq!(obs[0].priority, "medium");
    }
}
