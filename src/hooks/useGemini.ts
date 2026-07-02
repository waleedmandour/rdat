import { useState, useCallback } from "react";
import { useSettingsStore } from "../stores/settings-store";
import { TutorAnalysis } from "../types";

/**
 * Hook for Cloud Gemini API calls (Tier 2 of the ghost-text pipeline).
 *
 * Architecture note (user-owned key model):
 *   The Gemini API key is sent in the request body on every call. The
 *   Vercel serverless function forwards it to the Gemini SDK. No API
 *   key is stored server-side.
 *
 * Error handling note:
 *   Vercel serverless functions can return non-JSON responses in
 *   several failure modes:
 *     - Cold-start crashes (function dies before our code runs)
 *     - Function timeout (returns Vercel's HTML error page)
 *     - Node version deprecation (returns "A server error occurred...")
 *     - Function size limit exceeded (returns 413 HTML)
 *   All JSON parsing in this hook is wrapped in safeJsonParse to
 *   handle these gracefully and surface a useful error message
 *   instead of the cryptic "Unexpected token 'A'..." parse error.
 */
export function useGemini() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const geminiApiKey = useSettingsStore((state) => state.geminiApiKey);
  const MAX_RETRIES = 2;

  /**
   * Safely parse a Response as JSON, falling back to a useful error
   * message if the body is not valid JSON (e.g. Vercel's HTML error pages).
   *
   * Returns a flat object shape (always has `ok` + `error` fields) so
   * TypeScript narrowing works cleanly in caller code without
   * discriminated-union gymnastics.
   */
  async function safeJsonParse<T = any>(response: Response): Promise<{ ok: boolean; data: T | null; error: string | null }> {
    // First, get the raw text so we can inspect it
    let rawText: string;
    try {
      rawText = await response.text();
    } catch (e: any) {
      return { ok: false, data: null, error: `Failed to read response body: ${e?.message || e}` };
    }

    // Try JSON parse
    try {
      const data = JSON.parse(rawText) as T;
      return { ok: true, data, error: null };
    } catch {
      // Not JSON — diagnose what we got
      const contentType = response.headers.get("content-type") || "";
      const preview = rawText.slice(0, 200).replace(/\s+/g, " ").trim();

      // Vercel's standard server error page starts with "A server error..."
      if (preview.toLowerCase().startsWith("a server error")) {
        return {
          ok: false,
          data: null,
          error: `Vercel serverless function crashed (likely cold-start or runtime error). ` +
                 `Status: ${response.status}. ` +
                 `This often happens when the function fails to import dependencies on first load. ` +
                 `Try again in 30 seconds — Vercel may be re-deploying. ` +
                 `If the issue persists, check the Vercel function logs. ` +
                 `Preview: "${preview}"`,
        };
      }

      // HTML response (Vercel's error page or the SPA fallback)
      if (contentType.includes("text/html") || preview.startsWith("<!DOCTYPE") || preview.startsWith("<html")) {
        return {
          ok: false,
          data: null,
          error: `Expected JSON but received HTML (status ${response.status}). ` +
                 `This usually means the API route was not deployed correctly, or a rewrite rule is intercepting /api/* requests. ` +
                 `Preview: "${preview}"`,
        };
      }

      // Some other non-JSON text
      return {
        ok: false,
        data: null,
        error: `Expected JSON response but got ${contentType || "unknown content-type"} (status ${response.status}). ` +
               `Preview: "${preview}"`,
      };
    }
  }

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
          const result = await safeJsonParse<{ error?: string }>(response);
          const msg = result.ok && result.data?.error
            ? result.data.error
            : !result.ok && result.error
              ? result.error
              : `Gemini API error (${response.status})`;
          throw new Error(msg);
        }

        const result = await safeJsonParse<{ suggestions?: string[] }>(response);
        if (!result.ok || !result.data) throw new Error(result.error || "Invalid response");
        return result.data.suggestions || [];
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
          const result = await safeJsonParse<{ error?: string }>(response);
          const msg = result.ok && result.data?.error
            ? result.data.error
            : !result.ok && result.error
              ? result.error
              : `Gemini API error (${response.status})`;
          throw new Error(msg);
        }

        const result = await safeJsonParse<{ translation?: string }>(response);
        if (!result.ok || !result.data) throw new Error(result.error || "Invalid response");
        return result.data.translation || "";
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
          const result = await safeJsonParse<{ error?: string }>(response);
          const msg = result.ok && result.data?.error
            ? result.data.error
            : !result.ok && result.error
              ? result.error
              : `Gemini API error (${response.status})`;
          throw new Error(msg);
        }

        const result = await safeJsonParse<TutorAnalysis>(response);
        if (!result.ok || !result.data) throw new Error(result.error || "Invalid response");
        return result.data;
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
