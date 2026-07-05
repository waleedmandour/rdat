/**
 * LLM Adapter Factory — picks the right adapter for the current environment.
 *
 * Selection order (per project spec: local LLM is PRIMARY, Gemini is fallback):
 *
 *   1. If running inside Tauri AND Ollama daemon is reachable → OllamaAdapter
 *      (Ollama is the preferred primary engine in desktop mode: faster
 *       inference via native CUDA/Metal, supports larger models, no
 *       WebGPU browser dependency)
 *
 *   2. Else if WebGPU is available in the browser → WebLLMAdapter
 *      (Used in PWA mode only. SKIPPED in Tauri mode because WebGPU
 *       in Tauri's WebView2/WKWebView is unreliable and the check
 *       itself can hang even with a timeout — the user should install
 *       Ollama instead.)
 *
 *   3. Else → null
 *      (No local adapter available; only Gemini cloud fallback will work.
 *       TargetEditor will surface the appropriate amber inline hint
 *       telling the user to install Ollama or use a WebGPU browser.)
 *
 * The active adapter is memoized — once selected, the same instance is
 * returned for the lifetime of the page. Callers should NOT cache the
 * adapter themselves; always go through `getActiveAdapter()`.
 */

import type { LLMAdapter } from "../llm-adapter";
import { OllamaAdapter, isTauriEnvironment } from "./ollama-adapter";
import { WebLLMAdapter } from "./web-llm-adapter";
import { useSettingsStore } from "../../stores/settings-store";

let activeAdapter: LLMAdapter | null = null;
let selectionPromise: Promise<LLMAdapter | null> | null = null;

/**
 * Wrap a promise with a timeout. If the promise doesn't resolve within
 * `ms` milliseconds, return `fallback` instead.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * Detect and return the active LLM adapter for the current environment.
 * Memoized — the same instance is returned on subsequent calls.
 *
 * In Tauri mode, if Ollama is not detected on the first attempt, we
 * automatically retry once after a 3-second delay. This handles the
 * cold-start race where Ollama is set to autostart at login but hasn't
 * bound its HTTP listener yet when RDAT launches. Manual "Recheck"
 * from the UI still works as before (via resetAdapter()).
 *
 * @returns The active adapter, or null if no local adapter is available.
 */
export async function getActiveAdapter(): Promise<LLMAdapter | null> {
  if (activeAdapter) return activeAdapter;
  if (selectionPromise) return selectionPromise;

  selectionPromise = (async () => {
    // ── Step 1: Try Ollama (only inside Tauri) ──
    // 8-second timeout — the Rust health check tries 3 URLs with 5s
    // each, plus Tauri IPC overhead. 8s is enough for one full attempt.
    if (isTauriEnvironment()) {
      try {
        const ollama = new OllamaAdapter();
        let available = await withTimeout(ollama.isAvailable(), 8000, false);

        // ── Auto-retry on initial launch ──
        // If Ollama wasn't detected on the first attempt, retry with
        // increasing delays. If the user had a model loaded in a prior
        // session (loadedModel is in localStorage), retry more aggressively
        // because we know Ollama was working before.
        const savedModel = useSettingsStore.getState().loadedModel;
        const maxRetries = savedModel ? 3 : 1; // 3 retries if prior model exists
        const retryDelay = savedModel ? 2000 : 3000; // 2s if prior model, 3s otherwise

        for (let attempt = 0; attempt < maxRetries && !available; attempt++) {
          console.log(`[AdapterFactory] Ollama not detected (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${retryDelay / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          available = await withTimeout(ollama.isAvailable(), 8000, false);
        }

        if (available) {
          console.log("[AdapterFactory] Selected OllamaAdapter (Tauri + Ollama daemon).");
          activeAdapter = ollama;

          // ── Auto-load previously selected model ──
          // If the user had a model loaded in a prior session, automatically
          // re-select it so they don't have to manually click "Load" every
          // time they restart the app. The model weights are still cached
          // by Ollama on disk; this just sets our active model ID.
          if (savedModel) {
            try {
              console.log(`[AdapterFactory] Auto-loading previously selected model: ${savedModel}`);
              await ollama.loadModel(savedModel);
            } catch (e) {
              console.warn(`[AdapterFactory] Auto-load of ${savedModel} failed:`, e);
              // Don't fail the whole detection if auto-load fails — the
              // user can manually load from the Models panel.
            }
          }

          return activeAdapter;
        }
        console.log("[AdapterFactory] Tauri detected but Ollama daemon not reachable after retries.");
        activeAdapter = null;
        return activeAdapter;
      } catch (e) {
        console.warn("[AdapterFactory] Ollama check failed:", e);
        activeAdapter = null;
        return activeAdapter;
      }
    }

    // ── Step 2: Try WebLLM (PWA/browser mode only) ──
    // 3-second timeout — isWebGPUAvailable() already has a 2s internal
    // timeout on requestAdapter(), so 3s is enough margin.
    try {
      const webllm = new WebLLMAdapter();
      const available = await withTimeout(webllm.isAvailable(), 3000, false);
      if (available) {
        console.log("[AdapterFactory] Selected WebLLMAdapter (WebGPU available).");
        activeAdapter = webllm;
        return activeAdapter;
      }
      console.log("[AdapterFactory] WebGPU not available. No local adapter.");
    } catch (e) {
      console.warn("[AdapterFactory] WebLLM check failed:", e);
    }

    // ── Step 3: No local adapter ──
    activeAdapter = null;
    return activeAdapter;
  })();

  return selectionPromise;
}

/**
 * Synchronously get the active adapter if it has already been resolved.
 * Returns null if `getActiveAdapter()` has not been called yet, or if
 * it resolved to null.
 */
export function getActiveAdapterSync(): LLMAdapter | null {
  return activeAdapter;
}

/**
 * Force re-selection of the adapter. Useful after the user installs
 * Ollama mid-session, or after WebGPU becomes available (e.g. user
 * switches browsers).
 */
export function resetAdapter(): void {
  activeAdapter = null;
  selectionPromise = null;
}

// ─── Re-exports ───────────────────────────────────────────────────

export type { LLMAdapter } from "../llm-adapter";
export { OllamaAdapter, isTauriEnvironment } from "./ollama-adapter";
export { WebLLMAdapter } from "./web-llm-adapter";
