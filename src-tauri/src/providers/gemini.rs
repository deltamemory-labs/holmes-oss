use async_trait::async_trait;
use reqwest::Client;
use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::traits::{LlmMessage, LlmProvider, StreamChunk, ToolCall};

pub struct GeminiProvider {
    api_key: String,
    model: String,
    client: Client,
}

impl GeminiProvider {
    pub fn new(api_key: String, model: String) -> Self {
        Self {
            api_key,
            model,
            client: Client::new(),
        }
    }

    /// Convert `LlmMessage` history into Gemini's `contents` shape.
    /// Three message variants must round-trip so the model sees its own
    /// prior actions correctly:
    ///   - `{ role: assistant, tool_calls: Some(..) }` → `{ role: model,
    ///      parts: [{ functionCall: { name, args } }, ...] }`
    ///   - `{ role: tool|user, tool_response: Some(..) }` → `{ role: user,
    ///      parts: [{ functionResponse: { name, response: { result } } }] }`
    ///   - otherwise plain text.
    fn build_contents(&self, messages: &[LlmMessage]) -> Vec<Value> {
        let mut out = Vec::new();
        for m in messages {
            // Tool call turn (assistant asking to invoke tools)
            if let Some(calls) = &m.tool_calls {
                let parts: Vec<Value> = calls
                    .iter()
                    .map(|c| {
                        let args: Value = serde_json::from_str(&c.arguments)
                            .unwrap_or_else(|_| json!({}));
                        json!({ "functionCall": { "name": c.name, "args": args } })
                    })
                    .collect();
                out.push(json!({ "role": "model", "parts": parts }));
                continue;
            }

            // Tool response turn (executor returning result to model)
            if let Some(resp) = &m.tool_response {
                let response: Value = serde_json::from_str(&resp.content)
                    .unwrap_or_else(|_| json!({ "result": resp.content }));
                out.push(json!({
                    "role": "user",
                    "parts": [{
                        "functionResponse": { "name": resp.name, "response": response }
                    }]
                }));
                continue;
            }

            // Plain text turn
            let role = if m.role == "assistant" { "model" } else { "user" };
            out.push(json!({ "role": role, "parts": [{ "text": &m.content }] }));
        }
        out
    }
}

#[async_trait]
impl LlmProvider for GeminiProvider {
    async fn stream_chat(
        &self,
        system: &str,
        messages: &[LlmMessage],
        tools: Option<&Value>,
        tx: mpsc::Sender<StreamChunk>,
    ) {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse",
            self.model
        );

        let mut body = json!({
            "system_instruction": { "parts": [{ "text": system }] },
            "contents": self.build_contents(messages),
            "generationConfig": { "temperature": 1.0 }
        });

        if let Some(tool_defs) = tools {
            body["tools"] = tool_defs.clone();
        }

        log::info!("[Gemini] Streaming {} with {} messages", self.model, messages.len());

        let resp = match self.client
            .post(&url)
            .header("x-goog-api-key", &self.api_key)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                log::error!("[Gemini] Request error: {}", e);
                let _ = tx.send(StreamChunk::Error(e.to_string())).await;
                return;
            }
        };

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            log::error!("[Gemini] API error {}: {}", status, &text[..text.len().min(300)]);
            let _ = tx.send(StreamChunk::Error(format!("{}: {}", status, text))).await;
            return;
        }

        // Stream the response bytes incrementally
        let mut full_text = String::new();
        let mut buffer = String::new();

        use futures::StreamExt;
        let mut byte_stream = resp.bytes_stream();

        while let Some(chunk_result) = byte_stream.next().await {
            let chunk = match chunk_result {
                Ok(c) => c,
                Err(e) => {
                    log::error!("[Gemini] Stream error: {}", e);
                    let _ = tx.send(StreamChunk::Error(e.to_string())).await;
                    return;
                }
            };

            buffer.push_str(&String::from_utf8_lossy(&chunk));

            // Process complete SSE events (terminated by \r\n\r\n or \n\n)
            loop {
                // Find the end of an SSE event
                let boundary = if let Some(pos) = buffer.find("\r\n\r\n") {
                    Some((pos, 4))
                } else if let Some(pos) = buffer.find("\n\n") {
                    Some((pos, 2))
                } else {
                    None
                };

                let (pos, skip) = match boundary {
                    Some(b) => b,
                    None => break, // No complete event yet, wait for more data
                };

                let event_block = buffer[..pos].to_string();
                buffer = buffer[pos + skip..].to_string();

                // Parse each line in the event block
                for line in event_block.lines() {
                    let data = match line.strip_prefix("data: ") {
                        Some(d) => d.trim(),
                        None => continue,
                    };

                    if data.is_empty() || data == "[DONE]" {
                        continue;
                    }

                    let parsed: Value = match serde_json::from_str(data) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    if let Some(parts) = parsed["candidates"][0]["content"]["parts"].as_array() {
                        for part in parts {
                            if let Some(fc) = part.get("functionCall") {
                                let call = ToolCall {
                                    id: uuid::Uuid::new_v4().to_string(),
                                    name: fc["name"].as_str().unwrap_or("").to_string(),
                                    arguments: fc["args"].to_string(),
                                };
                                let _ = tx.send(StreamChunk::ToolCalls(vec![call])).await;
                            }
                            if let Some(text) = part["text"].as_str() {
                                full_text.push_str(text);
                                let _ = tx.send(StreamChunk::Delta(text.to_string())).await;
                            }
                        }
                    }
                }
            }
        }

        log::info!("[Gemini] Done, {} chars", full_text.len());
        let _ = tx.send(StreamChunk::Done(full_text)).await;
    }
}
