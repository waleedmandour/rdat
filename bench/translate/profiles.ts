/**
 * Prompt profiles for the translation benchmark.
 *
 * Each model family has a specific prompt format:
 *   - plain (gemma4, qwen3.5): a single fixed instruction + source text
 *   - translategemma: single user message, no system message, glossary
 *     hints folded into the user message
 *   - hy-mt: Tencent's official template (verified from model cards)
 *   - rdat-rag: RDAT's own buildRAGSystemPrompt/buildUserPrompt (for
 *     the C2 condition + the cloud Gemini anchor)
 *
 * C1 "native": each model uses its official prompt format.
 * C2 "RDAT-RAG": general LLMs use RDAT's builders with glossary hints.
 */

export type PromptCondition = "C1-native" | "C2-rdat-rag";
export type Direction = "en-ar" | "ar-en";

export interface PromptResult {
  /** The rendered system prompt (empty for translategemma). */
  systemPrompt: string;
  /** The rendered user prompt. */
  userPrompt: string;
  /** The profile label for logging. */
  profileLabel: string;
}

export interface GlossaryHint {
  source: string;
  target: string;
}

/**
 * Render a prompt for a given model family, condition, direction, and
 * optional glossary hints.
 *
 * C1 "native":
 *   - plain: "Translate the following {srcLang} text into {tgtLang}. Output only the translation.\n\n{sourceText}"
 *   - translategemma: single user message, no system. Glossary hints
 *     (if any) are folded into the user message per the TranslateGemma
 *     format.
 *   - hy-mt: Tencent's official template. The model card shows a chat
 *     template; we use the /api/chat format with system + user.
 *
 * C2 "RDAT-RAG":
 *   - Uses RDAT's buildRAGSystemPrompt + buildUserPrompt (imported lazily
 *     to avoid pulling the app's store deps into the bench).
 *   - Specialists get hints in the user message per their profile.
 */
export function renderPrompt(
  family: string,
  condition: PromptCondition,
  direction: Direction,
  sourceText: string,
  glossaryHints?: GlossaryHint[]
): PromptResult {
  const isArToEn = direction === "ar-en";
  const srcLang = isArToEn ? "Arabic" : "English";
  const tgtLang = isArToEn ? "English" : "Arabic";

  // ── C1 "native" ──
  if (condition === "C1-native") {
    if (family === "translategemma") {
      // TranslateGemma: single user message, no system message.
      // Glossary hints (if any) go into the user message.
      let userMsg = `Translate the following ${srcLang} text into ${tgtLang}. Output only the translation.\n\n${sourceText}`;
      if (glossaryHints && glossaryHints.length > 0) {
        const hints = glossaryHints.map(h => `${h.source} → ${h.target}`).join("; ");
        userMsg += `\n\nGlossary: ${hints}`;
      }
      return {
        systemPrompt: "",
        userPrompt: userMsg,
        profileLabel: "translategemma-native",
      };
    }

    if (family === "hy-mt" || family === "hy-mt2") {
      // Tencent HY-MT official template: system message with translation
      // instruction, user message with the source text. The model card
      // shows the chat template uses standard system+user roles.
      let systemMsg = `You are a professional translator. Translate the following ${srcLang} text into ${tgtLang}. Output only the translation.`;
      let userMsg = sourceText;
      if (glossaryHints && glossaryHints.length > 0) {
        const hints = glossaryHints.map(h => `${h.source} → ${h.target}`).join("\n");
        systemMsg += `\n\nUse these glossary terms where applicable:\n${hints}`;
      }
      return {
        systemPrompt: systemMsg,
        userPrompt: userMsg,
        profileLabel: "hy-mt-native",
      };
    }

    // Default "plain" for general LLMs (gemma4, qwen3.5, etc.)
    return {
      systemPrompt: "",
      userPrompt: `Translate the following ${srcLang} text into ${tgtLang}. Output only the translation.\n\n${sourceText}`,
      profileLabel: "plain-native",
    };
  }

  // ── C2 "RDAT-RAG" ──
  // Use RDAT's own prompt builders. For the bench, we import them lazily.
  // The builders are in src/lib/llm-adapter.ts.
  // We replicate the logic here (to avoid pulling store deps) but keep
  // the exact same prompt text.
  const baseInstructions = isArToEn
    ? [
        "You are a professional Arabic-to-English translator specializing in Computer-Assisted Translation (CAT) workflows.",
        "Your task is to translate the given Arabic text into natural, accurate, and fluent English.",
        "Follow these rules strictly:",
        "1. Use the reference glossary terms preferentially wherever they apply.",
        "2. Maintain terminological consistency.",
        "3. Produce professional English suitable for academic contexts.",
        "4. Do NOT add explanations, notes, or commentary.",
        "5. Output ONLY the English translation.",
      ].join("\n")
    : [
        "You are a professional English-to-Arabic translator specializing in Computer-Assisted Translation (CAT) workflows.",
        "Your task is to translate the given English text into natural, accurate, and fluent Arabic.",
        "Follow these rules strictly:",
        "1. Use the reference glossary terms preferentially wherever they apply.",
        "2. Maintain terminological consistency.",
        "3. Produce Modern Standard Arabic suitable for professional/academic contexts.",
        "4. Do NOT add explanations, notes, or commentary.",
        "5. Output ONLY the Arabic translation.",
      ].join("\n");

  let ragContext = "";
  if (glossaryHints && glossaryHints.length > 0) {
    const formatted = glossaryHints
      .map(h => `  - "${h.source}" -> "${h.target}"`)
      .join("\n");
    ragContext = `\n\nReference glossary (use these terms preferentially where applicable):\n${formatted}`;
  }

  const systemPrompt = baseInstructions + ragContext;
  const userPrompt = `${isArToEn ? "Arabic source" : "English source"}: ${sourceText}\n\nTranslate to ${tgtLang}. Output ONLY the ${tgtLang} translation. Do not add explanations.`;

  return {
    systemPrompt,
    userPrompt,
    profileLabel: family === "translategemma" ? "translategemma-rdat" : "rdat-rag",
  };
}
