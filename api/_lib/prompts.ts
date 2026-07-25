/**
 * Direction-aware prompt builders for the Vercel serverless
 * translation endpoints (burst / full).
 *
 * These mirror the prompt logic in `src/lib/gemini-direct.ts` so
 * PWA-mode requests get the exact same direction-aware behaviour as
 * Tauri-mode requests. See PHASE 1 task 1.3 in the project brief.
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
