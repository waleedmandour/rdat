/**
 * Direction-aware prompt builders for the Vercel serverless
 * translation endpoints (burst / full / tutor-explain).
 *
 * These mirror the prompt logic in `src/lib/gemini-direct.ts` so
 * PWA-mode requests get the exact same direction-aware behaviour as
 * Tauri-mode requests. See PHASE 1 task 1.3 and PHASE 3 task 3.1.
 *
 * The phrasing is aligned with `buildRAGSystemPrompt()` /
 * `buildUserPrompt()` in `src/lib/llm-adapter.ts` so all three tiers
 * (LTE / local LLM / Gemini) speak the same direction-aware language
 * to the underlying model.
 */

export type TranslationDirection = "en-ar" | "ar-en";

interface DirectionLabels {
  sourceLang: string;
  targetLang: string;
  professionalTarget: string;
}

function labelsForDirection(direction: TranslationDirection): DirectionLabels {
  return direction === "ar-en"
    ? {
        sourceLang: "Arabic",
        targetLang: "English",
        professionalTarget: "professional English suitable for academic contexts",
      }
    : {
        sourceLang: "English",
        targetLang: "Arabic",
        professionalTarget: "standard professional Arabic appropriate for technical translation workflows",
      };
}

export function buildBurstPrompt(
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

export function buildFullPrompt(
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
 * Direction-aware AI Translation Tutor prompt. Previously (pre-PHASE 3)
 * this prompt always framed the analysis as "English source sentence
 * and an Arabic translation attempt" — wrong for AR→EN attempts. The
 * prompt now branches on direction so the source/target labelling
 * matches what the user is actually doing. The course title stays
 * "Arabic-English professional translation" in both directions because
 * the tutor teaches bidirectional AR↔EN translation.
 *
 * `isRTL` controls the *output language* of the tutor's feedback
 * (Arabic when the UI is RTL, English otherwise) — that's separate
 * from the translation direction.
 */
export function buildTutorPrompt(
  sourceText: string,
  targetText: string,
  isRTL: boolean,
  direction: TranslationDirection = "en-ar"
): string {
  const labels = labelsForDirection(direction);
  return `You are an elite, pedagogical translation professor teaching Arabic-English professional translation.
Your task is to analyze a ${labels.sourceLang} source sentence and a ${labels.targetLang} translation attempt, and provide rich pedagogical feedback and corrections.

${labels.sourceLang} Source: "${sourceText}"
${labels.targetLang} Translation Attempt: "${targetText}"

Respond with a strictly formatted JSON object matching this structure:
{
  "rating": 90,
  "grade": "A",
  "explanation": "A direct feedback paragraph explaining style and grammatical cohesion in the language designated by isRTL=${isRTL}. Speak affectionately as a helpful coaching tutor.",
  "termsAnalysed": [
    { "term": "${labels.sourceLang} Term", "analysis": "${labels.targetLang} mapping explanation and contextual fit analysis." }
  ],
  "pitfalls": "Common translation traps, literal translation failures, or false friends to watch out for in this sentence."
}

Ensure your entire explanation, analyses, and comments are returned in ${isRTL ? "Arabic" : "English"}.
Do NOT wrap the response in markdown quotes or code fences. Output ONLY the raw JSON block.`;
}
