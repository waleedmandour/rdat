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
 *
 * PHASE 1 (bidirectional translation): the burst/full request types
 * and prompt builders now accept a `direction: "en-ar" | "ar-en"`
 * field. Both the Tauri and PWA code paths share the same
 * direction-aware prompt builders so behaviour stays identical
 * across the two deployment targets.
 */

import { isTauriEnvironment } from "./adapters/ollama-adapter";
import type { TranslationDirection } from "../stores/workspace-store";

// ─── Types ────────────────────────────────────────────────────────

export interface GeminiBurstRequest {
  sourceText: string;
  targetPrefix: string;
  geminiApiKey: string;
  /** Translation direction. Defaults to "en-ar" for backward compat with older callers. */
  direction?: TranslationDirection;
}

export interface GeminiFullRequest {
  sourceText: string;
  targetPrefix: string;
  geminiApiKey: string;
  /** Translation direction. Defaults to "en-ar" for backward compat with older callers. */
  direction?: TranslationDirection;
}

export interface GeminiTutorRequest {
  sourceText: string;
  targetText: string;
  locale: "en" | "ar";
  geminiApiKey: string;
  /**
   * Translation direction of the segment being analysed. The tutor
   * prompt branches on this so it frames the analysis correctly for
   * both EN→AR and AR→EN attempts. Defaults to "en-ar" for backward
   * compatibility with older callers. See PHASE 3 task 3.1.
   */
  direction?: TranslationDirection;
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

// ─── Direction-aware prompt labels ────────────────────────────────
// These mirror the phrasing already used by buildRAGSystemPrompt() /
// buildUserPrompt() in src/lib/llm-adapter.ts so that Tier 2 (Gemini)
// and Tier 1 (local LLM) speak the same direction-aware language to
// the model. Keeping one vocabulary avoids the drift that previously
// left Gemini hardcoded to "English-to-Arabic" while the local LLM
// was already direction-aware.

interface DirectionLabels {
  sourceLang: string;   // "English" | "Arabic"
  targetLang: string;   // "Arabic" | "English"
  sourceLabel: string;  // "English source" | "Arabic source"
  targetLabel: string;  // "Arabic translation" | "English translation"
  professionalTarget: string; // "standard professional Arabic" | "professional English"
}

function labelsForDirection(direction: TranslationDirection): DirectionLabels {
  return direction === "ar-en"
    ? {
        sourceLang: "Arabic",
        targetLang: "English",
        sourceLabel: "Arabic source",
        targetLabel: "English translation",
        professionalTarget: "professional English suitable for academic contexts",
      }
    : {
        sourceLang: "English",
        targetLang: "Arabic",
        sourceLabel: "English source",
        targetLabel: "Arabic translation",
        professionalTarget: "standard professional Arabic appropriate for technical translation workflows",
      };
}

// ─── Shared prompt builders ───────────────────────────────────────
// These mirror the prompts in api/translate/*.ts so behavior is
// identical between PWA and Tauri modes. The api/translate/*.ts
// functions export their own copies of these builders (see PHASE 1
// task 1.3) — keep them in sync if you change phrasing here.

function buildBurstPrompt(
  sourceText: string,
  targetPrefix: string,
  direction: TranslationDirection = "en-ar"
): string {
  const labels = labelsForDirection(direction);
  return `You are an expert ${labels.sourceLang}-to-${labels.targetLang} translator.
Your task is to predict up to 3 natural ${labels.targetLang} translation completions that follow logically from the typed prefix "${targetPrefix || ""}" translating this ${labels.sourceLang} sentence:
"${sourceText}"

Reflect high-quality professional terminology.
You MUST respond with a valid JSON object matching the following structure:
{"suggestions": ["suggestion1", "suggestion2", "suggestion3"]}

Do NOT wrap the result in markdown quotes or extra text. Output ONLY the raw JSON block.`;
}

function buildFullPrompt(
  sourceText: string,
  targetPrefix: string,
  direction: TranslationDirection = "en-ar"
): string {
  const labels = labelsForDirection(direction);
  return `Translate the following ${labels.sourceLang} sentence to ${labels.targetLang}:
"${sourceText}"

${targetPrefix ? `The translation MUST start with this pre-written prefix: "${targetPrefix}"` : ""}
Provide a fluent translation in ${labels.professionalTarget}.
Return ONLY the raw ${labels.targetLang} translation. No quotes, no explanations, no boilerplate.`;
}

/**
 * Build the AI Translation Tutor prompt. Direction-aware since PHASE 3
 * task 3.1: previously the prompt always framed the analysis as
 * "Arabic-English professional translation" with the source labelled
 * "English Source" and the target labelled "Arabic Translation Attempt",
 * which was wrong for AR→EN attempts. The prompt now branches on
 * direction so the framing matches what the user is actually doing.
 *
 * The `isRTL` flag controls the *output language* of the tutor's
 * feedback (Arabic when the UI is RTL, English otherwise) — that's
 * separate from the translation direction.
 */
function buildTutorPrompt(
  sourceText: string,
  targetText: string,
  isRTL: boolean,
  direction: TranslationDirection = "en-ar"
): string {
  const isArToEn = direction === "ar-en";
  const sourceLang = isArToEn ? "Arabic" : "English";
  const targetLang = isArToEn ? "English" : "Arabic";
  // The course title stays "Arabic-English professional translation"
  // in both directions because the tutor teaches bidirectional
  // AR↔EN translation; only the source/target labelling changes.
  return `You are an elite, pedagogical translation professor teaching Arabic-English professional translation.
Your task is to analyze a ${sourceLang} source sentence and a ${targetLang} translation attempt, and provide rich pedagogical feedback and corrections.

${sourceLang} Source: "${sourceText}"
${targetLang} Translation Attempt: "${targetText}"

Respond with a strictly formatted JSON object matching this structure:
{
  "rating": 90,
  "grade": "A",
  "explanation": "A direct feedback paragraph explaining style and grammatical cohesion in the language designated by isRTL=${isRTL}. Speak affectionately as a helpful coaching tutor.",
  "termsAnalysed": [
    { "term": "${sourceLang} Term", "analysis": "${targetLang} mapping explanation and contextual fit analysis." }
  ],
  "pitfalls": "Common translation traps, literal translation failures, or false friends to watch out for in this sentence."
}

Ensure your entire explanation, analyses, and comments are returned in ${isRTL ? "Arabic" : "English"}.
Do NOT wrap the response in markdown quotes or code fences. Output ONLY the raw JSON block.`;
}

// ─── Tauri (Rust proxy) implementations ──────────────────────────

async function tauriGeminiBurst(req: GeminiBurstRequest): Promise<GeminiBurstResponse> {
  const invoke = await getInvoke();
  const direction = req.direction || "en-ar";
  const systemPrompt = buildBurstPrompt(req.sourceText, req.targetPrefix, direction);
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
  const direction = req.direction || "en-ar";
  const systemPrompt = buildFullPrompt(req.sourceText, req.targetPrefix, direction);
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
  const direction = req.direction || "en-ar";
  const systemPrompt = buildTutorPrompt(req.sourceText, req.targetText, isRTL, direction);
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
