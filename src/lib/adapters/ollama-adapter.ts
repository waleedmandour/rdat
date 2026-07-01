/**
 * OllamaAdapter — LLMAdapter implementation backed by a local Ollama
 * daemon, accessed via Tauri Rust commands.
 *
 * Architecture:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Tauri Webview (React)                                        │
 *   │   TargetEditor → OllamaAdapter → @tauri-apps/api invoke()    │
 *   └────────────────────────────────┬─────────────────────────────┘
 *                                    │ IPC
 *   ┌────────────────────────────────▼─────────────────────────────┐
 *   │ Tauri Rust Backend (src-tauri/src/commands.rs)                │
 *   │   ollama_health, ollama_list_models, ollama_pull_model,       │
 *   │   ollama_translate                                             │
 *   └────────────────────────────────┬─────────────────────────────┘
 *                                    │ HTTP (localhost)
 *   ┌────────────────────────────────▼─────────────────────────────┐
 *   │ Ollama Daemon (localhost:11434)                               │
 *   │   /api/tags, /api/pull, /api/generate                         │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Why this design:
 *   - The webview cannot call http://localhost:11434 directly due to
 *     CORS and mixed-content restrictions when the webview is served
 *     over a custom protocol. Tauri's Rust side has no such limits.
 *   - Keeping HTTP logic in Rust means we can use reqwest's streaming
 *     for pull progress, proper error types, and avoid bundling a
 *     fetch polyfill in the webview.
 *   - The adapter on the JS side stays thin: it just marshals args
 *     and unwraps results.
 *
 * When running outside Tauri (PWA mode), `isAvailable()` returns false
 * and all command invocations throw a clear error. The adapter factory
 * falls back to WebLLMAdapter in that case.
 */

import type {
  LLMAdapter,
  AdapterState,
  ModelInfo,
  TranslateOptions,
  StateChangeCallback,
} from "../llm-adapter";
import { buildRAGSystemPrompt, buildUserPrompt } from "../llm-adapter";
import type { CorpusEntry } from "../local-translation-engine";

// ─── Tauri Detection ──────────────────────────────────────────────
// We check for Tauri's runtime global. This avoids importing
// @tauri-apps/api when not in Tauri (which would break the PWA build).

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  }
}

export function isTauriEnvironment(): boolean {
  return (
    typeof window !== "undefined" &&
    (typeof window.__TAURI_INTERNALS__ !== "undefined" ||
      typeof window.__TAURI__ !== "undefined")
  );
}

// ─── Tauri invoke (lazy-loaded) ───────────────────────────────────

let invokeModule: any | null = null;
async function getInvoke(): Promise<(cmd: string, args?: Record<string, unknown>) => Promise<any>> {
  if (!invokeModule) {
    const mod = await import("@tauri-apps/api/core");
    invokeModule = mod.invoke;
  }
  return invokeModule;
}

// ─── Default Ollama Model Catalog ─────────────────────────────────
// Even though Ollama can run any model the user has pulled, we ship a
// recommended catalog so the AiModelsView can offer one-click install.
// These map to Ollama model tags — the user can pull more if desired.

const RECOMMENDED_OLLAMA_MODELS: Array<Omit<ModelInfo, "isCached">> = [
  {
    id: "qwen2.5:1.5b",
    name: "Qwen 2.5 1.5B Instruct",
    parameters: "1.5B",
    size: "~1.0 GB",
    family: "Qwen",
  },
  {
    id: "gemma2:2b",
    name: "Gemma 2 2B IT",
    parameters: "2B",
    size: "~1.6 GB",
    family: "Gemma",
  },
  {
    id: "qwen2.5:7b",
    name: "Qwen 2.5 7B Instruct",
    parameters: "7B",
    size: "~4.7 GB",
    family: "Qwen",
  },
  {
    id: "gemma2:9b",
    name: "Gemma 2 9B IT",
    parameters: "9B",
    size: "~5.5 GB",
    family: "Gemma",
  },
  {
    id: "llama3.1:8b",
    name: "Llama 3.1 8B Instruct",
    parameters: "8B",
    size: "~4.9 GB",
    family: "Llama",
  },
];

// ─── Adapter State (internal) ─────────────────────────────────────

let currentState: AdapterState = "idle";
let currentProgress = 0;
let currentError: string | null = null;
let loadedModelId: string | null = null;

const subscribers: Set<StateChangeCallback> = new Set();

function notifySubscribers() {
  subscribers.forEach((cb) => cb(currentState, currentProgress, currentError));
}

function setState(state: AdapterState, progress = currentProgress, error: string | null = currentError) {
  currentState = state;
  currentProgress = progress;
  currentError = error;
  notifySubscribers();
}

// ─── Adapter Implementation ───────────────────────────────────────

export class OllamaAdapter implements LLMAdapter {
  readonly id = "ollama" as const;
  readonly displayName = "Ollama (Local Daemon)";

  // ── Identity / Availability ──

  async isAvailable(): Promise<boolean> {
    if (!isTauriEnvironment()) return false;
    try {
      const invoke = await getInvoke();
      // The Rust command returns true if Ollama daemon responds on
      // localhost:11434/api/tags within a 2-second timeout.
      return await invoke("ollama_health");
    } catch (e: any) {
      console.warn("[OllamaAdapter] health check failed:", e);
      return false;
    }
  }

  // ── Model Lifecycle ──
  //
  // Note: Ollama doesn't have an explicit "load" step like WebLLM.
  // Models are loaded by the daemon on first inference and unloaded
  // automatically after `OLLAMA_KEEP_ALIVE` (default 5 min) of
  // inactivity. We model "loaded" as "the model the user has selected
  // for use" — a UI concept, not a daemon state.

  isModelLoaded(): boolean {
    return loadedModelId !== null;
  }

  getLoadedModelId(): string | null {
    return loadedModelId;
  }

  async loadModel(modelId: string, _onProgress?: (progress: number) => void): Promise<void> {
    // For Ollama, "loading" means "the user has selected this model
    // and we should ensure it's pulled locally". We do NOT auto-pull
    // here — the user pulls explicitly via pullModel(). If the model
    // isn't pulled yet, the first translate() call will fail with a
    // clear error from the daemon.

    // Verify the model exists locally
    const installed = await this.listModels();
    const found = installed.find((m) => m.id === modelId);
    if (!found) {
      const err = `Model "${modelId}" is not installed. Pull it first via pullModel().`;
      setState("error", 0, err);
      throw new Error(err);
    }

    loadedModelId = modelId;
    setState("ready", 100, null);
  }

  async unloadModel(): Promise<void> {
    // Ollama manages memory itself — we just clear our selection.
    // The daemon will unload the model from memory after its
    // keep-alive timeout. No need to call the daemon explicitly.
    loadedModelId = null;
    setState("idle", 0, null);
  }

  // ── Inference ──

  async translate(opts: TranslateOptions): Promise<string[]> {
    if (!loadedModelId) {
      const err = "No model selected. Call loadModel() first.";
      setState("error", 0, err);
      throw new Error(err);
    }

    const { sourceText, targetPrefix = "", ragEntries, maxTokens = 256, temperature = 0.3 } = opts;

    const systemPrompt = buildRAGSystemPrompt(ragEntries);
    const userPrompt = buildUserPrompt(sourceText, targetPrefix);

    const prevState = currentState;
    setState("generating");

    try {
      const invoke = await getInvoke();
      const result = await invoke("ollama_translate", {
        req: {
          model: loadedModelId,
          systemPrompt,
          userPrompt,
          maxTokens,
          temperature,
        },
      }) as { candidates: string[]; error: string | null };

      if (result.error) {
        setState("error", 0, result.error);
        throw new Error(result.error);
      }

      setState("ready");
      return result.candidates || [];
    } catch (e: any) {
      const msg = e?.message || String(e);
      console.error("[OllamaAdapter] translate failed:", msg);
      setState("error", 0, msg);
      // Restore previous state on error so UI doesn't get stuck
      setTimeout(() => setState(prevState === "generating" ? "ready" : prevState), 100);
      throw e;
    }
  }

  // ── Model Catalog ──

  async listModels(): Promise<ModelInfo[]> {
    if (!isTauriEnvironment()) return [];
    try {
      const invoke = await getInvoke();
      const installed = (await invoke("ollama_list_models")) as Array<{
        name: string;
        size: number;
        digest: string;
      }>;

      // Merge installed models with the recommended catalog so the UI
      // shows both "what you have" and "what you can install".
      const installedSet = new Set(installed.map((m) => m.name));
      const catalog: ModelInfo[] = RECOMMENDED_OLLAMA_MODELS.map((m) => ({
        ...m,
        isCached: installedSet.has(m.id),
      }));

      // Add any installed models not in the recommended catalog (user-pulled)
      for (const m of installed) {
        if (!catalog.find((c) => c.id === m.name)) {
          catalog.push({
            id: m.name,
            name: m.name,
            parameters: parseParamsFromTag(m.name),
            size: formatBytes(m.size),
            family: parseFamilyFromTag(m.name),
            isCached: true,
          });
        }
      }

      return catalog;
    } catch (e: any) {
      console.error("[OllamaAdapter] listModels failed:", e);
      return [];
    }
  }

  async pullModel(modelId: string, onProgress?: (progress: number) => void): Promise<void> {
    if (!isTauriEnvironment()) {
      throw new Error("Cannot pull models outside Tauri environment.");
    }

    setState("loading", 0, null);

    try {
      const invoke = await getInvoke();

      // Use Tauri's event system to stream progress from Rust.
      // The Rust command emits "ollama-pull-progress" events as
      // Ollama streams them. We subscribe before invoking.
      let unsubscribe: (() => void) | null = null;
      try {
        const events = await import("@tauri-apps/api/event");
        unsubscribe = await events.listen<{ percent: number }>(
          "ollama-pull-progress",
          (event) => {
            const pct = event.payload?.percent ?? 0;
            setState("loading", pct, null);
            onProgress?.(pct);
          }
        );
      } catch {
        // If event subscription fails, proceed without progress updates
      }

      try {
        await invoke("ollama_pull_model", { model: modelId });
        setState("ready", 100, null);
      } finally {
        unsubscribe?.();
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      setState("error", 0, msg);
      throw e;
    }
  }

  async removeModel(modelId: string): Promise<void> {
    if (!isTauriEnvironment()) {
      throw new Error("Cannot remove models outside Tauri environment.");
    }
    const invoke = await getInvoke();
    await invoke("ollama_remove_model", { model: modelId });
    if (loadedModelId === modelId) {
      loadedModelId = null;
      setState("idle", 0, null);
    }
  }

  // ── Error Tracking ──

  getLastError(): string | null {
    return currentError;
  }

  // ── State Subscription ──

  onStateChange(cb: StateChangeCallback): () => void {
    subscribers.add(cb);
    // Emit current state immediately so subscribers don't miss it
    cb(currentState, currentProgress, currentError);
    return () => {
      subscribers.delete(cb);
    };
  }

  getState(): AdapterState {
    return currentState;
  }

  getProgress(): number {
    return currentProgress;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

function parseParamsFromTag(tag: string): string {
  // Ollama tags look like "qwen2.5:7b", "llama3.1:8b", "gemma2:2b"
  const match = tag.match(/:(\d+b)$/i);
  return match ? match[1].toUpperCase() : "?";
}

function parseFamilyFromTag(tag: string): string {
  // Take everything before the colon, capitalize first letter
  const base = tag.split(":")[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `~${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `~${mb.toFixed(0)} MB`;
}

export default OllamaAdapter;
