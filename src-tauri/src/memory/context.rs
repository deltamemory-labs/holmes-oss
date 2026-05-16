use rusqlite::Connection;

use super::observations;

const OBSERVATION_PREAMBLE: &str =
    "The following observations block contains your memory of past matters and conversations with this user's firm.";

const OBSERVATION_INSTRUCTIONS: &str = r#"IMPORTANT: When responding, reference specific details from these observations when relevant. Personalize your response based on what you know about this firm's past deals, preferences, and patterns.

KNOWLEDGE UPDATES: When asked about current state, always prefer the MOST RECENT information. If you see conflicting information, the newer observation supersedes the older one.

CROSS-MATTER CONNECTIONS: If you notice that a party, clause type, or term from the current matter appeared in a past matter, surface that connection proactively. This is your key advantage.

Do not mention the observation system, memory, or summarization to the user. Use the knowledge naturally."#;

/// Build the stable context prefix from all observations.
/// This is injected at the top of every chat's system prompt and is prompt-cacheable.
pub fn build_stable_prefix(conn: &Connection) -> String {
    let all_obs = observations::load_all(conn, None);

    if all_obs.is_empty() {
        return String::new();
    }

    let formatted = observations::format_for_context(&all_obs);

    format!(
        "{}\n\n{}\n\n{}",
        OBSERVATION_PREAMBLE, formatted, OBSERVATION_INSTRUCTIONS
    )
}

/// Estimate the token count of the current observation context.
#[allow(dead_code)]
pub fn context_token_count(conn: &Connection) -> usize {
    let all_obs = observations::load_all(conn, None);
    observations::estimate_tokens(&all_obs)
}
