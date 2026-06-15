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
  id: number;
  source_term: string;
  target_term: string;
  source_lang: string;
  target_lang: string;
  pos?: string;
  domain?: string;
  notes?: string;
  created_at?: string;
}

export interface SegmentEntry {
  id: number;
  source: string;
  target: string;
  source_lang: string;
  target_lang: string;
  status: "draft" | "confirmed" | "rejected" | "locked";
  score: number;
  source_file?: string;
  segment_index?: number;
  created_at?: string;
  updated_at?: string;
  _pendingSync?: boolean;
}

export type StoreName = "tm_entries" | "glossary" | "segments" | "sync_meta";

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


