import express from "express";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Lazy initialize Google GenAI SDK to prevent container startup crashes
let aiInstance: GoogleGenAI | null = null;

function getAI(userProvidedKey?: string): GoogleGenAI {
  const apiKey = userProvidedKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured. Please supply a valid key under the AI Studio Settings panel or API Keys view.");
  }
  return new GoogleGenAI({ apiKey });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route 1: Candidate Bursts (Predictive typing candidates)
  app.post("/api/translate/burst", async (req, res) => {
    const { sourceText, targetPrefix, geminiApiKey } = req.body;

    if (!sourceText) {
      return res.status(400).json({ error: "Missing sourceText parameter." });
    }

    try {
      const ai = getAI(geminiApiKey);
      const systemPrompt = 
`You are an expert English-to-Arabic translator.
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
          responseMimeType: "application/json"
        }
      });

      const rawText = response.text || "{}";
      const parsed = JSON.parse(rawText);
      res.json({ suggestions: parsed.suggestions || [] });
    } catch (e: any) {
      console.error("[Backend] Burst failed:", e);
      res.status(500).json({ error: e.message || "Failed to generate predictive alternatives." });
    }
  });

  // API Route 2: Full segment translation
  app.post("/api/translate/full", async (req, res) => {
    const { sourceText, targetPrefix, geminiApiKey } = req.body;

    if (!sourceText) {
      return res.status(400).json({ error: "Missing sourceText parameter." });
    }

    try {
      const ai = getAI(geminiApiKey);
      const systemPrompt = 
`Translate the following English sentence to Arabic:
"${sourceText}"

${targetPrefix ? `The translation MUST start with this pre-written prefix: "${targetPrefix}"` : ""}
Provide a fluent translation in standard professional Arabic appropriate for technical translation workflows.
Return ONLY the raw Arabic translation. No quotes, no explanations, no boilerplate.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: systemPrompt,
      });

      const translation = (response.text || "").trim();
      res.json({ translation });
    } catch (e: any) {
      console.error("[Backend] Full translation failed:", e);
      res.status(500).json({ error: e.message || "Failed to generate full translation." });
    }
  });

  // API Route 3: AI Translation Tutor
  app.post("/api/translate/tutor-explain", async (req, res) => {
    const { sourceText, targetText, geminiApiKey, locale } = req.body;

    if (!sourceText || !targetText) {
      return res.status(400).json({ error: "Missing sourceText or targetText parameter." });
    }

    try {
      const ai = getAI(geminiApiKey);
      const isRTL = locale === "ar";
      
      const systemPrompt = 
`You are an elite, pedagogical translation professor teaching Arabic-English professional translation.
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
          responseMimeType: "application/json"
        }
      });

      const rawText = response.text || "{}";
      const parsed = JSON.parse(rawText);
      res.json(parsed);
    } catch (e: any) {
      console.error("[Backend] Tutor analysis failed:", e);
      res.status(500).json({ error: e.message || "Failed to analyze translation attempt." });
    }
  });

  // Serve static assets and bind Vite's dev server middleware
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Full-Stack Server] running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
