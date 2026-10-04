/**
 * Robustness / format compliance checks.
 *
 * Computed BEFORE output cleaning. Reports per-model rates for:
 *   - empty output
 *   - preamble or commentary (non-translation text before/after the translation)
 *   - markdown fences (``` or ~~~)
 *   - leaked thinking tags (ndl...ndl)
 *   - wrong script (Arabic-letter share for EN→AR should be high; Latin share for AR→EN should be high)
 *   - repetition loops (3+ consecutive repeats of the same token)
 *   - length ratio outside 0.5–2.0 of the reference
 *   - truncation at num_predict (output ends mid-token or at exactly max_tokens)
 */

export interface ComplianceResult {
  isEmpty: boolean;
  hasPreamble: boolean;
  hasMarkdownFences: boolean;
  hasThinkingTags: boolean;
  wrongScript: boolean;
  hasRepetition: boolean;
  lengthRatioOutOfRange: boolean;
  possiblyTruncated: boolean;
}

export interface ComplianceRates {
  emptyRate: number;
  preambleRate: number;
  markdownFenceRate: number;
  thinkingTagRate: number;
  wrongScriptRate: number;
  repetitionRate: number;
  lengthRatioOutOfRangeRate: number;
  truncationRate: number;
  totalChecked: number;
}

const ARABIC_RANGE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LATIN_RANGE = /[A-Za-z]/;
const THINKING_TAG = /\u003Cthink\u003E|\u003C\/think\u003E/i;

/**
 * Check a single hypothesis for compliance issues.
 */
export function checkCompliance(
  hypothesis: string,
  reference: string,
  direction: "en-ar" | "ar-en",
  maxTokens?: number
): ComplianceResult {
  const trimmed = hypothesis.trim();

  // Empty output
  const isEmpty = trimmed.length === 0;

  // Markdown fences
  const hasMarkdownFences = /```|~~~/.test(trimmed);

  // Leaked thinking tags
  const hasThinkingTags = THINKING_TAG.test(trimmed);

  // Preamble: the first line doesn't start with an Arabic (for EN→AR)
  // or Latin (for AR→EN) character — it's likely commentary.
  // Also check for common preamble patterns like "Here is", "Translation:", etc.
  const firstLine = trimmed.split("\n")[0]?.trim() || "";
  const startsWithTargetScript = direction === "en-ar"
    ? ARABIC_RANGE.test(firstLine[0] || "")
    : LATIN_RANGE.test(firstLine[0] || "");
  const hasPreamblePattern = /^(here is|translation:|sure,|certainly,|the translation|of course|okay,|let me)/i.test(firstLine);
  const hasPreamble = !isEmpty && (!startsWithTargetScript || hasPreamblePattern);

  // Wrong script: for EN→AR, the output should be predominantly Arabic.
  // For AR→EN, predominantly Latin.
  const arabicChars = (trimmed.match(new RegExp(ARABIC_RANGE.source, "g")) || []).length;
  const latinChars = (trimmed.match(new RegExp(LATIN_RANGE.source, "g")) || []).length;
  const totalLetters = arabicChars + latinChars;
  const wrongScript = !isEmpty && totalLetters > 10 && (
    (direction === "en-ar" && arabicChars / totalLetters < 0.3) ||
    (direction === "ar-en" && latinChars / totalLetters < 0.3)
  );

  // Repetition: 3+ consecutive repeats of the same word
  const words = trimmed.split(/\s+/).filter(Boolean);
  let hasRepetition = false;
  if (words.length >= 6) {
    for (let i = 0; i <= words.length - 6; i++) {
      if (words[i] === words[i + 2] && words[i] === words[i + 4]) {
        hasRepetition = true;
        break;
      }
    }
  }

  // Length ratio
  const hypLen = trimmed.length;
  const refLen = reference.trim().length;
  const ratio = refLen > 0 ? hypLen / refLen : 1;
  const lengthRatioOutOfRange = !isEmpty && (ratio < 0.5 || ratio > 2.0);

  // Truncation: if we know maxTokens and the output is suspiciously close
  // to the limit, it may have been truncated.
  const possiblyTruncated = !isEmpty && maxTokens !== undefined && hypLen > maxTokens * 3; // rough char estimate

  return {
    isEmpty,
    hasPreamble,
    hasMarkdownFences,
    hasThinkingTags,
    wrongScript,
    hasRepetition,
    lengthRatioOutOfRange,
    possiblyTruncated,
  };
}

/**
 * Aggregate compliance results into per-model rates.
 */
export function aggregateCompliance(
  results: Array<{ result: ComplianceResult }>
): ComplianceRates {
  const total = results.length;
  if (total === 0) {
    return {
      emptyRate: 0, preambleRate: 0, markdownFenceRate: 0,
      thinkingTagRate: 0, wrongScriptRate: 0, repetitionRate: 0,
      lengthRatioOutOfRangeRate: 0, truncationRate: 0, totalChecked: 0,
    };
  }

  return {
    emptyRate: results.filter(r => r.result.isEmpty).length / total,
    preambleRate: results.filter(r => r.result.hasPreamble).length / total,
    markdownFenceRate: results.filter(r => r.result.hasMarkdownFences).length / total,
    thinkingTagRate: results.filter(r => r.result.hasThinkingTags).length / total,
    wrongScriptRate: results.filter(r => r.result.wrongScript).length / total,
    repetitionRate: results.filter(r => r.result.hasRepetition).length / total,
    lengthRatioOutOfRangeRate: results.filter(r => r.result.lengthRatioOutOfRange).length / total,
    truncationRate: results.filter(r => r.result.possiblyTruncated).length / total,
    totalChecked: total,
  };
}
