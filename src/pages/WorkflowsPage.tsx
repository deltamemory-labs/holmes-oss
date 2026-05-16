import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { MessageSquare, Table2, Plus, Search, Zap, Play, X, Lock } from "lucide-react";
import { api, type Workflow, type Project, type Document as Doc } from "@/lib/tauri";
import { PRACTICE_OPTIONS } from "@/lib/columnPresets";

type Tab = "all" | "builtin" | "custom";
type WfType = "all" | "assistant" | "tabular";

export function WorkflowsPage() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [tab, setTab] = useState<Tab>("all");
  const [typeFilter, setTypeFilter] = useState<WfType>("all");
  const [practiceFilter, setPracticeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<"assistant" | "tabular">("assistant");
  const [newPractice, setNewPractice] = useState("");
  // Run modal state
  const [runWf, setRunWf] = useState<Workflow | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [runProject, setRunProject] = useState<string>("");
  const [runDocs, setRunDocs] = useState<Doc[]>([]);
  const [runSelectedDocs, setRunSelectedDocs] = useState<string[]>([]);

  const load = useCallback(() => { api.listWorkflows().then(setWorkflows); }, []);
  useEffect(() => { load(); api.listProjects().then(setProjects); }, [load]);

  useEffect(() => {
    if (!runProject) { setRunDocs([]); setRunSelectedDocs([]); return; }
    api.listDocuments(runProject).then((d) => { setRunDocs(d); setRunSelectedDocs(d.map((x) => x.id)); });
  }, [runProject]);

  const filtered = workflows.filter((w) => {
    if (tab === "builtin" && !w.isSystem) return false;
    if (tab === "custom" && w.isSystem) return false;
    if (typeFilter !== "all" && w.type !== typeFilter) return false;
    if (practiceFilter && w.practice !== practiceFilter) return false;
    if (search && !w.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    await api.createWorkflow(newTitle.trim(), { type: newType, practice: newPractice || undefined });
    setCreating(false); setNewTitle(""); setNewType("assistant"); setNewPractice("");
    load();
  };

  const handleRun = async () => {
    if (!runWf || !runProject || runSelectedDocs.length === 0) return;
    if (runWf.type === "tabular") {
      const reviewId = await api.createReviewFromWorkflow(runWf.id, runProject, runSelectedDocs);
      setRunWf(null);
      navigate({ to: "/tabular-reviews/$id", params: { id: reviewId } });
    } else {
      // For assistant workflows, navigate to chat with the workflow attached
      setRunWf(null);
      navigate({ to: "/" });
    }
  };

  const handleDelete = async (id: string) => {
    await api.deleteWorkflow(id);
    load();
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="px-6 py-4 border-b border-hairline-soft flex items-center gap-3">
        <Zap className="w-5 h-5 text-accent-coral" strokeWidth={1.5} />
        <h1 className="font-display text-[22px] text-ink" style={{ fontWeight: 500, letterSpacing: "-0.4px" }}>Workflows</h1>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-soft" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="pl-8 pr-3 py-1.5 w-40 rounded-md border border-hairline text-[12px] text-ink placeholder:text-muted-soft focus:outline-none focus:border-accent-blue bg-canvas" />
          </div>
          <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-medium text-on-primary bg-primary rounded-full hover:bg-primary-active transition-colors"><Plus className="w-3.5 h-3.5" /> New</button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-6 py-2.5 border-b border-hairline-soft flex items-center gap-2 text-[12px]">
        {(["all", "builtin", "custom"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-1 rounded-full border transition-colors ${tab === t ? "bg-ink text-on-primary border-ink" : "border-hairline text-muted hover:border-hairline-strong hover:text-ink bg-canvas"}`}>{t === "all" ? "All" : t === "builtin" ? "Built-in" : "Custom"}</button>
        ))}
        <div className="w-px h-4 bg-hairline mx-1" />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as WfType)} className="rounded-md border border-hairline px-2 py-1 text-[11px] text-body bg-canvas focus:outline-none focus:border-accent-blue">
          <option value="all">All types</option>
          <option value="assistant">Assistant</option>
          <option value="tabular">Tabular</option>
        </select>
        <select value={practiceFilter} onChange={(e) => setPracticeFilter(e.target.value)} className="rounded-md border border-hairline px-2 py-1 text-[11px] text-body bg-canvas focus:outline-none focus:border-accent-blue">
          <option value="">All practices</option>
          {PRACTICE_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Zap className="w-8 h-8 text-muted-soft mb-3" strokeWidth={1} />
            <p className="text-sm text-muted">No workflows match your filters</p>
          </div>
        ) : (
          <div className="divide-y divide-hairline-soft">
            {filtered.map((wf) => (
              <div key={wf.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-canvas-soft transition-colors cursor-pointer group" onClick={() => navigate({ to: "/workflows/$id", params: { id: wf.id } })}>
                <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 border border-hairline-soft ${wf.type === "tabular" ? "bg-surface-wash-blue" : "bg-surface-strong"}`}>
                  {wf.type === "tabular" ? <Table2 className="w-4 h-4 text-accent-blue" strokeWidth={1.5} /> : <MessageSquare className="w-4 h-4 text-ink" strokeWidth={1.5} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-ink font-medium truncate">{wf.title}</p>
                  <p className="text-[11px] text-muted-soft mt-0.5">{wf.practice ?? "General"} · {wf.type}</p>
                </div>
                {wf.isSystem && <Lock className="w-3 h-3 text-muted-soft shrink-0" />}
                <button onClick={(e) => { e.stopPropagation(); setRunWf(wf); }} className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-3 py-1 text-[11px] text-ink border border-hairline rounded-full hover:border-ink transition-all"><Play className="w-3 h-3" /> Run</button>
                {!wf.isSystem && (
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(wf.id); }} className="opacity-0 group-hover:opacity-100 p-1 text-muted-soft hover:text-error rounded transition-all"><X className="w-3.5 h-3.5" /></button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Run modal */}
      {runWf && (
        <div className="fixed inset-0 z-[101] flex items-center justify-center bg-ink/30 backdrop-blur-sm animate-fade-in" onClick={() => setRunWf(null)}>
          <div className="w-full max-w-lg rounded-md bg-canvas shadow-xl border border-hairline p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-[22px] text-ink mb-1" style={{ fontWeight: 500, letterSpacing: "-0.4px" }}>Run "{runWf.title}"</h3>
            <p className="text-[12px] text-muted-soft mb-5">Select a project and documents to run this workflow on.</p>
            <div className="space-y-4">
              <div>
                <label className="mono-label-sm mb-1.5 block">Project</label>
                <select value={runProject} onChange={(e) => setRunProject(e.target.value)} className="w-full rounded-md border border-hairline px-3 py-2 text-[13px] text-ink focus:outline-none focus:border-accent-blue bg-canvas">
                  <option value="">Select a project…</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              {runProject && runDocs.length > 0 && (
                <div>
                  <label className="mono-label-sm mb-1.5 block">Documents ({runSelectedDocs.length}/{runDocs.length})</label>
                  <div className="max-h-44 overflow-y-auto rounded-md border border-hairline p-2 space-y-1">
                    {runDocs.map((d) => (
                      <label key={d.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-canvas-soft cursor-pointer">
                        <input type="checkbox" checked={runSelectedDocs.includes(d.id)} onChange={(e) => setRunSelectedDocs((prev) => e.target.checked ? [...prev, d.id] : prev.filter((x) => x !== d.id))} className="rounded border-hairline-strong accent-primary" />
                        <span className="text-[12px] text-ink truncate">{d.filename}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setRunWf(null)} className="px-4 py-2 text-[12px] text-muted hover:text-ink rounded-md hover:bg-surface-strong transition-colors">Cancel</button>
              <button onClick={handleRun} disabled={!runProject || runSelectedDocs.length === 0} className="flex items-center gap-1.5 px-5 py-2 text-[12px] font-medium text-on-primary bg-primary rounded-full hover:bg-primary-active disabled:opacity-40 transition-colors">
                {runWf.type === "tabular" ? <><Table2 className="w-3.5 h-3.5" /> Create Review</> : <><MessageSquare className="w-3.5 h-3.5" /> Use in Chat</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create modal */}
      {creating && (
        <div className="fixed inset-0 z-[101] flex items-center justify-center bg-ink/30 backdrop-blur-sm animate-fade-in" onClick={() => setCreating(false)}>
          <div className="w-full max-w-md rounded-md bg-canvas shadow-xl border border-hairline p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-[22px] text-ink mb-5" style={{ fontWeight: 500, letterSpacing: "-0.4px" }}>New workflow</h3>
            <div className="space-y-4">
              <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Workflow name" autoFocus className="w-full font-display text-2xl text-ink placeholder:text-muted-soft bg-transparent focus:outline-none border-b border-hairline pb-2" style={{ fontWeight: 500, letterSpacing: "-0.4px" }} />
              <div>
                <label className="mono-label-sm mb-1.5 block">Type</label>
                <div className="flex gap-2">
                  {(["assistant", "tabular"] as const).map((t) => (
                    <button key={t} onClick={() => setNewType(t)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] border transition-colors ${newType === t ? "border-ink bg-ink text-on-primary font-medium" : "border-hairline text-muted hover:border-hairline-strong hover:text-ink bg-canvas"}`}>
                      {t === "assistant" ? <MessageSquare className="w-3 h-3" /> : <Table2 className="w-3 h-3" />}
                      {t === "assistant" ? "Assistant" : "Tabular"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mono-label-sm mb-1.5 block">Practice area</label>
                <select value={newPractice} onChange={(e) => setNewPractice(e.target.value)} className="w-full rounded-md border border-hairline px-3 py-2 text-[12px] text-ink focus:outline-none focus:border-accent-blue bg-canvas">
                  <option value="">None</option>
                  {PRACTICE_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setCreating(false)} className="px-4 py-2 text-[12px] text-muted hover:text-ink rounded-md hover:bg-surface-strong transition-colors">Cancel</button>
              <button onClick={handleCreate} disabled={!newTitle.trim()} className="px-5 py-2 text-[12px] font-medium text-on-primary bg-primary rounded-full hover:bg-primary-active disabled:opacity-40 transition-colors">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
