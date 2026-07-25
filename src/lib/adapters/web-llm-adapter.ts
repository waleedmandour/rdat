/**
 * WebLLMAdapter — LLMAdapter implementation backed by @mlc-ai/web-llm.
 *
 * Wraps the existing `local-llm-engine.ts` module so that WebLLM can be
 * used through the unified LLMAdapter interface alongside the new
 * OllamaAdapter. This is a thin facade — all real logic stays in
 * local-llm-engine.ts to avoid duplicating the model-loading,
 * state-machine, and prefetch-cache code.
 *
 * This adapter is used:
 *   - In PWA mode (browser-only deployment on Vercel)
 *   - In Tauri mode as a FALLBACK when Ollama is not available
 *
 * WebLLM requires WebGPU (Chrome 113+, Edge 113+). On browsers without
 * WebGPU (Safari, Firefox, mobile browsers), `isAvailable()` returns
 * false and the adapter is not selectable.
 */

import type {
  LLMAdapter,
  AdapterState,
  ModelInfo,
  TranslateOptions,
  StateChangeCallback,
} from "../llm-adapter";
import { useWorkspaceStore } from "../../stores/workspace-store";
import type { TranslationDirection } from "../../stores/workspace-store";

// Lazy-import the engine to avoid pulling WebLLM into the Tauri-only
// bundle path. The dynamic import also lets us gracefully handle the
// case where WebGPU is unavailable without throwing at module load.
let engineModule: typeof import("../local-llm-engine") | null = null;
async function getEngine() {
  if (!engineModule) {
    engineModule = await import("../local-llm-engine");
  }
  return engineModule;
}

// ─── Static Model Catalog ─────────────────────────────────────────
// WebLLM has a fixed catalog — models are pulled from MLC's CDN on
// first load. We expose them as ModelInfo so the AiModelsView can
// render them uniformly with Ollama models.

const WEBLLM_CATALOG: Array<Omit<ModelInfo, "isCached">> = [
  {
    id: "qwen-1.5b",
    name: "Qwen 2.5 1.5B Instruct",
    parameters: "1.5B",
    size: "~1.0 GB",
    family: "Qwen",
  },
  {
    id: "gemma-2b",
    name: "Gemma 2 2B IT",
    parameters: "2B",
    size: "~1.4 GB",
    family: "Gemma",
  },
  {
    id: "qwen-7b",
    name: "Qwen 2.5 7B Instruct",
    parameters: "7B",
    size: "~4.0 GB",
    family: "Qwen",
  },
  {
    id: "gemma-7b",
    name: "Gemma 2 9B IT",
    parameters: "9B",
    size: "~5.0 GB",
    family: "Gemma",
  },
  {
    id: "llama3-8b",
    name: "Llama 3.1 8B Instruct",
    parameters: "8B",
    size: "~4.5 GB",
    family: "Llama",
  },
];

// ─── Adapter Implementation ───────────────────────────────────────

export class WebLLMAdapter implements LLMAdapter {
  readonly id = "web-llm" as const;
  readonly displayName = "WebLLM (WebGPU)";

  private subscribers: Set<StateChangeCallback> = new Set();
  private unsubscribeEngine: (() => void) | null = null;

  // ── Identity / Availability ──

  async isAvailable(): Promise<boolean> {
    try {
      const engine = await getEngine();
      return await engine.isWebGPUAvailable();
    } catch {
      return false;
    }
  }

  // ── Model Lifecycle ──

  isModelLoaded(): boolean {
    if (!engineModule) return false;
    return engineModule.isModelLoaded();
  }

  getLoadedModelId(): string | null {
    if (!engineModule) return null;
    return engineModule.getLoadedModelId();
  }

  async loadModel(modelId: string, onProgress?: (progress: number) => void): Promise<void> {
    const engine = await getEngine();
    // Wire up engine state → our subscribers
    this.attachToEngineState(engine);
    await engine.loadModel(modelId, onProgress);
  }

  async unloadModel(): Promise<void> {
    if (!engineModule) return;
    await engineModule.unloadModel();
  }

  // ── Inference ──

  async translate(opts: TranslateOptions): Promise<string[]> {
    const engine = await getEngine();
    const { sourceText, targetPrefix = "", ragEntries } = opts;

    // Read the current translation direction from the workspace store.
    // This mirrors what the OllamaAdapter does and ensures WebLLM-based
    // inference produces direction-aware prompts (previously the
    // WebLLM path hardcoded English→Arabic — see PHASE 1 task 1.2).
    const direction: TranslationDirection =
      useWorkspaceStore.getState().direction || "en-ar";

    // Delegate to the engine's RAG or non-RAG path based on whether
    // RAG entries were provided. This preserves the existing
    // prefetch-cache behavior that TargetEditor relies on.
    if (ragEntries && ragEntries.length > 0) {
      return engine.generateRAGTranslation(sourceText, targetPrefix, 5, direction);
    }
    return engine.generateLocalTranslation(sourceText, targetPrefix, direction);
  }

  // ── Model Catalog ──

  async listModels(): Promise<ModelInfo[]> {
    const engine = await getEngine();
    const result: ModelInfo[] = [];
    for (const entry of WEBLLM_CATALOG) {
      let isCached = false;
      try {
        isCached = await engine.isModelCached(entry.id);
      } catch {
        // ignore — treat as not cached
      }
      result.push({ ...entry, isCached });
    }
    return result;
  }

  async removeModel(modelId: string): Promise<void> {
    const engine = await getEngine();
    await engine.removeModelCache(modelId);
  }

  // ── Error Tracking ──

  getLastError(): string | null {
    if (!engineModule) return null;
    // Engine exposes both load errors (engineError) and inference
    // errors (lastLLMError). Prefer the most recent inference error
    // since that's what callers care about during translation.
    return engineModule.getLastLLMError() ?? engineModule.getEngineError();
  }

  // ── State Subscription ──

  onStateChange(cb: StateChangeCallback): () => void {
    this.subscribers.add(cb);

    // Lazy-attach to the engine on first subscription
    if (!this.unsubscribeEngine) {
      getEngine().then((engine) => this.attachToEngineState(engine));
    }

    return () => {
      this.subscribers.delete(cb);
    };
  }

  getState(): AdapterState {
    if (!engineModule) return "idle";
    // Map engine's LLMEngineState to our AdapterState 1:1
    return engineModule.getEngineState() as AdapterState;
  }

  getProgress(): number {
    if (!engineModule) return 0;
    return engineModule.getLoadingProgress();
  }

  // ─── Internal: Bridge engine state → our subscribers ──────────

  private attachToEngineState(engine: typeof import("../local-llm-engine")) {
    if (this.unsubscribeEngine) return; // already attached
    this.unsubscribeEngine = engine.onEngineStateChange((state, progress, error) => {
      this.subscribers.forEach((cb) => cb(state as AdapterState, progress, error));
    });
  }
}

export default WebLLMAdapter;
