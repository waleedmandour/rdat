import { useState, useCallback } from "react";
import { useSettingsStore } from "../stores/settings-store";
import { TutorAnalysis } from "../types";

interface GeminiResult {
  match: string;
  source: string;
  remainder: string;
  score: number;
}

export function useGemini() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const geminiApiKey = useSettingsStore((state) => state.geminiApiKey);

  const generateBurst = useCallback(
    async (sourceText: string, targetPrefix: string): Promise<string[]> => {
      if (!sourceText.trim()) return [];

      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/translate/burst", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sourceText,
            targetPrefix,
            geminiApiKey,
          }),
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || "Failed to fetch burst translation");
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
    [geminiApiKey]
  );

  const generateFullTranslation = useCallback(
    async (sourceText: string, targetPrefix: string): Promise<string> => {
      if (!sourceText.trim()) return "";

      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/translate/full", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sourceText,
            targetPrefix,
            geminiApiKey,
          }),
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || "Failed to fetch full translation");
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
    [geminiApiKey]
  );

  const generateTutorExplanation = useCallback(
    async (sourceText: string, targetText: string, locale: "en" | "ar"): Promise<TutorAnalysis | null> => {
      if (!sourceText.trim() || !targetText.trim()) return null;

      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/translate/tutor-explain", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sourceText,
            targetText,
            geminiApiKey,
            locale,
          }),
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || "Failed to get tutor explanation");
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
