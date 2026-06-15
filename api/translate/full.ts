/**
 * Vercel Serverless Function: /api/translate/full
 *
 * Generates a full Arabic translation of the given English source text
 * using Gemini 2.5 Flash. Optionally conditions on a typed Arabic prefix.
 *
 * Body: { sourceText: string, targetPrefix?: string, geminiApiKey?: string }
 * Response: { translation: string }
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
    return res.json({ translation });
  } catch (e: any) {
    console.error("[API /full] Failed:", e);
    return res.status(500).json({
      error: e.message || "Failed to generate full translation.",
    });
  }
}
