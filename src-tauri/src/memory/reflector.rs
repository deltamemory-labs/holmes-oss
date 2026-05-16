use crate::providers::{GeminiProvider, LlmMessage, LlmProvider, StreamChunk};

use super::observations::{self, Observation};

const REFLECTOR_SYSTEM_PROMPT: &str = r#"You are the Reflector, a background agent that restructures and condenses observations in a legal AI assistant called Holmes.

Your observations are THE ENTIRETY of the assistant's cross-matter memory. Any information you do not include will be immediately forgotten.

INSTRUCTIONS:
1. Combine related observations across matters (e.g., "Acme Corp appeared as buyer in Project Alpha and guarantor in Project Beta")
2. Identify patterns (e.g., "This firm consistently negotiates 36-month rep survival periods")
3. Drop observations superseded by newer information (if a term was amended, keep only the current version)
4. Preserve all 🔴 high-priority observations
5. Condense older observations more aggressively, retain more detail for recent ones
6. Maintain chronological ordering and date anchoring
7. Preserve entity relationships and cross-references between matters

OUTPUT FORMAT:
Return the restructured observations in the same format as the input:
* [priority marker] ([time]) [observation]. (meaning [date] if applicable)

Group by date. Preserve the three-date model."#;

const REFLECTOR_TOKEN_BUDGET: usize = 50_000;

/// Check if reflection is needed based on observation token count.
pub fn needs_reflection(observations: &[Observation]) -> bool {
    observations::estimate_tokens(observations) > REFLECTOR_TOKEN_BUDGET
}

/// Run the Reflector to restructure observations.
pub async fn reflect(
    api_key: &str,
    observations: &[Observation],
    today: &str,
) -> Vec<Observation> {
    let current_text = observations::format_for_context(observations);

    let provider = GeminiProvider::new(
        api_key.to_string(),
        "gemini-3-flash-preview".to_string(),
    );

    let user_msg = format!(
        "Today's date: {}\n\nCurrent observations to restructure:\n{}",
        today, current_text
    );

    let messages = vec![LlmMessage {
        role: "user".into(),
        content: user_msg,
        ..Default::default()
    }];

    let (tx, mut rx) = tokio::sync::mpsc::channel::<StreamChunk>(32);
    let system = REFLECTOR_SYSTEM_PROMPT.to_string();

    tokio::spawn(async move {
        provider.stream_chat(&system, &messages, None, tx).await;
    });

    let mut full_text = String::new();
    while let Some(chunk) = rx.recv().await {
        match chunk {
            StreamChunk::Delta(t) => full_text.push_str(&t),
            StreamChunk::Done(t) => { full_text = t; break; }
            StreamChunk::Error(_) => return observations.to_vec(),
            _ => {}
        }
    }

    parse_reflected_observations(&full_text, today)
}

fn parse_reflected_observations(text: &str, today: &str) -> Vec<Observation> {
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
            let clean = content
                .trim_start_matches("🔴")
                .trim_start_matches("🟡")
                .trim_start_matches("🟢")
                .trim()
                .to_string();

            observations::new_observation(None, clean, priority, Some(today.to_string()), None)
        })
        .collect()
}
