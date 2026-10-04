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
import { useWorkspaceStore } from "../../stores/workspace-store";
import { useSettingsStore } from "../../stores/settings-store";

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
// Modern lineup (July 2026): Gemma 4, Qwen 3, Llama 4.
// Gemma 4 E2B is the recommended starter model — smallest, fastest,
// fits the project's 1-2B parameter target.
// Even though Ollama can run any model the user has pulled, we ship a
// recommended catalog so the AiModelsView can offer one-click install.
//
// v0.4.2: added gemma4:12b-qat (Quantization-Aware Training variant —
// smaller footprint, same quality). Filtered out non-translation models
// (embedding, vision-only, code-only) from the "user-pulled" list so the
// panel stays focused on translation-relevant models.

export const RECOMMENDED_OLLAMA_MODELS: Array<Omit<ModelInfo, "isCached">> = [
  {
    id: "gemma4:e2b",
    name: "Gemma 4 E2B (Recommended Starter)",
    parameters: "2B (Effective)",
    size: "~1.5 GB",
    family: "Gemma",
  },
  {
    id: "gemma4:e4b",
    name: "Gemma 4 E4B (Higher Quality)",
    parameters: "4B (Effective)",
    size: "~3.0 GB",
    family: "Gemma",
  },
  {
    id: "gemma4:e2b-it-qat",
    name: "Gemma 4 E2B QAT (Quantization-Aware, Higher Quality)",
    parameters: "2B (QAT)",
    size: "~1.6 GB",
    family: "Gemma",
  },
  {
    id: "gemma4:e4b-it-qat",
    name: "Gemma 4 E4B QAT (Quantization-Aware, Higher Quality)",
    parameters: "4B (QAT)",
    size: "~3.2 GB",
    family: "Gemma",
  },
  {
    id: "gemma4:12b-it-qat",
    name: "Gemma 4 12B QAT (Highest Quality, Quantization-Aware)",
    parameters: "12B (QAT)",
    size: "~7.2 GB",
    family: "Gemma",
  },
  {
    id: "qwen2.5:1.5b",
    name: "Qwen 2.5 1.5B (Non-thinking, Fast)",
    parameters: "1.5B",
    size: "~1.0 GB",
    family: "Qwen",
  },
  {
    id: "qwen2.5:3b",
    name: "Qwen 2.5 3B (Non-thinking, Balanced)",
    parameters: "3B",
    size: "~2.0 GB",
    family: "Qwen",
  },
  {
    id: "qwen3:1.7b",
    name: "Qwen 3 1.7B (Thinking model - may be slower)",
    parameters: "1.7B",
    size: "~1.1 GB",
    family: "Qwen",
  },
  {
    id: "qwen3:4b",
    name: "Qwen 3 4B (Thinking model - may be slower)",
    parameters: "4B",
    size: "~2.5 GB",
    family: "Qwen",
  },
  {
    id: "llama3.1:8b",
    name: "Llama 3.1 8B (Stable, Good Arabic)",
    parameters: "8B",
    size: "~4.9 GB",
    family: "Llama",
  },
];

/**
 * Models that are NOT useful for translation and should be filtered out
 * of the "user-pulled" list (so the panel stays focused). The user can
 * still pull them via Ollama directly; we just don't show them in RDAT.
 *
 * Matches by prefix so e.g. "nomic-embed" catches all variants.
 */
const HIDDEN_MODEL_PREFIXES = [
  "nomic-embed",    // embedding model
  "mxbai-embed",    // embedding model
  "snowflake-arctic-embed", // embedding model
  "all-minilm",     // embedding model
  "llava",          // vision model
  "moondream",      // vision model
  "minicpm-v",      // vision model
  "qwen2.5-coder",  // code-only
  "codellama",      // code-only
  "deepseek-coder", // code-only
  "starcoder",      // code-only
];

function isHiddenModel(modelTag: string): boolean {
  const lower = modelTag.toLowerCase();
  return HIDDEN_MODEL_PREFIXES.some((p) => lower.startsWith(p));
}

/**
 * The default model to auto-select for new users after they pull it.
 * Gemma 4 E2B — smallest, fastest, fits the project's 1-2B target.
 */
export const DEFAULT_OLLAMA_MODEL = "gemma4:e2b";

// ─── Adapter State (internal) ─────────────────────────────────────

let currentState: AdapterState = "idle";
let currentProgress = 0;
let currentError: string | null = null;
let loadedModelId: string | null = null;

/**
 * Last health-check diagnostics — which URLs were tried and which errors
 * occurred. Populated by isAvailable() and readable via
 * `getHealthDiagnostics()` so the UI can surface them to the user.
 * This is critical for field debugging: a screenshot of the UI now
 * contains enough info to diagnose "Ollama not detected" without a
 * remote debugging session.
 */
export interface HealthAttempt {
  url: string;
  success: boolean;
  error: string | null;
}

export interface HealthDiagnostics {
  healthy: boolean;
  attempts: HealthAttempt[];
}

let lastHealthDiagnostics: HealthDiagnostics | null = null;

export function getHealthDiagnostics(): HealthDiagnostics | null {
  return lastHealthDiagnostics;
}

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

  /**
   * Check if Ollama is available. Returns a boolean (for the
   * LLMAdapter interface) but also stores the full diagnostics
   * accessible via getHealthDiagnostics().
   *
   * The Rust command returns a structured HealthResult with per-URL
   * attempt details — we extract the boolean here and stash the
   * diagnostics for the UI.
   */
  async isAvailable(): Promise<boolean> {
    // v0.4.2: in PWA mode, try the HTTP backend (localhost:11434).
    // This lets the PWA use a locally-installed Ollama daemon without
    // Tauri. Requires OLLAMA_ORIGINS to be set on the user's Ollama.
    if (!isTauriEnvironment()) {
      const ok = await httpHealthCheck();
      if (!ok) return false;
      lastHealthDiagnostics = {
        healthy: true,
        attempts: [{ url: OLLAMA_HTTP_BASE, success: true, error: null }],
      };
      return true;
    }
    try {
      const invoke = await getInvoke();
      const result = await invoke("ollama_health") as HealthDiagnostics;
      lastHealthDiagnostics = result;
      return result.healthy;
    } catch (e: any) {
      console.warn("[OllamaAdapter] health check failed:", e);
      lastHealthDiagnostics = {
        healthy: false,
        attempts: [{
          url: "(invoke failed)",
          success: false,
          error: e?.message || String(e),
        }],
      };
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

    // Get direction from workspace store
    const direction = useWorkspaceStore.getState().direction || "en-ar";

    const systemPrompt = buildRAGSystemPrompt(ragEntries, direction);
    const userPrompt = buildUserPrompt(sourceText, targetPrefix, direction);

    const prevState = currentState;
    setState("generating");

    try {
      let result: { candidates: string[]; error: string | null };

      if (isTauriEnvironment()) {
        const invoke = await getInvoke();
        console.log("[OllamaAdapter] translate() called (Tauri)", {
          model: loadedModelId,
          sourceText: sourceText.substring(0, 60),
          targetPrefix: targetPrefix.substring(0, 60),
          hasRag: !!ragEntries && ragEntries.length > 0,
        });

        result = await invoke("ollama_translate", {
          req: {
            model: loadedModelId,
            systemPrompt,
            userPrompt,
            maxTokens,
            temperature,
          },
        }) as { candidates: string[]; error: string | null };
      } else {
        // v0.4.2: PWA mode — use HTTP backend
        console.log("[OllamaAdapter] translate() called (HTTP)", {
          model: loadedModelId,
          sourceText: sourceText.substring(0, 60),
          targetPrefix: targetPrefix.substring(0, 60),
          hasRag: !!ragEntries && ragEntries.length > 0,
        });

        result = await httpTranslate({
          model: loadedModelId,
          systemPrompt,
          userPrompt,
          maxTokens,
          temperature,
        });
      }

      if (result.error) {
        setState("error", 0, result.error);
        throw new Error(result.error);
      }

      const candidates = result.candidates || [];
      console.log("[OllamaAdapter] translate() returned", {
        candidateCount: candidates.length,
        firstCandidate: candidates[0]?.substring(0, 80),
      });

      // If the user typed a prefix, the model returns ONLY the continuation
      // (per the continuation prompt). We need to combine prefix + continuation
      // into a full candidate so computeGhostRemainder can extract the remainder.
      const prefix = targetPrefix.trim();
      if (prefix && candidates.length > 0) {
        const continuation = candidates[0].trim();
        // Combine: prefix + space + continuation (if continuation doesn't already start with prefix)
        let fullCandidate;
        if (continuation.startsWith(prefix)) {
          // Model returned the full translation (didn't follow "continue only" instruction)
          fullCandidate = continuation;
        } else {
          // Model returned just the continuation - prepend the prefix
          fullCandidate = prefix + " " + continuation;
        }
        console.log("[OllamaAdapter] Combined candidate:", fullCandidate.substring(0, 80));
        return [fullCandidate];
      }

      setState("ready");
      return candidates;
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

  async listModels(showAll: boolean = false): Promise<ModelInfo[]> {
    // v0.4.2: in PWA mode, use the HTTP backend.
    // v0.4.3: showAll parameter bypasses the hidden-model filter.
    let installed: Array<{ name: string; size: number; digest: string }> = [];
    try {
      if (isTauriEnvironment()) {
        const invoke = await getInvoke();
        installed = (await invoke("ollama_list_models")) as Array<{
          name: string;
          size: number;
          digest: string;
        }>;
      } else {
        installed = await httpListModels();
      }
    } catch (e: any) {
      console.error("[OllamaAdapter] listModels failed:", e);
      return [];
    }

    // v0.4.2: filter out non-translation models (embedding, vision, code)
    // so the panel stays focused. The user can still pull them via
    // Ollama directly; we just don't show them in RDAT.
    // v0.4.3: showAll=true bypasses the filter. But we NEVER hide a model
    // the user has loaded or selected (loadedModelId).
    const loadedModel = useSettingsStore.getState().loadedModel;
    const visibleInstalled = installed.filter((m) =>
      showAll || !isHiddenModel(m.name) || m.name === loadedModel
    );

    // Merge installed models with the recommended catalog so the UI
    // shows both "what you have" and "what you can install".
    const installedSet = new Set(visibleInstalled.map((m) => m.name));
    const catalog: ModelInfo[] = RECOMMENDED_OLLAMA_MODELS.map((m) => ({
      ...m,
      isCached: installedSet.has(m.id),
    }));

    // Add any installed models not in the recommended catalog (user-pulled)
    for (const m of visibleInstalled) {
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
  }

  async pullModel(modelId: string, onProgress?: (progress: number) => void): Promise<void> {
    // v0.4.2: in PWA mode, use the HTTP backend.
    if (!isTauriEnvironment()) {
      setState("loading", 0, null);
      try {
        await httpPullModel(modelId, (pct) => {
          setState("loading", pct, null);
          onProgress?.(pct);
        });
        setState("ready", 100, null);
      } catch (e: any) {
        const msg = e?.message || String(e);
        setState("error", 0, msg);
        throw e;
      }
      return;
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
    // v0.4.2: in PWA mode, use the HTTP backend.
    if (!isTauriEnvironment()) {
      await httpRemoveModel(modelId);
      if (loadedModelId === modelId) {
        loadedModelId = null;
        setState("idle", 0, null);
      }
      return;
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

// ─── HTTP backend for PWA mode (v0.4.2) ────────────────────────────
// When not running in Tauri (PWA/browser mode), the OllamaAdapter can
// still reach a local Ollama daemon via its REST API at
// http://localhost:11434. This requires the user to set
// OLLAMA_ORIGINS=* (or the PWA's origin) so Ollama accepts the
// cross-origin request. Documented in the README + AiModelsView.
//
// The HTTP backend mirrors the Tauri Rust commands:
//   - GET  /api/tags        → list installed models
//   - POST /api/pull        → pull a model (streaming NDJSON progress)
//   - POST /api/generate    → inference
//   - DELETE /api/delete    → remove a model
//
// All requests use a 60-second timeout (Ollama generate can be slow on
// first load). Pull uses a streaming reader for progress updates.

const OLLAMA_HTTP_BASE = "http://localhost:11434";
const OLLAMA_HTTP_TIMEOUT_MS = 60_000;

interface OllamaTag {
  name: string;
  size: number;
  digest: string;
}

async function httpListModels(): Promise<OllamaTag[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_HTTP_TIMEOUT_MS);
  try {
    const resp = await fetch(`${OLLAMA_HTTP_BASE}/api/tags`, {
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return (data.models || []).map((m: any) => ({
      name: m.name,
      size: m.size || 0,
      digest: m.digest || "",
    }));
  } finally {
    clearTimeout(timer);
  }
}

async function httpHealthCheck(): Promise<boolean> {
  // Quick HEAD/GET to /api/tags with a short timeout. If it responds,
  // Ollama is running + CORS is configured.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const resp = await fetch(`${OLLAMA_HTTP_BASE}/api/tags`, {
      signal: controller.signal,
    });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function httpPullModel(
  modelId: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  // /api/pull streams NDJSON: {"status":"pulling manifest"}, then
  // {"status":"downloading","digest":"...","total":...,"completed":...}
  // We read the stream + compute percent from completed/total.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 600_000); // 10 min for large models
  try {
    const resp = await fetch(`${OLLAMA_HTTP_BASE}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelId, stream: true }),
      signal: controller.signal,
    });
    if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // keep incomplete line
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.status === "downloading" && evt.total) {
            const pct = Math.round((evt.completed / evt.total) * 100);
            onProgress?.(pct);
          } else if (evt.status === "success") {
            onProgress?.(100);
          }
        } catch {
          // ignore parse errors on partial lines
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

async function httpTranslate(req: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  temperature: number;
}): Promise<{ candidates: string[]; error: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_HTTP_TIMEOUT_MS);
  try {
    const resp = await fetch(`${OLLAMA_HTTP_BASE}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: req.model,
        system: req.systemPrompt,
        prompt: req.userPrompt,
        stream: false,
        options: {
          num_predict: req.maxTokens,
          temperature: req.temperature,
        },
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return { candidates: [], error: `Ollama HTTP ${resp.status}: ${text.slice(0, 200)}` };
    }
    const data = await resp.json();
    const candidate = (data.response || "").trim();
    return { candidates: candidate ? [candidate] : [], error: null };
  } catch (e: any) {
    return { candidates: [], error: e?.message || String(e) };
  } finally {
    clearTimeout(timer);
  }
}

async function httpRemoveModel(modelId: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_HTTP_TIMEOUT_MS);
  try {
    const resp = await fetch(`${OLLAMA_HTTP_BASE}/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelId }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  } finally {
    clearTimeout(timer);
  }
}

export default OllamaAdapter;
