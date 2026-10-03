/**
 * Arabic normalizer for secondary scoring.
 *
 * Strips diacritics, tatweel, unifies alef/yaa/taa-marbuta variants,
 * unifies digit scripts and punctuation. Applied to both hypothesis
 * and reference before chrF so the score is robust to orthographic
 * variation that doesn't affect meaning.
 */

const DIACRITICS = /[\u064B-\u065F\u0670]/g;
const TATWEEL = /\u0640/g;
const BIDI = /[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/g;

/**
 * Normalize Arabic text for secondary chrF scoring.
 * Pure function, no side effects.
 */
export function normalizeArabic(text: string): string {
  return text
    // Strip diacritics (tashkeel)
    .replace(DIACRITICS, "")
    // Strip tatweel
    .replace(TATWEEL, "")
    // Strip bidi controls
    .replace(BIDI, "")
    // Unify alef forms: أ إ آ → ا
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
    // Unify yaa: ى → ي
    .replace(/\u0649/g, "\u064A")
    // Unify taa-marbuta: ة → ه
    .replace(/\u0629/g, "\u0647")
    // Unify Arabic-Indic digits ٠-٩ → 0-9
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    // Unify Persian digits ۰-۹ → 0-9
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0))
    // Unify Arabic comma ، → ,
    .replace(/\u060C/g, ",")
    // Unify Arabic semicolon ؛ → ;
    .replace(/\u061B/g, ";")
    // Unify Arabic question mark ؟ → ?
    .replace(/\u061F/g, "?")
    // Normalize whitespace
    .replace(/\s+/g, " ")
    .trim();
}
