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
 *      (Used in PWA mode, and as a fallback in Tauri when Ollama is
 *       not installed)
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

let activeAdapter: LLMAdapter | null = null;
let selectionPromise: Promise<LLMAdapter | null> | null = null;

/**
 * Detect and return the active LLM adapter for the current environment.
 * Memoized — the same instance is returned on subsequent calls.
 *
 * @returns The active adapter, or null if no local adapter is available.
 */
export async function getActiveAdapter(): Promise<LLMAdapter | null> {
  if (activeAdapter) return activeAdapter;
  if (selectionPromise) return selectionPromise;

  selectionPromise = (async () => {
    // ── Step 1: Try Ollama (only inside Tauri) ──
    if (isTauriEnvironment()) {
      try {
        const ollama = new OllamaAdapter();
        const available = await ollama.isAvailable();
        if (available) {
          console.log("[AdapterFactory] Selected OllamaAdapter (Tauri + Ollama daemon).");
          activeAdapter = ollama;
          return activeAdapter;
        }
        console.log("[AdapterFactory] Tauri detected but Ollama daemon not reachable. Falling back to WebLLM.");
      } catch (e) {
        console.warn("[AdapterFactory] Ollama check failed, falling back to WebLLM:", e);
      }
    }

    // ── Step 2: Try WebLLM (browser with WebGPU, or Tauri fallback) ──
    try {
      const webllm = new WebLLMAdapter();
      const available = await webllm.isAvailable();
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
 *
 * Useful in hot paths (e.g. inside a useEffect) where you don't want
 * to re-trigger the async selection.
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
