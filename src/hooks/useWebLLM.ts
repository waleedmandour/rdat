import { useState, useEffect, useCallback } from "react";
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

/**
 * Hook that manages the WebGPU / Local LLM lifecycle.
 *
 * Previously a dead stub returning hardcoded `{state: "ready"}`.
 * Now it:
 *   1. Detects WebGPU availability
 *   2. Subscribes to engine state changes
 *   3. Auto-loads/unloads models when `loadedModel` setting changes
 *   4. Exposes real progress, state, and error information
 */
export function useWebLLM() {
  const [webgpuInfo, setWebgpuInfo] = useState<WebGPUInfo>({
    state: "unavailable",
  });

  const loadedModel = useSettingsStore((s) => s.loadedModel);

  // Detect WebGPU availability on mount
  useEffect(() => {
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
  useEffect(() => {
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
