// Ollama provider: streams from a local /api/chat endpoint.
//
// Wire format reference: https://github.com/ollama/ollama/blob/main/docs/api.md
//
// Notes worth keeping in mind:
//  - Ollama returns NDJSON, not SSE. Each line is a complete JSON object.
//  - Tool calling is OpenAI-shaped (`tools: [{type:"function", function:{...}}]`)
//    rather than Gemini-shaped, so we convert on the way in.
//  - Some models stream partial `tool_calls` arrays; others only emit them
//    once at the end (`done: true`). We handle both by accumulating until
//    the stream closes.

use async_trait::async_trait;
use reqwest::Client;
use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::traits::{LlmMessage, LlmProvider, StreamChunk, ToolCall};

pub struct OllamaProvider {
    base_url: String,
    model: String,
    client: Client,
}

impl OllamaProvider {
    pub fn new(base_url: String, model: String) -> Self {
        let trimmed = base_url.trim_end_matches('/').to_string();
        Self {
            base_url: trimmed,
            model,
            client: Client::new(),
        }
    }

    /// Convert our internal `LlmMessage` history into Ollama's role-based
    /// chat messages. Tool calls and tool responses round-trip so the
    /// model sees its prior actions and their results.
    fn build_messages(messages: &[LlmMessage]) -> Vec<Value> {
        let mut out = Vec::with_capacity(messages.len());
        for m in messages {
            // Assistant tool-call turn
            if let Some(calls) = &m.tool_calls {
                let tool_calls: Vec<Value> = calls
                    .iter()
                    .map(|c| {
                        let args: Value = serde_json::from_str(&c.arguments)
                            .unwrap_or_else(|_| json!({}));
                        json!({
                            "function": { "name": c.name, "arguments": args }
                        })
                    })
                    .collect();
                out.push(json!({
                    "role": "assistant",
                    "content": m.content,
                    "tool_calls": tool_calls,
                }));
                continue;
            }

            // Tool response turn
            if let Some(resp) = &m.tool_response {
                // Ollama wants the tool result as a string in `content`.
                out.push(json!({
                    "role": "tool",
                    "name": resp.name,
                    "content": resp.content,
                }));
                continue;
            }

            // Plain text turn — keep our role labels (user/assistant/system).
            let role = match m.role.as_str() {
                "assistant" => "assistant",
                "system" => "system",
                _ => "user",
            };
            out.push(json!({ "role": role, "content": m.content }));
        }
        out
    }

    /// Convert Gemini-shaped tool definitions into the OpenAI-shaped form
    /// Ollama expects. The chat command emits the Gemini shape because it
    /// was the only provider; rather than duplicate the schemas we adapt
    /// at the boundary.
    fn convert_tools(tools: &Value) -> Vec<Value> {
        // Input shape: `[{ functionDeclarations: [{ name, description, parameters }] }]`
        // Output shape: `[{ type: "function", function: { name, description, parameters } }]`
        let Some(arr) = tools.as_array() else { return vec![] };
        let mut out = Vec::new();
        for entry in arr {
            let Some(decls) = entry.get("functionDeclarations").and_then(|d| d.as_array()) else {
                continue;
            };
            for d in decls {
                out.push(json!({
                    "type": "function",
                    "function": {
                        "name": d.get("name").cloned().unwrap_or(Value::Null),
                        "description": d.get("description").cloned().unwrap_or(Value::Null),
                        "parameters": d.get("parameters").cloned().unwrap_or(json!({"type":"object","properties":{}})),
                    }
                }));
            }
        }
        out
    }
}

#[async_trait]
impl LlmProvider for OllamaProvider {
    async fn stream_chat(
        &self,
        system: &str,
        messages: &[LlmMessage],
        tools: Option<&Value>,
        tx: mpsc::Sender<StreamChunk>,
    ) {
        let url = format!("{}/api/chat", self.base_url);

        // Prepend the system prompt as the first message rather than using a
        // separate field — Ollama expects it inline.
        let mut chat_messages = Vec::with_capacity(messages.len() + 1);
        if !system.is_empty() {
            chat_messages.push(json!({ "role": "system", "content": system }));
        }
        chat_messages.extend(Self::build_messages(messages));

        let mut body = json!({
            "model": self.model,
            "messages": chat_messages,
            "stream": true,
            "options": { "temperature": 1.0 },
        });

        if let Some(tool_defs) = tools {
            let converted = Self::convert_tools(tool_defs);
            if !converted.is_empty() {
                body["tools"] = Value::Array(converted);
            }
        }

        log::info!(
            "[Ollama] Streaming {} via {} with {} messages",
            self.model,
            self.base_url,
            messages.len()
        );

        let resp = match self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                log::error!("[Ollama] Request error: {}", e);
                let _ = tx
                    .send(StreamChunk::Error(format!(
                        "Could not reach Ollama at {}: {}",
                        self.base_url, e
                    )))
                    .await;
                return;
            }
        };

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            log::error!(
                "[Ollama] API error {}: {}",
                status,
                &text[..text.len().min(300)]
            );
            let _ = tx
                .send(StreamChunk::Error(format!("{}: {}", status, text)))
                .await;
            return;
        }

        let mut full_text = String::new();
        let mut buffer = String::new();
        // Tool calls can stream across multiple chunks or only show up at the
        // last one. Accumulate and emit on `done`.
        let mut pending_tool_calls: Vec<ToolCall> = Vec::new();

        use futures::StreamExt;
        let mut byte_stream = resp.bytes_stream();

        while let Some(chunk_result) = byte_stream.next().await {
            let chunk = match chunk_result {
                Ok(c) => c,
                Err(e) => {
                    log::error!("[Ollama] Stream error: {}", e);
                    let _ = tx.send(StreamChunk::Error(e.to_string())).await;
                    return;
                }
            };
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            // NDJSON: split on newlines, keep the trailing partial line.
            while let Some(nl) = buffer.find('\n') {
                let line = buffer[..nl].trim().to_string();
                buffer = buffer[nl + 1..].to_string();
                if line.is_empty() {
                    continue;
                }

                let parsed: Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                if let Some(err) = parsed.get("error").and_then(|e| e.as_str()) {
                    let _ = tx.send(StreamChunk::Error(err.to_string())).await;
                    return;
                }

                let message = parsed.get("message");

                if let Some(msg) = message {
                    if let Some(text) = msg.get("content").and_then(|c| c.as_str()) {
                        if !text.is_empty() {
                            full_text.push_str(text);
                            let _ = tx.send(StreamChunk::Delta(text.to_string())).await;
                        }
                    }

                    if let Some(calls) = msg.get("tool_calls").and_then(|c| c.as_array()) {
                        for c in calls {
                            let func = c.get("function").cloned().unwrap_or(Value::Null);
                            let name = func
                                .get("name")
                                .and_then(|n| n.as_str())
                                .unwrap_or("")
                                .to_string();
                            // `arguments` may be a JSON object or a JSON-encoded string.
                            let arguments = match func.get("arguments") {
                                Some(Value::String(s)) => s.clone(),
                                Some(other) => other.to_string(),
                                None => "{}".into(),
                            };
                            pending_tool_calls.push(ToolCall {
                                id: uuid::Uuid::new_v4().to_string(),
                                name,
                                arguments,
                            });
                        }
                    }
                }

                if parsed.get("done").and_then(|v| v.as_bool()) == Some(true) {
                    if !pending_tool_calls.is_empty() {
                        let calls = std::mem::take(&mut pending_tool_calls);
                        let _ = tx.send(StreamChunk::ToolCalls(calls)).await;
                    }
                    log::info!("[Ollama] Done, {} chars", full_text.len());
                    let _ = tx.send(StreamChunk::Done(full_text.clone())).await;
                    return;
                }
            }
        }

        // Stream ended without a `done` line. Flush whatever we have.
        if !pending_tool_calls.is_empty() {
            let calls = std::mem::take(&mut pending_tool_calls);
            let _ = tx.send(StreamChunk::ToolCalls(calls)).await;
        }
        let _ = tx.send(StreamChunk::Done(full_text)).await;
    }
}
