/**
 * Local LLM Engine — On-device translation inference via WebGPU using @mlc-ai/web-llm.
 *
 * This module wraps the MLC WebLLM engine to provide:
 *   1. Real model downloading and caching (via browser Cache API)
 *   2. On-device inference for translation suggestions
 *   3. Model lifecycle management (load / unload / status)
 *
 * Architecture:
 *   LTE (dict/n-gram) → Local LLM (WebGPU inference) → Cloud Gemini (fallback)
 *                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
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

// ─── Model ID Mapping ─────────────────────────────────────────────
// Maps the RDAT catalog IDs to the actual MLC WebLLM model registry IDs.
// We prefer q4f16_1 quantization for the best speed/quality tradeoff.
export const MODEL_MAP: Record<string, string> = {
  "qwen-1.5b": "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  "gemma-2b": "gemma-2-2b-it-q4f16_1-MLC",
  "qwen-7b": "Qwen2.5-7B-Instruct-q4f16_1-MLC",
  "gemma-7b": "gemma-2-9b-it-q4f16_1-MLC", // closest 7B-class Gemma available
  "llama3-8b": "Llama-3.1-8B-Instruct-q4f16_1-MLC",
};

/** Reverse map: MLC model ID → RDAT catalog ID */
const REVERSE_MODEL_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(MODEL_MAP).map(([rdatId, mlcId]) => [mlcId, rdatId])
);

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
 * Generate translation suggestions using the on-device LLM.
 *
 * This is the core inference function. It constructs a translation prompt
 * and calls the model's chat completion API.
 *
 * @param sourceText - The source text to translate (English)
 * @param targetPrefix - The already-typed Arabic prefix to condition on
 * @returns Array of translation candidate strings
 */
export async function generateLocalTranslation(
  sourceText: string,
  targetPrefix: string
): Promise<string[]> {
  if (!engine || !currentModelId) {
    console.warn("[LocalLLM] No model loaded — cannot generate.");
    return [];
  }

  const prevState = engineState;
  engineState = "generating";
  notifySubscribers();

  try {
    // Construct a focused translation prompt
    const systemPrompt = `You are a professional English-to-Arabic translator. Translate the given English text into natural, accurate Arabic. Only output the Arabic translation, nothing else. Do not add explanations, notes, or transliterations.`;

    const userPrompt = targetPrefix.trim()
      ? `Translate the following English text to Arabic. The translation must start with: "${targetPrefix.trim()}"\n\nEnglish: ${sourceText}\nArabic:`
      : `Translate the following English text to Arabic.\n\nEnglish: ${sourceText}\nArabic:`;

    const reply = await engine.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 256,
      temperature: 0.3,
      // Only request 1 candidate for speed; we can increase to n: 2 if needed
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
    return [];
  } finally {
    engineState = prevState === "generating" ? "ready" : prevState;
    notifySubscribers();
  }
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
 */
export async function isWebGPUAvailable(): Promise<boolean> {
  if (!("gpu" in navigator)) return false;
  try {
    const adapter = await (navigator as any).gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}
