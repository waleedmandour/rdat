/**
 * LLM Adapter Interface — Abstraction over local LLM backends.
 *
 * The project supports two local LLM backends:
 *   1. WebLLMAdapter  — runs @mlc-ai/web-llm in the browser via WebGPU
 *                       (used in PWA mode and as fallback in Tauri)
 *   2. OllamaAdapter  — calls a local Ollama daemon via Tauri Rust commands
 *                       (used in Tauri desktop mode, primary engine)
 *
 * Both adapters implement this interface so that TargetEditor and the
 * rest of the ghost-text pipeline can swap backends without touching
 * tier-fallback logic, error surfacing, or the tier-source badge.
 *
 * Selection logic (see `adapters/index.ts → getActiveAdapter`):
 *   - If running inside Tauri AND Ollama daemon is reachable → OllamaAdapter
 *   - Else if WebGPU is available                              → WebLLMAdapter
 *   - Else                                                     → null (Gemini only)
 *
 * The adapter is RESPONSIBLE FOR:
 *   - Loading / unloading models
 *   - Generating translation candidates
 *   - Surfacing its own errors via getLastError()
 *   - Notifying subscribers on state changes (loading, ready, error)
 *
 * The adapter is NOT responsible for:
 *   - Tier fallback (TargetEditor handles that)
 *   - RAG retrieval (TargetEditor passes CorpusEntry[] in)
 *   - Caching (handled by callers)
 *   - UI / toasts (handled by TargetEditor)
 */

import type { CorpusEntry } from "./local-translation-engine";

// ─── Shared Types ──────────────────────────────────────────────────

export type AdapterId = "web-llm" | "ollama";

export type AdapterState =
  | "idle"          // No model loaded
  | "loading"       // Model is being downloaded / loaded
  | "ready"         // Model loaded and ready for inference
  | "generating"    // Inference in progress
  | "error";        // Last operation failed (see getLastError)

export interface ModelInfo {
  /** Adapter-specific model identifier (e.g. "qwen2.5:1.5b" for Ollama, "qwen-1.5b" for WebLLM). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Approximate parameter count (e.g. "1.5B", "7B"). */
  parameters: string;
  /** Approximate size on disk (human-readable, e.g. "~1.0 GB"). */
  size: string;
  /** Whether the model is currently downloaded / cached locally. */
  isCached: boolean;
  /** Family / lineage (e.g. "Qwen", "Gemma", "Llama"). */
  family: string;
}

export interface TranslateOptions {
  /** English source text to translate. */
  sourceText: string;
  /** Already-typed Arabic prefix to condition on (may be empty). */
  targetPrefix?: string;
  /** Optional RAG context entries (top-k glossary/TM hits). */
  ragEntries?: CorpusEntry[];
  /** Max tokens to generate (default 256). */
  maxTokens?: number;
  /** Sampling temperature (default 0.3 for deterministic translations). */
  temperature?: number;
}

export interface StateChangeCallback {
  (state: AdapterState, progress: number, error: string | null): void;
}

// ─── Adapter Interface ─────────────────────────────────────────────

export interface LLMAdapter {
  // ── Identity ──
  /** Unique adapter identifier. */
  readonly id: AdapterId;
  /** Human-readable display name (e.g. "Ollama (Local)", "WebLLM (WebGPU)"). */
  readonly displayName: string;

  // ── Availability ──
  /**
   * Check if this adapter is available in the current environment.
   *   - WebLLM: returns true if `navigator.gpu` is present and an adapter can be requested.
   *   - Ollama: returns true if running inside Tauri AND the Ollama daemon responds on localhost:11434.
   *
   * This is a quick check — it does NOT verify that a model is loaded.
   * Use `isModelLoaded()` for that.
   */
  isAvailable(): Promise<boolean>;

  // ── Model Lifecycle ──
  /** Check if a model is currently loaded and ready for inference. */
  isModelLoaded(): boolean;
  /** Get the currently loaded model ID (adapter-specific), or null. */
  getLoadedModelId(): string | null;
  /**
   * Load a model.
   * @param modelId Adapter-specific model identifier
   * @param onProgress Optional progress callback (0-100)
   */
  loadModel(modelId: string, onProgress?: (progress: number) => void): Promise<void>;
  /** Unload the current model and free resources. */
  unloadModel(): Promise<void>;

  // ── Inference ──
  /**
   * Generate translation candidates.
   * @returns Array of translation candidates (best first); empty array on failure.
   *          Call `getLastError()` to retrieve the error message if empty.
   */
  translate(opts: TranslateOptions): Promise<string[]>;

  // ── Model Catalog ──
  /**
   * List available models for this adapter.
   *   - WebLLM: returns the static catalog from MODEL_MAP.
   *   - Ollama: queries the daemon's `/api/tags` endpoint for installed models.
   */
  listModels(): Promise<ModelInfo[]>;
  /**
   * Download / pull a model so it can be loaded later.
   *   - WebLLM: no-op (models are downloaded on `loadModel`).
   *   - Ollama: POSTs to `/api/pull` and streams progress.
   * @param onProgress Optional progress callback (0-100)
   */
  pullModel?(modelId: string, onProgress?: (progress: number) => void): Promise<void>;
  /**
   * Delete a model from local storage.
   *   - WebLLM: deletes from browser Cache API.
   *   - Ollama: DELETEs from the daemon's model store.
   */
  removeModel?(modelId: string): Promise<void>;

  // ── Error Tracking ──
  /** Get the most recent error from this adapter, or null if last op succeeded. */
  getLastError(): string | null;

  // ── State Subscription ──
  /**
   * Subscribe to state changes (loading, ready, generating, error).
   * @returns Unsubscribe function.
   */
  onStateChange(cb: StateChangeCallback): () => void;
  /** Get the current adapter state. */
  getState(): AdapterState;
  /** Get the current loading progress (0-100). */
  getProgress(): number;
}

// ─── Helper: Build RAG-Enriched System Prompt ─────────────────────
// Shared between adapters so the prompt is identical regardless of backend.
// Extracted here so changes to the prompt format apply to both adapters.

export function buildRAGSystemPrompt(ragEntries?: CorpusEntry[]): string {
  const baseInstructions = [
    "You are a professional English-to-Arabic translator specializing in Computer-Assisted Translation (CAT) workflows.",
    "Your task is to translate the given English text into natural, accurate, and fluent Arabic.",
    "Follow these rules strictly:",
    "1. Use the reference glossary terms preferentially wherever they apply.",
    "2. Maintain terminological consistency — if a term appears multiple times, translate it the same way each time.",
    "3. Produce Modern Standard Arabic (فصحى) suitable for professional/academic contexts.",
    "4. Do NOT add explanations, notes, transliterations, or commentary.",
    "5. Output ONLY the Arabic translation — nothing else.",
  ].join("\n");

  let ragContext = "";
  if (ragEntries && ragEntries.length > 0) {
    const formatted = ragEntries
      .map((e) => `  • "${e.en}" → "${e.ar}"`)
      .join("\n");
    ragContext = `\n\nReference glossary (use these terms preferentially where applicable):\n${formatted}`;
  }

  return baseInstructions + ragContext;
}

// ─── Helper: Build User Prompt ────────────────────────────────────

export function buildUserPrompt(sourceText: string, targetPrefix?: string): string {
  const prefix = targetPrefix?.trim();
  return prefix
    ? `Translate the following English text to Arabic. The translation must start with: "${prefix}"\n\nEnglish: ${sourceText}\nArabic:`
    : `Translate the following English text to Arabic.\n\nEnglish: ${sourceText}\nArabic:`;
}
