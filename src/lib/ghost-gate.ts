/**
 * Ghost-gate predicate.
 *
 * Determines whether ghost-text suggestions should be DISPLAYED for a
 * target segment. The gate is DISPLAY-ONLY: background generation
 * (segment-focus prefetch, LLM requests) still runs so suggestions are
 * ready, but no ghost text is shown until the user has entered their
 * first meaningful characters in that target segment.
 *
 * Why display-only: the user said "hide until the translator starts
 * typing". Restored/saved translations, paste, undo/redo, segment
 * navigation, and Arabic/IME input all behave correctly because the
 * predicate is derived statelessly from the segment's current text —
 * no stored flag, no race with async requests.
 *
 * The gate is applied at ONE choke point in TargetEditor's render path
 * (covering all tiers: LTE, local LLM, Gemini). It is evaluated at
 * DISPLAY time, not request time, so a late response cannot leak
 * through.
 *
 * When the gate is closed:
 *   - ghostSuggestion is forced to "" (empty)
 *   - the tier badge is hidden
 *   - any aria-live announcement is suppressed
 *   - Tab, Alt+], Ctrl+Right behave as they do today when no
 *     suggestion exists (Tab is never trapped)
 *
 * The existing tier-error hints and status-bar behaviour are NOT
 * affected (per the brief: "existing tier-error hints … stay as they
 * are").
 */

/**
 * Minimum number of meaningful characters required to open the gate.
 * Default 1 = "first meaningful character". Change to a higher number
 * (e.g. 3) for "first full word" — it's a single constant.
 */
export const GHOST_GATE_MIN_CHARS = 1;

// Characters that are stripped before counting:
//   - whitespace (space, tab, newline, NBSP, various Unicode spaces)
//   - bidi controls (U+200E/F LRM/RLM, U+061C ALM, U+202A–202E,
//     U+2066–2069 isolates)
//   - ZWJ (U+200D) / ZWNJ (U+200C)
//   - tatweel (U+0640)
//
// These are zero-width or formatting-only and do not constitute
// "typing" for the purpose of opening the gate. A segment that
// contains ONLY these (e.g. a stray bidi mark from a paste) stays
// closed.
const STRIPPED = /[\s\u00A0\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069\u200D\u200C\u0640]/g;

/**
 * Strip whitespace, bidi controls, ZWJ/ZWNJ, and tatweel from a string.
 * Used by the gate predicate to count only "meaningful" characters.
 */
export function stripInvisible(text: string): string {
  return text.replace(STRIPPED, "");
}

/**
 * Count the meaningful characters in a target segment's text.
 * Whitespace, bidi controls, ZWJ/ZWNJ, and tatweel do not count.
 */
export function countMeaningfulChars(text: string): number {
  return stripInvisible(text).length;
}

/**
 * The gate predicate. Returns true if ghost-text suggestions should be
 * DISPLAYED for this segment.
 *
 * Pure: derives entirely from the segment's current text. No stored
 * flag, no side effects. If the segment returns to empty (after
 * stripping), the gate closes and any visible ghost text disappears
 * at once (because the caller forces ghostSuggestion to "" when this
 * returns false).
 *
 * @param targetText - the current text in the target segment
 * @param minChars   - override for GHOST_GATE_MIN_CHARS (for tests)
 * @returns true if the gate is open (display suggestions), false otherwise
 */
export function isGhostGateOpen(
  targetText: string,
  minChars: number = GHOST_GATE_MIN_CHARS
): boolean {
  return countMeaningfulChars(targetText) >= minChars;
}
