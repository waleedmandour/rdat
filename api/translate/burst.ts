/**
 * Vercel Serverless Function: /api/translate/burst
 *
 * Generates up to 3 predictive translation candidates using Gemini 2.5
 * Flash. Designed for the "ghost-text" burst suggestion tier in the
 * RDAT Copilot three-tier pipeline.
 *
 * Direction-aware (PHASE 1): accepts a `direction: "en-ar" | "ar-en"`
 * field in the request body and builds a direction-appropriate prompt.
 * Defaults to "en-ar" when the field is absent for backward
 * compatibility with older clients.
 *
 * Uses the modern Web Standard fetch handler (ESM-compatible).
 *
 * Body: { sourceText: string, targetPrefix?: string, direction?: "en-ar"|"ar-en", geminiApiKey?: string }
 * Response: { suggestions: string[] }
 */
import { getAI } from "../_lib/gemini";
import { buildBurstPrompt, type TranslationDirection } from "../_lib/prompts";
import { checkRateLimit, checkInputSize } from "../_lib/rate-limit";

export default {
  async fetch(request: Request) {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed. Use POST." }, { status: 405 });
    }

    // SECURITY (audit fix #4): per-IP rate limiting. See _lib/rate-limit.ts.
    const rl = checkRateLimit(request);
    if (!rl.allowed) {
      return Response.json(
        { error: rl.reason || "Rate limit exceeded" },
        {
          status: 429,
          headers: rl.retryAfterSeconds
            ? { "Retry-After": String(rl.retryAfterSeconds) }
            : undefined,
        }
      );
    }

    try {
      const {
        sourceText,
        targetPrefix,
        direction,
        geminiApiKey,
      } = await request.json() as {
        sourceText?: string;
        targetPrefix?: string;
        direction?: TranslationDirection;
        geminiApiKey?: string;
      };

      if (!sourceText) {
        return Response.json({ error: "Missing sourceText parameter." }, { status: 400 });
      }

      // SECURITY (audit fix #4): cap input size to prevent memory/timeout
      // exhaustion. 10k chars is well beyond any realistic single segment.
      const sizeCheck = checkInputSize(sourceText, targetPrefix);
      if (!sizeCheck.ok) {
        return Response.json({ error: sizeCheck.error }, { status: 413 });
      }

      // Validate direction — fall back to "en-ar" for unknown / missing values.
      const dir: TranslationDirection =
        direction === "ar-en" || direction === "en-ar" ? direction : "en-ar";

      const ai = getAI(geminiApiKey);
      const systemPrompt = buildBurstPrompt(sourceText, targetPrefix || "", dir);

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: systemPrompt,
        config: {
          responseMimeType: "application/json",
        },
      });

      const rawText = response.text || "{}";
      const parsed = JSON.parse(rawText);
      return Response.json({ suggestions: parsed.suggestions || [] });
    } catch (e: any) {
      console.error("[API /burst] Failed:", e);
      return Response.json(
        { error: e.message || "Failed to generate predictive alternatives." },
        { status: 500 }
      );
    }
  },
};
