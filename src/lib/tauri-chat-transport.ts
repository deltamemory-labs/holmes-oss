import { invoke, Channel } from "@tauri-apps/api/core";
import { DefaultChatTransport } from "ai";
import type { UIMessage, UIMessageChunk } from "ai";

interface ChatEvent {
  line: string;
}

export interface ToolCallEvent {
  messageId: string;
  callId: string;
  name: string;
  arguments: string;
}

export interface ToolResultEvent {
  messageId: string;
  callId: string;
  name: string;
  ok: boolean;
  result: string;
}

export type ToolActivityListener = (
  kind: "call" | "result",
  payload: ToolCallEvent | ToolResultEvent,
) => void;

/**
 * Extends DefaultChatTransport to bridge Tauri IPC to AI SDK's useChat.
 *
 * In Phase 2 the Rust backend emits two kinds of events:
 *  1. AI SDK protocol events (`text-delta`, `finish`, etc.) — passed
 *     through the SSE stream and parsed by the parent transport.
 *  2. Custom `tool-call` / `tool-result` events — intercepted here and
 *     fanned out to the subscribed listener so the UI can render a
 *     live tool-activity timeline above each assistant message. These
 *     are *not* forwarded to the AI SDK parser, which would otherwise
 *     log unknown event types.
 *
 * Attachments (`fileIds` + `workflowId`) are pushed in via `attachFiles`
 * / `attachWorkflow` before `sendMessage` and consumed on the next call.
 */
export class TauriChatTransport extends DefaultChatTransport<UIMessage> {
  private _model = "gemini-3-flash-preview";
  private _chatId: string | null = null;
  private _projectId: string | undefined = undefined;
  private _pendingFileIds: string[] | null = null;
  private _pendingWorkflowId: string | null = null;
  private _toolListener: ToolActivityListener | null = null;
  private _chatCreatedListener: ((chatId: string) => void) | null = null;

  constructor() {
    super({ api: "tauri://chat" });
  }

  setModel(model: string) {
    this._model = model;
  }

  /** Set to a valid id when resuming an existing chat, or "" to reset. */
  setChatId(chatId: string) {
    this._chatId = chatId || null;
  }

  setProjectId(pid: string | undefined) {
    this._projectId = pid;
  }

  attachFiles(fileIds: string[]) {
    this._pendingFileIds = fileIds.length > 0 ? fileIds : null;
  }

  attachWorkflow(workflowId: string | null) {
    this._pendingWorkflowId = workflowId;
  }

  /** Subscribe to tool-activity events for the PreResponseWrapper. */
  onToolActivity(listener: ToolActivityListener | null) {
    this._toolListener = listener;
  }

  /**
   * Fires once the transport has obtained a chat id — currently only
   * when the first `sendMessages` call had to `create_chat` implicitly.
   * The UI uses this to update the URL from `/` to `/chat/$id` so the
   * first message is linkable and survives a reload.
   */
  onChatCreated(listener: ((chatId: string) => void) | null) {
    this._chatCreatedListener = listener;
  }

  override async sendMessages(options: {
    trigger: "submit-message" | "regenerate-message";
    chatId: string;
    messageId: string | undefined;
    messages: UIMessage[];
    abortSignal: AbortSignal | undefined;
  }): Promise<ReadableStream<UIMessageChunk>> {
    const { messages } = options;

    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    const content =
      lastUserMsg?.parts
        ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n") ?? "";

    if (!content) {
      return new ReadableStream({ start(c) { c.close(); } });
    }

    if (!this._chatId) {
      const chat = await invoke<{ id: string }>("create_chat", { projectId: this._projectId });
      this._chatId = chat.id;
      // Notify UI so it can update the URL to /chat/$id.
      this._chatCreatedListener?.(chat.id);
    }

    const chatId = this._chatId;
    const model = this._model;
    const fileIds = this._pendingFileIds;
    const workflowId = this._pendingWorkflowId;
    this._pendingFileIds = null;
    this._pendingWorkflowId = null;
    const toolListener = this._toolListener;

    const encoder = new TextEncoder();
    const byteStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const channel = new Channel<ChatEvent>();
        channel.onmessage = (event: ChatEvent) => {
          // Peek at the event type. Custom tool events are siphoned off
          // here so the AI SDK SSE parser never sees them.
          let parsed: Record<string, unknown> | null = null;
          try {
            parsed = JSON.parse(event.line) as Record<string, unknown>;
          } catch {
            parsed = null;
          }

          if (parsed && parsed.type === "tool-call" && toolListener) {
            toolListener("call", {
              messageId: String(parsed.messageId ?? ""),
              callId: String(parsed.callId ?? ""),
              name: String(parsed.name ?? ""),
              arguments: String(parsed.arguments ?? ""),
            });
            return;
          }
          if (parsed && parsed.type === "tool-result" && toolListener) {
            toolListener("result", {
              messageId: String(parsed.messageId ?? ""),
              callId: String(parsed.callId ?? ""),
              name: String(parsed.name ?? ""),
              ok: Boolean(parsed.ok),
              result: String(parsed.result ?? ""),
            });
            return;
          }

          // Everything else is forwarded as an SSE line.
          controller.enqueue(encoder.encode(`data: ${event.line}\n\n`));
          if (parsed && parsed.type === "finish") {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          }
        };

        invoke<void>("send_message", {
          chatId,
          content,
          model,
          fileIds,
          workflowId,
          onEvent: channel,
        }).catch((err: unknown) => {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", errorText: String(err) })}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        });
      },
    });

    return this.processResponseStream(byteStream);
  }

  override async reconnectToStream() {
    return null;
  }
}
