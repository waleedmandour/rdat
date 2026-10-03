/**
 * Segmentation module — public API.
 *
 * Pure, dependency-free, deterministic, lossless paragraph-faithful
 * CAT-grade segmentation with Arabic-aware rules.
 *
 * Usage:
 *   import { segment, roundtrip } from "@/src/lib/segmentation";
 *   const { segments } = segment(sourceText, { granularity: "sentence" });
 */

export {
  segment,
  roundtrip,
  isIdempotent,
  normalizeLineEndings,
  detectDominantScript,
  splitParagraphs,
} from "./orchestrator";

export {
  EN_ABBREVIATIONS,
  isListMarker,
  CLOSING_QUOTES_BRACKETS,
} from "./english-rules";

export {
  AR_TERMINATORS,
  AR_WEAK_PUNCTUATION,
  AR_CLOSING,
  AR_ABBREVIATIONS,
  AR_ATTRIBUTION_VERBS,
  normalizeArabicForMatching,
  computeProtectedSpans,
  isInsideProtectedSpan,
  scoreSoftSplitSuggestions,
} from "./arabic-rules";

export { fnv1aHex, ARABIC_DIGITS, ARABIC_DIACRITICS, TATWEEL, BIDI_INVISIBLE } from "./types";
export { PROTECTED_SPAN_MAX_CHARS } from "./arabic-rules";

export type {
  Segment,
  SegmentationResult,
  SegmentOptions,
  ManualOverride,
  Granularity,
  Script,
} from "./types";
