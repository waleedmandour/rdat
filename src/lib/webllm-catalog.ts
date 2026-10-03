/**
 * Centralized WebLLM model catalog — the SINGLE source of truth.
 *
 * Previously the catalog was duplicated:
 *   - MODEL_MAP in src/lib/local-llm-engine.ts (RDAT id → MLC id)
 *   - WEBLLM_CATALOG in src/lib/adapters/web-llm-adapter.ts (display info)
 *
 * Task 4 (v0.4.0) centralizes both into this file. Both consumers import
 * from here. Adding a model is a one-line addition to MODELS below.
 *
 * Branch B (no verified 12B MLC build exists): the Gemma 4 E4B
 * community build is shipped labelled "Experimental". A 12B entry is
 * a one-line addition once an MLC build exists — see
 * docs/webllm-gemma4-12b-build.md for the conversion recipe.
 */

import type { TranslationDirection } from "../stores/workspace-store";

// ─── Model record ──────────────────────────────────────────────────
// Combines the MLC ModelRecord fields (model, model_id, model_lib,
// vram_required_MB, required_features) with RDAT display fields (name,
// parameters, size, family, badge).
export interface WebLLMModelRecord {
  /** RDAT catalog id (used in settings-store.downloadedModels / loadedModel). */
  id: string;
  /** Display name. */
  name: string;
  /** Parameter count for display (e.g. "1.5B", "E4B"). */
  parameters: string;
  /** Approximate download size for display (e.g. "~1.0 GB"). */
  size: string;
  /** Model family for display (e.g. "Qwen", "Gemma"). */
  family: string;
  /** MLC model_id (the id inside the appConfig.model_list). */
  mlcModelId: string;
  /** Full URL to the model directory (weights + mlc-chat-config.json). */
  model: string;
  /** Full URL to the compiled WebGPU wasm. */
  modelLib: string;
  /** Estimated VRAM required in MB (for capability gating). */
  vramRequiredMB: number;
  /** Required WebGPU features (e.g. ["shader-f16"]). */
  requiredFeatures: string[];
  /**
   * Badge: "Experimental" for unvalidated community builds,
   * "Highest quality" for the best verified model, undefined for
   * standard entries.
   */
  badge?: "Experimental" | "Highest quality";
  /** Context window in tokens (for prompt truncation). */
  contextWindow: number;
  /**
   * Conversation template (from mlc-chat-config.json). Used to
   * configure the engine correctly. The WebLLM runtime reads this
   * from the model's mlc-chat-config.json at load time, so we don't
   * need to pass it — but we store it for documentation/validation.
   */
  convTemplate?: string;
}

// ─── The catalog ───────────────────────────────────────────────────
// Prebuilt models (from MLC's CDN) use the model_id directly; WebLLM
// resolves them via its built-in prebuiltAppConfig. Custom models
// (community builds) need the full model + modelLib URLs.
//
// To add a 12B Gemma 4 build once one exists, add an entry here with
// the real mlcModelId / model / modelLib URLs — that's the one-line
// addition. See docs/webllm-gemma4-12b-build.md.

export const MODELS: WebLLMModelRecord[] = [
  {
    id: "qwen-1.5b",
    name: "Qwen 2.5 1.5B Instruct",
    parameters: "1.5B",
    size: "~1.0 GB",
    family: "Qwen",
    mlcModelId: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    // Prebuilt: WebLLM resolves via prebuiltAppConfig, so model/modelLib
    // are not needed. We set them to empty strings.
    model: "",
    modelLib: "",
    vramRequiredMB: 2048,
    requiredFeatures: ["shader-f16"],
    contextWindow: 32768,
  },
  {
    id: "gemma-2b",
    name: "Gemma 2 2B IT",
    parameters: "2B",
    size: "~1.4 GB",
    family: "Gemma",
    mlcModelId: "gemma-2-2b-it-q4f16_1-MLC",
    model: "",
    modelLib: "",
    vramRequiredMB: 2560,
    requiredFeatures: ["shader-f16"],
    contextWindow: 8192,
  },
  {
    id: "qwen-7b",
    name: "Qwen 2.5 7B Instruct",
    parameters: "7B",
    size: "~4.0 GB",
    family: "Qwen",
    mlcModelId: "Qwen2.5-7B-Instruct-q4f16_1-MLC",
    model: "",
    modelLib: "",
    vramRequiredMB: 6144,
    requiredFeatures: ["shader-f16"],
    contextWindow: 32768,
  },
  {
    id: "gemma-7b",
    name: "Gemma 2 9B IT",
    parameters: "9B",
    size: "~5.0 GB",
    family: "Gemma",
    mlcModelId: "gemma-2-9b-it-q4f16_1-MLC",
    model: "",
    modelLib: "",
    vramRequiredMB: 7168,
    requiredFeatures: ["shader-f16"],
    contextWindow: 8192,
  },
  {
    id: "llama3-8b",
    name: "Llama 3.1 8B Instruct",
    parameters: "8B",
    size: "~4.5 GB",
    family: "Llama",
    mlcModelId: "Llama-3.1-8B-Instruct-q4f16_1-MLC",
    model: "",
    modelLib: "",
    vramRequiredMB: 6656,
    requiredFeatures: ["shader-f16"],
    contextWindow: 131072,
  },
  // ─── Gemma 4 E4B (Experimental community build) ──────────────────
  // Branch B: no verified 12B MLC build exists (verified 2026-10-03
  // via HuggingFace API search: 0 results for "gemma-4 12B MLC").
  // The upstream google/gemma-4-12B-it is real (Apache 2.0) but has
  // no MLC/WebLLM-format build. The E4B community build at
  // welcoma/gemma-4-E4B-it-q4f16_1-MLC is the closest verified
  // Gemma 4 artifact: it has mlc-chat-config.json, the wasm, build
  // provenance, and a WebLLM usage snippet. Its README explicitly
  // says "build candidate, not an official mlc-ai release … browser
  // runtime validation still required." Labelled "Experimental".
  //
  // To add a 12B build once one exists, add an entry like:
  //   {
  //     id: "gemma-4-12b",
  //     name: "Gemma 4 12B IT",
  //     parameters: "12B",
  //     size: "~7.0 GB",
  //     family: "Gemma",
  //     mlcModelId: "gemma-4-12B-it-q4f16_1-MLC",
  //     model: "https://huggingface.co/<org>/<repo>/resolve/main/",
  //     modelLib: "https://huggingface.co/<org>/<repo>/resolve/main/libs/<...>-webgpu.wasm",
  //     vramRequiredMB: 9216,
  //     requiredFeatures: ["shader-f16"],
  //     badge: "Highest quality",
  //     contextWindow: 4096,
  //     convTemplate: "gemma4_instruction",
  //   }
  {
    id: "gemma-4-e4b",
    name: "Gemma 4 E4B IT (Experimental)",
    parameters: "E4B",
    size: "~3.98 GB",
    family: "Gemma",
    mlcModelId: "gemma-4-E4B-it-q4f16_1-MLC",
    model: "https://huggingface.co/welcoma/gemma-4-E4B-it-q4f16_1-MLC/resolve/main/",
    modelLib: "https://huggingface.co/welcoma/gemma-4-E4B-it-q4f16_1-MLC/resolve/main/libs/gemma-4-E4B-it-q4f16_1-MLC-webgpu.wasm",
    vramRequiredMB: 5120, // 3.976 GB weights + overhead
    requiredFeatures: ["shader-f16"],
    badge: "Experimental",
    contextWindow: 4096,
    convTemplate: "gemma4_instruction",
  },
];

// ─── Lookup helpers ────────────────────────────────────────────────

/** Get a model record by RDAT id. Returns undefined if not found. */
export function getModelById(id: string): WebLLMModelRecord | undefined {
  return MODELS.find((m) => m.id === id);
}

/** Get the MLC model_id for a given RDAT id. */
export function getMlcModelId(rdatId: string): string | undefined {
  return getModelById(rdatId)?.mlcModelId;
}

/** Build the WebLLM AppConfig.model_list for custom (non-prebuilt) models. */
export function getCustomModelList(): Array<{
  model: string;
  model_id: string;
  model_lib: string;
  vram_required_MB: number;
  required_features: string[];
}> {
  return MODELS.filter((m) => m.model && m.modelLib).map((m) => ({
    model: m.model,
    model_id: m.mlcModelId,
    model_lib: m.modelLib,
    vram_required_MB: m.vramRequiredMB,
    required_features: m.requiredFeatures,
  }));
}

// ─── Capability gating (pure, testable) ────────────────────────────

export interface CapabilityInfo {
  webgpuAvailable: boolean;
  shaderF16: boolean;
  maxBufferSize: number;
  maxStorageBufferBindingSize: number;
}

export interface GatingResult {
  /** Can the model load at all? */
  canLoad: boolean;
  /** Hard blockers (model cannot load). */
  blockers: string[];
  /** Soft warnings (model may load but probably won't work well). */
  warnings: string[];
}

/**
 * Check whether a model can load on the current device.
 *
 * Pure: takes a CapabilityInfo (so tests can mock the adapter) and a
 * model record. Returns blockers (hard) + warnings (soft).
 *
 * Hard blockers:
 *   - WebGPU unavailable
 *   - shader-f16 required but not available (and no q4f32_1 fallback)
 *
 * Soft warnings (do NOT hard-block):
 *   - maxBufferSize < vramRequiredMB * 1.1 (10% headroom)
 *   - maxStorageBufferBindingSize < 256MB (typical for large models)
 *   - navigator.hardwareConcurrency low
 *   - mobile device (coarse pointer or small screen)
 */
export function checkModelCapability(
  model: WebLLMModelRecord,
  caps: CapabilityInfo,
  options?: { isMobile?: boolean; hardwareConcurrency?: number }
): GatingResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Hard: WebGPU
  if (!caps.webgpuAvailable) {
    blockers.push("WebGPU unavailable in this browser. Use Chrome 113+ or Edge 113+.");
  }

  // Hard: shader-f16
  if (model.requiredFeatures.includes("shader-f16") && !caps.shaderF16) {
    // Per the brief: "prefer q4f16_1, fall back to a q4f32_1 variant
    // if one exists, else disable with an explanation". We don't have
    // q4f32_1 variants for any model in the catalog today. So this is
    // a hard block with an explanation.
    blockers.push(
      "This model requires the shader-f16 WebGPU feature, which is not available on this device. " +
      "No q4f32_1 fallback build exists for this model yet."
    );
  }

  // Soft: VRAM (maxBufferSize is in bytes; convert model MB to bytes)
  const requiredBytes = model.vramRequiredMB * 1024 * 1024;
  if (caps.maxBufferSize > 0 && caps.maxBufferSize < requiredBytes * 1.1) {
    warnings.push(
      `Device maxBufferSize (${(caps.maxBufferSize / 1024 / 1024).toFixed(0)} MB) is close to ` +
      `this model's requirement (~${model.vramRequiredMB} MB). The model may fail to load or run slowly.`
    );
  }

  // Soft: storage buffer binding size
  if (caps.maxStorageBufferBindingSize > 0 && caps.maxStorageBufferBindingSize < 256 * 1024 * 1024) {
    warnings.push(
      `Device maxStorageBufferBindingSize (${(caps.maxStorageBufferBindingSize / 1024 / 1024).toFixed(0)} MB) ` +
      `is below the recommended 256 MB for large models.`
    );
  }

  // Soft: low core count
  if (options?.hardwareConcurrency !== undefined && options.hardwareConcurrency < 4) {
    warnings.push(
      `Low CPU core count (${options.hardwareConcurrency}). Inference will be slow.`
    );
  }

  // Soft: mobile
  if (options?.isMobile) {
    warnings.push(
      "Mobile devices often have limited VRAM and thermal throttling. " +
      "Large models may fail to load or crash mid-inference."
    );
  }

  return {
    canLoad: blockers.length === 0,
    blockers,
    warnings,
  };
}

/**
 * Detect capability info from a real WebGPU adapter.
 * Returns null if WebGPU is unavailable.
 */
export async function detectCapabilityInfo(): Promise<CapabilityInfo | null> {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) return null;
  try {
    const adapter = await (navigator as any).gpu.requestAdapter();
    if (!adapter) return null;
    const info: CapabilityInfo = {
      webgpuAvailable: true,
      shaderF16: adapter.features.has("shader-f16"),
      maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    };
    return info;
  } catch {
    return null;
  }
}

// ─── Storage pre-check ─────────────────────────────────────────────

export interface StorageCheckResult {
  ok: boolean;
  error?: string;
  quota?: number;
  usage?: number;
}

/**
 * Pre-check navigator.storage.estimate() against the model's download
 * size. Requests navigator.storage.persist(). Returns a clear error
 * on insufficient quota.
 */
export async function precheckStorage(
  model: WebLLMModelRecord
): Promise<StorageCheckResult> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    // Can't check — assume OK (e.g. Tauri environment).
    return { ok: true };
  }
  try {
    const estimate = await navigator.storage.estimate();
    const quota = estimate.quota ?? 0;
    const usage = estimate.usage ?? 0;
    const available = quota - usage;
    // Parse the model size string (e.g. "~3.98 GB") into bytes.
    const requiredBytes = parseSizeToBytes(model.size);
    if (requiredBytes > 0 && available < requiredBytes * 1.2) {
      return {
        ok: false,
        error: `Insufficient storage. Model requires ~${model.size} but only ${(available / 1024 / 1024 / 1024).toFixed(1)} GB is available. Free up space or remove other models.`,
        quota,
        usage,
      };
    }
    // Request persistent storage (best-effort, don't block on failure)
    if (navigator.storage.persist) {
      try {
        await navigator.storage.persist();
      } catch {
        // Non-fatal
      }
    }
    return { ok: true, quota, usage };
  } catch (e: any) {
    return { ok: false, error: `Storage check failed: ${e?.message || e}` };
  }
}

function parseSizeToBytes(sizeStr: string): number {
  const match = sizeStr.match(/~?([\d.]+)\s*(GB|MB)/i);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  return unit === "GB" ? num * 1024 * 1024 * 1024 : num * 1024 * 1024;
}

// ─── Direction-aware stop tokens + thinking markup strip ───────────
// Gemma 4 uses the gemma4_instruction conv template. The WebLLM
// runtime handles stop tokens via the mlc-chat-config.json. But Gemma 4
// is a "unified" model with thinking/reasoning support — we must
// ensure no thinking markup leaks into ghost text.
//
// stripThinkingMarkup removes <think>...</think> blocks and any
// leading "Thinking:" preamble. Applied to all model outputs in
// local-llm-engine.ts (see generateLocalTranslation /
// generateRAGTranslation).

export function stripThinkingMarkup(text: string): string {
  // Remove <think>...</think> blocks (case-insensitive, multiline)
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // Remove unclosed <think> block to end of string
  out = out.replace(/<think>[\s\S]*$/gi, "");
  // Remove leading "Thinking:" preamble (Gemma 4 sometimes emits this)
  out = out.replace(/^\s*Thinking:\s*[\s\S]*?(?=\n\n|\n[A-Z]|\nTranslation:)/i, "");
  // Trim leading whitespace left by the removal
  return out.trim();
}

// ─── Context window truncation ─────────────────────────────────────
// When the prompt exceeds the model's context window, truncate RAG
// glossary context first (per the brief). Returns the trimmed entries.
//
// The entry type is generic over any record with `en` + `ar` string
// fields (matching CorpusEntry from local-translation-engine.ts).

export function truncateRAGContext<T extends { en: string; ar: string }>(
  ragEntries: T[],
  sourceText: string,
  targetPrefix: string,
  contextWindow: number,
  reservedTokens: number = 512
): T[] {
  // Coarse token estimate: ~4 chars per token for English, ~2 for Arabic.
  // Be conservative (2 chars/token) so we don't overflow.
  const systemPromptTokens = 200; // approx for the RAG system prompt
  const userPromptTokens = Math.ceil((sourceText.length + targetPrefix.length) / 2);
  const budget = contextWindow - reservedTokens - systemPromptTokens - userPromptTokens;
  if (budget <= 0) return []; // no room for RAG

  const out: T[] = [];
  let used = 0;
  for (const entry of ragEntries) {
    const entryTokens = Math.ceil((entry.en.length + entry.ar.length) / 2) + 4;
    if (used + entryTokens > budget) break;
    out.push(entry);
    used += entryTokens;
  }
  return out;
}

// Re-export TranslationDirection for convenience (avoid circular import
// — workspace-store imports from segmentation, not from here).
export type { TranslationDirection };
