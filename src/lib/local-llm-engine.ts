/**
 * Local LLM Engine — On-device translation inference via WebGPU using @mlc-ai/web-llm.
 *
 * This module wraps the MLC WebLLM engine to provide:
 *   1. Real model downloading and caching (via browser Cache API)
 *   2. On-device inference for translation suggestions
 *   3. Model lifecycle management (load / unload / status)
 *   4. RAG-augmented translation with selective glossary context
 *   5. Translation prefetch cache for instant ghost-text display
 *
 * Architecture (Phase 2 — RAG-augmented pipeline):
 *   LTE (dict/n-gram) → RAG-LLM (WebGPU + glossary context) → Cloud Gemini (fallback)
 *                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 *                        This module provides the middle tier.
 */

import {
  CreateMLCEngine,
  MLCEngine,
  type InitProgressCallback,
  type InitProgressReport,
  hasModelInCache,
  deleteModelInCache,
} from "@mlc-ai/web-llm";
import { getLTE, type CorpusEntry } from "./local-translation-engine";
import {
  buildRAGSystemPrompt,
  buildUserPrompt,
} from "./llm-adapter";
import type { TranslationDirection } from "../stores/workspace-store";

// ─── Model ID Mapping ─────────────────────────────────────────────
// Maps the RDAT catalog IDs to the actual MLC WebLLM model registry IDs.
// We prefer q4f16_1 quantization for the best speed/quality tradeoff.
//
// NOTE: WebLLM catalog lags behind Ollama. Gemma 4 / Qwen 3 / Llama 4
// may not yet be on MLC's registry. The OllamaAdapter is the primary
// path for modern models; WebLLMAdapter is the browser fallback and
// uses whatever MLC has available. See RECOMMENDED_OLLAMA_MODELS in
// ollama-adapter.ts for the modern lineup.
export const MODEL_MAP: Record<string, string> = {
  "qwen-1.5b": "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  "gemma-2b": "gemma-2-2b-it-q4f16_1-MLC",
  "qwen-7b": "Qwen2.5-7B-Instruct-q4f16_1-MLC",
  "gemma-7b": "gemma-2-9b-it-q4f16_1-MLC", // closest 7B-class Gemma available
  "llama3-8b": "Llama-3.1-8B-Instruct-q4f16_1-MLC",
};

// ─── Engine State ──────────────────────────────────────────────────

let engine: MLCEngine | null = null;
let currentModelId: string | null = null;
let isLoadingModel = false;
let loadingProgress = 0;

export type LLMEngineState =
  | "idle"
  | "loading"
  | "ready"
  | "generating"
  | "error";

let engineState: LLMEngineState = "idle";
let engineError: string | null = null;

// ─── Inference Error Tracking ────────────────────────────────────
// Separate from `engineError` (which tracks *load* failures).
// `lastLLMError` tracks the most recent *inference* failure so
// downstream consumers (TargetEditor, StatusBar) can surface it.
let lastLLMError: string | null = null;

/** Get the most recent inference error, or null if the last call succeeded. */
export function getLastLLMError(): string | null {
  return lastLLMError;
}

// ─── Translation Prefetch Cache ──────────────────────────────────
// When the user focuses a segment, we prefetch a full translation
// and cache it. The ghost-text system then compares the user's typed
// prefix against this cached translation to instantly produce a
// suggestion remainder — no LLM call needed until the user deviates.
const prefetchCache = new Map<string, { translation: string; timestamp: number }>();
const PREFETCH_TTL_MS = 120_000; // Cache entries expire after 2 minutes

/** Store a prefetched translation in the cache. */
export function cachePrefetch(sourceText: string, translation: string): void {
  prefetchCache.set(sourceText.trim().toLowerCase(), {
    translation,
    timestamp: Date.now(),
  });
  // Prune expired entries
  const now = Date.now();
  for (const [key, val] of prefetchCache) {
    if (now - val.timestamp > PREFETCH_TTL_MS) {
      prefetchCache.delete(key);
    }
  }
}

/** Retrieve a cached prefetch translation, or null if not found/expired. */
export function getPrefetch(sourceText: string): string | null {
  const entry = prefetchCache.get(sourceText.trim().toLowerCase());
  if (!entry) return null;
  if (Date.now() - entry.timestamp > PREFETCH_TTL_MS) {
    prefetchCache.delete(sourceText.trim().toLowerCase());
    return null;
  }
  return entry.translation;
}

/** Clear the entire prefetch cache. */
export function clearPrefetchCache(): void {
  prefetchCache.clear();
}

// ─── Callbacks ─────────────────────────────────────────────────────

type StateChangeCallback = (
  state: LLMEngineState,
  progress: number,
  error: string | null
) => void;

const subscribers: Set<StateChangeCallback> = new Set();

function notifySubscribers() {
  subscribers.forEach((cb) =>
    cb(engineState, loadingProgress, engineError)
  );
}

/** Subscribe to engine state changes. Returns an unsubscribe function. */
export function onEngineStateChange(cb: StateChangeCallback): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

// ─── Core Functions ────────────────────────────────────────────────
//
// NOTE: This module previously held its own duplicated EN→AR system/user
// prompt strings. They have been removed in favour of the shared
// `buildRAGSystemPrompt()` / `buildUserPrompt()` helpers from
// `./llm-adapter.ts`, which are direction-aware and are also used by
// the Ollama adapter. Keeping a single source of truth for the prompt
// prevents the three tiers (LTE / local LLM / Gemini) from drifting
// apart again — see PHASE 1 task 1.2 in the project brief.

/**
 * Load a model into WebGPU memory.
 *
 * This triggers the actual download of model weights if they are not cached.
 * The download is managed by @mlc-ai/web-llm using the browser Cache API.
 *
 * @param rdatModelId - The RDAT catalog model ID (e.g. "qwen-1.5b")
 * @param onProgress - Optional progress callback (0-100)
 */
export async function loadModel(
  rdatModelId: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  const mlcModelId = MODEL_MAP[rdatModelId];
  if (!mlcModelId) {
    throw new Error(
      `Unknown model ID: "${rdatModelId}". Available: ${Object.keys(MODEL_MAP).join(", ")}`
    );
  }

  // Already loaded the same model — no-op
  if (engine && currentModelId === rdatModelId) {
    console.log(`[LocalLLM] Model "${rdatModelId}" already loaded.`);
    return;
  }

  // If another model is currently loading, reject
  if (isLoadingModel) {
    throw new Error("Another model is currently loading. Please wait.");
  }

  // Unload any previous model
  if (engine) {
    console.log("[LocalLLM] Unloading previous model...");
    await unloadModel();
  }

  isLoadingModel = true;
  loadingProgress = 0;
  engineState = "loading";
  engineError = null;
  notifySubscribers();

  const progressCallback: InitProgressCallback = (report: InitProgressReport) => {
    loadingProgress = Math.round(report.progress * 100);
    onProgress?.(loadingProgress);
    notifySubscribers();
  };

  try {
    console.log(`[LocalLLM] Loading model "${mlcModelId}" via WebGPU...`);
    engine = await CreateMLCEngine(mlcModelId, {
      initProgressCallback: progressCallback,
    });
    currentModelId = rdatModelId;
    engineState = "ready";
    loadingProgress = 100;
    console.log(`[LocalLLM] Model "${rdatModelId}" loaded successfully.`);
  } catch (err: any) {
    engine = null;
    currentModelId = null;
    engineState = "error";
    engineError = err?.message || String(err);
    console.error("[LocalLLM] Failed to load model:", engineError);
    throw err;
  } finally {
    isLoadingModel = false;
    notifySubscribers();
  }
}

/**
 * Unload the current model and free WebGPU memory.
 */
export async function unloadModel(): Promise<void> {
  if (engine) {
    try {
      await engine.unload();
    } catch (err) {
      console.warn("[LocalLLM] Error during unload:", err);
    }
    engine = null;
    currentModelId = null;
  }
  engineState = "idle";
  loadingProgress = 0;
  engineError = null;
  notifySubscribers();
  console.log("[LocalLLM] Model unloaded.");
}

/**
 * Generate translation suggestions using the on-device LLM (no RAG context).
 *
 * This is the basic inference function used as a fallback when the LTE
 * corpus is empty and no RAG context is available.
 *
 * @param sourceText - The source text to translate
 * @param targetPrefix - The already-typed target-language prefix to condition on
 * @param direction - Translation direction ("en-ar" or "ar-en"). Defaults to
 *                    "en-ar" for backward compatibility with callers that
 *                    haven't been updated yet.
 * @returns Array of translation candidate strings
 */
export async function generateLocalTranslation(
  sourceText: string,
  targetPrefix: string,
  direction: TranslationDirection = "en-ar"
): Promise<string[]> {
  if (!engine || !currentModelId) {
    console.warn("[LocalLLM] No model loaded — cannot generate.");
    return [];
  }

  const prevState = engineState;
  engineState = "generating";
  notifySubscribers();

  try {
    const systemPrompt = buildRAGSystemPrompt(undefined, direction);
    const userPrompt = buildUserPrompt(sourceText, targetPrefix, direction);

    const reply = await engine.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 256,
      temperature: 0.3,
    });

    const candidates: string[] = [];
    for (const choice of reply.choices) {
      const content = choice.message?.content?.trim();
      if (content) {
        candidates.push(content);
      }
    }

    return candidates;
  } catch (err: any) {
    console.error("[LocalLLM] Inference failed:", err);
    lastLLMError = err?.message || String(err);
    return [];
  } finally {
    engineState = prevState === "generating" ? "ready" : prevState;
    notifySubscribers();
  }
}

/**
 * Generate RAG-augmented translation suggestions using the on-device LLM.
 *
 * This is the primary inference function for the Phase 2 pipeline. It
 * constructs a domain-specific system prompt enriched with selective
 * glossary/TM context retrieved from the LTE. Only the top-k most
 * relevant entries are included to avoid context bloat and keep the
 * prompt within token limits of smaller models (1.5B–9B parameters).
 *
 * Features:
 *   - Selective RAG: Retrieves only top-k (default 5) most relevant entries
 *   - Structured system prompt with CAT-specific instructions
 *   - Glossary-aware translation with terminological consistency enforcement
 *   - Falls back to non-RAG translation if no relevant entries found
 *   - Caches the result in the prefetch cache for instant ghost-text
 *   - Direction-aware: prompts and LTE search both branch on direction
 *
 * @param sourceText - The source text to translate
 * @param targetPrefix - The already-typed target-language prefix to condition on
 * @param topK - Maximum number of glossary entries to include as RAG context
 * @param direction - Translation direction ("en-ar" or "ar-en"). Defaults to
 *                    "en-ar" for backward compatibility.
 * @returns Array of translation candidate strings
 */
export async function generateRAGTranslation(
  sourceText: string,
  targetPrefix: string,
  topK = 5,
  direction: TranslationDirection = "en-ar"
): Promise<string[]> {
  if (!engine || !currentModelId) {
    console.warn("[LocalLLM] No model loaded — cannot generate RAG translation.");
    return [];
  }

  const prevState = engineState;
  engineState = "generating";
  notifySubscribers();

  try {
    // ── Selective RAG: Retrieve top-k relevant glossary entries ──
    // LTE.search() is direction-aware: it matches against the source
    // field for the active direction so AR→EN queries match on Arabic.
    const lte = getLTE();
    const ragEntries: Array<CorpusEntry & { score: number }> = lte.getStats().entries > 0
      ? lte.search(sourceText, topK, direction)
      : [];

    // Build the structured system + user prompts via the shared
    // direction-aware builders. This is the same path used by the
    // Ollama adapter, so all local-LLM tiers share identical prompt
    // logic and stay in sync.
    const systemPrompt = buildRAGSystemPrompt(ragEntries, direction);
    const userPrompt = buildUserPrompt(sourceText, targetPrefix, direction);

    const reply = await engine.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 256,
      temperature: 0.3,
    });

    const candidates: string[] = [];
    for (const choice of reply.choices) {
      const content = choice.message?.content?.trim();
      if (content) {
        candidates.push(content);
      }
    }

    // Cache the best candidate in the prefetch cache
    if (candidates.length > 0) {
      cachePrefetch(sourceText, candidates[0]);
    }

    return candidates;
  } catch (err: any) {
    console.error("[LocalLLM] RAG inference failed:", err);
    lastLLMError = err?.message || String(err);
    return [];
  } finally {
    engineState = prevState === "generating" ? "ready" : prevState;
    notifySubscribers();
  }
}

/**
 * Prefetch a translation for a source segment.
 *
 * Called when the user focuses a new segment (before they start typing).
 * The result is cached and used for instant ghost-text display when the
 * user begins typing. If a cached result already exists and is fresh,
 * it is returned immediately without calling the LLM.
 *
 * @param sourceText - The source text to pre-translate
 * @param direction - Translation direction ("en-ar" or "ar-en"). Defaults
 *                    to "en-ar" for backward compatibility.
 * @returns The cached or freshly generated translation, or null on failure
 */
export async function prefetchTranslation(
  sourceText: string,
  direction: TranslationDirection = "en-ar"
): Promise<string | null> {
  // Check prefetch cache first
  const cached = getPrefetch(sourceText);
  if (cached) {
    console.log("[LocalLLM] Prefetch cache hit for segment.");
    return cached;
  }

  // Also check LTE for an instant match
  const lte = getLTE();
  if (lte.getStats().entries > 0) {
    const lteResult = lte.getSuggestion(sourceText, "", direction);
    if (lteResult && lteResult.match) {
      cachePrefetch(sourceText, lteResult.match);
      return lteResult.match;
    }
  }

  // If a model is loaded, use RAG translation for the prefetch
  if (engine && currentModelId && engineState === "ready") {
    try {
      const candidates = await generateRAGTranslation(sourceText, "", 5, direction);
      if (candidates.length > 0) {
        return candidates[0];
      }
    } catch (err) {
      console.warn("[LocalLLM] Prefetch inference failed:", err);
    }
  }

  return null;
}

// ─── Query Functions ───────────────────────────────────────────────

/** Check if a model is currently loaded and ready for inference. */
export function isModelLoaded(): boolean {
  return engine !== null && engineState === "ready";
}

/** Get the currently loaded RDAT model ID, or null. */
export function getLoadedModelId(): string | null {
  return currentModelId;
}

/** Get the current engine state. */
export function getEngineState(): LLMEngineState {
  return engineState;
}

/** Get the current loading progress (0-100). */
export function getLoadingProgress(): number {
  return loadingProgress;
}

/** Get the last error, if any. */
export function getEngineError(): string | null {
  return engineError;
}

/**
 * Check if a model's weights are already cached in the browser.
 * This avoids re-downloading on subsequent loads.
 */
export async function isModelCached(rdatModelId: string): Promise<boolean> {
  const mlcModelId = MODEL_MAP[rdatModelId];
  if (!mlcModelId) return false;
  try {
    return await hasModelInCache(mlcModelId);
  } catch {
    return false;
  }
}

/**
 * Delete a model's cached weights from the browser.
 * Useful for freeing up storage.
 */
export async function removeModelCache(rdatModelId: string): Promise<void> {
  const mlcModelId = MODEL_MAP[rdatModelId];
  if (!mlcModelId) return;
  try {
    await deleteModelInCache(mlcModelId);
    console.log(`[LocalLLM] Cache cleared for "${rdatModelId}".`);
  } catch (err) {
    console.warn(`[LocalLLM] Failed to clear cache for "${rdatModelId}":`, err);
  }
}

/**
 * Check WebGPU availability in the current browser.
 * Returns true if WebGPU is available, false otherwise.
 *
 * CRITICAL: This function has a 2-second timeout. In Tauri's WebView2
 * (Windows) and WKWebView (macOS), navigator.gpu.requestAdapter() can
 * hang for 10-30 seconds or indefinitely when WebGPU is not properly
 * supported. Without a timeout, this blocks the entire UI — the
 * "Detecting engine..." spinner, the WelcomeTab checklist, and the
 * useWebLLM hook all call this function on startup.
 *
 * The timeout is applied at the source so ALL callers are protected.
 */
export async function isWebGPUAvailable(): Promise<boolean> {
  if (!("gpu" in navigator)) return false;
  try {
    // Race requestAdapter() against a 2-second timeout.
    // If it doesn't resolve in 2s, assume WebGPU is unavailable.
    const adapter = await Promise.race([
      (navigator as any).gpu.requestAdapter(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    return adapter !== null;
  } catch {
    return false;
  }
}
