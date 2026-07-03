/**
 * Gemini Direct Client — Tauri/PWA dispatcher.
 *
 * In Tauri mode: calls the Rust-side `gemini_translate` command via
 * Tauri invoke, which uses reqwest to call the Gemini REST API. This
 * avoids CORS issues and works with post-June-19-2026 API key
 * restrictions.
 *
 * In PWA mode (browser): calls the Vercel serverless functions at
 * `/api/translate/*` which use the @google/genai SDK server-side.
 *
 * The interface matches `useGemini.ts` so the existing hook can use
 * this without modification — it just needs to call these functions
 * instead of `fetch("/api/translate/...")` directly.
 */

import { isTauriEnvironment } from "./adapters/ollama-adapter";

// ─── Types ────────────────────────────────────────────────────────

export interface GeminiBurstRequest {
  sourceText: string;
  targetPrefix: string;
  geminiApiKey: string;
}

export interface GeminiFullRequest {
  sourceText: string;
  targetPrefix: string;
  geminiApiKey: string;
}

export interface GeminiTutorRequest {
  sourceText: string;
  targetText: string;
  locale: "en" | "ar";
  geminiApiKey: string;
}

export interface GeminiBurstResponse {
  suggestions: string[];
}

export interface GeminiFullResponse {
  translation: string;
}

export interface GeminiTutorResponse {
  rating: number;
  grade: string;
  explanation: string;
  termsAnalysed: { term: string; analysis: string }[];
  pitfalls: string;
}

// ─── Tauri invoke (lazy-loaded) ───────────────────────────────────

let invokeFn: any = null;
async function getInvoke() {
  if (!invokeFn) {
    const mod = await import("@tauri-apps/api/core");
    invokeFn = mod.invoke;
  }
  return invokeFn;
}

// ─── Shared prompt builders ───────────────────────────────────────
// These mirror the prompts in api/translate/*.ts so behavior is
// identical between PWA and Tauri modes.

function buildBurstPrompt(sourceText: string, targetPrefix: string): string {
  return `You are an expert English-to-Arabic translator.
Your task is to predict up to 3 natural Arabic translation completions that follow logically from the typed prefix "${targetPrefix || ""}" translating this English sentence:
"${sourceText}"

Reflect high-quality professional terminology.
You MUST respond with a valid JSON object matching the following structure:
{"suggestions": ["suggestion1", "suggestion2", "suggestion3"]}

Do NOT wrap the result in markdown quotes or extra text. Output ONLY the raw JSON block.`;
}

function buildFullPrompt(sourceText: string, targetPrefix: string): string {
  return `Translate the following English sentence to Arabic:
"${sourceText}"

${targetPrefix ? `The translation MUST start with this pre-written prefix: "${targetPrefix}"` : ""}
Provide a fluent translation in standard professional Arabic appropriate for technical translation workflows.
Return ONLY the raw Arabic translation. No quotes, no explanations, no boilerplate.`;
}

function buildTutorPrompt(sourceText: string, targetText: string, isRTL: boolean): string {
  return `You are an elite, pedagogical translation professor teaching Arabic-English professional translation.
Your task is to analyze an English source sentence and an Arabic translation attempt, and provide rich pedagogical feedback and corrections.

English Source: "${sourceText}"
Arabic Translation Attempt: "${targetText}"

Respond with a strictly formatted JSON object matching this structure:
{
  "rating": 90,
  "grade": "A",
  "explanation": "A direct feedback paragraph explaining style and grammatical cohesion in the language designated by isRTL=${isRTL}. Speak affectionately as a helpful coaching tutor.",
  "termsAnalysed": [
    { "term": "English Term", "analysis": "Arabic mapping explanation and contextual fit analysis." }
  ],
  "pitfalls": "Common translation traps, literal translation failures, or false friends to watch out for in this sentence."
}

Ensure your entire explanation, analyses, and comments are returned in ${isRTL ? "Arabic" : "English"}.
Do NOT wrap the response in markdown quotes or code fences. Output ONLY the raw JSON block.`;
}

// ─── Tauri (Rust proxy) implementations ──────────────────────────

async function tauriGeminiBurst(req: GeminiBurstRequest): Promise<GeminiBurstResponse> {
  const invoke = await getInvoke();
  const systemPrompt = buildBurstPrompt(req.sourceText, req.targetPrefix);
  const result = await invoke("gemini_translate", {
    req: {
      model: "gemini-2.5-flash",
      systemPrompt,
      userPrompt: req.sourceText,
      maxTokens: 512,
      temperature: 0.4,
      apiKey: req.geminiApiKey,
    },
  }) as { candidates: string[]; error: string | null };

  if (result.error) throw new Error(result.error);

  // Gemini returns the raw text; for burst we asked for JSON, so parse it
  const rawText = result.candidates[0] || "{}";
  try {
    const parsed = JSON.parse(rawText);
    return { suggestions: parsed.suggestions || [] };
  } catch {
    // If Gemini didn't return valid JSON, treat each candidate as a suggestion
    return { suggestions: result.candidates };
  }
}

async function tauriGeminiFull(req: GeminiFullRequest): Promise<GeminiFullResponse> {
  const invoke = await getInvoke();
  const systemPrompt = buildFullPrompt(req.sourceText, req.targetPrefix);
  const result = await invoke("gemini_translate", {
    req: {
      model: "gemini-2.5-flash",
      systemPrompt,
      userPrompt: req.sourceText,
      maxTokens: 256,
      temperature: 0.3,
      apiKey: req.geminiApiKey,
    },
  }) as { candidates: string[]; error: string | null };

  if (result.error) throw new Error(result.error);
  return { translation: (result.candidates[0] || "").trim() };
}

async function tauriGeminiTutor(req: GeminiTutorRequest): Promise<GeminiTutorResponse> {
  const invoke = await getInvoke();
  const isRTL = req.locale === "ar";
  const systemPrompt = buildTutorPrompt(req.sourceText, req.targetText, isRTL);
  const result = await invoke("gemini_translate", {
    req: {
      model: "gemini-2.5-flash",
      systemPrompt,
      userPrompt: `Analyze the translation above. Output JSON only.`,
      maxTokens: 1024,
      temperature: 0.3,
      apiKey: req.geminiApiKey,
    },
  }) as { candidates: string[]; error: string | null };

  if (result.error) throw new Error(result.error);

  const rawText = result.candidates[0] || "{}";
  try {
    const parsed = JSON.parse(rawText);
    return parsed as GeminiTutorResponse;
  } catch {
    throw new Error("Gemini returned invalid JSON for tutor analysis: " + rawText.slice(0, 200));
  }
}

// ─── PWA (Vercel function) implementations ───────────────────────

async function pwaGeminiBurst(req: GeminiBurstRequest): Promise<GeminiBurstResponse> {
  const response = await fetch("/api/translate/burst", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!response.ok) {
    const errText = await response.text();
    let errMsg = `HTTP ${response.status}`;
    try { const j = JSON.parse(errText); errMsg = j.error || errMsg; } catch { errMsg = errText.slice(0, 200); }
    throw new Error(errMsg);
  }
  return response.json();
}

async function pwaGeminiFull(req: GeminiFullRequest): Promise<GeminiFullResponse> {
  const response = await fetch("/api/translate/full", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!response.ok) {
    const errText = await response.text();
    let errMsg = `HTTP ${response.status}`;
    try { const j = JSON.parse(errText); errMsg = j.error || errMsg; } catch { errMsg = errText.slice(0, 200); }
    throw new Error(errMsg);
  }
  return response.json();
}

async function pwaGeminiTutor(req: GeminiTutorRequest): Promise<GeminiTutorResponse> {
  const response = await fetch("/api/translate/tutor-explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!response.ok) {
    const errText = await response.text();
    let errMsg = `HTTP ${response.status}`;
    try { const j = JSON.parse(errText); errMsg = j.error || errMsg; } catch { errMsg = errText.slice(0, 200); }
    throw new Error(errMsg);
  }
  return response.json();
}

// ─── Public API — dispatches based on environment ────────────────

export async function geminiBurst(req: GeminiBurstRequest): Promise<GeminiBurstResponse> {
  if (isTauriEnvironment()) {
    return tauriGeminiBurst(req);
  }
  return pwaGeminiBurst(req);
}

export async function geminiFull(req: GeminiFullRequest): Promise<GeminiFullResponse> {
  if (isTauriEnvironment()) {
    return tauriGeminiFull(req);
  }
  return pwaGeminiFull(req);
}

export async function geminiTutor(req: GeminiTutorRequest): Promise<GeminiTutorResponse> {
  if (isTauriEnvironment()) {
    return tauriGeminiTutor(req);
  }
  return pwaGeminiTutor(req);
}
