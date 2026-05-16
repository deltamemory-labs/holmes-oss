import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "@tanstack/react-router";
import {
  Upload, File, Trash2, Eye, X, FolderOpen, ChevronLeft,
  FileText, Image, Music, BookOpen, FolderPlus, ChevronRight, ChevronDown,
  MoreHorizontal, Folder, History, RefreshCw,
} from "lucide-react";
import {
  api,
  type Project,
  type Document as Doc,
  type Subfolder,
  type DocumentVersion,
} from "@/lib/tauri";
import { ChatView } from "@/components/chat/ChatView";
import { DocxView } from "@/components/shared/DocxView";
import { PdfView } from "@/components/shared/PdfView";
import { resolveDocFromCitation } from "@/lib/doc-resolver";
import type { Citation } from "@/lib/citations";

export function ProjectPage() {
  const { id } = useParams({ strict: false });
  const [project, setProject] = useState<Project | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [folders, setFolders] = useState<Subfolder[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedDoc, setSelectedDoc] = useState<Doc | null>(null);
  const [docBytes, setDocBytes] = useState<Uint8Array | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [highlightQuote, setHighlightQuote] = useState<string | null>(null);
  const [citedPage, setCitedPage] = useState<number | null>(null);
  const [viewerKey, setViewerKey] = useState(0);
  const [newFolderMode, setNewFolderMode] = useState<string | null | "root">(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [menuForDoc, setMenuForDoc] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const [p, d, f] = await Promise.all([
      api.getProject(id),
      api.listDocuments(id),
      api.listSubfolders(id),
    ]);
    setProject(p);
    setDocs(d);
    setFolders(f);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const openDoc = useCallback(
    async (doc: Doc, quote?: string, page?: number, versionId?: string) => {
      setSelectedDoc(doc);
      setHighlightQuote(quote ?? null);
      setCitedPage(page ?? null);
      setViewerKey((k) => k + 1);
      const bytes = await api.readDocumentBytes(doc.id, versionId);
      setDocBytes(new Uint8Array(bytes));
    },
    [],
  );

  const handleCitation = useCallback(
    (citation: Citation) => {
      const page =
        typeof citation.page === "number"
          ? citation.page
          : parseInt(String(citation.page)) || undefined;

      const resolved = resolveDocFromCitation(citation.doc_id, docs);
      if (resolved) {
        openDoc(resolved.doc, citation.quote, page);
      }
    },
    [docs, openDoc],
  );

  const handleFiles = async (files: FileList | File[], folderId?: string) => {
    if (!id) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const buffer = await file.arrayBuffer();
      await api.uploadDocument(
        id,
        file.name,
        Array.from(new Uint8Array(buffer)),
        folderId,
      );
    }
    setUploading(false);
    load();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  const handleDelete = async (docId: string) => {
    await api.deleteDocument(docId);
    if (selectedDoc?.id === docId) {
      setSelectedDoc(null);
      setDocBytes(null);
    }
    load();
  };

  const createFolder = async () => {
    if (!id || !newFolderName.trim()) {
      setNewFolderMode(null);
      setNewFolderName("");
      return;
    }
    const parent = newFolderMode === "root" ? undefined : newFolderMode ?? undefined;
    const created = await api.createSubfolder(
      id,
      newFolderName.trim(),
      parent,
    );
    setExpandedFolders((s) => new Set(s).add(created.id));
    setNewFolderMode(null);
    setNewFolderName("");
    load();
  };

  const moveDocToFolder = async (docId: string, folderId: string | null) => {
    await api.moveDocumentToFolder(docId, folderId);
    setMenuForDoc(null);
    load();
  };

  const toggleFolder = (folderId: string) => {
    setExpandedFolders((s) => {
      const next = new Set(s);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  if (!project) return null;

  // Partition docs by folder
  const rootDocs = docs.filter((d) => !d.folderId);
  const rootFolders = folders.filter((f) => !f.parentFolderId);

  return (
    <div className="flex h-full animate-fade-in">
      {/* Left: File panel */}
      <div className="w-72 border-r border-hairline flex flex-col shrink-0 bg-canvas-soft">
        <div className="p-4 border-b border-hairline-soft">
          <div className="flex items-center gap-2 mb-1">
            <ChevronLeft
              className="w-4 h-4 text-muted-soft cursor-pointer hover:text-body transition-colors"
              onClick={() => window.history.back()}
            />
            <FolderOpen className="w-4 h-4 text-muted" strokeWidth={1.5} />
            <h2 className="text-sm font-medium text-ink truncate flex-1">
              {project.name}
            </h2>
            <button
              onClick={() => {
                setNewFolderMode("root");
                setNewFolderName("");
              }}
              title="New folder"
              className="p-1 text-muted-soft hover:text-body transition-colors rounded"
            >
              <FolderPlus className="w-3.5 h-3.5" strokeWidth={1.5} />
            </button>
          </div>
          <p className="text-[11px] text-muted-soft ml-6">
            {docs.length} document{docs.length !== 1 ? "s" : ""} · {folders.length}{" "}
            folder{folders.length !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.multiple = true;
            input.accept = ".pdf,.docx,.doc,.png,.jpg,.jpeg,.mp3,.wav";
            input.onchange = () => input.files && handleFiles(input.files);
            input.click();
          }}
          className={`m-3 p-4 border border-dashed rounded-md text-center cursor-pointer transition-all duration-200 ${
            dragOver
              ? "border-accent-blue bg-surface-wash-blue"
              : "border-hairline hover:border-hairline-strong hover:bg-canvas-soft"
          }`}
        >
          <Upload className="w-5 h-5 text-muted mx-auto mb-1.5" strokeWidth={1.5} />
          <p className="text-[12px] text-muted">
            {uploading ? "Uploading..." : "Drop files or click to upload"}
          </p>
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-auto px-3 pb-3 space-y-0.5">
          {/* New folder at root inline input */}
          {newFolderMode === "root" && (
            <NewFolderInput
              value={newFolderName}
              onChange={setNewFolderName}
              onCancel={() => {
                setNewFolderMode(null);
                setNewFolderName("");
              }}
              onSubmit={createFolder}
            />
          )}

          {rootFolders.map((folder) => (
            <FolderNode
              key={folder.id}
              folder={folder}
              allFolders={folders}
              allDocs={docs}
              expanded={expandedFolders}
              onToggle={toggleFolder}
              selectedDocId={selectedDoc?.id ?? null}
              onOpenDoc={openDoc}
              onDeleteDoc={handleDelete}
              menuForDoc={menuForDoc}
              setMenuForDoc={setMenuForDoc}
              moveDocToFolder={moveDocToFolder}
              depth={0}
            />
          ))}

          {rootDocs.map((doc) => (
            <DocRow
              key={doc.id}
              doc={doc}
              selected={selectedDoc?.id === doc.id}
              onOpen={() => openDoc(doc)}
              onDelete={() => handleDelete(doc.id)}
              folders={folders}
              menuOpen={menuForDoc === doc.id}
              setMenuOpen={(o) => setMenuForDoc(o ? doc.id : null)}
              moveToFolder={(folderId) => moveDocToFolder(doc.id, folderId)}
              depth={0}
            />
          ))}

          {rootFolders.length === 0 && rootDocs.length === 0 && (
            <p className="text-[11px] text-muted-soft px-3 py-4 text-center">
              Upload documents or create a folder to get started.
            </p>
          )}
        </div>
      </div>

      {/* Center: Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        <ChatView projectId={id} onCitationClick={handleCitation} />
      </div>

      {/* Right: Document viewer */}
      {selectedDoc && docBytes && (
        <DocumentViewer
          key={selectedDoc.id}
          doc={selectedDoc}
          docBytes={docBytes}
          viewerKey={viewerKey}
          highlightQuote={highlightQuote}
          citedPage={citedPage}
          onClose={() => {
            setSelectedDoc(null);
            setDocBytes(null);
            setHighlightQuote(null);
          }}
          onReloadAfterVersion={(d) => {
            // After uploading a new version or switching the active version,
            // reload bytes + doc list so sizes and version chip refresh.
            openDoc(d);
            load();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// File tree subcomponents
// ---------------------------------------------------------------------------

function FolderNode({
  folder,
  allFolders,
  allDocs,
  expanded,
  onToggle,
  selectedDocId,
  onOpenDoc,
  onDeleteDoc,
  menuForDoc,
  setMenuForDoc,
  moveDocToFolder,
  depth,
}: {
  folder: Subfolder;
  allFolders: Subfolder[];
  allDocs: Doc[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
  selectedDocId: string | null;
  onOpenDoc: (d: Doc) => void;
  onDeleteDoc: (id: string) => void;
  menuForDoc: string | null;
  setMenuForDoc: (id: string | null) => void;
  moveDocToFolder: (docId: string, folderId: string | null) => void;
  depth: number;
}) {
  const isOpen = expanded.has(folder.id);
  const children = allFolders.filter((f) => f.parentFolderId === folder.id);
  const ownDocs = allDocs.filter((d) => d.folderId === folder.id);
  const count = children.length + ownDocs.length;

  return (
    <div>
      <button
        onClick={() => onToggle(folder.id)}
        className="w-full flex items-center gap-1.5 py-1.5 rounded-md text-[12px] text-body hover:bg-canvas-soft transition-colors"
        style={{ paddingLeft: 8 + depth * 12, paddingRight: 8 }}
      >
        {isOpen ? (
          <ChevronDown className="w-3 h-3 text-muted-soft" strokeWidth={1.5} />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-soft" strokeWidth={1.5} />
        )}
        <Folder className="w-3.5 h-3.5 text-muted" strokeWidth={1.5} />
        <span className="flex-1 text-left truncate text-ink">{folder.name}</span>
        <span className="text-[10px] text-muted-soft">{count}</span>
      </button>
      {isOpen && (
        <div className="space-y-0.5 mt-0.5">
          {children.map((child) => (
            <FolderNode
              key={child.id}
              folder={child}
              allFolders={allFolders}
              allDocs={allDocs}
              expanded={expanded}
              onToggle={onToggle}
              selectedDocId={selectedDocId}
              onOpenDoc={onOpenDoc}
              onDeleteDoc={onDeleteDoc}
              menuForDoc={menuForDoc}
              setMenuForDoc={setMenuForDoc}
              moveDocToFolder={moveDocToFolder}
              depth={depth + 1}
            />
          ))}
          {ownDocs.map((doc) => (
            <DocRow
              key={doc.id}
              doc={doc}
              selected={selectedDocId === doc.id}
              onOpen={() => onOpenDoc(doc)}
              onDelete={() => onDeleteDoc(doc.id)}
              folders={allFolders}
              menuOpen={menuForDoc === doc.id}
              setMenuOpen={(o) => setMenuForDoc(o ? doc.id : null)}
              moveToFolder={(folderId) => moveDocToFolder(doc.id, folderId)}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DocRow({
  doc,
  selected,
  onOpen,
  onDelete,
  folders,
  menuOpen,
  setMenuOpen,
  moveToFolder,
  depth,
}: {
  doc: Doc;
  selected: boolean;
  onOpen: () => void;
  onDelete: () => void;
  folders: Subfolder[];
  menuOpen: boolean;
  setMenuOpen: (o: boolean) => void;
  moveToFolder: (folderId: string | null) => void;
  depth: number;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [menuOpen, setMenuOpen]);

  return (
    <div className="relative">
      <div
        onClick={onOpen}
        className={`flex items-center gap-2 py-1.5 rounded-lg cursor-pointer group transition-all duration-150 ${
          selected ? "bg-surface-card shadow-sm" : "hover:bg-surface-card/60"
        }`}
        style={{ paddingLeft: 8 + depth * 12, paddingRight: 8 }}
      >
        <FileIconFor type={doc.fileType} />
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <p className="text-[12.5px] text-ink truncate">{doc.filename}</p>
          {doc.versionCount > 1 && (
            <span className="shrink-0 inline-flex items-center rounded-md bg-surface-strong px-1 py-0.5 text-[9px] font-semibold text-body tracking-wide">
              V{doc.currentVersionNumber ?? doc.versionCount}
            </span>
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(!menuOpen);
          }}
          className="opacity-0 group-hover:opacity-100 p-1 text-muted-soft hover:text-body transition-all rounded"
        >
          <MoreHorizontal className="w-3 h-3" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="opacity-0 group-hover:opacity-100 p-1 text-muted-soft hover:text-error transition-all rounded"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute z-20 right-2 top-full mt-1 w-52 bg-canvas rounded-md shadow-lg border border-hairline overflow-hidden"
        >
          <p className="mono-label-sm px-3 pt-2 pb-1">
            Move to folder
          </p>
          <div className="max-h-48 overflow-y-auto pb-1">
            <button
              onClick={() => moveToFolder(null)}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-canvas-soft transition-colors text-left"
            >
              <FolderOpen
                className="w-3 h-3 text-muted-soft"
                strokeWidth={1.5}
              />
              <span className="text-[12px] text-ink">(Root)</span>
            </button>
            {folders.map((f) => (
              <button
                key={f.id}
                onClick={() => moveToFolder(f.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-canvas-soft transition-colors text-left"
              >
                <Folder
                  className="w-3 h-3 text-muted"
                  strokeWidth={1.5}
                />
                <span className="text-[12px] text-ink truncate">{f.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NewFolderInput({
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-canvas border border-hairline">
      <Folder className="w-3.5 h-3.5 text-muted" strokeWidth={1.5} />
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
          else if (e.key === "Escape") onCancel();
        }}
        onBlur={onSubmit}
        placeholder="Folder name"
        className="flex-1 min-w-0 bg-transparent text-[12px] text-ink placeholder:text-muted-soft focus:outline-none"
      />
    </div>
  );
}

function FileIconFor({ type }: { type: string | null }) {
  if (type === "pdf")
    return <FileText className="w-3.5 h-3.5 text-accent-coral shrink-0" strokeWidth={1.5} />;
  if (type === "docx" || type === "doc")
    return <File className="w-3.5 h-3.5 text-accent-blue shrink-0" strokeWidth={1.5} />;
  if (type === "png" || type === "jpg" || type === "jpeg")
    return <Image className="w-3.5 h-3.5 text-muted shrink-0" strokeWidth={1.5} />;
  if (type === "mp3" || type === "wav")
    return <Music className="w-3.5 h-3.5 text-muted shrink-0" strokeWidth={1.5} />;
  return <File className="w-3.5 h-3.5 text-muted shrink-0" strokeWidth={1.5} />;
}

// ---------------------------------------------------------------------------
// Document viewer (right panel) with version history + upload new version
// ---------------------------------------------------------------------------

function DocumentViewer({
  doc,
  docBytes,
  viewerKey,
  highlightQuote,
  citedPage,
  onClose,
  onReloadAfterVersion,
}: {
  doc: Doc;
  docBytes: Uint8Array;
  viewerKey: number;
  highlightQuote: string | null;
  citedPage: number | null;
  onClose: () => void;
  onReloadAfterVersion: (doc: Doc) => void;
}) {
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [uploadingVersion, setUploadingVersion] = useState(false);
  const [doc_, setDoc] = useState(doc);

  useEffect(() => {
    setDoc(doc);
  }, [doc]);

  const loadVersions = async () => {
    const v = await api.listDocumentVersions(doc_.id);
    setVersions(v);
  };

  useEffect(() => {
    if (showVersions) loadVersions();
  }, [showVersions, doc_.id]);

  const uploadNewVersion = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.docx,.doc,.png,.jpg,.jpeg";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploadingVersion(true);
      const buffer = await file.arrayBuffer();
      await api.uploadNewVersion(
        doc_.id,
        file.name,
        Array.from(new Uint8Array(buffer)),
      );
      setUploadingVersion(false);
      setShowVersions(false);
      onReloadAfterVersion(doc_);
    };
    input.click();
  };

  const switchToVersion = async (versionId: string) => {
    await api.setActiveVersion(doc_.id, versionId);
    setShowVersions(false);
    onReloadAfterVersion(doc_);
  };

  const formatSize = (b: number) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="w-[480px] border-l border-hairline flex flex-col shrink-0 bg-canvas-soft animate-slide-in-right">
      <div className="flex items-center justify-between px-4 py-3 border-b border-hairline-soft">
        <div className="flex items-center gap-2 min-w-0">
          <Eye className="w-4 h-4 text-muted shrink-0" strokeWidth={1.5} />
          <p className="text-[13px] font-medium text-ink truncate">
            {doc_.filename}
          </p>
          {doc_.versionCount > 1 && (
            <span className="shrink-0 inline-flex items-center rounded-md bg-surface-strong px-1.5 py-0.5 text-[10px] font-semibold text-body tracking-wide">
              V{doc_.currentVersionNumber ?? doc_.versionCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <div className="relative">
            <button
              onClick={() => setShowVersions((v) => !v)}
              title="Version history"
              className="p-1.5 text-muted hover:text-body hover:bg-surface-strong transition-colors rounded"
            >
              <History className="w-3.5 h-3.5" strokeWidth={1.5} />
            </button>
            {showVersions && (
              <VersionPopover
                versions={versions}
                currentVersionId={doc_.currentVersionId}
                onSwitch={switchToVersion}
                onUpload={uploadNewVersion}
                uploading={uploadingVersion}
                onClose={() => setShowVersions(false)}
              />
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-muted hover:text-body hover:bg-surface-strong transition-colors rounded"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Highlight quote banner */}
      {highlightQuote && (
        <div className="mx-3 mt-3 p-3 bg-surface-wash-blue border border-hairline-soft rounded-md">
          <div className="flex items-start gap-2">
            <BookOpen
              className="w-4 h-4 text-accent-blue shrink-0 mt-0.5"
              strokeWidth={1.5}
            />
            <div>
              <p className="mono-label-sm mb-1">
                Cited passage{citedPage ? ` / Page ${citedPage}` : ""}
              </p>
              <p className="text-[12px] text-ink leading-relaxed italic">
                "{highlightQuote}"
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-3">
        {doc_.fileType === "pdf" ? (
          <PdfView
            bytes={docBytes}
            targetPage={citedPage}
            highlightQuote={highlightQuote}
            reloadKey={viewerKey}
          />
        ) : doc_.fileType === "docx" || doc_.fileType === "doc" ? (
          <DocxView
            key={viewerKey}
            docId={doc_.id}
            versionId={doc_.currentVersionId}
            highlightQuote={highlightQuote}
          />
        ) : doc_.fileType === "png" ||
          doc_.fileType === "jpg" ||
          doc_.fileType === "jpeg" ? (
          <img
            src={URL.createObjectURL(
              new Blob([docBytes.buffer as ArrayBuffer]),
            )}
            className="max-w-full rounded-md border border-hairline"
            alt={doc_.filename}
          />
        ) : (
          <div className="bg-canvas rounded-md border border-hairline p-6 text-center">
            <File
              className="w-8 h-8 text-muted mx-auto mb-2"
              strokeWidth={1.5}
            />
            <p className="text-sm text-muted">{doc_.filename}</p>
            <p className="text-[11px] text-muted-soft mt-1">
              {formatSize(doc_.sizeBytes)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function VersionPopover({
  versions,
  currentVersionId,
  onSwitch,
  onUpload,
  uploading,
  onClose,
}: {
  versions: DocumentVersion[];
  currentVersionId: string | null;
  onSwitch: (versionId: string) => void;
  onUpload: () => void;
  uploading: boolean;
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
      className="absolute right-0 top-full mt-1 w-72 bg-canvas rounded-md shadow-lg border border-hairline overflow-hidden z-30"
    >
      <div className="px-3 pt-2 pb-1.5 flex items-center justify-between border-b border-hairline-soft">
        <p className="mono-label-sm">
          Version history
        </p>
        <button
          onClick={onUpload}
          disabled={uploading}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-ink bg-surface-strong hover:bg-hairline rounded-md transition-colors disabled:opacity-50"
        >
          {uploading ? (
            <RefreshCw className="w-2.5 h-2.5 animate-spin" strokeWidth={2} />
          ) : (
            <Upload className="w-2.5 h-2.5" strokeWidth={2} />
          )}
          Upload new
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto py-1">
        {versions.length === 0 ? (
          <p className="text-[11px] text-muted-soft px-3 py-4 text-center">
            Loading...
          </p>
        ) : (
          versions.map((v) => {
            const active = v.id === currentVersionId;
            return (
              <button
                key={v.id}
                onClick={() => !active && onSwitch(v.id)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                  active ? "bg-surface-strong/60" : "hover:bg-surface-strong/60"
                }`}
              >
                <span
                  className={`inline-flex items-center justify-center w-7 h-5 rounded-md text-[10px] font-semibold tracking-wide ${
                    active
                      ? "bg-primary text-on-primary"
                      : "bg-surface-strong text-body"
                  }`}
                >
                  V{v.versionNumber ?? "?"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-ink truncate">
                    {v.displayName ?? "Version"}
                  </p>
                  <p className="text-[10px] text-muted-soft">
                    {new Date(v.createdAt).toLocaleString()} · {v.source}
                  </p>
                </div>
                {active && (
                  <span className="text-[9px] font-semibold text-muted-soft tracking-wide">
                    ACTIVE
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
