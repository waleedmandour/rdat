import { create } from "zustand";
import { EngineMode } from "../types";

interface SettingsState {
  engineMode: EngineMode;
  geminiApiKey: string;
  /** Whether the user has opted in to persisting the API key across reloads. Defaults to false. */
  rememberApiKey: boolean;
  useCloudFallback: boolean;
  useGtr: boolean;
  downloadedModels: string[]; // e.g. ["qwen-1.5b", "gemma-2b"]
  loadedModel: string; // e.g. "gemma-2b" or ""
  setEngineMode: (mode: EngineMode) => void;
  setGeminiApiKey: (key: string) => void;
  setRememberApiKey: (remember: boolean) => void;
  setUseCloudFallback: (use: boolean) => void;
  setUseGtr: (use: boolean) => void;
  addDownloadedModel: (modelId: string) => void;
  setLoadedModel: (modelId: string) => void;
}

/**
 * SECURITY (audit fix #2): The Gemini API key is no longer persisted to
 * localStorage by default. localStorage is readable by any JavaScript
 * on the same origin — including XSS payloads — so a leaked key was a
 * single `localStorage.getItem` away. The key now lives in memory only
 * (Zustand state) and is cleared on page reload unless the user
 * explicitly opts in via the "Remember API key on this device"
 * checkbox in the API Keys panel.
 *
 * One-time migration: any pre-existing `rdat_gemini_api_key` value
 * from older versions is wiped from localStorage on app boot. Users
 * who want persistence must re-enter their key and check the opt-in.
 */
function migrateLegacyApiKeyStorage(): void {
  if (typeof window === "undefined") return;
  // Only run the migration once per device to avoid wiping a key the
  // user just opted in to remembering.
  const MIGRATION_FLAG = "rdat_api_key_migrated_v031";
  if (localStorage.getItem(MIGRATION_FLAG) === "true") return;
  localStorage.removeItem("rdat_gemini_api_key");
  localStorage.setItem(MIGRATION_FLAG, "true");
}

export const useSettingsStore = create<SettingsState>((set) => {
  // Run the one-time migration before reading any state.
  migrateLegacyApiKeyStorage();

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

  const rememberApiKey = getInitial<boolean>("rdat_remember_api_key", false);
  // Only load the key from storage if the user has opted in. Otherwise
  // start with an empty string — the user must re-enter on each boot.
  const initialApiKey = rememberApiKey
    ? getInitial<string>("rdat_gemini_api_key", "")
    : "";

  return {
    engineMode: getInitial<EngineMode>("rdat_engine_mode", "hybrid"),
    geminiApiKey: initialApiKey,
    rememberApiKey,
    useCloudFallback: getInitial<boolean>("rdat_cloud_fallback", true),
    useGtr: getInitial<boolean>("rdat_use_gtr", true),
    downloadedModels: getInitial<string[]>("rdat_downloaded_models", []),
    loadedModel: getInitial<string>("rdat_loaded_model", ""),

    setEngineMode: (engineMode) => {
      localStorage.setItem("rdat_engine_mode", JSON.stringify(engineMode));
      set({ engineMode });
    },
    setGeminiApiKey: (geminiApiKey) => {
      // SECURITY: only write to localStorage if the user has opted in.
      // Otherwise the key lives in memory only and is cleared on reload.
      set((state) => {
        if (state.rememberApiKey) {
          localStorage.setItem("rdat_gemini_api_key", geminiApiKey);
        } else {
          // Make sure no stale key lingers from a previous opt-in session.
          localStorage.removeItem("rdat_gemini_api_key");
        }
        return { geminiApiKey };
      });
    },
    setRememberApiKey: (rememberApiKey) => {
      localStorage.setItem("rdat_remember_api_key", JSON.stringify(rememberApiKey));
      set((state) => {
        if (!rememberApiKey) {
          // User unchecked the box — wipe any persisted key immediately.
          localStorage.removeItem("rdat_gemini_api_key");
        } else if (state.geminiApiKey) {
          // User checked the box — persist the current in-memory key.
          localStorage.setItem("rdat_gemini_api_key", state.geminiApiKey);
        }
        return { rememberApiKey };
      });
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
