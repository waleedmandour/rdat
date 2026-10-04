/**
 * English (Latin) segmentation rules — SRX-style ordered rule table.
 *
 * First-match-wins: we walk the paragraph left to right. At each
 * candidate terminator position we evaluate the rules in order; the
 * first rule that matches (break or no-break) decides. If no rule
 * matches, no break.
 *
 * Why not full SRX? SRX is XML and ships with a complex rule
 * language (before-break / after-break regexes, rule cascades). For
 * a CAT tool targeting EN↔AR with a fixed domain, a hand-tuned
 * ordered table is smaller, faster, and easier to test. The data
 * tables below are extendable.
 */

import { LATIN_DIGITS } from "./types";

// ─── Abbreviation table (extendable) ───────────────────────────────
// All entries are stored lowercase; matching is case-insensitive on
// the last word before the period. A "." immediately after one of
// these tokens does NOT break.
//
// Context-dependent entries (e.g. "St" = Saint vs Street) are handled
// by the after-context: if the next token starts with a lowercase
// letter or a street-type word, we suppress the break. For now we
// treat them all as no-break, which matches Trados's default
// conservative behaviour. Refine via the data table.
export const EN_ABBREVIATIONS = new Set<string>([
  // Titles
  "mr", "mrs", "ms", "miss", "dr", "prof", "sr", "jr",
  // Honorifics / forms of address
  "esq", "rev", "hon", "fr", "br",
  // Time
  "a.m", "p.m", "am", "pm",
  // Geography
  "st", "ave", "blvd", "rd", "sq", "pl", "ct", "mt", "mtn", "ft",
  "u.s", "u.s.a", "u.k", "u.a.e", "e.u",
  // Academic / units
  "no", "vol", "pp", "p", "ch", "sec", "fig", "figs", "et", "al",
  "etc", "cf", "op", "cit", "ibid", "id",
  // Corporate
  "inc", "ltd", "co", "corp", "plc", "gmbh",
  // Latin abbreviations
  "e.g", "i.e", "viz", "vs", "v", "c", "ca", "cp",
  // Months (abbreviated)
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept",
  "oct", "nov", "dec",
  // Days
  "mon", "tue", "wed", "thu", "fri", "sat", "sun",
  // Common technical
  "approx", "dept", "est", "min", "max", "avg", "def", "ref",
  "eq", "fig", "tab", "ch", "sec", "vol",
]);

// Single-letter initials: "A." "B." etc. A period after a single
// uppercase letter does not break UNLESS the following token starts
// with an uppercase letter and the initial is not part of a list like
// "A. B. Smith". We handle the common case: single uppercase letter +
// period + space + uppercase → no break if the next token is also a
// single letter or a known-name pattern. This is conservative.
export function isSingleLetterInitial(before: string): boolean {
  // `before` is the single character immediately before the period.
  return before.length === 1 && before >= "A" && before <= "Z";
}

// ─── URL / email / filename / version protection ───────────────────
// A period inside a URL, email, filename, or version string does not
// break. We detect these by checking that the period is part of a
// contiguous non-whitespace token that contains a URL/email marker.
//
// The key insight: a period that ends a sentence is followed by
// whitespace + next sentence. A period INSIDE a URL is surrounded by
// non-whitespace on both sides (e.g. "example.com/page"). So we find
// the maximal non-whitespace run containing the period, and check if
// that run looks like a URL/email.
//
//   digits on both sides          → decimal (3.14)        → no break
//   "/" before or "/" after nearby → URL path             → no break
//   "@" in the run                → email domain          → no break
//   run starts with http/https/ftp/www → URL              → no break

export function isDecimalOrVersion(
  before: string,
  after: string
): boolean {
  return !!before.match(LATIN_DIGITS) && !!after.match(LATIN_DIGITS);
}

/**
 * Does the period at `periodPos` sit inside a URL or email token?
 * We find the maximal whitespace-delimited run containing the period
 * and check whether that run contains a URL scheme, "www.", or "@".
 * This is tight enough that "info." after a URL is NOT suppressed
 * (the run is just "info", which has no scheme), but "example.com"
 * inside "https://example.com/page" IS suppressed.
 */
export function isInsideUrlOrEmail(
  text: string,
  periodPos: number
): boolean {
  // Find the start of the run (walk back until whitespace)
  let runStart = periodPos;
  while (runStart > 0 && !/\s/.test(text[runStart - 1])) runStart--;
  // Find the end of the run (walk forward until whitespace)
  let runEnd = periodPos;
  while (runEnd < text.length && !/\s/.test(text[runEnd])) runEnd++;

  const run = text.slice(runStart, runEnd).toLowerCase();
  // A URL/email run must contain a scheme marker or @
  return (
    run.includes("http://") ||
    run.includes("https://") ||
    run.includes("ftp://") ||
    run.includes("www.") ||
    run.includes("@")
  );
}

// ─── List-marker protection ────────────────────────────────────────
//   "1. " "2. " "a. " "b. " "iv. " "(1) " "(a) " "1) " "a) "
// A period or closing paren immediately after a list marker, followed
// by whitespace + text, does NOT break.
const LIST_MARKER_NUMERIC = /^\d{1,3}[.)]$/;
const LIST_MARKER_ALPHA = /^[a-z][.)]$/;
const LIST_MARKER_ROMAN = /^(ix|iv|v?i{0,3})[.)]$/i;
const LIST_MARKER_PAREN = /^\(?\d{1,3}\)$/;
const LIST_MARKER_PAREN_ALPHA = /^\([a-z]\)$/;

export function isListMarker(token: string): boolean {
  if (!token) return false;
  const t = token.toLowerCase();
  return (
    LIST_MARKER_NUMERIC.test(t) ||
    LIST_MARKER_ALPHA.test(t) ||
    LIST_MARKER_ROMAN.test(t) ||
    LIST_MARKER_PAREN.test(t) ||
    LIST_MARKER_PAREN_ALPHA.test(t)
  );
}

// ─── Closing-quote / bracket attachment ────────────────────────────
// After a terminator ".", ".", "!", "?", "…", we attach trailing
// closing quotes/brackets to the same sentence.
export const CLOSING_QUOTES_BRACKETS = new Set<string>([
  '"', "'", "”", "“", "’", "‘", "»", "«",
  ")", "]", "}", "〉", "》",
]);
