export type ChannelSource = "lte" | "rag" | "localAgent" | "webllm" | "gemini" | "prefetch";

export interface SuggestionResult {
  text: string;
  source: ChannelSource;
  latency: number;
  confidence: number;
  isBurst?: boolean;
}

export interface ChannelResult {
  source: ChannelSource;
  text: string;
  latency: number;
  confidence: number;
  error?: string;
}

export interface TMEntry {
  id: number;
  source: string;
  target: string;
  source_lang: string;
  target_lang: string;
  domain?: string;
  created_at?: string;
  updated_at?: string;
  _pendingSync?: boolean;
}

export interface GlossaryEntry {
  /**
   * Audit fix #7: id is now `number | string`. Manually-added and
   * JSON-uploaded entries get auto-incremented numeric ids from
   * IndexedDB; reference-DB entries get deterministic string ids of
   * the form "{dbId}-{idx}" so they can't collide with numeric ids
   * and can be removed as a group when the user toggles the DB off.
   */
  id: number | string;
  source_term: string;
  target_term: string;
  source_lang: string;
  target_lang: string;
  pos?: string;
  domain?: string;
  notes?: string;
  created_at?: string;
  /**
   * Optional reference-DB tag. When set, this entry belongs to a
   * downloadable reference DB (e.g. "wipo", "microsoft", "opus") and
   * can be removed as a group when the user toggles that DB off via
   * the "Use" button. Entries added manually or via JSON upload do
   * not have this field set. See PHASE 2 task 2.3.
   */
  source_db?: string;
}

export interface SegmentEntry {
  /**
   * Audit fix #6: id is now `number | string`. Confirmed segments use
   * a deterministic string id so re-confirming an edited segment
   * upserts instead of duplicating.
   *
   * Task 2 (v0.4.0): `sourceHash` was added (DB v4, additive index).
   *
   * Issue 2 (v0.4.1): `docId` was added (DB v5, additive index). The
   * id format is now `{docId}:{sourceLang}-{targetLang}:{idx}` (was
   * `{sourceLang}-{targetLang}-{idx}`) so confirming a segment in
   * document B no longer overwrites document A's saved translation.
   * Legacy v4 entries without `docId` are NOT attached by hydration
   * (conservative — the user re-translates).
   */
  id: number | string;
  source: string;
  target: string;
  source_lang: string;
  target_lang: string;
  status: "draft" | "confirmed" | "rejected" | "locked";
  score: number;
  source_file?: string;
  segment_index?: number;
  /**
   * FNV-1a hash of the source text (hex string). Used by the hydration
   * path to refuse re-attaching a saved translation to different
   * source text. Undefined on legacy v3 entries (treated as "do not
   * attach"). See src/lib/segmentation/types.ts fnv1aHex.
   */
  sourceHash?: string;
  /**
   * Document/project id (Issue 2, v0.4.1). Groups segments by document
   * so cross-document overwrites can't happen. Undefined on legacy v4
   * entries (treated as "do not attach"). See src/stores/workspace-store.ts
   * currentDocId.
   */
  docId?: string;
  created_at?: string;
  updated_at?: string;
  _pendingSync?: boolean;
}

/**
 * Document/project metadata (Issue 2, v0.4.1). Stored in the `documents`
 * object store (DB v5). One row per imported document. Used by a future
 * document-manager UI (list, switch, rename, delete). For now, the
 * workspace tracks the active docId + name; this store persists them so
 * a document can be re-opened after a reload.
 */
export interface DocumentMeta {
  /** UUID (crypto.randomUUID()). */
  id: string;
  /** Display name (usually the imported filename, or "Pasted text"). */
  name: string;
  source_lang: string;
  target_lang: string;
  /** Number of segments at import time (for display). */
  segment_count: number;
  created_at: string;
  updated_at: string;
}

export type StoreName = "tm_entries" | "glossary" | "segments" | "sync_meta" | "documents";

export type NavItem = "translator" | "glossary" | "models" | "api-keys" | "settings";

export type EngineMode = "hybrid" | "local" | "cloud";
export type GTRStatus = "active" | "zero-shot";

export interface WebGPUInfo {
  state: "unavailable" | "initializing" | "ready" | "error";
  progress?: number;
  error?: string;
}

export interface RAGState {
  isWorkerReady: boolean;
  isCorpusLoaded: boolean;
  isLoading: boolean;
  error: string | null;
  corpusSize: number;
  modelsLoaded: boolean;
}

export type LocalAgentState = "disconnected" | "connected" | "syncing" | "ready" | "error";

export interface LanguageContextType {
  locale: "en" | "ar";
  setLocale: (locale: "en" | "ar") => void;
  t: (key: string) => any;
}

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

export interface ToastContextType {
  toasts: Toast[];
  showToast: (message: string, type?: ToastType) => void;
  removeToast: (id: string) => void;
}

export interface TutorAnalysis {
  rating: number;
  grade: string;
  explanation: string;
  termsAnalysed: { term: string; analysis: string }[];
  pitfalls: string;
}


