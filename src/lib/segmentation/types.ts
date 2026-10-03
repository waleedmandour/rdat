/**
 * Segmentation — types and shared constants.
 *
 * Pure, dependency-free, deterministic, lossless. No network, no DOM,
 * no side effects. Safe to run in a Web Worker, a service worker, or
 * Node (for tests).
 *
 * Design notes:
 *   - `start`/`end` are UTF-16 code-unit offsets into the ORIGINAL
 *     input (after \r\n → \n normalization, which is the only
 *     transformation applied). `concat(segments.map(s => s.text).join("…"))`
 *     is NOT the round-trip; the round-trip property is:
 *       original === segmentsAndSeparatorsJoined
 *     where the joiner is the empty string and the separators are
 *     re-derivable from `start`/`end` gaps. See `roundtrip()` in the
 *     orchestrator.
 *   - `sourceHash` is a non-cryptographic hash of the segment's text
 *     for persistence attach/detach decisions. NOT a security
 *     primitive. FNV-1a was chosen because it is tiny, fast, has
 *     good distribution for short strings, and has no dependencies.
 *     Collisions on real translation-segment-sized strings are
 *     negligible; the hydration path also checks `source_lang` +
 *     `target_lang` + length, so a hash collision alone would still
 *     need a same-length same-language-pair segment to misattach.
 *   - `script` is the dominant script of the segment's paragraph,
 *     not the segment itself, so a Latin token inside an Arabic
 *     paragraph still gets Arabic rules (per the brief).
 */

export type Script = "latin" | "arabic";

export type Granularity = "sentence" | "paragraph";

/**
 * A single segment produced by the segmenter.
 */
export interface Segment {
  /** 0-based global index across the whole document. */
  index: number;
  /** 0-based paragraph index. */
  paragraphIndex: number;
  /** 0-based index within the paragraph. */
  indexInParagraph: number;
  /** The segment text (no surrounding whitespace). */
  text: string;
  /** UTF-16 offset into the normalized input where this segment starts. */
  start: number;
  /** UTF-16 offset into the normalized input where this segment ends (exclusive). */
  end: number;
  /** FNV-1a hash of `text` (hex string). Non-cryptographic. */
  sourceHash: string;
  /** True if this is the last segment in its paragraph. */
  isParagraphEnd: boolean;
  /** Dominant script of the paragraph this segment belongs to. */
  script: Script;
  /**
   * Optional soft-split suggestion for long Arabic sentences. A list
   * of candidate split points (UTF-16 offsets into `text`), ranked by
   * the scoring heuristic. The UI renders a "Split here" affordance
   * at each. NEVER auto-applied.
   */
  softSplitSuggestion?: number[];
}

/**
 * The full segmentation result.
 */
export interface SegmentationResult {
  /** Ordered segments. */
  segments: Segment[];
  /** The normalized input (only \r\n → \n applied). */
  normalized: string;
  /** Granularity used. */
  granularity: Granularity;
  /** Manual overrides applied on top (for round-trip / debugging). */
  manualBreaks: number[];
  manualJoins: number[];
}

/**
 * Manual overrides stored on top of automatic segmentation.
 *   - manualBreaks: global segment indices where the user inserted a
 *     break (split). Each entry is the index of the segment that
 *     should be split at the stored cursor offset.
 *   - manualJoins: global segment indices where the user joined with
 *     the next segment.
 *
 * Both are cleared when the source text changes. They are applied
 * AFTER automatic segmentation, so re-segmentation (e.g. on direction
 * switch) re-applies them deterministically as long as the text is
 * unchanged. If a manual break/join would be invalid for the current
 * automatic segmentation (e.g. the segment index is out of range),
 * it is silently dropped.
 */
export interface ManualOverride {
  /** Global segment index to split. */
  segmentIndex: number;
  /** UTF-16 offset within that segment's text where the break goes. */
  offset: number;
}

/**
 * Options for `segment()`.
 */
export interface SegmentOptions {
  granularity?: Granularity;
  manualBreaks?: ManualOverride[];
  manualJoins?: number[];
  /**
   * Soft-split token-length threshold for Arabic. Default 45.
   * Sentences at or above this length are candidates for a soft-split
   * suggestion. Set to Infinity to disable.
   */
  softSplitTokenThreshold?: number;
}

// ─── Shared character classes ──────────────────────────────────────

/**
 * Arabic-Indic digits ٠-٩ (U+0660–U+0669) and Persian digits ۰-۹
 * (U+06F0–U+06F9). Used in abbreviation/number rules so a "." between
 * Arabic digits never breaks (e.g. "٣.١٤" is a decimal, not a sentence
 * end).
 */
export const ARABIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/;

/**
 * Latin digits 0-9.
 */
export const LATIN_DIGITS = /[0-9]/;

/**
 * Any digit (Latin, Arabic-Indic, Persian).
 */
export const ANY_DIGIT = /[\u0660-\u0669\u06F0-\u06F9 0-9]/;

/**
 * Arabic diacritics (tashkeel) U+064B–065F and the superscript alef
 * U+0670. Used by the matching-only normalizer.
 */
export const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670]/g;

/**
 * Tatweel U+0640. Used by the matching-only normalizer.
 */
export const TATWEEL = /\u0640/g;

/**
 * Bidi controls and invisible formatting characters that must NOT be
 * treated as whitespace and must NOT be treated as boundaries. They
 * are preserved inside segments.
 *
 *   U+200E  LRE marker (LRM)
 *   U+200F  RLE marker (RLM)
 *   U+061C  Arabic Letter Mark
 *   U+202A–202E  LRE/RLE/PDF/LRO/RLO (deprecated bidi)
 *   U+2066–2069  LRI/RLI/FSI/PDI (isolate)
 *   U+200D  ZWJ
 *   U+200C  ZWNJ
 *
 * None of these are whitespace per ECMAScript's `\s`, but they are
 * zero-width and a naive `trim()`-on-steroids could strip them. We
 * preserve them.
 */
export const BIDI_INVISIBLE = /[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069\u200D\u200C]/;

/**
 * Characters that are "whitespace" for segmentation purposes: space,
 * tab, newline, carriage return, vertical tab, form feed, non-breaking
 * space (U+00A0), and the various Unicode spaces. Bidi/invisible
 * characters are EXCLUDED (see above).
 */
export const SEGMENT_WHITESPACE = /[\s\u00A0\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]/;

// ─── FNV-1a hash (non-cryptographic) ───────────────────────────────

/**
 * Compute the 32-bit FNV-1a hash of a string, returned as an 8-char
 * hex string. Non-cryptographic — used only for "is this the same
 * source text as last time?" attach/detach decisions in persistence.
 *
 * Why FNV-1a: tiny, no dependencies, good distribution on short
 * strings, ~1 µs per segment. Not a security primitive.
 */
export function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // FNV prime (32-bit)
    hash = Math.imul(hash, 0x01000193);
  }
  // To unsigned 32-bit, then to hex
  return (hash >>> 0).toString(16).padStart(8, "0");
}
