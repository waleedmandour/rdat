import { create } from "zustand";
import { EngineMode } from "../types";

interface SettingsState {
  engineMode: EngineMode;
  geminiApiKey: string;
  useCloudFallback: boolean;
  useGtr: boolean;
  downloadedModels: string[]; // e.g. ["qwen-1.5b", "gemma-2b"]
  loadedModel: string; // e.g. "gemma-2b" or ""
  setEngineMode: (mode: EngineMode) => void;
  setGeminiApiKey: (key: string) => void;
  setUseCloudFallback: (use: boolean) => void;
  setUseGtr: (use: boolean) => void;
  addDownloadedModel: (modelId: string) => void;
  setLoadedModel: (modelId: string) => void;
}

export const useSettingsStore = create<SettingsState>((set) => {
  // Load initial settings gracefully
  const getInitial = <T>(key: string, fallback: T): T => {
    if (typeof window === "undefined") return fallback;
    const value = localStorage.getItem(key);
    if (!value) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  };

  return {
    engineMode: getInitial<EngineMode>("rdat_engine_mode", "hybrid"),
    geminiApiKey: getInitial<string>("rdat_gemini_api_key", ""),
    useCloudFallback: getInitial<boolean>("rdat_cloud_fallback", true),
    useGtr: getInitial<boolean>("rdat_use_gtr", true),
    downloadedModels: getInitial<string[]>("rdat_downloaded_models", []),
    loadedModel: getInitial<string>("rdat_loaded_model", ""),

    setEngineMode: (engineMode) => {
      localStorage.setItem("rdat_engine_mode", JSON.stringify(engineMode));
      set({ engineMode });
    },
    setGeminiApiKey: (geminiApiKey) => {
      localStorage.setItem("rdat_gemini_api_key", geminiApiKey);
      set({ geminiApiKey });
    },
    setUseCloudFallback: (useCloudFallback) => {
      localStorage.setItem("rdat_cloud_fallback", JSON.stringify(useCloudFallback));
      set({ useCloudFallback });
    },
    setUseGtr: (useGtr) => {
      localStorage.setItem("rdat_use_gtr", JSON.stringify(useGtr));
      set({ useGtr });
    },
    addDownloadedModel: (modelId) => {
      set((state) => {
        if (state.downloadedModels.includes(modelId)) return state;
        const updated = [...state.downloadedModels, modelId];
        localStorage.setItem("rdat_downloaded_models", JSON.stringify(updated));
        return { downloadedModels: updated };
      });
    },
    setLoadedModel: (loadedModel) => {
      localStorage.setItem("rdat_loaded_model", JSON.stringify(loadedModel));
      set({ loadedModel });
    },
  };
});
export default useSettingsStore;
