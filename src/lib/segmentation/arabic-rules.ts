/**
 * Arabic segmentation rules.
 *
 * CAT tools handle Arabic poorly because they depend on Latin cues
 * (capitalization, consistent full stops) that Arabic lacks. Arabic
 * has no case, chains clauses with ، ؛ و ف ثم, and is often
 * punctuated inconsistently. This module implements an SRX-style
 * ordered rule table tuned for Arabic, plus the "soft-split
 * suggestion" innovation for long sentences.
 */

import {
  ARABIC_DIGITS,
  ARABIC_DIACRITICS,
  TATWEEL,
  BIDI_INVISIBLE,
} from "./types";

// ─── Terminators ───────────────────────────────────────────────────
// Strong terminators that DO break (with closing quotes/brackets
// attached). Arabic ؟ (U+061F), Latin ! ? . … (Arabic text often
// uses Latin ! and ?), and combinations ؟! !؟.
export const AR_TERMINATORS = new Set<string>([".", "!", "?", "؟", "…"]);

// Weak punctuation that NEVER breaks by default: ، (U+060C Arabic
// comma), ؛ (U+061B Arabic semicolon), : (colon). These chain
// clauses in Arabic and breaking on them would over-segment.
export const AR_WEAK_PUNCTUATION = new Set<string>(["،", "؛", ":"]);

// Closing quotes/brackets to attach to the previous sentence.
export const AR_CLOSING = new Set<string>([
  "»", "«", "”", "“", "’", "‘", ")", "]", "﴾", "﴿",
]);

// Protected span openers/closers (balanced — never split inside).
export const AR_PROTECTED_PAIRS: Array<[string, string]> = [
  ["«", "»"],
  ["“", "”"],
  ["‘", "’"],
  ["(", ")"],
  ["[", "]"],
  ["﴿", "﴾"], // Quranic pairs (open ﴿, close ﴾ — note order!)
];

// ─── Arabic abbreviation table (extendable) ────────────────────────
// These are tokens followed by "." that should NOT break. Context-
// dependent entries are marked. Matching is done on the normalized
// (diacritics-stripped, alef-unified) form, so "د." and "د." with a
// diacritic both match.
export const AR_ABBREVIATIONS = new Set<string>([
  "د",       // د.  → دكتور (Dr)
  "أ.د",    // أ.د. → أستاذ دكتور (Prof. Dr)
  "م",       // م.  → مهندس (Eng) — context-dependent (also "م" = meter)
  "ص",       // ص.  → صفحة (page) / صلى الله عليه وسلم
  "ج",       // ج.  → جزء (part) / جمعة
  "ط",       // ط.  → طبعة (edition)
  "س",       // س.  → سنة (year)
  "هـ",      // هـ. → هجري (Hijri year suffix)
  "م",       // م.  → ميلادي (Gregorian year suffix) — context-dependent
  "ت.ق",    // ت.ق. → تقديري
  "ان.م",   // ان.م. → انتهت المذكرة
  "ر.ض",    // ر.ض. → رضي الله عنه
  "ع.ه",    // ع.ه. → علامه
]);

// Year-suffix markers that attach to a preceding numeral: م (ميلادي),
// هـ (هجري). A break after these is suppressed when the previous
// token is a numeral.
export const AR_YEAR_SUFFIXES = new Set<string>(["م", "هـ"]);

// ─── Attribution verbs ─────────────────────────────────────────────
// After a closing quote, do NOT break when the next token is an
// attribution verb. «هل ذهبت؟» سأل أحمد  →  one segment.
//
// Data table — extendable. Stored in their bare root forms; the
// matcher also accepts common conjugated prefixes (و، ف، ثم) and
// suffixes (ت، نا، وا, ن).
export const AR_ATTRIBUTION_VERBS = new Set<string>([
  "قال", "قالت",
  "سأل", "سألت",
  "أجاب", "أجابت",
  "أضاف", "أضافت",
  "أكد", "أكدت",
  "صرّح", "صرحت",
  "ذكر", "ذكرت",
  "رد", "ردت",
  "شرح", "شرحت",
  "وضح", "وضحت",
  "نوه", "نوهت",
  "أوضح", "أوضحت",
  "اعترف", "اعترفت",
  "روى", "روت",
  "كتب", "كتبت",
  "أشار", "أشارت",
]);

// ─── Soft-split clause-initial connectors ──────────────────────────
// When scoring candidate soft-split points at ، or ؛, a point is a
// candidate only if the next non-whitespace token starts with one of
// these connectors. Both bare and proclitic-prefixed forms are
// matched. We match the FULL form (never strip letters blindly —
// "ولكن" is the proclitic و + لكن; "بل" is its own word).
export const AR_SOFTSPLIT_CONNECTORS = [
  "ولكن", "لكن",
  "ثم",
  "بينما",
  "حيث",
  "إذ",
  "لأن",
  "كما",
  "أما",
  "بل",
  "لذلك",
  "وبينما", "وحيث", "ولأن", "وكما", "ولذلك", "وأما", "وإذ",
  "فبينما", "فحيث", "فلأن", "فكما", "فلذلك", "فأما", "فإذ",
  "وإن", "فإن", "إن",
];

// ─── Matching-only normalizer ──────────────────────────────────────
// NEVER applied to output. Used only for abbreviation/verb matching
// so that diacritics, tatweel, bidi marks, and alef-form variants
// don't defeat the data tables.
export function normalizeArabicForMatching(input: string): string {
  return input
    .replace(ARABIC_DIACRITICS, "")
    .replace(TATWEEL, "")
    .replace(BIDI_INVISIBLE, "")
    // Unify alef forms: أ إ آ → ا
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
    .trim();
}

// ─── Token counting for soft-split scoring ─────────────────────────
// "Token" here is a coarse proxy: a maximal run of non-whitespace
// characters. Good enough for the "both sides ≥ ~8 tokens" balance
// heuristic. NOT a linguistic tokenizer.
export function countArabicTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// ─── Protected-span tracking ───────────────────────────────────────
// A terminator inside a balanced « », “ ”, ( ), [ ], ﴿ ﴾ does not
// break. We compute the span boundaries once per paragraph (with a
// delimiter lookahead cap so an unbalanced quote can't swallow the
// whole document) and check terminator positions against them.
//
// Implementation: walk the paragraph, maintain a stack of open
// delimiters. On a close, pop. If the stack is non-empty at a
// terminator position, the terminator is inside a protected span.
//
// Cap: if the open→close distance exceeds PROTECTED_SPAN_MAX_CHARS,
// we assume the open was spurious and pop it (defensive). Reset at
// paragraph boundaries (handled by the orchestrator calling this per
// paragraph).
export const PROTECTED_SPAN_MAX_CHARS = 4000;

export interface ProtectedSpanRange {
  /** Offset of the opening delimiter (inclusive). */
  start: number;
  /** Offset of the closing delimiter (exclusive). */
  end: number;
}

/**
 * Compute the set of protected spans for a paragraph. The returned
 * ranges are half-open `[start, end)` into the paragraph text.
 *
 * Defensive: an unmatched opener is popped after
 * PROTECTED_SPAN_MAX_CHARS characters, so an unbalanced « can't
 * swallow the rest of the document.
 */
export function computeProtectedSpans(paragraph: string): ProtectedSpanRange[] {
  const spans: ProtectedSpanRange[] = [];
  // Stack of { openChar, openPos, closeChar }
  const stack: Array<{ open: string; close: string; pos: number }> = [];

  const openers = new Map<string, string>();
  for (const [o, c] of AR_PROTECTED_PAIRS) {
    openers.set(o, c);
  }

  for (let i = 0; i < paragraph.length; i++) {
    const ch = paragraph[i];

    // Check opener
    const close = openers.get(ch);
    if (close) {
      // Special: « and » order — in Arabic, « opens and » closes.
      // Our table has ["«","»"] so openers.get("«") = "»". Good.
      stack.push({ open: ch, close, pos: i });
      continue;
    }

    // Check closer — scan stack from top for a matching opener
    for (let s = stack.length - 1; s >= 0; s--) {
      if (ch === stack[s].close) {
        const openPos = stack[s].pos;
        if (i - openPos <= PROTECTED_SPAN_MAX_CHARS) {
          spans.push({ start: openPos, end: i + 1 });
        }
        // Pop everything above and the match
        stack.length = s;
        break;
      }
    }

    // Defensive: if the bottom of the stack has been open too long,
    // pop it. This guards against an unmatched opener swallowing the
    // rest of the document.
    if (stack.length > 0) {
      const bottom = stack[0];
      if (i - bottom.pos > PROTECTED_SPAN_MAX_CHARS) {
        stack.shift();
      }
    }
  }

  return spans;
}

/**
 * Is `pos` inside any protected span?
 */
export function isInsideProtectedSpan(
  pos: number,
  spans: ProtectedSpanRange[]
): boolean {
  for (const span of spans) {
    if (pos >= span.start && pos < span.end) return true;
  }
  return false;
}

// ─── Arabic-Indic / Persian digit handling ─────────────────────────
// A "." between digits never breaks. Covers ٠-٩, ۰-۹, and 0-9.
export function isArabicDecimalPoint(
  text: string,
  periodPos: number
): boolean {
  const before = periodPos > 0 ? text[periodPos - 1] : "";
  const after = periodPos < text.length - 1 ? text[periodPos + 1] : "";
  const beforeIsDigit = ARABIC_DIGITS.test(before) || /[0-9]/.test(before);
  const afterIsDigit = ARABIC_DIGITS.test(after) || /[0-9]/.test(after);
  return beforeIsDigit && afterIsDigit;
}

// ─── Arabic list-marker protection ─────────────────────────────────
//   ١.  ٢.  ١-  ٢-  (١)  (٢)  أ-  ب-  (أ)  (ب)
// These never break and stay with their text.
const AR_LIST_NUMERIC = /^[\u0660-\u0669\u06F0-\u06F9 0-9]{1,3}[.)-]$/;
const AR_LIST_ALPHA = /^[\u0621-\u064A][.)-]$/; // single Arabic letter + . ) -
const AR_LIST_PAREN = /^\([\u0660-\u0669\u06F0-\u06F9 0-9]{1,3}\)$/;
const AR_LIST_PAREN_ALPHA = /^\([\u0621-\u064A]\)$/;

export function isArabicListMarker(token: string): boolean {
  if (!token) return false;
  return (
    AR_LIST_NUMERIC.test(token) ||
    AR_LIST_ALPHA.test(token) ||
    AR_LIST_PAREN.test(token) ||
    AR_LIST_PAREN_ALPHA.test(token)
  );
}

// ─── Soft-split suggestion scorer ──────────────────────────────────
// Given a long Arabic sentence (≥ softSplitTokenThreshold tokens),
// score candidate split points at ، or ؛ followed by a clause-initial
// connector. Returns a ranked list of UTF-16 offsets into `text`.
//
// Scoring:
//   - candidate must be at a ، or ؛
//   - the next non-whitespace token (after the ، / ؛) must start with
//     one of AR_SOFTSPLIT_CONNECTORS (matched on the normalized form)
//   - both sides must have ≥ 8 tokens (balance)
//   - score = -|left_tokens - right_tokens| (closer to middle = higher)
//
// Returns the top 3 offsets (or fewer). NEVER auto-applies — the UI
// shows a "Split here" affordance.
export function scoreSoftSplitSuggestions(
  text: string,
  threshold: number,
  spans: ProtectedSpanRange[]
): number[] {
  if (countArabicTokens(text) < threshold) return [];

  const candidates: Array<{ pos: number; score: number }> = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "،" && ch !== "؛") continue;
    if (isInsideProtectedSpan(i, spans)) continue;

    // Find the next non-whitespace token after i
    let j = i + 1;
    while (j < text.length && /\s/.test(text[j])) j++;
    if (j >= text.length) continue;

    // Read the next "word" (up to whitespace or punctuation)
    let wordEnd = j;
    while (
      wordEnd < text.length &&
      !/\s/.test(text[wordEnd]) &&
      text[wordEnd] !== "،" &&
      text[wordEnd] !== "؛" &&
      text[wordEnd] !== "." &&
      text[wordEnd] !== "!" &&
      text[wordEnd] !== "?" &&
      text[wordEnd] !== "؟"
    ) {
      wordEnd++;
    }
    const rawWord = text.slice(j, wordEnd);
    const normWord = normalizeArabicForMatching(rawWord);

    // Match against connectors (full forms only, never strip blindly)
    const isConnector = AR_SOFTSPLIT_CONNECTORS.some(
      (c) => normWord === c || normWord.startsWith(c)
    );
    if (!isConnector) continue;

    // Balance check
    const left = text.slice(0, i);
    const right = text.slice(i + 1);
    const leftTokens = countArabicTokens(left);
    const rightTokens = countArabicTokens(right);
    if (leftTokens < 8 || rightTokens < 8) continue;

    const score = -Math.abs(leftTokens - rightTokens);
    candidates.push({ pos: i, score });
  }

  // Sort by score descending, take top 3
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 3).map((c) => c.pos);
}
