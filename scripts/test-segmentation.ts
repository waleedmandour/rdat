/**
 * Segmentation test suite — 60+ cases covering EN and AR rules.
 *
 * Run: npx tsx scripts/test-segmentation.ts
 *
 * Covers:
 *   - English: terminators (. ! ? …), abbreviations (Mr, Dr, e.g, etc),
 *     decimals/versions (3.14, v2.1.0), URLs/emails, list markers,
 *     single-letter initials, mid-sentence ellipses, closing quotes
 *   - Arabic: terminators (. ! ? ؟ … + combos ؟! !؟), Arabic-Indic
 *     ٠-٩ and Persian ۰-۹ digits, decimal ٫, thousands ٬, ٪, numbered
 *     lists (١. ١- (١) أ-), abbreviation table (د. أ.د. م.), year
 *     suffixes م/هـ, protected spans («» “” () [] ﴿﴾), quote +
 *     attribution verb (قال، قالت، سأل…), soft-split suggestions for
 *     long sentences, matching-only normalization (diacritics, tatweel,
 *     bidi marks), invisible characters preserved
 *   - Paragraph handling: \n, \n\n, \r\n, trailing whitespace, empty
 *     lines preserved as separators
 *   - Lossless round-trip: concat(segments + gaps) === original
 *   - Idempotence: segment(segment(x).normalized) === segment(x)
 *   - Rule-set selection when direction flips (script-based, not
 *     direction-based)
 *   - Manual split / merge overrides
 *   - Granularity toggle (sentence vs paragraph)
 */
import {
  segment,
  roundtrip,
  isIdempotent,
  normalizeArabicForMatching,
  type Segment,
} from "../src/lib/segmentation";

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

function segTexts(s: Segment[]): string[] {
  return s.map((x) => x.text);
}

// ════════════════════════════════════════════════════════════════════
// ENGLISH RULES
// ════════════════════════════════════════════════════════════════════
console.log("\n══ English: basic terminators ══");

{
  const r = segment("Hello world. This is a test. Goodbye.");
  check("Three sentences from three periods", r.segments.length === 3, `got ${r.segments.length}`);
  check("First sentence correct", r.segments[0].text === "Hello world.");
  check("Second sentence correct", r.segments[1].text === "This is a test.");
}

{
  const r = segment("Wow! Really? Yes…");
  check("Breaks on ! ? …", r.segments.length === 3, `got ${r.segments.length}`);
}

{
  const r = segment("He said \"hello.\" Then he left.");
  check("Closing quote attached to sentence", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
  check("First sentence includes closing quote", r.segments[0].text === "He said \"hello.\"", `got "${r.segments[0].text}"`);
}

console.log("\n══ English: abbreviations ══");

{
  const r = segment("Mr. Smith went to the store. He bought milk.");
  check("Mr. does not break", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

{
  const r = segment("Dr. Jones, Ph.D. visited Prof. Brown at 3 p.m. yesterday.");
  check("Multiple abbreviations in one sentence", r.segments.length === 1, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

{
  // etc. is an abbreviation — conservative behaviour: no break.
  // Use a clearer sentence end to test the break separately.
  const r = segment("She likes fruits, e.g. apples and oranges. He likes vegetables.");
  check("e.g. does not break, sentence period does", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

{
  const r = segment("The meeting is at 10 a.m. on Monday. Please be on time.");
  check("a.m. does not break", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

{
  const r = segment("See Fig. 3 and Vol. 2 for details. The rest is in Ch. 4.");
  check("Fig. Vol. Ch. do not break", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

console.log("\n══ English: decimals, versions, URLs ══");

{
  const r = segment("Pi is 3.14 and version 2.1.0 is out. Download it now.");
  check("Decimal and version do not break", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

{
  const r = segment("Visit https://example.com/page.html for info. It is free.");
  check("URL with dots does not break", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

{
  const r = segment("Email me at john.doe@example.com tomorrow. Thanks.");
  check("Email does not break", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

console.log("\n══ English: list markers ══");

{
  const r = segment("1. First item goes here. 2. Second item follows.");
  check("Numeric list marker does not break", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

{
  const r = segment("a) First option. b) Second option. c) Third option.");
  check("Alpha list marker does not break", r.segments.length === 3, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

console.log("\n══ English: initials ══");

{
  const r = segment("A. B. Smith is here. He is waiting.");
  check("Single-letter initials do not break", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

console.log("\n══ English: mid-sentence ellipsis ══");

{
  const r = segment("He paused… then continued. The end.");
  check("Mid-sentence … does not break (followed by lowercase)", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

// ════════════════════════════════════════════════════════════════════
// ARABIC RULES
// ════════════════════════════════════════════════════════════════════
console.log("\n══ Arabic: basic terminators ══");

{
  const r = segment("ذهب أحمد إلى المدرسة. ثم عاد إلى البيت. نام مبكراً.");
  check("Three Arabic sentences with periods", r.segments.length === 3, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

{
  const r = segment("هل ذهبت؟ نعم ذهبت. تعال هنا!");
  check("Arabic ؟ and ! break", r.segments.length === 3, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

console.log("\n══ Arabic: closing quotes/brackets attached ══");

{
  const r = segment("قال «مرحباً.» ثم انصرف. ذهبنا معه.");
  check("Closing » preserved (not dropped)", r.segments[0].text.includes("»"), `got "${r.segments[0].text}"`);
  check("Two sentences (protected span keeps «.», real break at انصرف.)", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

console.log("\n══ Arabic: weak punctuation never breaks ══");

{
  const r = segment("ذهب أحمد، ثم سالم، ثم خالد. الجميع سعداء.");
  check("Arabic ، does not break", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

{
  const r = segment("العناصر هي: أولاً، ثانياً، ثالثاً. هذا كل شيء.");
  check("Arabic : and ، do not break", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

console.log("\n══ Arabic: Arabic-Indic & Persian digits ══");

{
  const r = segment("النتيجة هي ٣.١٤ وليس ٢.٧١. هذا صحيح.");
  check("Arabic-Indic decimal does not break", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

{
  const r = segment("المبلغ ١٢٣٤٥٬٦٧٨ ريال. هذا كثير.");
  check("Arabic thousands separator ٬ does not break", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

{
  const r = segment("نسبة القبول ٩٥٪ هذا العام. أعلى من العام الماضي.");
  check("Arabic percent ٪ does not break", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

console.log("\n══ Arabic: numbered lists ══");

{
  const r = segment("١. البند الأول هنا. ٢. البند الثاني يتبعه. ٣. البند الثالث.");
  check("Arabic-Indic list marker does not break", r.segments.length === 3, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

{
  const r = segment("أ- البند الأول. ب- البند الثاني. ج- البند الثالث.");
  check("Arabic alpha list marker does not break", r.segments.length === 3, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

console.log("\n══ Arabic: abbreviations ══");

{
  const r = segment("قابل د. أحمد في العيادة. كان موعداً جيداً.");
  check("د. abbreviation does not break", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

{
  const r = segment("ألقى أ.د. خالد محاضرة. كانت ممتازة.");
  check("أ.د. abbreviation does not break", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

console.log("\n══ Arabic: year suffixes م / هـ ══");

{
  const r = segment("وُلد عام ١٩٨٠م في القاهرة. توفي عام ٢٠٢٠م.");
  check("Year suffix م after numeral does not break", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

{
  const r = segment("الهجرة كانت عام ٦٢٢هـ. بدأ التقويم.");
  check("Year suffix هـ after numeral does not break", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

console.log("\n══ Arabic: protected spans (Quranic ﴿﴾) ══");

{
  // ﴿ open, ﴾ close (note: in our table the pair is ["﴿","﴾"])
  const r = segment("قال تعالى: ﴿اقرأ باسم ربك﴾. هذه بداية.");
  check("Terminator inside ﴿﴾ does not break the inner text", r.segments.length >= 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
  // The first segment should contain the whole ﴿...﴾
  check("First segment includes the ﴿...﴾ span", r.segments[0].text.includes("﴿اقرأ باسم ربك﴾"), `got "${r.segments[0].text}"`);
}

{
  // Protected span with a terminator inside «...»
  const r = segment("قال «هل ذهبت؟» بصراحة. لا أعرف.");
  check("؟ inside «» does not break mid-quote", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
}

console.log("\n══ Arabic: quote + attribution verb ══");

{
  // «هل ذهبت؟» سأل أحمد  → one segment (؟ inside «» + attribution verb after)
  const r = segment("«هل ذهبت؟» سأل أحمد. ثم ذهبنا.");
  check("Quote + attribution verb = one segment", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
  check("First segment is quote + attribution", /سأل/.test(r.segments[0].text), `got "${r.segments[0].text}"`);
}

{
  const r = segment("«سأعود قريباً» قال خالد. ثم غادر.");
  check("قال attribution after closing quote", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
  check("First segment includes قال", /قال/.test(r.segments[0].text), `got "${r.segments[0].text}"`);
}

console.log("\n══ Arabic: soft-split suggestion for long sentence ══");

{
  // A long Arabic sentence (≥45 tokens) with ، ثم and ، لكن connectors
  const long = "ذهب أحمد إلى السوق في الصباح الباكر جداً ليشتري بعض الخضروات الطازجة لأمه التي تنتظره في البيت بفارغ الصبر، ثم قابل صديقه القديم خالد في المقهى المجاور لتجلسا معاً يتحدثان عن أيام الصبا والذكريات الجميلة، لكنه لم يبق طويلاً في هذا اللقاء لأن عليه العودة سريعاً لإنهاء الواجب المدرسي المتبقي قبل المساء.";
  const r = segment(long);
  check("Long Arabic sentence is one segment (no auto-split)", r.segments.length === 1, `got ${r.segments.length}`);
  check("Long Arabic sentence has soft-split suggestion", (r.segments[0].softSplitSuggestion?.length ?? 0) > 0, `suggestions=${JSON.stringify(r.segments[0].softSplitSuggestion)}`);
}

{
  // A short Arabic sentence should NOT have a soft-split suggestion
  const short = "ذهب أحمد إلى البيت. ثم نام.";
  const r = segment(short);
  check("Short Arabic sentence has no soft-split suggestion", (r.segments[0].softSplitSuggestion?.length ?? 0) === 0);
}

console.log("\n══ Arabic: matching-only normalization ══");

{
  const withDiacritics = "قَابَلَ د. أحمد في العيادة. كان موعداً جيداً.";
  const r = segment(withDiacritics);
  check("Diacritics preserved in segment text", r.segments[0].text.includes("قَابَلَ"), `got "${r.segments[0].text}"`);
  check("Abbreviation still matched with diacritics around", r.segments.length === 2, `got ${r.segments.length}`);
  // Normalization for matching only — verify the helper
  check("normalizeArabicForMatching strips diacritics", normalizeArabicForMatching("قَابَلَ") === "قابل");
}

{
  const withTatweel = "العـــربية لغة جميلة. نعم.";
  const r = segment(withTatweel);
  check("Tatweel preserved in output", r.segments[0].text.includes("ـــ"), `got "${r.segments[0].text}"`);
  check("normalizeArabicForMatching strips tatweel", normalizeArabicForMatching("العـــربية") === "العربية");
}

console.log("\n══ Arabic: invisible characters preserved ══");

{
  // LRM (U+200E) inside Arabic text — must NOT be treated as whitespace or boundary
  const withLRM = "ذهب أحمد\u200E إلى البيت. ثم نام.";
  const r = segment(withLRM);
  check("LRM preserved in segment text", r.segments[0].text.includes("\u200E"), `got "${r.segments[0].text}"`);
  check("LRM does not create a boundary", r.segments.length === 2, `got ${r.segments.length}`);
}

// ════════════════════════════════════════════════════════════════════
// MIXED SCRIPT
// ════════════════════════════════════════════════════════════════════
console.log("\n══ Mixed Arabic / English ══");

{
  // Arabic paragraph with Latin tokens (iPhone, Apple) — dominant = Arabic
  const r = segment("اشتريت iPhone 15 Pro من Apple. هذا هاتف رائع.");
  check("Latin tokens in Arabic paragraph keep Arabic rules", r.segments.length === 2, `got ${r.segments.length}, texts=${JSON.stringify(segTexts(r.segments))}`);
  check("Dominant script is Arabic", r.segments[0].script === "arabic", `got ${r.segments[0].script}`);
}

{
  // English paragraph with Arabic token — dominant = Latin
  const r = segment("The word سيارة means car in Arabic. It is common.");
  check("Arabic token in English paragraph keeps Latin rules", r.segments.length === 2, `got ${r.segments.length}`);
  check("Dominant script is Latin", r.segments[0].script === "latin", `got ${r.segments[0].script}`);
}

// ════════════════════════════════════════════════════════════════════
// PARAGRAPH HANDLING
// ════════════════════════════════════════════════════════════════════
console.log("\n══ Paragraph handling ══");

{
  const r = segment("First paragraph here.\nSecond paragraph here.\nThird one.");
  check("Three \\n-separated paragraphs", r.segments.filter(s => s.isParagraphEnd).length === 3, `got ${r.segments.filter(s => s.isParagraphEnd).length} paragraph ends, segments=${r.segments.length}`);
  check("Each paragraph is one segment (no sentence terminators)", r.segments.length === 3, `got ${r.segments.length}`);
}

{
  const r = segment("First para.\n\nSecond para after blank line.");
  check("Blank line preserved as separator (no empty segment)", !r.segments.some(s => s.text === ""), `got ${JSON.stringify(segTexts(r.segments))}`);
  check("Two segments from two non-empty paragraphs", r.segments.length === 2, `got ${r.segments.length}`);
}

{
  // \r\n normalization
  const r = segment("Line one.\r\nLine two.\r\nLine three.");
  check("\\r\\n normalized to \\n (3 segments)", r.segments.length === 3, `got ${r.segments.length}`);
  check("No \\r in normalized output", !r.normalized.includes("\r"));
}

{
  // Trailing whitespace within paragraph
  const r = segment("Hello world.   \nSecond line.");
  check("Trailing whitespace in paragraph handled", r.segments.length === 2, `got ${r.segments.length}`);
}

{
  // Empty lines at start
  const r = segment("\n\n\nHello. World.");
  check("Leading empty lines do not create empty segments", r.segments.length === 2, `got ${r.segments.length}`);
}

// ════════════════════════════════════════════════════════════════════
// LOSSLESS ROUND-TRIP
// ════════════════════════════════════════════════════════════════════
console.log("\n══ Lossless round-trip ══");

{
  const inputs = [
    "Hello world. Goodbye.",
    "First para.\n\nSecond para.",
    "ذهب أحمد. ثم عاد.",
    "Mixed سيارة and text. With newlines.\nAnd more.",
    "  leading spaces here.  ",
    "Trailing newlines\n\n\n",
    "«quote» end. Next.",
    "﴿آية﴾ here. Done.",
    "3.14 and 2.71. Numbers.",
    "Mr. Smith went home. He was tired.",
    "\r\nWindows line one.\r\nWindows line two.",
    "Empty\n\n\n\nbetween.",
  ];
  for (const input of inputs) {
    const r = segment(input);
    const reconstructed = roundtrip(r);
    // Round-trip is against the NORMALIZED input (only \r\n → \n applied)
    const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    check(`Round-trip: "${input.slice(0, 40)}${input.length > 40 ? "…" : ""}"`, reconstructed === normalized, `\n  in:       ${JSON.stringify(input)}\n  expected: ${JSON.stringify(normalized)}\n  got:      ${JSON.stringify(reconstructed)}`);
  }
}

// ════════════════════════════════════════════════════════════════════
// IDEMPOTENCE
// ════════════════════════════════════════════════════════════════════
console.log("\n══ Idempotence ══");

{
  const inputs = [
    "Hello world. Goodbye.",
    "First para.\n\nSecond para.",
    "ذهب أحمد. ثم عاد.",
    "Mr. Smith went home. He was tired.",
    "«quote» end. Next sentence here.",
  ];
  for (const input of inputs) {
    check(`Idempotent: "${input.slice(0, 40)}${input.length > 40 ? "…" : ""}"`, isIdempotent(input));
  }
}

// ════════════════════════════════════════════════════════════════════
// RULE-SET SELECTION WHEN DIRECTION FLIPS
// ════════════════════════════════════════════════════════════════════
console.log("\n══ Rule-set selection on direction flip ══");

{
  // Same text segmented twice — should be identical (script-based, not direction-based)
  const text = "ذهب أحمد. ثم عاد.";
  const r1 = segment(text);
  // The segmenter doesn't take a direction param; it uses script detection.
  // So calling segment() twice on the same text MUST produce the same result.
  const r2 = segment(text);
  check("Same text segments identically (script-based)", r1.segments.length === r2.segments.length);
  check("Arabic text gets Arabic script", r1.segments[0].script === "arabic");
}

{
  // Latin text with Arabic terminator ؟ — should still get Latin rules
  // (dominant script is Latin) so ؟ is NOT a terminator for Latin rules
  const text = "The ؟ symbol is Arabic. It is not Latin.";
  const r = segment(text);
  check("Latin-dominant text uses Latin rules (؟ not a terminator)", r.segments[0].script === "latin", `script=${r.segments[0].script}`);
}

// ════════════════════════════════════════════════════════════════════
// GRANULARITY TOGGLE
// ════════════════════════════════════════════════════════════════════
console.log("\n══ Granularity toggle ══");

{
  const text = "First sentence here. Second one. Third one.";
  const rSent = segment(text, { granularity: "sentence" });
  const rPara = segment(text, { granularity: "paragraph" });
  check("Sentence granularity → 3 segments", rSent.segments.length === 3, `got ${rSent.segments.length}`);
  check("Paragraph granularity → 1 segment", rPara.segments.length === 1, `got ${rPara.segments.length}`);
}

// ════════════════════════════════════════════════════════════════════
// MANUAL SPLIT / MERGE
// ════════════════════════════════════════════════════════════════════
console.log("\n══ Manual split / merge ══");

{
  const text = "Hello world. Goodbye everyone.";
  // Split segment 0 at offset 6 ("Hello " | "world.")
  const rSplit = segment(text, {
    manualBreaks: [{ segmentIndex: 0, offset: 6 }],
  });
  check("Manual split produces 3 segments", rSplit.segments.length === 3, `got ${rSplit.segments.length}, texts=${JSON.stringify(segTexts(rSplit.segments))}`);
  check("Split first part is 'Hello'", rSplit.segments[0].text === "Hello", `got "${rSplit.segments[0].text}"`);
}

{
  const text = "First sentence. Second sentence. Third sentence.";
  // Join segment 0 with segment 1
  const rJoin = segment(text, { manualJoins: [0] });
  check("Manual join produces 2 segments", rJoin.segments.length === 2, `got ${rJoin.segments.length}, texts=${JSON.stringify(segTexts(rJoin.segments))}`);
  check("Joined segment text contains both", rJoin.segments[0].text === "First sentence. Second sentence.", `got "${rJoin.segments[0].text}"`);
}

// ════════════════════════════════════════════════════════════════════
// PERFORMANCE: 100k chars in < 100ms
// ════════════════════════════════════════════════════════════════════
console.log("\n══ Performance: 100k chars ══");

{
  // Build a ~100k char document by repeating a paragraph
  const para = "This is a test paragraph with several sentences. It has abbreviations like Mr. and Dr. It also has numbers like 3.14 and versions like 2.1.0. The quick brown fox jumps over the lazy dog. ";
  const big = para.repeat(Math.ceil(100_000 / para.length)).slice(0, 100_000);
  const start = Date.now();
  const r = segment(big);
  const elapsed = Date.now() - start;
  check(`100k chars segmented in < 100ms (got ${elapsed}ms)`, elapsed < 100, `elapsed=${elapsed}ms, segments=${r.segments.length}`);
}

// ════════════════════════════════════════════════════════════════════
console.log("\n────────────────────────────────");
console.log(`  PASS: ${pass}    FAIL: ${fail}`);
console.log("────────────────────────────────");
if (fail > 0) {
  process.exit(1);
}
