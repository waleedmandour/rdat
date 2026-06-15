import { useState, useCallback, useRef } from "react";
import { useSettingsStore } from "../stores/settings-store";
import { TutorAnalysis } from "../types";

interface GeminiResult {
  match: string;
  source: string;
  remainder: string;
  score: number;
}

/**
 * Hook for Cloud Gemini API calls (Tier 2 of the ghost-text pipeline).
 *
 * Phase 3 enhancement: Added retry logic and better error recovery.
 * If a Gemini API call fails due to a network timeout or 5xx error,
 * the hook automatically retries up to 2 times with exponential backoff
 * (500ms, 1500ms). Non-retryable errors (4xx, missing API key) fail
 * immediately without retrying.
 */
export function useGemini() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const geminiApiKey = useSettingsStore((state) => state.geminiApiKey);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 2;

  const fetchWithRetry = useCallback(
    async (url: string, body: object): Promise<Response> => {
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          // Retryable: server errors (5xx) and network timeouts
          if (response.status >= 500 && attempt < MAX_RETRIES) {
            const backoff = Math.min(500 * Math.pow(3, attempt), 3000);
            console.warn(`[useGemini] Server error ${response.status}, retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, backoff));
            continue;
          }

          return response;
        } catch (err: any) {
          lastError = err;
          // Network errors are retryable
          if (attempt < MAX_RETRIES) {
            const backoff = Math.min(500 * Math.pow(3, attempt), 3000);
            console.warn(`[useGemini] Network error, retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, backoff));
          }
        }
      }

      throw lastError || new Error("All retry attempts failed");
    },
    []
  );

  const generateBurst = useCallback(
    async (sourceText: string, targetPrefix: string): Promise<string[]> => {
      if (!sourceText.trim()) return [];

      setLoading(true);
      setError(null);
      try {
        const response = await fetchWithRetry("/api/translate/burst", {
          sourceText,
          targetPrefix,
          geminiApiKey,
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `Gemini API error (${response.status})`);
        }

        const data = await response.json();
        return data.suggestions || [];
      } catch (err: any) {
        console.error("[useGemini] Burst generation failed:", err);
        setError(err.message);
        return [];
      } finally {
        setLoading(false);
      }
    },
    [geminiApiKey, fetchWithRetry]
  );

  const generateFullTranslation = useCallback(
    async (sourceText: string, targetPrefix: string): Promise<string> => {
      if (!sourceText.trim()) return "";

      setLoading(true);
      setError(null);
      try {
        const response = await fetchWithRetry("/api/translate/full", {
          sourceText,
          targetPrefix,
          geminiApiKey,
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `Gemini API error (${response.status})`);
        }

        const data = await response.json();
        return data.translation || "";
      } catch (err: any) {
        console.error("[useGemini] Full translation failed:", err);
        setError(err.message);
        return "";
      } finally {
        setLoading(false);
      }
    },
    [geminiApiKey, fetchWithRetry]
  );

  const generateTutorExplanation = useCallback(
    async (sourceText: string, targetText: string, locale: "en" | "ar"): Promise<TutorAnalysis | null> => {
      if (!sourceText.trim() || !targetText.trim()) return null;

      setLoading(true);
      setError(null);
      try {
        const response = await fetchWithRetry("/api/translate/tutor-explain", {
          sourceText,
          targetText,
          geminiApiKey,
          locale,
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `Gemini API error (${response.status})`);
        }

        const data = await response.json();
        return data as TutorAnalysis;
      } catch (err: any) {
        console.error("[useGemini] Tutor call failed:", err);
        setError(err.message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [geminiApiKey, fetchWithRetry]
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
