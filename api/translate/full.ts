/**
 * Vercel Serverless Function: /api/translate/full
 *
 * Generates a full Arabic translation of the given English source text
 * using Gemini 2.5 Flash. Optionally conditions on a typed Arabic prefix.
 *
 * Uses the modern Web Standard fetch handler (ESM-compatible).
 *
 * Body: { sourceText: string, targetPrefix?: string, geminiApiKey?: string }
 * Response: { translation: string }
 */
import { getAI } from "../_lib/gemini";

export default {
  async fetch(request: Request) {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed. Use POST." }, { status: 405 });
    }

    try {
      const { sourceText, targetPrefix, geminiApiKey } = await request.json() as {
        sourceText?: string;
        targetPrefix?: string;
        geminiApiKey?: string;
      };

      if (!sourceText) {
        return Response.json({ error: "Missing sourceText parameter." }, { status: 400 });
      }

      const ai = getAI(geminiApiKey);

      const systemPrompt = `Translate the following English sentence to Arabic:
"${sourceText}"

${targetPrefix ? `The translation MUST start with this pre-written prefix: "${targetPrefix}"` : ""}
Provide a fluent translation in standard professional Arabic appropriate for technical translation workflows.
Return ONLY the raw Arabic translation. No quotes, no explanations, no boilerplate.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: systemPrompt,
      });

      const translation = (response.text || "").trim();
      return Response.json({ translation });
    } catch (e: any) {
      console.error("[API /full] Failed:", e);
      return Response.json(
        { error: e.message || "Failed to generate full translation." },
        { status: 500 }
      );
    }
  },
};
