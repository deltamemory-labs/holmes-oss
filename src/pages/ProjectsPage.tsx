import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { FolderOpen, Plus, FileText, Trash2, Clock, Search, X } from "lucide-react";
import { api, type Project } from "@/lib/tauri";

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCm, setNewCm] = useState("");
  const navigate = useNavigate();

  const load = () => api.listProjects().then(setProjects);
  useEffect(() => { load(); }, []);

  const filtered = search.trim()
    ? projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : projects;

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const project = await api.createProject(newName.trim(), newCm.trim() || undefined);
    setNewName(""); setNewCm(""); setShowModal(false);
    navigate({ to: "/projects/$id", params: { id: project.id } });
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.preventDefault(); e.stopPropagation();
    await api.deleteProject(id); load();
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="px-6 py-4 border-b border-hairline-soft flex items-center gap-3">
        <FolderOpen className="w-5 h-5 text-ink" strokeWidth={1.5} />
        <h1 className="font-display text-[22px] text-ink" style={{ fontWeight: 500, letterSpacing: "-0.4px" }}>Projects</h1>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-soft" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="pl-8 pr-3 py-1.5 w-40 rounded-md border border-hairline text-[12px] text-ink placeholder:text-muted-soft focus:outline-none focus:border-accent-blue bg-canvas" />
          </div>
          <button onClick={() => setShowModal(true)} className="flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-medium text-on-primary bg-primary rounded-full hover:bg-primary-active transition-colors">
            <Plus className="w-3.5 h-3.5" /> New
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <FolderOpen className="w-8 h-8 text-muted-soft mb-3" strokeWidth={1} />
            <p className="text-sm text-muted mb-2">{search ? "No projects match" : "No projects yet"}</p>
            {!search && <button onClick={() => setShowModal(true)} className="text-[12px] text-accent-blue hover:text-primary-active underline underline-offset-2">Create your first project</button>}
          </div>
        ) : (
          <div className="divide-y divide-hairline-soft">
            {filtered.map((p) => (
              <Link key={p.id} to="/projects/$id" params={{ id: p.id }} className="flex items-center gap-4 px-6 py-3.5 hover:bg-canvas-soft transition-colors group">
                <div className="w-9 h-9 rounded-md bg-surface-strong border border-hairline-soft flex items-center justify-center shrink-0">
                  <FolderOpen className="w-4 h-4 text-ink" strokeWidth={1.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-ink font-medium truncate">{p.name}</p>
                  <div className="flex items-center gap-3 text-[11px] text-muted-soft mt-0.5">
                    {p.cmNumber && <span>{p.cmNumber}</span>}
                    <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{p.documentCount} doc{p.documentCount !== 1 ? "s" : ""}</span>
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(p.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                  </div>
                </div>
                <button onClick={(e) => handleDelete(e, p.id)} className="opacity-0 group-hover:opacity-100 p-1.5 text-muted-soft hover:text-error rounded-md hover:bg-surface-strong transition-all">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Create modal */}
      {showModal && (
        <div className="fixed inset-0 z-[101] flex items-center justify-center bg-ink/30 backdrop-blur-sm animate-fade-in" onClick={() => setShowModal(false)}>
          <div className="w-full max-w-md rounded-md bg-canvas shadow-xl border border-hairline p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-display text-[22px] text-ink" style={{ fontWeight: 500, letterSpacing: "-0.4px" }}>New project</h3>
              <button onClick={() => setShowModal(false)} className="p-1 text-muted hover:text-ink transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mono-label-sm mb-1.5 block">Project name</label>
                <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreate()} placeholder="e.g. Acme Corp Acquisition" className="w-full px-3 py-2.5 rounded-md border border-hairline bg-canvas text-[13px] text-ink placeholder:text-muted-soft focus:outline-none focus:border-accent-blue" />
              </div>
              <div>
                <label className="mono-label-sm mb-1.5 block">Client-matter number (optional)</label>
                <input value={newCm} onChange={(e) => setNewCm(e.target.value)} placeholder="e.g. 2024-0142" className="w-full px-3 py-2.5 rounded-md border border-hairline bg-canvas text-[13px] text-ink placeholder:text-muted-soft focus:outline-none focus:border-accent-blue" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-[12px] text-muted hover:text-ink rounded-md hover:bg-surface-strong transition-colors">Cancel</button>
              <button onClick={handleCreate} disabled={!newName.trim()} className="px-5 py-2 text-[12px] font-medium text-on-primary bg-primary rounded-full hover:bg-primary-active disabled:opacity-40 transition-colors">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
