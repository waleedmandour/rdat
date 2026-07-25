import express from "express";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import {
  buildBurstPrompt,
  buildFullPrompt,
  buildTutorPrompt,
  type TranslationDirection,
} from "./api/_lib/prompts";

dotenv.config();

// Lazy initialize Google GenAI SDK to prevent container startup crashes.
// Note: unlike the Vercel function (which can cache the SDK instance when
// using the env-var key), the dev server always creates a fresh instance
// per request so per-user keys work correctly.
function getAI(userProvidedKey?: string): GoogleGenAI {
  const apiKey = userProvidedKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured. Please supply a valid key under the AI Studio Settings panel or API Keys view.");
  }
  return new GoogleGenAI({ apiKey });
}

/** Validate and normalise the direction field from the request body. */
function normaliseDirection(raw: unknown): TranslationDirection {
  return raw === "ar-en" || raw === "en-ar" ? raw : "en-ar";
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route 1: Candidate Bursts (Predictive typing candidates)
  // Direction-aware since PHASE 1; this dev-server mirror was
  // previously hardcoded to EN→AR. See PHASE 3 task 3.1.
  app.post("/api/translate/burst", async (req, res) => {
    const { sourceText, targetPrefix, geminiApiKey, direction } = req.body;

    if (!sourceText) {
      return res.status(400).json({ error: "Missing sourceText parameter." });
    }

    try {
      const ai = getAI(geminiApiKey);
      const dir = normaliseDirection(direction);
      const systemPrompt = buildBurstPrompt(sourceText, targetPrefix || "", dir);

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
  // Direction-aware since PHASE 1; this dev-server mirror was
  // previously hardcoded to EN→AR. See PHASE 3 task 3.1.
  app.post("/api/translate/full", async (req, res) => {
    const { sourceText, targetPrefix, geminiApiKey, direction } = req.body;

    if (!sourceText) {
      return res.status(400).json({ error: "Missing sourceText parameter." });
    }

    try {
      const ai = getAI(geminiApiKey);
      const dir = normaliseDirection(direction);
      const systemPrompt = buildFullPrompt(sourceText, targetPrefix || "", dir);

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
  // Direction-aware since PHASE 3 task 3.1; previously hardcoded to
  // "English source sentence and an Arabic translation attempt".
  app.post("/api/translate/tutor-explain", async (req, res) => {
    const { sourceText, targetText, geminiApiKey, locale, direction } = req.body;

    if (!sourceText || !targetText) {
      return res.status(400).json({ error: "Missing sourceText or targetText parameter." });
    }

    try {
      const ai = getAI(geminiApiKey);
      const isRTL = locale === "ar";
      const dir = normaliseDirection(direction);
      const systemPrompt = buildTutorPrompt(sourceText, targetText, isRTL, dir);

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
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Full-Stack Server] running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
