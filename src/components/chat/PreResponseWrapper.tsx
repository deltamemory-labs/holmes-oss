import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  Search,
  Sparkles,
  Loader2,
  Check,
  AlertCircle,
} from "lucide-react";

export interface ToolActivity {
  callId: string;
  name: string;
  arguments: string;
  state: "running" | "done" | "error";
  result?: string;
  ok?: boolean;
}

interface Props {
  activities: ToolActivity[];
  /** Set while the assistant turn is still streaming. */
  streaming: boolean;
}

/**
 * Collapsible timeline of tool calls made while the assistant was
 * formulating its reply. Mirrors Mike's `PreResponseWrapper` but leans
 * into our editorial surface (soft gradient orb, subtle chevron).
 *
 * When the turn is still streaming, the wrapper auto-expands. Once
 * complete it collapses to a one-line summary so finished messages
 * don't dominate the scroll. The user can always click to re-open.
 */
export function PreResponseWrapper({ activities, streaming }: Props) {
  const [open, setOpen] = useState(streaming);

  // Keep the wrapper open while streaming; don't fight the user if they
  // manually collapsed a running turn.
  const effectiveOpen = streaming ? open || activities.some((a) => a.state === "running") : open;

  if (activities.length === 0) return null;

  const done = activities.filter((a) => a.state !== "running").length;
  const total = activities.length;

  const label = streaming
    ? activities.some((a) => a.state === "running")
      ? `Working · ${done}/${total}`
      : `Thought for ${total} step${total === 1 ? "" : "s"}`
    : `${total} step${total === 1 ? "" : "s"}`;

  return (
    <div className="mb-2 rounded-md bg-canvas-soft border border-hairline-soft overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-strong transition-colors"
      >
        {effectiveOpen ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-soft" strokeWidth={1.5} />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-soft" strokeWidth={1.5} />
        )}
        <Sparkles
          className={`w-3.5 h-3.5 ${
            streaming && activities.some((a) => a.state === "running")
              ? "text-accent-blue animate-pulse"
              : "text-muted-soft"
          }`}
          strokeWidth={1.5}
        />
        <span className="text-[12px] font-medium text-body">{label}</span>
      </button>

      {effectiveOpen && (
        <div className="px-3 pb-2.5 pt-0.5 space-y-1">
          {activities.map((a) => (
            <ToolRow key={a.callId} activity={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolRow({ activity }: { activity: ToolActivity }) {
  const { icon, label } = describe(activity);

  return (
    <div className="flex items-start gap-2 pl-5 py-1">
      <div className="pt-0.5 shrink-0">
        {activity.state === "running" ? (
          <Loader2
            className="w-3 h-3 text-accent-blue animate-spin"
            strokeWidth={2}
          />
        ) : activity.state === "error" || activity.ok === false ? (
          <AlertCircle className="w-3 h-3 text-error/80" strokeWidth={2} />
        ) : (
          <Check className="w-3 h-3 text-success" strokeWidth={2.5} />
        )}
      </div>
      <div className="flex items-start gap-1.5 min-w-0 flex-1">
        <div className="shrink-0 pt-0.5">{icon}</div>
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] text-body leading-snug">{label}</p>
          {activity.ok === false && activity.result && (
            <p className="text-[10.5px] text-error/80 mt-0.5 truncate">
              {parseErrorMessage(activity.result)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Translate a tool name + JSON args payload into an operator-readable
 * sentence. Unknown tools fall back to `name(args)`.
 */
function describe(activity: ToolActivity): { icon: React.ReactNode; label: string } {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(activity.arguments || "{}");
  } catch {
    /* noop */
  }

  switch (activity.name) {
    case "list_project_docs":
      return {
        icon: <FolderOpen className="w-3 h-3 text-muted-soft" strokeWidth={1.5} />,
        label: "Listing project documents",
      };
    case "read_document": {
      const id = typeof args.document_id === "string" ? args.document_id.slice(0, 8) : "";
      const name = tryFilenameFromResult(activity.result) ?? (id ? `doc ${id}…` : "document");
      return {
        icon: <FileText className="w-3 h-3 text-muted-soft" strokeWidth={1.5} />,
        label: `Reading ${name}`,
      };
    }
    case "find_in_document": {
      const q = typeof args.query === "string" ? args.query : "";
      const id = typeof args.document_id === "string" ? args.document_id.slice(0, 8) : "";
      const target = tryFilenameFromResult(activity.result) ?? (id ? `doc ${id}…` : "document");
      const matchCount = tryMatchCountFromResult(activity.result);
      const suffix = matchCount != null ? ` · ${matchCount} match${matchCount === 1 ? "" : "es"}` : "";
      return {
        icon: <Search className="w-3 h-3 text-accent-blue" strokeWidth={1.5} />,
        label: `Searching ${target} for "${q}"${suffix}`,
      };
    }
    default:
      return {
        icon: <Sparkles className="w-3 h-3 text-muted-soft" strokeWidth={1.5} />,
        label: activity.name,
      };
  }
}

function tryFilenameFromResult(result?: string): string | null {
  if (!result) return null;
  try {
    const v = JSON.parse(result);
    if (typeof v?.filename === "string") return v.filename;
  } catch {
    /* ignore */
  }
  return null;
}

function tryMatchCountFromResult(result?: string): number | null {
  if (!result) return null;
  try {
    const v = JSON.parse(result);
    if (typeof v?.match_count === "number") return v.match_count;
  } catch {
    /* ignore */
  }
  return null;
}

function parseErrorMessage(result: string): string {
  try {
    const v = JSON.parse(result);
    if (typeof v?.error === "string") return v.error;
  } catch {
    /* ignore */
  }
  return result.slice(0, 120);
}
