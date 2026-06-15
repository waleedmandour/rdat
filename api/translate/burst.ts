/**
 * Vercel Serverless Function: /api/translate/burst
 *
 * Generates up to 3 predictive Arabic translation candidates
 * using Gemini 2.5 Flash. Designed for the "ghost-text" burst
 * suggestion tier in the RDAT Copilot three-tier pipeline.
 *
 * Uses the modern Web Standard fetch handler (ESM-compatible).
 *
 * Body: { sourceText: string, targetPrefix?: string, geminiApiKey?: string }
 * Response: { suggestions: string[] }
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

      const systemPrompt = `You are an expert English-to-Arabic translator.
Your task is to predict up to 3 natural Arabic translation completions that follow logically from the typed prefix "${targetPrefix || ""}" translating this English sentence:
"${sourceText}"

Reflect high-quality professional terminology.
You MUST respond with a valid JSON object matching the following structure:
{"suggestions": ["suggestion1", "suggestion2", "suggestion3"]}

Do NOT wrap the result in markdown quotes or extra text. Output ONLY the raw JSON block.`;

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
