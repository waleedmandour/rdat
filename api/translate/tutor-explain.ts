/**
 * Vercel Serverless Function: /api/translate/tutor-explain
 *
 * Provides pedagogical AI translation feedback by analysing an
 * English→Arabic translation attempt. Returns rating, grade,
 * term-by-term analysis, and common pitfalls.
 *
 * Body: { sourceText: string, targetText: string, locale?: "en"|"ar", geminiApiKey?: string }
 * Response: { rating, grade, explanation, termsAnalysed, pitfalls }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAI } from "../_lib/gemini";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const { sourceText, targetText, geminiApiKey, locale } = req.body || {};

  if (!sourceText || !targetText) {
    return res
      .status(400)
      .json({ error: "Missing sourceText or targetText parameter." });
  }

  try {
    const ai = getAI(geminiApiKey);
    const isRTL = locale === "ar";

    const systemPrompt = `You are an elite, pedagogical translation professor teaching Arabic-English professional translation.
Your task is to analyze an English source sentence and an Arabic translation attempt, and provide rich pedagogical feedback and corrections.

English Source: "${sourceText}"
Arabic Translation Attempt: "${targetText}"

Respond with a strictly formatted JSON object matching this structure:
{
  "rating": 90, // integer from 0 to 100
  "grade": "A", // letter grade (e.g., A+, B-, C)
  "explanation": "A direct feedback paragraph explaining style and grammatical cohesion in the language designated by isRTL=${isRTL}. Speak affectionately as a helpful coaching tutor.",
  "termsAnalysed": [
    { "term": "English Term", "analysis": "Arabic mapping explanation and contextual fit analysis." }
  ],
  "pitfalls": "Common translation traps, literal translation failures, or false friends to watch out for in this sentence."
}

Ensure your entire explanation, analyses, and comments are returned in ${isRTL ? "Arabic" : "English"}.
Do NOT wrap the response in markdown quotes or code fences. Output ONLY the raw JSON block.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: systemPrompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const rawText = response.text || "{}";
    const parsed = JSON.parse(rawText);
    return res.json(parsed);
  } catch (e: any) {
    console.error("[API /tutor-explain] Failed:", e);
    return res
      .status(500)
      .json({ error: e.message || "Failed to analyze translation attempt." });
  }
}
