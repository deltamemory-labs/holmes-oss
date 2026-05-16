import { useState, useRef, useEffect, useMemo } from "react";
import {
  ArrowRight,
  Square,
  Bot,
  User,
  Sparkles,
  FolderOpen,
  Paperclip,
  Zap,
  X,
  FileText,
  File as FileIcon,
  Check,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import type { UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TauriChatTransport } from "@/lib/tauri-chat-transport";
import { Dropdown } from "@/components/ui/Dropdown";
import { api, type Project, type Document, type Workflow } from "@/lib/tauri";
import { InitialView } from "@/components/shared/InitialView";
import {
  PreResponseWrapper,
  type ToolActivity,
} from "@/components/chat/PreResponseWrapper";

import { parseCitations, stripCitations, type Citation } from "@/lib/citations";

interface ModelOption {
  value: string;
  label: string;
}

const GEMINI_MODELS: ModelOption[] = [
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
  { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
  { value: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite" },
];

/**
 * Prompt chips shown on the empty chat state. Rendered as an auto-
 * scrolling marquee under the composer — a wide editorial list reads
 * closer to Cohere's taxonomy-chip rhythm than a static 2x2 grid.
 */
const SUGGESTIONS: { text: string; sub: string }[] = [
  { text: "Summarize this agreement", sub: "Get a quick overview" },
  { text: "What are the key obligations?", sub: "Identify duties & deadlines" },
  { text: "Find the termination clause", sub: "Search across documents" },
  { text: "Compare these contracts", sub: "Side-by-side analysis" },
  { text: "Extract defined terms", sub: "Pull glossary from a contract" },
  { text: "List payment obligations", sub: "Surface money-moving clauses" },
  { text: "What governing law applies?", sub: "Jurisdiction & venue" },
  { text: "Who are the parties?", sub: "Counterparty overview" },
];

interface Props {
  projectId?: string;
  chatId?: string;
  onCitationClick?: (citation: Citation) => void;
  /** Fires whenever the active project context changes (user picks a project, or chat hydration infers one). */
  onProjectChange?: (projectId: string | undefined) => void;
}

export function ChatView({ projectId: initialProjectId, chatId, onCitationClick, onProjectChange }: Props) {
  const navigate = useNavigate();
  const [model, setModel] = useState<string>(GEMINI_MODELS[0].value);
  const [ollamaModels, setOllamaModels] = useState<ModelOption[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | undefined>(initialProjectId);
  const [projectDocs, setProjectDocs] = useState<Document[]>([]);
  const [attachedDocs, setAttachedDocs] = useState<Document[]>([]);
  const [attachedWorkflow, setAttachedWorkflow] = useState<Workflow | null>(null);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [showDocPicker, setShowDocPicker] = useState(false);
  const [showWorkflowPicker, setShowWorkflowPicker] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  /**
   * Tool activity keyed by messageId. The backend emits the assistant
   * messageId it started the turn with, so each assistant message in the
   * rendered list gets its own timeline.
   */
  const [toolActivity, setToolActivity] = useState<Record<string, ToolActivity[]>>({});
  /**
   * The id of the assistant message currently streaming. The backend's
   * tool events carry this id, but we also need it on the client so the
   * PreResponseWrapper can show a "working" state against the latest
   * (not-yet-rendered) assistant message.
   */
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);

  const transport = useMemo(() => new TauriChatTransport(), []);

  useEffect(() => {
    transport.setModel(model);
  }, [model, transport]);

  // Keep the transport's project context in sync with the picker. Unlike
  // the earlier version we DO NOT reset chatId here — that was wiping the
  // chatId prop passed in from the route and causing old chats to look
  // empty when reopened.
  useEffect(() => {
    transport.setProjectId(selectedProject);
    onProjectChange?.(selectedProject);
  }, [selectedProject, transport, onProjectChange]);

  useEffect(() => {
    api.listProjects().then(setProjects);
  }, []);

  // Hydrate model picker from settings and discover any installed Ollama
  // models so the user can pick a local model right from the chat bar.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await api.getSettings();
        if (!cancelled && settings.defaultMainModel) {
          setModel(settings.defaultMainModel);
        }
        const list = await api.listOllamaModels();
        if (!cancelled) {
          setOllamaModels(
            list.map((m) => ({ value: `ollama:${m.name}`, label: `Ollama · ${m.name}` })),
          );
        }
      } catch {
        // Ollama not running is fine — the dropdown just falls back to hosted models.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Combined options shown in the chat composer dropdown. If the saved
  // default isn't represented (e.g. an Ollama model that's no longer
  // installed), surface it so the user can see what's selected.
  const modelOptions = useMemo<ModelOption[]>(() => {
    const opts: ModelOption[] = [...GEMINI_MODELS, ...ollamaModels];
    if (!opts.some((o) => o.value === model)) {
      opts.push({ value: model, label: model });
    }
    return opts;
  }, [ollamaModels, model]);

  useEffect(() => {
    api.listWorkflows().then(setWorkflows);
  }, []);

  useEffect(() => {
    if (selectedProject) {
      api.listDocuments(selectedProject).then(setProjectDocs);
    } else {
      setProjectDocs([]);
    }
  }, [selectedProject]);

  // Navigate to /chat/$id once the first user message has implicitly
  // created a chat via the transport, so the URL is linkable.
  useEffect(() => {
    transport.onChatCreated((newId) => {
      // Mark this chatId as already-hydrated so the effect that runs on
      // the route change doesn't refetch and clobber our streaming state.
      lastHydratedChatId.current = newId;
      if (!chatId) {
        navigate({ to: "/chat/$id", params: { id: newId } }).catch(() => { });
      }
    });
    return () => {
      transport.onChatCreated(null);
    };
  }, [transport, chatId, navigate]);

  // Subscribe to tool activity emitted by the backend. We update per
  // messageId so each assistant message keeps its own step list.
  useEffect(() => {
    transport.onToolActivity((kind, payload) => {
      setStreamingMessageId(payload.messageId);
      setToolActivity((prev) => {
        const next = { ...prev };
        const list = next[payload.messageId] ? [...next[payload.messageId]] : [];

        if (kind === "call") {
          list.push({
            callId: payload.callId,
            name: payload.name,
            arguments: (payload as { arguments: string }).arguments,
            state: "running",
          });
        } else {
          const p = payload as { callId: string; ok: boolean; result: string };
          const idx = list.findIndex((a) => a.callId === p.callId);
          if (idx >= 0) {
            list[idx] = {
              ...list[idx],
              state: p.ok ? "done" : "error",
              ok: p.ok,
              result: p.result,
            };
          }
        }

        next[payload.messageId] = list;
        return next;
      });
    });
    return () => {
      transport.onToolActivity(null);
    };
  }, [transport]);

  const { messages, sendMessage, status, setMessages } = useChat({ transport });
  const isLoading = status === "streaming" || status === "submitted";

  // Tracks the last chatId we hydrated from the backend. Used to skip
  // hydration when the id change came from our own `onChatCreated` path
  // (streaming state is already in memory and would be clobbered by a
  // backend reload mid-stream).
  const lastHydratedChatId = useRef<string | null>(null);

  // When the route provides a chatId (e.g. user clicked an entry in the
  // sidebar), hydrate the transcript and sync the transport + project
  // context so the next send lands on the same chat row.
  useEffect(() => {
    let cancelled = false;

    if (!chatId) {
      // Fresh composer — reset both the transport and the rendered messages
      // so we don't leak an earlier conversation into /.
      transport.setChatId("");
      setMessages([]);
      setToolActivity({});
      setStreamingMessageId(null);
      lastHydratedChatId.current = null;
      return;
    }

    transport.setChatId(chatId);

    // We already know about this chatId (either from an explicit
    // hydration or from an implicit create during send). Don't refetch
    // and don't overwrite in-flight streaming state.
    if (lastHydratedChatId.current === chatId) {
      return;
    }
    lastHydratedChatId.current = chatId;

    (async () => {
      try {
        const [chat, rows] = await Promise.all([
          api.getChat(chatId),
          api.getChatMessages(chatId),
        ]);
        if (cancelled) return;

        // Pick up the chat's project so doc context is right without the
        // user having to re-select in the project dropdown.
        if (chat.projectId && chat.projectId !== selectedProject) {
          setSelectedProject(chat.projectId);
        }

        const hydrated: UIMessage[] = rows.map((m) => ({
          id: m.id,
          role: (m.role === "assistant" ? "assistant" : "user") as
            | "user"
            | "assistant",
          parts: [{ type: "text", text: m.content ?? "" }],
        }));
        setMessages(hydrated);
        setToolActivity({});
        setStreamingMessageId(null);
      } catch {
        // Chat row could not be loaded — leave the view empty rather
        // than crashing; the sidebar entry will disappear on next poll
        // anyway if the chat genuinely doesn't exist.
      }
    })();

    return () => {
      cancelled = true;
    };
    // selectedProject intentionally omitted: we only want this to run when
    // the chatId itself changes, not whenever the user picks a new project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, transport, setMessages]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [input]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    // Push attachments to transport before sending. Transport consumes them
    // for the very next `send_message` call and then clears itself.
    transport.attachFiles(attachedDocs.map((d) => d.id));
    transport.attachWorkflow(attachedWorkflow?.id ?? null);
    setInput("");
    setAttachedDocs([]);
    setAttachedWorkflow(null);
    sendMessage({ text });
  };

  const isEmpty = messages.length === 0 && !isLoading;
  const docCount = projectDocs.length;

  // Shared input bar JSX — rendered either centered (empty state) or pinned bottom (messages exist)
  const inputBar = (
    <div className="w-full max-w-3xl mx-auto px-4 pb-4 pt-2">
      {/* Project context pill (only when messages exist) */}
      {!isEmpty && selectedProject && (
        <div className="flex items-center gap-2 mb-2 px-2">
          <FolderOpen className="w-3.5 h-3.5 text-muted-soft" strokeWidth={1.5} />
          <span className="text-[11px] text-muted-soft">
            {projects.find((p) => p.id === selectedProject)?.name} · {docCount} doc{docCount !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      <div className="border border-hairline-strong rounded-2xl bg-canvas shadow-sm focus-within:shadow-md focus-within:border-ink transition-all duration-200">
        {/* Attached chips */}
        {(attachedWorkflow || attachedDocs.length > 0) && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {attachedWorkflow && (
              <span className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full text-[11px] bg-accent-coral-soft/40 text-ink border border-accent-coral/50">
                <Zap className="w-2.5 h-2.5 text-accent-coral" strokeWidth={2} />
                <span className="max-w-[140px] truncate">{attachedWorkflow.title}</span>
                <button onClick={() => setAttachedWorkflow(null)} className="rounded-full p-0.5 ml-0.5 text-ink/50 hover:text-ink hover:bg-accent-coral-soft/60 transition-colors"><X className="w-2.5 h-2.5" /></button>
              </span>
            )}
            {attachedDocs.map((doc) => (
              <span key={doc.id} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[11px] text-on-primary bg-primary border border-primary">
                {doc.fileType === "pdf" ? <FileText className="w-2.5 h-2.5 text-on-primary/80" strokeWidth={2} /> : <FileIcon className="w-2.5 h-2.5 text-on-primary/80" strokeWidth={2} />}
                <span className="max-w-[140px] truncate">{doc.filename}</span>
                <button onClick={() => setAttachedDocs((xs) => xs.filter((x) => x.id !== doc.id))} className="rounded-full p-0.5 ml-0.5 text-white/50 hover:text-white hover:bg-white/20 transition-colors"><X className="w-2.5 h-2.5" /></button>
              </span>
            ))}
          </div>
        )}

        {/* Textarea */}
        <div className="px-4 pt-3.5">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            placeholder={selectedProject ? "Ask about your documents..." : "Ask Holmes anything..."}
            rows={1}
            className="w-full bg-transparent text-[14px] text-ink placeholder:text-muted-soft focus:outline-none resize-none leading-6 max-h-48 overflow-hidden"
          />
        </div>

        {/* Controls bar */}
        <div className="flex items-center justify-between px-2.5 pb-2.5">
          <div className="flex items-center gap-0.5">
            {/* Project selector button */}
            {!initialProjectId && (
              <div className="relative">
                <button
                  onClick={() => setShowProjectPicker((v) => !v)}
                  className={`flex items-center gap-1.5 rounded-lg px-2 h-8 text-[12px] transition-colors ${selectedProject ? "text-ink" : "text-muted hover:bg-surface-strong hover:text-body"}`}
                >
                  <FolderOpen className="w-3.5 h-3.5" strokeWidth={1.5} />
                  <span className="hidden sm:inline">{selectedProject ? projects.find((p) => p.id === selectedProject)?.name ?? "Project" : "Projects"}</span>
                </button>
                {showProjectPicker && (
                  <ProjectPicker
                    projects={projects}
                    selectedId={selectedProject}
                    onSelect={(pid) => { setSelectedProject(pid || undefined); setShowProjectPicker(false); }}
                    onClose={() => setShowProjectPicker(false)}
                  />
                )}
              </div>
            )}

            {/* Attach docs */}
            <div className="relative">
              <button
                disabled={!selectedProject || projectDocs.length === 0}
                onClick={() => setShowDocPicker((v) => !v)}
                className="flex items-center gap-1.5 rounded-lg px-2 h-8 text-[12px] text-muted hover:bg-surface-strong hover:text-body disabled:text-muted-soft/40 disabled:hover:bg-transparent transition-colors"
              >
                <Paperclip className="w-3.5 h-3.5" strokeWidth={1.5} />
                <span className="hidden sm:inline">Docs</span>
              </button>
              {showDocPicker && (
                <DocPicker
                  docs={projectDocs}
                  selectedIds={new Set(attachedDocs.map((d) => d.id))}
                  onToggle={(doc) => {
                    setAttachedDocs((xs) =>
                      xs.some((x) => x.id === doc.id)
                        ? xs.filter((x) => x.id !== doc.id)
                        : [...xs, doc],
                    );
                  }}
                  onClose={() => setShowDocPicker(false)}
                />
              )}
            </div>

            {/* Attach workflow */}
            <div className="relative">
              <button
                onClick={() => setShowWorkflowPicker((v) => !v)}
                className={`flex items-center gap-1.5 rounded-md px-2 h-8 text-[12px] transition-colors ${attachedWorkflow ? "text-accent-coral" : "text-muted hover:bg-surface-strong hover:text-ink"}`}
              >
                <Zap className="w-3.5 h-3.5" strokeWidth={1.5} />
                <span className="hidden sm:inline">Workflows</span>
              </button>
              {showWorkflowPicker && (
                <WorkflowPicker
                  workflows={workflows}
                  selectedId={attachedWorkflow?.id ?? null}
                  onSelect={(wf) => {
                    setAttachedWorkflow(wf);
                    setShowWorkflowPicker(false);
                  }}
                  onClose={() => setShowWorkflowPicker(false)}
                />
              )}
            </div>

            {/* Model selector */}
            <div className="ml-1">
              <Dropdown value={model} options={modelOptions} onChange={setModel} compact />
            </div>
          </div>

          {/* Send / Stop */}
          <button
            onClick={isLoading ? undefined : handleSend}
            disabled={!isLoading && !input.trim()}
            className="relative h-8 w-8 flex items-center justify-center rounded-full bg-primary text-on-primary border border-primary disabled:bg-surface-strong disabled:text-muted-soft disabled:border-hairline active:enabled:scale-95 transition-all duration-150"
          >
            {isLoading ? (
              <Square className="w-3.5 h-3.5" fill="currentColor" strokeWidth={0} />
            ) : (
              <ArrowRight className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Messages or empty state */}
      {isEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <div className="flex flex-col items-center w-full max-w-3xl animate-fade-in">
            <InitialView />

            {/* Input composer */}
            <div className="w-full mt-8">{inputBar}</div>

            {/* Auto-scrolling suggestion strip — slides continuously with
                fades on both edges. Clicking a chip drops the prompt into
                the composer and focuses it. Hovering pauses the scroll. */}
            <div className="w-full max-w-2xl mt-2">
              <div className="suggestions-marquee py-1">
                <div className="suggestions-track">
                  {[...SUGGESTIONS, ...SUGGESTIONS].map((q, i) => (
                    <button
                      key={`${q.text}-${i}`}
                      onClick={() => { setInput(q.text); textareaRef.current?.focus(); }}
                      className="shrink-0 flex flex-col items-start gap-0.5 px-4 py-2.5 text-left bg-canvas border border-hairline rounded-md hover:border-ink transition-colors min-w-[220px]"
                    >
                      <span className="text-[12.5px] text-ink font-medium whitespace-nowrap">{q.text}</span>
                      <span className="text-[11px] text-muted-soft whitespace-nowrap">{q.sub}</span>
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-center text-[11px] text-muted-soft mt-4">
                Holmes can make mistakes. Answers are not legal advice.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-auto">
            <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
              {messages.map((msg, msgIdx) => {
                const isLatestAssistant =
                  msg.role === "assistant" && msgIdx === messages.length - 1;
                const activityList: ToolActivity[] =
                  isLatestAssistant && streamingMessageId
                    ? toolActivity[streamingMessageId] ?? []
                    : [];
                return (
                  <div key={msg.id} className="flex gap-3.5 animate-fade-in">
                    <Avatar role={msg.role} />
                    <div className="flex-1 pt-1 min-w-0">
                      {activityList.length > 0 && (
                        <PreResponseWrapper
                          activities={activityList}
                          streaming={isLoading && isLatestAssistant}
                        />
                      )}
                      {msg.parts.map((part, i) => {
                        if (part.type === "text") {
                          const clean = stripCitations(part.text);
                          const citations = parseCitations(part.text);
                          return msg.role === "assistant" ? (
                            <div key={i} className="prose-holmes">
                              <CitationMarkdown text={clean} citations={citations} onCitationClick={onCitationClick} />
                            </div>
                          ) : (
                            <p key={i} className="text-sm text-body leading-relaxed whitespace-pre-wrap">{part.text}</p>
                          );
                        }
                        return null;
                      })}
                      {isLoading && msg === messages[messages.length - 1] && msg.role === "assistant" && (
                        <span className="inline-block w-1.5 h-4 bg-ink animate-pulse ml-0.5 align-text-bottom rounded-sm" />
                      )}
                    </div>
                  </div>
                );
              })}
              {isLoading && messages[messages.length - 1]?.role === "user" && (
                <div className="flex gap-3.5">
                  <Avatar role="assistant" />
                  <div className="flex-1 pt-1 min-w-0">
                    {streamingMessageId && toolActivity[streamingMessageId]?.length ? (
                      <PreResponseWrapper
                        activities={toolActivity[streamingMessageId]}
                        streaming={true}
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-accent-blue animate-pulse" />
                        <span className="text-sm text-muted">Thinking...</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>
          {inputBar}
        </>
      )}
    </div>
  );
}

function ProjectPicker({
  projects,
  selectedId,
  onSelect,
  onClose,
}: {
  projects: Project[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [onClose]);

  return (
    <div ref={ref} className="absolute bottom-full mb-2 left-0 w-64 bg-canvas border border-hairline rounded-md shadow-lg overflow-hidden z-50">
      <div className="max-h-60 overflow-y-auto py-1">
        <button onClick={() => onSelect("")} className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-canvas-soft transition-colors ${!selectedId ? "text-ink font-medium" : "text-muted"}`}>
          No project (general chat)
        </button>
        {projects.map((p) => (
          <button key={p.id} onClick={() => onSelect(p.id)} className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-canvas-soft transition-colors ${selectedId === p.id ? "text-ink font-medium bg-surface-strong" : "text-body"}`}>
            <FolderOpen className="w-3 h-3 text-muted-soft shrink-0" strokeWidth={1.5} />
            <span className="truncate">{p.name}</span>
            <span className="text-[10px] text-muted-soft ml-auto">{p.documentCount}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function DocPicker({
  docs,
  selectedIds,
  onToggle,
  onClose,
}: {
  docs: Document[];
  selectedIds: Set<string>;
  onToggle: (doc: Document) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [onClose]);

  const filtered = filter.trim()
    ? docs.filter((d) => d.filename.toLowerCase().includes(filter.toLowerCase()))
    : docs;

  return (
    <div
      ref={ref}
      className="absolute bottom-full mb-2 left-0 w-72 bg-canvas border border-hairline rounded-md shadow-lg overflow-hidden z-50"
    >
      <div className="px-3 py-2 border-b border-hairline-soft">
        <input
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter documents..."
          className="w-full bg-transparent text-[12px] text-ink placeholder:text-muted-soft focus:outline-none"
        />
      </div>
      <div className="max-h-60 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <p className="text-[11px] text-muted-soft px-3 py-4 text-center">No matches</p>
        ) : (
          filtered.map((d) => {
            const on = selectedIds.has(d.id);
            return (
              <button
                key={d.id}
                onClick={() => onToggle(d)}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-canvas-soft transition-colors text-left"
              >
                <div
                  className={`w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center shrink-0 transition-colors ${on
                      ? "bg-primary border-primary"
                      : "bg-canvas border-hairline-strong"
                    }`}
                >
                  {on && <Check className="w-2.5 h-2.5 text-on-primary" strokeWidth={3} />}
                </div>
                {d.fileType === "pdf" ? (
                  <FileText className="w-3 h-3 text-muted-soft shrink-0" strokeWidth={1.5} />
                ) : (
                  <FileIcon className="w-3 h-3 text-muted-soft shrink-0" strokeWidth={1.5} />
                )}
                <span className="text-[12px] text-ink truncate">{d.filename}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function WorkflowPicker({
  workflows,
  selectedId,
  onSelect,
  onClose,
}: {
  workflows: Workflow[];
  selectedId: string | null;
  onSelect: (wf: Workflow) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute bottom-full mb-2 left-0 w-72 bg-canvas border border-hairline rounded-md shadow-lg overflow-hidden z-50"
    >
      <p className="mono-label-sm px-3 pt-2.5 pb-1.5">
        Attach workflow
      </p>
      <div className="max-h-60 overflow-y-auto pb-1">
        {workflows.length === 0 ? (
          <p className="text-[11px] text-muted-soft px-3 py-4 text-center">No workflows</p>
        ) : (
          workflows.map((wf) => (
            <button
              key={wf.id}
              onClick={() => onSelect(wf)}
              className={`w-full flex items-start gap-2 px-3 py-2 hover:bg-canvas-soft transition-colors text-left ${selectedId === wf.id ? "bg-surface-strong" : ""
                }`}
            >
              <Zap
                className="w-3 h-3 text-accent-coral shrink-0 mt-0.5"
                strokeWidth={1.5}
              />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-ink truncate">{wf.title}</p>
                {wf.practice && (
                  <p className="text-[10px] text-muted-soft capitalize">
                    {wf.practice}
                  </p>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function Avatar({ role }: { role: string }) {
  return (
    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 border ${role === "user" ? "bg-surface-strong border-hairline" : "bg-surface-dark border-surface-dark"
      }`}>
      {role === "user"
        ? <User className="w-3.5 h-3.5 text-muted" strokeWidth={1.5} />
        : <Bot className="w-3.5 h-3.5 text-on-dark" strokeWidth={1.5} />}
    </div>
  );
}

/** Renders markdown with [N] citation markers as clickable, hoverable buttons */
function CitationMarkdown({
  text,
  citations,
  onCitationClick,
}: {
  text: string;
  citations: Citation[];
  onCitationClick?: (c: Citation) => void;
}) {
  return (
    <span
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.dataset.cite) {
          const ref = parseInt(target.dataset.cite);
          const citation = citations.find((c) => c.ref === ref);
          if (citation && onCitationClick) onCitationClick(citation);
        }
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p>{replaceCiteMarkers(children, citations)}</p>,
          li: ({ children }) => <li>{replaceCiteMarkers(children, citations)}</li>,
        }}
      >
        {text}
      </ReactMarkdown>
    </span>
  );
}

function replaceCiteMarkers(children: React.ReactNode, citations: Citation[]): React.ReactNode {
  if (!children) return children;
  if (typeof children === "string") {
    const parts = children.split(/(\[\d+\])/g);
    if (parts.length === 1) return children;
    return parts.map((part, i) => {
      const match = part.match(/^\[(\d+)\]$/);
      if (match) {
        const ref = parseInt(match[1]);
        const citation = citations.find((c) => c.ref === ref);
        return <CitationMarker key={i} ref_={ref} citation={citation} />;
      }
      return part;
    });
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => (
      <span key={i}>{replaceCiteMarkers(child, citations)}</span>
    ));
  }
  return children;
}

/**
 * Single citation marker with a hover tooltip that previews the cited
 * quote. Uses a CSS-only `:hover` group approach so we avoid creating
 * one React event listener per marker in a large message.
 */
function CitationMarker({
  ref_,
  citation,
}: {
  ref_: number;
  citation?: Citation;
}) {
  return (
    <span className="relative inline-block group">
      <span
        data-cite={ref_}
        className="citation-marker"
      >
        {ref_}
      </span>
      {citation && (
        <span className="pointer-events-none absolute left-0 bottom-full mb-1.5 w-72 bg-surface-dark text-on-dark text-[11px] leading-relaxed rounded-md shadow-xl p-3 opacity-0 group-hover:opacity-100 transition-opacity z-50 translate-y-1 group-hover:translate-y-0 duration-200">
          <span className="block mono-label-sm text-on-dark-soft mb-1">
            {citation.doc_id}
            {citation.page ? ` / p.${citation.page}` : ""}
          </span>
          <span className="block italic">"{citation.quote}"</span>
          <span className="block mt-2 text-[9px] text-on-dark-soft">
            Click to open
          </span>
        </span>
      )}
    </span>
  );
}
