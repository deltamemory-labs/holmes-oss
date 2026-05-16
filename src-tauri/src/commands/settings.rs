use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::AppError;
use crate::keystore;
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub display_name: Option<String>,
    pub organisation: Option<String>,
    pub has_gemini_key: bool,
    pub has_anthropic_key: bool,
    pub has_openai_key: bool,
    pub ollama_base_url: String,
    pub default_main_model: String,
    pub default_tabular_model: String,
    pub default_title_model: String,
    pub onboarding_complete: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettingsInput {
    pub display_name: Option<String>,
    pub organisation: Option<String>,
    pub gemini_api_key: Option<String>,
    pub anthropic_api_key: Option<String>,
    pub openai_api_key: Option<String>,
    pub ollama_base_url: Option<String>,
    pub default_main_model: Option<String>,
    pub default_tabular_model: Option<String>,
    pub default_title_model: Option<String>,
    pub onboarding_complete: Option<bool>,
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    let mut stmt = db.prepare(
        "SELECT display_name, organisation,
                ollama_base_url, default_main_model, default_tabular_model, default_title_model,
                onboarding_complete
         FROM settings WHERE id = 1",
    )?;

    let settings = stmt.query_row([], |row| {
        Ok(AppSettings {
            display_name: row.get(0)?,
            organisation: row.get(1)?,
            has_gemini_key: keystore::get_key("gemini_api_key").is_some(),
            has_anthropic_key: keystore::get_key("anthropic_api_key").is_some(),
            has_openai_key: keystore::get_key("openai_api_key").is_some(),
            ollama_base_url: row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "http://localhost:11434".into()),
            default_main_model: row.get::<_, Option<String>>(3)?.unwrap_or_else(|| "gemini-3-flash-preview".into()),
            default_tabular_model: row.get::<_, Option<String>>(4)?.unwrap_or_else(|| "gemini-3-flash-preview".into()),
            default_title_model: row.get::<_, Option<String>>(5)?.unwrap_or_else(|| "gemini-3.1-flash-lite-preview".into()),
            onboarding_complete: row.get::<_, i32>(6).unwrap_or(0) == 1,
        })
    })?;

    Ok(settings)
}

/// Get an API key from the OS keychain. Used internally by chat/tabular commands.
pub fn get_api_key(name: &str) -> Option<String> {
    keystore::get_key(name)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModel {
    pub name: String,
    pub size: Option<u64>,
    pub modified_at: Option<String>,
}

/// Lists models available on a running Ollama server.
///
/// `base_url` defaults to the value stored in settings if `None`. Returns an
/// empty list with a helpful error if the server isn't reachable, so the UI
/// can guide the user to start Ollama.
#[tauri::command]
pub async fn list_ollama_models(
    state: State<'_, AppState>,
    base_url: Option<String>,
) -> Result<Vec<OllamaModel>, AppError> {
    // Resolve base URL: explicit param wins, otherwise fall back to settings.
    let url = match base_url {
        Some(u) if !u.trim().is_empty() => u,
        _ => {
            let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
            db.query_row(
                "SELECT ollama_base_url FROM settings WHERE id = 1",
                [],
                |row| row.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten()
            .unwrap_or_else(|| "http://localhost:11434".into())
        }
    };

    let trimmed = url.trim_end_matches('/');
    let endpoint = format!("{}/api/tags", trimmed);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| AppError::Provider(e.to_string()))?;

    let resp = client
        .get(&endpoint)
        .send()
        .await
        .map_err(|e| AppError::Provider(format!("Could not reach Ollama at {}: {}", trimmed, e)))?;

    if !resp.status().is_success() {
        return Err(AppError::Provider(format!(
            "Ollama returned {} when listing models",
            resp.status()
        )));
    }

    #[derive(Deserialize)]
    struct TagsResponse {
        models: Vec<TagModel>,
    }
    #[derive(Deserialize)]
    struct TagModel {
        name: String,
        #[serde(default)]
        size: Option<u64>,
        #[serde(default)]
        modified_at: Option<String>,
    }

    let body: TagsResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Provider(format!("Invalid response from Ollama: {}", e)))?;

    Ok(body
        .models
        .into_iter()
        .map(|m| OllamaModel {
            name: m.name,
            size: m.size,
            modified_at: m.modified_at,
        })
        .collect())
}

#[tauri::command]
pub async fn validate_api_key(key: String) -> Result<bool, AppError> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent")
        .header("x-goog-api-key", &key)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "contents": [{"parts": [{"text": "Say ok"}]}],
            "generationConfig": {"maxOutputTokens": 5}
        }))
        .send()
        .await
        .map_err(|e| AppError::Provider(e.to_string()))?;

    Ok(resp.status().is_success())
}

#[tauri::command]
pub async fn update_settings(
    state: State<'_, AppState>,
    input: UpdateSettingsInput,
) -> Result<(), AppError> {
    // Store API keys in OS keychain
    if let Some(ref key) = input.gemini_api_key {
        if key.is_empty() {
            keystore::delete_key("gemini_api_key");
        } else {
            keystore::store_key("gemini_api_key", key)
                .map_err(|e| AppError::Validation(format!("Failed to store key: {}", e)))?;
        }
    }
    if let Some(ref key) = input.anthropic_api_key {
        if key.is_empty() {
            keystore::delete_key("anthropic_api_key");
        } else {
            keystore::store_key("anthropic_api_key", key)
                .map_err(|e| AppError::Validation(format!("Failed to store key: {}", e)))?;
        }
    }
    if let Some(ref key) = input.openai_api_key {
        if key.is_empty() {
            keystore::delete_key("openai_api_key");
        } else {
            keystore::store_key("openai_api_key", key)
                .map_err(|e| AppError::Validation(format!("Failed to store key: {}", e)))?;
        }
    }

    // Store non-secret settings in SQLite
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;

    let mut sets: Vec<String> = vec!["updated_at = datetime('now')".into()];
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![];

    macro_rules! maybe_set {
        ($field:ident, $col:expr) => {
            if let Some(ref v) = input.$field {
                sets.push(format!("{} = ?", $col));
                params.push(Box::new(v.clone()));
            }
        };
    }

    maybe_set!(display_name, "display_name");
    maybe_set!(organisation, "organisation");
    maybe_set!(ollama_base_url, "ollama_base_url");
    maybe_set!(default_main_model, "default_main_model");
    maybe_set!(default_tabular_model, "default_tabular_model");
    maybe_set!(default_title_model, "default_title_model");

    if let Some(v) = input.onboarding_complete {
        sets.push("onboarding_complete = ?".into());
        params.push(Box::new(v as i32));
    }

    let sql = format!("UPDATE settings SET {} WHERE id = 1", sets.join(", "));
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    db.execute(&sql, param_refs.as_slice())?;

    Ok(())
}
