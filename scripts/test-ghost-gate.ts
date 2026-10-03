/**
 * Ghost-gate predicate tests.
 *
 * Run: npx tsx scripts/test-ghost-gate.ts
 *
 * Covers: empty, whitespace-only, bidi-only, tatweel-only, Arabic
 * letter, Latin letter, digit, punctuation, pasted text, IME
 * composition, undo-to-empty, mixed meaningful + invisible.
 */
import {
  isGhostGateOpen,
  countMeaningfulChars,
  stripInvisible,
  GHOST_GATE_MIN_CHARS,
} from "../src/lib/ghost-gate";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? " — " + detail : ""}`);
  }
}

console.log("\n══ Ghost-gate predicate ══");
console.log(`GHOST_GATE_MIN_CHARS = ${GHOST_GATE_MIN_CHARS}`);

console.log("\n── Empty / whitespace-only ──");

check("Empty string → closed", isGhostGateOpen("") === false);
check("Single space → closed", isGhostGateOpen(" ") === false);
check("Multiple spaces → closed", isGhostGateOpen("   ") === false);
check("Tab → closed", isGhostGateOpen("\t") === false);
check("Newline → closed", isGhostGateOpen("\n") === false);
check("Mixed whitespace → closed", isGhostGateOpen(" \t\n ") === false);
check("NBSP (U+00A0) → closed", isGhostGateOpen("\u00A0") === false);
check("Various Unicode spaces → closed", isGhostGateOpen("\u2000\u2001\u202F\u3000") === false);

console.log("\n── Bidi controls only ──");

check("LRM (U+200E) only → closed", isGhostGateOpen("\u200E") === false);
check("RLM (U+200F) only → closed", isGhostGateOpen("\u200F") === false);
check("ALM (U+061C) only → closed", isGhostGateOpen("\u061C") === false);
check("LRE (U+202A) only → closed", isGhostGateOpen("\u202A") === false);
check("RLE (U+202B) only → closed", isGhostGateOpen("\u202B") === false);
check("PDF (U+202C) only → closed", isGhostGateOpen("\u202C") === false);
check("LRO (U+202D) only → closed", isGhostGateOpen("\u202D") === false);
check("RLO (U+202E) only → closed", isGhostGateOpen("\u202E") === false);
check("LRI (U+2066) only → closed", isGhostGateOpen("\u2066") === false);
check("RLI (U+2067) only → closed", isGhostGateOpen("\u2067") === false);
check("FSI (U+2068) only → closed", isGhostGateOpen("\u2068") === false);
check("PDI (U+2069) only → closed", isGhostGateOpen("\u2069") === false);
check("All bidi marks together → closed", isGhostGateOpen("\u200E\u200F\u061C\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069") === false);

console.log("\n── ZWJ / ZWNJ / tatweel only ──");

check("ZWJ (U+200D) only → closed", isGhostGateOpen("\u200D") === false);
check("ZWNJ (U+200C) only → closed", isGhostGateOpen("\u200C") === false);
check("Tatweel (U+0640) only → closed", isGhostGateOpen("\u0640") === false);
check("ZWJ + tatweel → closed", isGhostGateOpen("\u200D\u0640") === false);

console.log("\n── Arabic letter (opens gate) ──");

check("Single Arabic letter → open", isGhostGateOpen("ا") === true);
check("Arabic word → open", isGhostGateOpen("مرحبا") === true);
check("Arabic letter + bidi mark → open (meaningful char present)", isGhostGateOpen("ا\u200E") === true);
check("Arabic letter + tatweel → open", isGhostGateOpen("ا\u0640") === true);

console.log("\n── Latin letter (opens gate) ──");

check("Single Latin letter → open", isGhostGateOpen("h") === true);
check("Latin word → open", isGhostGateOpen("hello") === true);
check("Latin letter + bidi mark → open", isGhostGateOpen("h\u200E") === true);

console.log("\n── Digit (opens gate) ──");

check("Single Latin digit → open", isGhostGateOpen("1") === true);
check("Single Arabic-Indic digit → open", isGhostGateOpen("١") === true);
check("Single Persian digit → open", isGhostGateOpen("۱") === true);

console.log("\n── Punctuation ──");

check("Single punctuation '.' → open (punctuation is meaningful)", isGhostGateOpen(".") === true);
check("Single punctuation '؟' → open", isGhostGateOpen("؟") === true);
check("Comma only → open", isGhostGateOpen("،") === true);

console.log("\n── Pasted text (multiple words + spaces) ──");

check("Pasted English sentence → open", isGhostGateOpen("The quick brown fox") === true);
check("Pasted Arabic sentence → open", isGhostGateOpen("اللغة العربية لغة جميلة") === true);
check("Pasted text with leading bidi mark → open", isGhostGateOpen("\u200EHello world") === true);
check("Pasted text with trailing bidi mark → open", isGhostGateOpen("Hello world\u200E") === true);
check("Pasted text surrounded by bidi marks → open", isGhostGateOpen("\u200E\u200FHello\u200E") === true);

console.log("\n── IME composition (Arabic) ──");

check("Arabic with diacritics → open (diacritics are meaningful)", isGhostGateOpen("قَابَلَ") === true);
check("Arabic with ZWJ (composition) → open", isGhostGateOpen("لا\u200D") === true);

console.log("\n── Undo-to-empty (gate re-closes) ──");

check("Text then empty → re-closed", isGhostGateOpen("hello") && !isGhostGateOpen("") === true);
check("Text then whitespace-only → re-closed", isGhostGateOpen("hello") && !isGhostGateOpen("   ") === true);
check("Text then bidi-only → re-closed", isGhostGateOpen("hello") && !isGhostGateOpen("\u200E") === true);

console.log("\n── Mixed meaningful + invisible ──");

check("Bidi mark + Arabic letter + bidi mark → open", isGhostGateOpen("\u200Eا\u200E") === true);
check("Space + Latin letter + space → open", isGhostGateOpen(" h ") === true);
check("Tatweel + Arabic + tatweel → open", isGhostGateOpen("\u0640مرحبا\u0640") === true);

console.log("\n── minChars override (for 'first full word' option) ──");

check("minChars=3: 'hi' → closed", isGhostGateOpen("hi", 3) === false);
check("minChars=3: 'hello' → open", isGhostGateOpen("hello", 3) === true);
check("minChars=3: 'hi   ' (with spaces) → closed", isGhostGateOpen("hi   ", 3) === false);

console.log("\n── Helper: countMeaningfulChars ──");

check("countMeaningfulChars('') = 0", countMeaningfulChars("") === 0);
check("countMeaningfulChars('   ') = 0", countMeaningfulChars("   ") === 0);
check("countMeaningfulChars('\\u200E') = 0", countMeaningfulChars("\u200E") === 0);
check("countMeaningfulChars('hello') = 5", countMeaningfulChars("hello") === 5);
check("countMeaningfulChars('مرحبا') = 5", countMeaningfulChars("مرحبا") === 5);
check("countMeaningfulChars(' h ') = 1", countMeaningfulChars(" h ") === 1);
check("countMeaningfulChars('\\u200Eا\\u200E') = 1", countMeaningfulChars("\u200Eا\u200E") === 1);

console.log("\n── Helper: stripInvisible ──");

check("stripInvisible('hello') = 'hello'", stripInvisible("hello") === "hello");
check("stripInvisible(' h ') = 'h'", stripInvisible(" h ") === "h");
check("stripInvisible('\\u200Eا\\u200E') = 'ا'", stripInvisible("\u200Eا\u200E") === "ا");
check("stripInvisible('\\u0640مرحبا\\u0640') = 'مرحبا'", stripInvisible("\u0640مرحبا\u0640") === "مرحبا");

// ════════════════════════════════════════════════════════════════════
console.log("\n────────────────────────────────");
console.log(`  PASS: ${pass}    FAIL: ${fail}`);
console.log("────────────────────────────────");
if (fail > 0) {
  process.exit(1);
}
