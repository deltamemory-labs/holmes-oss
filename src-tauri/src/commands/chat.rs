use serde::Serialize;
use tauri::{ipc::Channel, State};
use uuid::Uuid;

use crate::error::AppError;
use crate::memory;
use crate::providers::{GeminiProvider, LlmMessage, LlmProvider, OllamaProvider, StreamChunk};
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chat {
    pub id: String,
    pub project_id: Option<String>,
    pub title: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub chat_id: String,
    pub role: String,
    pub content: Option<String>,
    /// JSON array of `{ document_id, filename }` attached to this message.
    pub files: Option<String>,
    pub annotations: Option<String>,
    pub created_at: String,
}

/// Each event is a raw SSE line following the AI SDK data stream protocol.
/// The frontend reads these with the AI SDK's UIMessageStream reader.
#[derive(Clone, Serialize)]
pub struct ChatEvent {
    pub line: String,
}

#[tauri::command]
pub async fn create_chat(
    state: State<'_, AppState>,
    project_id: Option<String>,
) -> Result<Chat, AppError> {
    let id = Uuid::new_v4().to_string();
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    db.execute(
        "INSERT INTO chats (id, project_id) VALUES (?1, ?2)",
        rusqlite::params![id, project_id],
    )?;
    Ok(Chat {
        id,
        project_id,
        title: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub async fn list_chats(
    state: State<'_, AppState>,
    project_id: Option<String>,
) -> Result<Vec<Chat>, AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    let mut stmt = if project_id.is_some() {
        db.prepare(
            "SELECT id, project_id, title, created_at FROM chats WHERE project_id = ?1 ORDER BY created_at DESC",
        )?
    } else {
        db.prepare("SELECT id, project_id, title, created_at FROM chats ORDER BY created_at DESC")?
    };

    let params: Vec<Box<dyn rusqlite::types::ToSql>> = if let Some(ref pid) = project_id {
        vec![Box::new(pid.clone())]
    } else {
        vec![]
    };
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let chats = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok(Chat {
                id: row.get(0)?,
                project_id: row.get(1)?,
                title: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(chats)
}

#[tauri::command]
pub async fn get_chat(state: State<'_, AppState>, chat_id: String) -> Result<Chat, AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    let chat = db
        .query_row(
            "SELECT id, project_id, title, created_at FROM chats WHERE id = ?1",
            [&chat_id],
            |row| {
                Ok(Chat {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    title: row.get(2)?,
                    created_at: row.get(3)?,
                })
            },
        )
        .map_err(|_| AppError::NotFound(format!("chat {} not found", chat_id)))?;
    Ok(chat)
}

#[tauri::command]
pub async fn get_chat_messages(
    state: State<'_, AppState>,
    chat_id: String,
) -> Result<Vec<ChatMessage>, AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    let mut stmt = db.prepare(
        "SELECT id, chat_id, role, content, files, annotations, created_at
         FROM chat_messages WHERE chat_id = ?1 ORDER BY created_at ASC",
    )?;

    let msgs = stmt
        .query_map([&chat_id], |row| {
            Ok(ChatMessage {
                id: row.get(0)?,
                chat_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                files: row.get(4)?,
                annotations: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(msgs)
}

#[tauri::command]
pub async fn delete_chat(state: State<'_, AppState>, chat_id: String) -> Result<(), AppError> {
    let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
    db.execute("DELETE FROM chats WHERE id = ?1", [&chat_id])?;
    Ok(())
}

const SYSTEM_PROMPT: &str = r#"You are Holmes, an AI legal assistant that helps lawyers analyze documents, answer legal questions, and draft legal documents.

TOOL USAGE STRATEGY:
- For projects with more than a handful of documents, call `search_documents` FIRST with a tight query to find the most relevant passages. It's BM25-scored across every doc in the project and returns document_id + page + snippet for each hit.
- Once you know which document to focus on, use `read_document` for the full text or `find_in_document` for targeted look-ups within it.
- `list_project_docs` is only worth calling when the user asks what documents exist or you need to disambiguate a reference.

DOCUMENT CITATION INSTRUCTIONS:
When you reference specific content from a document, place a numbered marker [1], [2], etc. inline in your prose at the point of reference.

After your complete response, append a <CITATIONS> block containing a JSON array:

<CITATIONS>
[
  {"ref": 1, "doc_id": "<uuid>", "page": 3, "quote": "exact verbatim text from the document"}
]
</CITATIONS>

Rules:
- `doc_id` MUST be the `id` shown next to each document in the DOCUMENTS section, or the `document_id` returned by the `list_project_docs` / `search_documents` / `read_document` / `find_in_document` tools. It is a UUID like 1b2f3c... — never `doc-0` or `doc-1`.
- Only cite text that appears verbatim in the source
- Keep quotes short (ideally 25 words or less)
- `page` refers to the sequential [Page N] marker in the text (1-indexed). Omit the field for non-PDF sources.
- Omit the <CITATIONS> block entirely if there are no citations
- Be precise and professional
- Do not fabricate document content"#;

#[tauri::command]
pub async fn send_message(
    state: State<'_, AppState>,
    chat_id: String,
    content: String,
    model: String,
    // Optional list of document IDs attached to this user message.
    // Attached docs are loaded into the context first; the rest of the
    // project's docs still follow so the assistant can cross-reference.
    file_ids: Option<Vec<String>>,
    // Optional workflow whose prompt is prepended to the user's message as
    // a system-level instruction.
    workflow_id: Option<String>,
    on_event: Channel<ChatEvent>,
) -> Result<(), AppError> {
    // Get API key and history
    let (api_key, history) = {
        let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;

        let api_key = crate::commands::settings::get_api_key("gemini_api_key");

        // Save user message with attached files
        let msg_id = Uuid::new_v4().to_string();

        // Encode attachments as `[{ document_id, filename }]` JSON so the UI
        // can render them as chips when rehydrating the chat.
        let files_json: Option<String> = if let Some(ref ids) = file_ids {
            if ids.is_empty() {
                None
            } else {
                // Fetch filenames so the UI doesn't need a second round-trip.
                let placeholders: Vec<String> = (1..=ids.len()).map(|i| format!("?{}", i)).collect();
                let sql = format!(
                    "SELECT id, filename FROM documents WHERE id IN ({})",
                    placeholders.join(",")
                );
                let mut stmt = db.prepare(&sql)?;
                let params: Vec<&dyn rusqlite::types::ToSql> =
                    ids.iter().map(|s| s as &dyn rusqlite::types::ToSql).collect();
                let mapped: Vec<serde_json::Value> = stmt
                    .query_map(params.as_slice(), |row| {
                        let id: String = row.get(0)?;
                        let filename: String = row.get(1)?;
                        Ok(serde_json::json!({ "document_id": id, "filename": filename }))
                    })?
                    .filter_map(|r| r.ok())
                    .collect();
                Some(serde_json::Value::Array(mapped).to_string())
            }
        } else {
            None
        };

        db.execute(
            "INSERT INTO chat_messages (id, chat_id, role, content, files) VALUES (?1, ?2, 'user', ?3, ?4)",
            rusqlite::params![msg_id, chat_id, content, files_json],
        )?;

        // Load history
        let mut stmt = db.prepare(
            "SELECT role, content FROM chat_messages WHERE chat_id = ?1 ORDER BY created_at ASC",
        )?;
        let history: Vec<LlmMessage> = stmt
            .query_map([&chat_id], |row| {
                Ok(LlmMessage {
                    role: row.get::<_, String>(0)?,
                    content: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    ..Default::default()
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        (api_key, history)
    };

    // Pick the provider based on the model id. Anything prefixed `ollama:`
    // routes to a local Ollama server; everything else is currently Gemini.
    // Each branch loads only the credentials/config it actually needs so a
    // user without a Gemini key can still chat with a local model.
    enum ProviderKind {
        Gemini { api_key: String },
        Ollama { base_url: String, model: String },
    }

    let provider_kind: ProviderKind = if let Some(local_model) = model.strip_prefix("ollama:") {
        let base_url = {
            let db = state
                .db
                .lock()
                .map_err(|e| AppError::Validation(e.to_string()))?;
            db.query_row(
                "SELECT ollama_base_url FROM settings WHERE id = 1",
                [],
                |row| row.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten()
            .unwrap_or_else(|| "http://localhost:11434".into())
        };
        ProviderKind::Ollama {
            base_url,
            model: local_model.to_string(),
        }
    } else {
        // Gemini (or any future hosted provider). The key was loaded above
        // alongside the chat history; bail loudly if it's missing.
        let key = api_key
            .clone()
            .ok_or_else(|| AppError::Validation("No Gemini API key configured".into()))?;
        ProviderKind::Gemini { api_key: key }
    };

    // Some downstream paths (memory observer/reflector) still assume a
    // Gemini key. They'll just no-op when it's absent for Ollama-only users.
    let gemini_key_for_memory = api_key.clone();

    // Optionally load the workflow prompt so the assistant follows it for
    // this message. Stored verbatim on the chat via the system prompt.
    let workflow_prompt: Option<String> = if let Some(ref wid) = workflow_id {
        let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
        db.query_row(
            "SELECT prompt_md FROM workflows WHERE id = ?1",
            [wid],
            |r| r.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
    } else {
        None
    };

    // Build system prompt with observation context + document context
    let (observation_context, document_context) = {
        let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
        let obs = memory::context::build_stable_prefix(&db);

        // Load project documents if this chat belongs to a project
        let project_id: Option<String> = db
            .query_row("SELECT project_id FROM chats WHERE id = ?1", [&chat_id], |r| r.get(0))
            .ok()
            .flatten();

        let mut doc_text = String::new();
        if let Some(ref pid) = project_id {
            let mut stmt = db.prepare(
                "SELECT d.id, d.filename, d.file_type, dv.storage_path
                 FROM documents d
                 JOIN document_versions dv ON dv.id = d.current_version_id
                 WHERE d.project_id = ?1 AND d.status = 'ready'"
            ).unwrap();

            let docs: Vec<(String, String, Option<String>, String)> = stmt
                .query_map([pid], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();

            // Sort: attached docs first (if any), then the rest, so the
            // assistant's prompt cache is dominated by the focused docs.
            let attached: std::collections::HashSet<String> = file_ids
                .as_ref()
                .map(|ids| ids.iter().cloned().collect())
                .unwrap_or_default();

            let mut ordered: Vec<_> = docs.clone();
            ordered.sort_by_key(|(id, _, _, _)| !attached.contains(id));

            for (_i, (doc_id, filename, file_type, storage_path)) in ordered.iter().enumerate() {
                let bytes = std::fs::read(storage_path).unwrap_or_default();
                let text = match file_type.as_deref() {
                    Some("pdf") => crate::documents::extract::extract_pdf_text(&bytes).unwrap_or_default(),
                    Some("docx") => crate::documents::extract::extract_docx_text(&bytes).unwrap_or_default(),
                    _ => String::from_utf8_lossy(&bytes).to_string(),
                };
                if !text.is_empty() {
                    // Emit the real UUID so the model cites by id the UI can
                    // look up directly in `listDocuments()`.
                    doc_text.push_str(&format!(
                        "\n---\nid: {}\nfilename: {}\n{}\n",
                        doc_id,
                        filename,
                        &text[..text.len().min(200_000)]
                    ));
                }
            }
        }

        (obs, doc_text)
    };

    let mut system = SYSTEM_PROMPT.to_string();
    if !observation_context.is_empty() {
        system.push_str(&format!("\n\n---\n\n{}", observation_context));
    }
    if let Some(ref wf) = workflow_prompt {
        system.push_str(&format!(
            "\n\n---\nWORKFLOW INSTRUCTION (attached by the user to this message):\n{}\n",
            wf
        ));
    }
    if !document_context.is_empty() {
        system.push_str(&format!(
            "\n\n---\nDOCUMENTS IN THIS PROJECT:\nThe following documents are loaded. Use them to answer questions. Cite with [N] markers.\n{}",
            document_context
        ));
    }

    // Project id for tool execution scope
    let project_id_for_tools: Option<String> = {
        let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
        db.query_row(
            "SELECT project_id FROM chats WHERE id = ?1",
            [&chat_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
    };

    let text_id = Uuid::new_v4().to_string();
    let assistant_msg_id = Uuid::new_v4().to_string();

    // start message + start text block (text block stays open across all tool
    // turns; the AI SDK happily concatenates delta chunks from the same id).
    let _ = on_event.send(ChatEvent {
        line: serde_json::json!({"type":"start","messageId":&assistant_msg_id}).to_string(),
    });
    let _ = on_event.send(ChatEvent {
        line: serde_json::json!({"type":"text-start","id":&text_id}).to_string(),
    });

    // Mutable history for the agent loop. Starts with the stored text turns;
    // each tool turn appends an assistant-tool-call record and a tool-response
    // record so the next provider call sees its full trail.
    let mut agent_history = history.clone();
    let mut full_text = String::new();
    let tools_json = crate::tools::tool_definitions();

    // Bound turns — a runaway model that keeps firing tools would otherwise
    // hammer the API and the user's bill.
    const MAX_TOOL_TURNS: usize = 6;
    let mut streaming_failed = false;

    for turn in 0..=MAX_TOOL_TURNS {
        let provider: Box<dyn LlmProvider> = match &provider_kind {
            ProviderKind::Gemini { api_key } => {
                Box::new(GeminiProvider::new(api_key.clone(), model.clone()))
            }
            ProviderKind::Ollama { base_url, model } => {
                Box::new(OllamaProvider::new(base_url.clone(), model.clone()))
            }
        };
        let (tx, mut rx) = tokio::sync::mpsc::channel::<StreamChunk>(64);

        let history_clone = agent_history.clone();
        let system_clone = system.clone();
        let tools_clone = tools_json.clone();

        tokio::spawn(async move {
            provider
                .stream_chat(&system_clone, &history_clone, Some(&tools_clone), tx)
                .await;
        });

        let mut turn_text = String::new();
        let mut turn_tool_calls: Vec<crate::providers::ToolCall> = Vec::new();

        while let Some(chunk) = rx.recv().await {
            match chunk {
                StreamChunk::Delta(text) => {
                    turn_text.push_str(&text);
                    let _ = on_event.send(ChatEvent {
                        line: serde_json::json!({
                            "type":"text-delta","id":&text_id,"delta":&text
                        }).to_string(),
                    });
                }
                StreamChunk::ToolCalls(calls) => {
                    for c in &calls {
                        // Announce the call to the UI so the PreResponseWrapper
                        // can render "Reading NDA.pdf..." live.
                        let _ = on_event.send(ChatEvent {
                            line: serde_json::json!({
                                "type":"tool-call",
                                "messageId":&assistant_msg_id,
                                "callId":&c.id,
                                "name":&c.name,
                                "arguments":&c.arguments,
                            }).to_string(),
                        });
                    }
                    turn_tool_calls.extend(calls);
                }
                StreamChunk::Done(text) => {
                    if !text.is_empty() && turn_text.is_empty() {
                        turn_text = text.clone();
                        let _ = on_event.send(ChatEvent {
                            line: serde_json::json!({
                                "type":"text-delta","id":&text_id,"delta":&text
                            }).to_string(),
                        });
                    }
                    break;
                }
                StreamChunk::Error(msg) => {
                    let _ = on_event.send(ChatEvent {
                        line: serde_json::json!({"type":"error","errorText":&msg}).to_string(),
                    });
                    streaming_failed = true;
                    break;
                }
            }
        }

        full_text.push_str(&turn_text);

        if streaming_failed {
            break;
        }

        if turn_tool_calls.is_empty() {
            // Model is done — no more tools wanted.
            break;
        }

        if turn == MAX_TOOL_TURNS {
            // Model still wants to call tools but we're out of budget.
            let _ = on_event.send(ChatEvent {
                line: serde_json::json!({
                    "type":"text-delta",
                    "id":&text_id,
                    "delta":"\n\n[Tool budget exhausted. Stopping.]",
                }).to_string(),
            });
            break;
        }

        // Append the assistant's tool-call turn to history so the next call
        // round-trips the function call correctly.
        agent_history.push(crate::providers::LlmMessage {
            role: "assistant".into(),
            content: turn_text.clone(),
            tool_calls: Some(turn_tool_calls.clone()),
            tool_response: None,
        });

        // Execute each call synchronously — tools are cheap (SQLite + local
        // files) and running them serially keeps the UX deterministic.
        for call in &turn_tool_calls {
            let result = {
                let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
                crate::tools::execute_tool(
                    &db,
                    state.search.as_ref(),
                    project_id_for_tools.as_deref(),
                    &call.name,
                    &call.arguments,
                )
            };

            let (response_json, ok) = match result {
                Ok(v) => (v.to_string(), true),
                Err(e) => (
                    serde_json::json!({ "error": e }).to_string(),
                    false,
                ),
            };

            let _ = on_event.send(ChatEvent {
                line: serde_json::json!({
                    "type":"tool-result",
                    "messageId":&assistant_msg_id,
                    "callId":&call.id,
                    "name":&call.name,
                    "ok":ok,
                    "result":&response_json,
                }).to_string(),
            });

            agent_history.push(crate::providers::LlmMessage {
                role: "tool".into(),
                content: String::new(),
                tool_calls: None,
                tool_response: Some(crate::providers::ToolResponse {
                    name: call.name.clone(),
                    content: response_json,
                }),
            });
        }
        // Loop back and let the model continue with the tool responses in scope.
    }

    if streaming_failed {
        return Ok(());
    }

    // end text block
    let _ = on_event.send(ChatEvent {
        line: serde_json::json!({"type":"text-end","id":&text_id}).to_string(),
    });
    // finish
    let _ = on_event.send(ChatEvent {
        line: serde_json::json!({"type":"finish"}).to_string(),
    });

    // Save assistant message
    {
        let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
        let msg_id = Uuid::new_v4().to_string();
        db.execute(
            "INSERT INTO chat_messages (id, chat_id, role, content) VALUES (?1, ?2, 'assistant', ?3)",
            rusqlite::params![msg_id, chat_id, full_text],
        )?;

        // Auto-title if first exchange
        let count: i32 = db.query_row(
            "SELECT COUNT(*) FROM chat_messages WHERE chat_id = ?1",
            [&chat_id],
            |r| r.get(0),
        )?;
        if count <= 2 {
            let title = content.chars().take(60).collect::<String>();
            db.execute(
                "UPDATE chats SET title = ?1 WHERE id = ?2",
                rusqlite::params![title, chat_id],
            )?;
        }
    }

    // Background: run Observer on the conversation
    let api_key_clone = gemini_key_for_memory.clone();
    let content_for_obs = format!("User: {}\nAssistant: {}", content, full_text);
    let project_id_obs = {
        let db = state.db.lock().map_err(|e| AppError::Validation(e.to_string()))?;
        db.query_row(
            "SELECT project_id FROM chats WHERE id = ?1",
            [&chat_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
    };
    let state_clone = state.inner().clone();
    let used_local_provider = matches!(provider_kind, ProviderKind::Ollama { .. });
    tokio::spawn(async move {
        // Memory pipeline still relies on Gemini. Skip cleanly if the user
        // is on Ollama-only — observations just won't accrue this turn.
        // We also skip when the active chat ran on a local model: the
        // observer would otherwise round-trip the conversation to Gemini
        // even though the user explicitly chose a local provider.
        if used_local_provider {
            return;
        }
        let Some(api_key_clone) = api_key_clone else { return };

        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let observations = memory::observer::observe(
            &api_key_clone,
            &content_for_obs,
            project_id_obs.as_deref(),
            &today,
        )
        .await;

        // Store observations
        if let Ok(db) = state_clone.db.lock() {
            for obs in &observations {
                memory::observations::store(&db, obs).ok();
            }
        }

        // Check if reflection is needed (separate lock scope)
        let (needs_reflect, all_obs, reflect_key) = {
            if let Ok(db) = state_clone.db.lock() {
                let all = memory::observations::load_all(&db, None);
                let needs = memory::reflector::needs_reflection(&all);
                let key = crate::commands::settings::get_api_key("gemini_api_key");
                (needs, all, key)
            } else {
                (false, vec![], None)
            }
        };

        if needs_reflect {
            if let Some(key) = reflect_key {
                let reflected = memory::reflector::reflect(&key, &all_obs, &today).await;
                if let Ok(db) = state_clone.db.lock() {
                    memory::observations::replace_all(&db, &reflected).ok();
                }
            }
        }
    });

    Ok(())
}
