use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// One turn in a chat history.
///
/// For most turns only `role` + `content` are populated. Two extensions
/// support the agentic tool loop:
///  - `tool_calls` (assistant only): the provider asked to invoke tools.
///    The provider serializes these back into its own wire format on the
///    next round-trip so the model sees its prior call.
///  - `tool_response` (user/tool turn): the result of executing a tool
///    call. The provider serializes this as a `functionResponse` part.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LlmMessage {
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_response: Option<ToolResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    /// JSON-serialized arguments. The executor parses into its typed form.
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResponse {
    pub name: String,
    /// JSON-serialized result. The provider nests this into its wire
    /// format verbatim; the model sees a structured response.
    pub content: String,
}

pub enum StreamChunk {
    Delta(String),
    ToolCalls(Vec<ToolCall>),
    Done(String),
    Error(String),
}

#[async_trait]
pub trait LlmProvider: Send + Sync {
    async fn stream_chat(
        &self,
        system: &str,
        messages: &[LlmMessage],
        tools: Option<&serde_json::Value>,
        tx: tokio::sync::mpsc::Sender<StreamChunk>,
    );
}
