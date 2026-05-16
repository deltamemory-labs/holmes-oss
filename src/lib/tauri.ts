import { invoke, Channel } from "@tauri-apps/api/core";

export interface AppSettings {
  displayName: string | null;
  organisation: string | null;
  hasGeminiKey: boolean;
  hasAnthropicKey: boolean;
  hasOpenaiKey: boolean;
  ollamaBaseUrl: string;
  defaultMainModel: string;
  defaultTabularModel: string;
  defaultTitleModel: string;
  onboardingComplete: boolean;
}

export interface UpdateSettingsInput {
  displayName?: string;
  organisation?: string;
  geminiApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  ollamaBaseUrl?: string;
  defaultMainModel?: string;
  defaultTabularModel?: string;
  defaultTitleModel?: string;
  onboardingComplete?: boolean;
}

export interface Project {
  id: string;
  name: string;
  cmNumber: string | null;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Subfolder {
  id: string;
  projectId: string;
  name: string;
  parentFolderId: string | null;
  createdAt: string;
}

export interface Document {
  id: string;
  projectId: string | null;
  folderId: string | null;
  filename: string;
  fileType: string | null;
  sizeBytes: number;
  status: string;
  currentVersionId: string | null;
  currentVersionNumber: number | null;
  versionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  storagePath: string;
  source: string;
  versionNumber: number | null;
  displayName: string | null;
  createdAt: string;
}

export interface Chat {
  id: string;
  projectId: string | null;
  title: string | null;
  createdAt: string;
}

export interface AttachedFile {
  document_id: string;
  filename: string;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  role: string;
  content: string | null;
  files: string | null;
  annotations: string | null;
  createdAt: string;
}

export type ChatEvent = { line: string };

export interface TabularReview {
  id: string;
  projectId: string | null;
  title: string | null;
  columnsConfig: string | null;
  createdAt: string;
}

export interface TabularCell {
  id: string;
  reviewId: string;
  documentId: string;
  columnIndex: number;
  content: string | null;
  citations: string | null;
  status: string;
}

export type CellEvent =
  | { event: "Complete"; data: { document_id: string; column_index: number; content: string } }
  | { event: "Error"; data: { document_id: string; column_index: number; message: string } }
  | { event: "BatchProgress"; data: { completed: number; total: number } };

export interface Workflow {
  id: string;
  title: string;
  type: string;
  promptMd: string | null;
  columnsConfig: string | null;
  practice: string | null;
  isSystem: boolean;
  createdAt: string;
}

export interface OllamaModel {
  name: string;
  size: number | null;
  modifiedAt: string | null;
}

export const api = {
  getSettings: () => invoke<AppSettings>("get_settings"),
  updateSettings: (input: UpdateSettingsInput) =>
    invoke<void>("update_settings", { input }),
  validateApiKey: (key: string) =>
    invoke<boolean>("validate_api_key", { key }),
  listOllamaModels: (baseUrl?: string) =>
    invoke<OllamaModel[]>("list_ollama_models", { baseUrl }),

  // Projects
  createProject: (name: string, cmNumber?: string) =>
    invoke<Project>("create_project", { name, cmNumber }),
  listProjects: () => invoke<Project[]>("list_projects"),
  getProject: (id: string) => invoke<Project>("get_project", { id }),
  deleteProject: (id: string) => invoke<void>("delete_project", { id }),
  renameProject: (id: string, name: string) =>
    invoke<void>("rename_project", { id, name }),

  // Subfolders
  listSubfolders: (projectId: string) =>
    invoke<Subfolder[]>("list_subfolders", { projectId }),
  createSubfolder: (projectId: string, name: string, parentFolderId?: string) =>
    invoke<Subfolder>("create_subfolder", { projectId, name, parentFolderId }),
  renameSubfolder: (id: string, name: string) =>
    invoke<void>("rename_subfolder", { id, name }),
  moveSubfolder: (id: string, parentFolderId: string | null) =>
    invoke<void>("move_subfolder", { id, parentFolderId }),
  deleteSubfolder: (id: string) =>
    invoke<void>("delete_subfolder", { id }),
  moveDocumentToFolder: (docId: string, folderId: string | null) =>
    invoke<void>("move_document_to_folder", { docId, folderId }),

  // Documents
  uploadDocument: (
    projectId: string,
    filename: string,
    fileBytes: number[],
    folderId?: string,
  ) =>
    invoke<Document>("upload_document", { projectId, filename, fileBytes, folderId }),
  uploadNewVersion: (docId: string, filename: string, fileBytes: number[]) =>
    invoke<DocumentVersion>("upload_new_version", { docId, filename, fileBytes }),
  listDocumentVersions: (docId: string) =>
    invoke<DocumentVersion[]>("list_document_versions", { docId }),
  setActiveVersion: (docId: string, versionId: string) =>
    invoke<void>("set_active_version", { docId, versionId }),
  listDocuments: (projectId: string) =>
    invoke<Document[]>("list_documents", { projectId }),
  readDocumentBytes: (docId: string, versionId?: string) =>
    invoke<number[]>("read_document_bytes", { docId, versionId }),
  deleteDocument: (docId: string) =>
    invoke<void>("delete_document", { docId }),
  extractDocxHtml: (docId: string, versionId?: string) =>
    invoke<string>("extract_docx_html", { docId, versionId }),

  // Chat
  createChat: (projectId?: string) =>
    invoke<Chat>("create_chat", { projectId }),
  listChats: (projectId?: string) =>
    invoke<Chat[]>("list_chats", { projectId }),
  getChat: (chatId: string) => invoke<Chat>("get_chat", { chatId }),
  getChatMessages: (chatId: string) =>
    invoke<ChatMessage[]>("get_chat_messages", { chatId }),
  deleteChat: (chatId: string) =>
    invoke<void>("delete_chat", { chatId }),

  // Tabular Reviews
  createReview: (projectId: string | undefined, title: string, columnsConfig: string) =>
    invoke<TabularReview>("create_review", { projectId, title, columnsConfig }),
  listReviews: (projectId?: string) =>
    invoke<TabularReview[]>("list_reviews", { projectId }),
  getReviewCells: (reviewId: string) =>
    invoke<TabularCell[]>("get_review_cells", { reviewId }),
  deleteReview: (reviewId: string) =>
    invoke<void>("delete_review", { reviewId }),
  renameReview: (reviewId: string, title: string) =>
    invoke<void>("rename_review", { reviewId, title }),
  updateReviewColumns: (reviewId: string, columnsConfig: string) =>
    invoke<void>("update_review_columns", { reviewId, columnsConfig }),
  extractSingleCell: (cellId: string) =>
    invoke<TabularCell>("extract_single_cell", { cellId }),
  addDocumentsToReview: (reviewId: string, docIds: string[], columnCount: number) =>
    invoke<void>("add_documents_to_review", { reviewId, docIds, columnCount }),
  extractAllCells: (reviewId: string, onEvent: (event: CellEvent) => void) => {
    const channel = new Channel<CellEvent>();
    channel.onmessage = onEvent;
    return invoke<void>("extract_all_cells", { reviewId, onEvent: channel });
  },

  // Workflows
  listWorkflows: () => invoke<Workflow[]>("list_workflows"),
  getWorkflow: (id: string) => invoke<Workflow>("get_workflow", { id }),
  createWorkflow: (title: string, opts?: { type?: string; promptMd?: string; columnsConfig?: string; practice?: string }) =>
    invoke<Workflow>("create_workflow", { title, ...opts }),
  updateWorkflow: (id: string, opts: { title?: string; promptMd?: string; columnsConfig?: string; practice?: string }) =>
    invoke<void>("update_workflow", { id, ...opts }),
  createReviewFromWorkflow: (workflowId: string, projectId: string, docIds: string[], title?: string) =>
    invoke<string>("create_review_from_workflow", { workflowId, projectId, docIds, title }),
  deleteWorkflow: (id: string) => invoke<void>("delete_workflow", { id }),
};

export function parseAttachedFiles(raw: string | null): AttachedFile[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
