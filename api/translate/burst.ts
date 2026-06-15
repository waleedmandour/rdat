/**
 * Vercel Serverless Function: /api/translate/burst
 *
 * Generates up to 3 predictive Arabic translation candidates
 * using Gemini 2.5 Flash. Designed for the "ghost-text" burst
 * suggestion tier in the RDAT Copilot three-tier pipeline.
 *
 * Body: { sourceText: string, targetPrefix?: string, geminiApiKey?: string }
 * Response: { suggestions: string[] }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAI } from "../_lib/gemini";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const { sourceText, targetPrefix, geminiApiKey } = req.body || {};

  if (!sourceText) {
    return res.status(400).json({ error: "Missing sourceText parameter." });
  }

  try {
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
    return res.json({ suggestions: parsed.suggestions || [] });
  } catch (e: any) {
    console.error("[API /burst] Failed:", e);
    return res.status(500).json({
      error: e.message || "Failed to generate predictive alternatives.",
    });
  }
}
