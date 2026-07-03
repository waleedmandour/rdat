import { useState, useEffect } from "react";
import { WebGPUInfo } from "../types";
import {
  isModelLoaded,
  getEngineState,
  getLoadingProgress,
  getEngineError,
  onEngineStateChange,
  loadModel,
  unloadModel,
  isWebGPUAvailable,
  type LLMEngineState,
} from "../lib/local-llm-engine";
import { useSettingsStore } from "../stores/settings-store";
import { isTauriEnvironment } from "../lib/adapters/ollama-adapter";

/**
 * Hook that manages the WebGPU / Local LLM lifecycle.
 *
 * In Tauri mode: this hook is effectively a no-op for WebGPU detection.
 * The OllamaAdapter handles model loading via Tauri commands, not this
 * hook. We skip the isWebGPUAvailable() call entirely because:
 *   1. WebGPU in Tauri's WebView2/WKWebView is unreliable
 *   2. The requestAdapter() call can hang even with a timeout
 *   3. Ollama is the primary engine in Tauri — WebLLM is not used
 *
 * In PWA mode (browser): this hook detects WebGPU and manages the
 * WebLLM engine lifecycle as before.
 */
export function useWebLLM() {
  const [webgpuInfo, setWebgpuInfo] = useState<WebGPUInfo>({
    state: "unavailable",
  });

  const loadedModel = useSettingsStore((s) => s.loadedModel);

  // Detect WebGPU availability on mount — ONLY in PWA mode
  useEffect(() => {
    // In Tauri mode, skip WebGPU check entirely. Ollama is the primary
    // engine; WebLLM is not used. This prevents the requestAdapter()
    // hang that was blocking the UI on desktop.
    if (isTauriEnvironment()) {
      setWebgpuInfo({ state: "unavailable" });
      return;
    }

    isWebGPUAvailable().then((available) => {
      if (!available) {
        setWebgpuInfo({ state: "unavailable" });
      } else if (!loadedModel) {
        setWebgpuInfo({ state: "unavailable" });
      }
      // If loadedModel is set, the next effect will handle initialization
    });
  }, []);

  // Subscribe to engine state changes
  useEffect(() => {
    const unsubscribe = onEngineStateChange(
      (state: LLMEngineState, progress: number, error: string | null) => {
        switch (state) {
          case "idle":
            setWebgpuInfo({ state: "unavailable" });
            break;
          case "loading":
            setWebgpuInfo({ state: "initializing", progress });
            break;
          case "ready":
            setWebgpuInfo({ state: "ready" });
            break;
          case "generating":
            // Still ready, just busy — keep the UI showing "ready"
            setWebgpuInfo({ state: "ready" });
            break;
          case "error":
            setWebgpuInfo({ state: "error", error: error || "Unknown error" });
            break;
        }
      }
    );

    // Sync initial state
    const currentState = getEngineState();
    if (currentState === "ready" || currentState === "generating") {
      setWebgpuInfo({ state: "ready" });
    } else if (currentState === "loading") {
      setWebgpuInfo({ state: "initializing", progress: getLoadingProgress() });
    } else if (currentState === "error") {
      setWebgpuInfo({ state: "error", error: getEngineError() || "Unknown error" });
    }

    return unsubscribe;
  }, []);

  // Auto-load/unload model when loadedModel setting changes
  // ONLY in PWA mode — in Tauri mode, the OllamaAdapter handles this
  useEffect(() => {
    // In Tauri mode, skip WebLLM model loading entirely
    if (isTauriEnvironment()) return;

    if (loadedModel) {
      // Only load if not already loaded with the same model
      if (!isModelLoaded()) {
        setWebgpuInfo({ state: "initializing", progress: 0 });
        loadModel(loadedModel, (progress) => {
          setWebgpuInfo({ state: "initializing", progress });
        }).catch((err) => {
          console.error("[useWebLLM] Failed to load model:", err);
          setWebgpuInfo({
            state: "error",
            error: err?.message || "Failed to load model",
          });
        });
      }
    } else {
      // Unload when loadedModel is cleared
      unloadModel().catch((err) => {
        console.warn("[useWebLLM] Failed to unload model:", err);
      });
    }
  }, [loadedModel]);

  return { webgpuInfo };
}

export default useWebLLM;
