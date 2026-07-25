/**
 * Vercel Serverless Function: /api/translate/tutor-explain
 *
 * Provides pedagogical AI translation feedback by analysing an
 * AR↔EN translation attempt. Returns rating, grade, term-by-term
 * analysis, and common pitfalls.
 *
 * Direction-aware (PHASE 3 task 3.1): accepts a `direction:
 * "en-ar" | "ar-en"` field in the request body. The prompt branches
 * on direction so the source/target labelling matches what the user
 * is actually doing. Defaults to "en-ar" when the field is absent
 * for backward compatibility with older clients.
 *
 * Uses the modern Web Standard fetch handler (ESM-compatible).
 *
 * Body: { sourceText: string, targetText: string, locale?: "en"|"ar", direction?: "en-ar"|"ar-en", geminiApiKey?: string }
 * Response: { rating, grade, explanation, termsAnalysed, pitfalls }
 */
import { getAI } from "../_lib/gemini";
import { buildTutorPrompt, type TranslationDirection } from "../_lib/prompts";

export default {
  async fetch(request: Request) {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed. Use POST." }, { status: 405 });
    }

    try {
      const { sourceText, targetText, geminiApiKey, locale, direction } = await request.json() as {
        sourceText?: string;
        targetText?: string;
        geminiApiKey?: string;
        locale?: string;
        direction?: TranslationDirection;
      };

      if (!sourceText || !targetText) {
        return Response.json(
          { error: "Missing sourceText or targetText parameter." },
          { status: 400 }
        );
      }

      // Validate direction — fall back to "en-ar" for unknown / missing values.
      const dir: TranslationDirection =
        direction === "ar-en" || direction === "en-ar" ? direction : "en-ar";

      const ai = getAI(geminiApiKey);
      const isRTL = locale === "ar";
      const systemPrompt = buildTutorPrompt(sourceText, targetText, isRTL, dir);

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: systemPrompt,
        config: {
          responseMimeType: "application/json",
        },
      });

      const rawText = response.text || "{}";
      const parsed = JSON.parse(rawText);
      return Response.json(parsed);
    } catch (e: any) {
      console.error("[API /tutor-explain] Failed:", e);
      return Response.json(
        { error: e.message || "Failed to analyze translation attempt." },
        { status: 500 }
      );
    }
  },
};
