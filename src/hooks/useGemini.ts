import { useState, useCallback } from "react";
import { useSettingsStore } from "../stores/settings-store";
import type { TutorAnalysis } from "../types";
import type { TranslationDirection } from "../stores/workspace-store";
import {
  geminiBurst,
  geminiFull,
  geminiTutor,
} from "../lib/gemini-direct";

/**
 * Hook for Cloud Gemini API calls (Tier 2 of the ghost-text pipeline).
 *
 * Architecture (dual-path):
 *   - In Tauri (desktop app): calls go through the Rust-side proxy
 *     (gemini_translate command) which uses reqwest to call the Gemini
 *     REST API. Avoids CORS and works with post-June-19-2026 key
 *     restrictions.
 *   - In PWA (browser): calls go through the Vercel serverless
 *     functions at /api/translate/* which use the @google/genai SDK.
 *
 * The dispatch happens in src/lib/gemini-direct.ts. This hook just
 * calls those functions and manages loading/error state.
 *
 * Direction-aware (PHASE 1): `generateBurst` and `generateFullTranslation`
 * accept a `direction` argument which they forward into the request
 * body. The Vercel functions and the Tauri Rust proxy both branch on
 * this to build direction-appropriate prompts. Callers should source
 * the direction from `useWorkspaceStore.getState().direction`.
 *
 * Retry logic: Gemini calls are retried up to 2 times with exponential
 * backoff (500ms, 1500ms) on 5xx errors and network failures.
 */
export function useGemini() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const geminiApiKey = useSettingsStore((state) => state.geminiApiKey);

  /**
   * Retry wrapper — calls `fn` up to MAX_RETRIES+1 times.
   * Retries on any error (network, 5xx, parse). Non-retryable errors
   * (4xx, missing key) are thrown immediately by the underlying function.
   */
  const withRetry = async <T,>(fn: () => Promise<T>): Promise<T> => {
    const MAX_RETRIES = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          const backoff = Math.min(500 * Math.pow(3, attempt), 3000);
          console.warn(`[useGemini] Retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES}) — ${err?.message || err}`);
          await new Promise(resolve => setTimeout(resolve, backoff));
        }
      }
    }
    throw lastError || new Error("All retry attempts failed");
  };

  const generateBurst = useCallback(
    async (
      sourceText: string,
      targetPrefix: string,
      direction: TranslationDirection = "en-ar"
    ): Promise<string[]> => {
      if (!sourceText.trim()) return [];

      setLoading(true);
      setError(null);
      try {
        const result = await withRetry(() => geminiBurst({
          sourceText,
          targetPrefix,
          geminiApiKey,
          direction,
        }));
        return result.suggestions || [];
      } catch (err: any) {
        console.error("[useGemini] Burst generation failed:", err);
        setError(err.message);
        return [];
      } finally {
        setLoading(false);
      }
    },
    [geminiApiKey]
  );

  const generateFullTranslation = useCallback(
    async (
      sourceText: string,
      targetPrefix: string,
      direction: TranslationDirection = "en-ar"
    ): Promise<string> => {
      if (!sourceText.trim()) return "";

      setLoading(true);
      setError(null);
      try {
        const result = await withRetry(() => geminiFull({
          sourceText,
          targetPrefix,
          geminiApiKey,
          direction,
        }));
        return result.translation || "";
      } catch (err: any) {
        console.error("[useGemini] Full translation failed:", err);
        setError(err.message);
        return "";
      } finally {
        setLoading(false);
      }
    },
    [geminiApiKey]
  );

  const generateTutorExplanation = useCallback(
    async (
      sourceText: string,
      targetText: string,
      locale: "en" | "ar",
      direction: TranslationDirection = "en-ar"
    ): Promise<TutorAnalysis | null> => {
      if (!sourceText.trim() || !targetText.trim()) return null;

      setLoading(true);
      setError(null);
      try {
        return await withRetry(() => geminiTutor({
          sourceText,
          targetText,
          locale,
          geminiApiKey,
          direction,
        }));
      } catch (err: any) {
        console.error("[useGemini] Tutor call failed:", err);
        setError(err.message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [geminiApiKey]
  );

  return {
    loading,
    error,
    generateBurst,
    generateFullTranslation,
    generateTutorExplanation,
  };
}
export default useGemini;
