/**
 * Phase 3 regression sweep — verifies the direction-aware code paths
 * added/fixed in Phases 1+2+3 still behave correctly.
 *
 * This script does NOT cover:
 *   - Browser-only flows (IndexedDB persistence, React rendering,
 *     toast visibility, theme toggle). For those, see the manual
 *     verification checklist in the Phase 3 report.
 *   - Live LLM/Gemini calls. We verify the prompt *builders* produce
 *     direction-correct text, not that the models respond well.
 *
 * Run with: npx tsx scripts/test-phase3-regression.ts
 */

// We need to test prompt builders that live in api/_lib/prompts.ts.
// tsx can import .ts files directly. The api/ folder uses
// ESM-compatible imports so this should work.

import {
  buildBurstPrompt,
  buildFullPrompt,
  buildTutorPrompt,
} from "../api/_lib/prompts";
import { getLTE } from "../src/lib/local-translation-engine";
import { SEED_CORPUS } from "../src/lib/seed-corpus";

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

function checkContains(haystack: string, needle: string, label: string) {
  check(
    label,
    haystack.includes(needle),
    `expected prompt to contain "${needle}"\n--- prompt ---\n${haystack}\n--------------`
  );
}

function checkDoesNotContain(haystack: string, needle: string, label: string) {
  check(
    label,
    !haystack.includes(needle),
    `expected prompt to NOT contain "${needle}" but it did`
  );
}

console.log("\n══════════════════════════════════════════════════════════════════");
console.log("  PHASE 3 REGRESSION SWEEP");
console.log("══════════════════════════════════════════════════════════════════\n");

// ─── 3.1 — Direction-aware prompt builders ─────────────────────────

console.log("─ buildBurstPrompt (PHASE 1) ─");
const burstEnAr = buildBurstPrompt("Hello world", "", "en-ar");
checkContains(burstEnAr, "English-to-Arabic", "EN→AR burst: source-target direction in prompt");
checkContains(burstEnAr, "English sentence", "EN→AR burst: source language label");

const burstArEn = buildBurstPrompt("مرحبا بالعالم", "", "ar-en");
checkContains(burstArEn, "Arabic-to-English", "AR→EN burst: source-target direction in prompt");
checkContains(burstArEn, "Arabic sentence", "AR→EN burst: source language label");
checkDoesNotContain(burstArEn, "English-to-Arabic", "AR→EN burst: no stale EN→AR framing");

console.log("\n─ buildFullPrompt (PHASE 1) ─");
const fullEnAr = buildFullPrompt("Hello world", "", "en-ar");
checkContains(fullEnAr, "English sentence to Arabic", "EN→AR full: direction in prompt");

const fullArEn = buildFullPrompt("مرحبا بالعالم", "", "ar-en");
checkContains(fullArEn, "Arabic sentence to English", "AR→EN full: direction in prompt");
checkDoesNotContain(fullArEn, "English sentence to Arabic", "AR→EN full: no stale EN→AR framing");

console.log("\n─ buildTutorPrompt (PHASE 3 task 3.1) ─");
const tutorEnAr = buildTutorPrompt("Hello world", "مرحبا بالعالم", false, "en-ar");
checkContains(tutorEnAr, "English Source:", "EN→EN tutor: source labelled correctly");
checkContains(tutorEnAr, "Arabic Translation Attempt:", "EN→AR tutor: target labelled correctly");
checkDoesNotContain(tutorEnAr, "Arabic Source:", "EN→AR tutor: no wrong source label");

const tutorArEn = buildTutorPrompt("مرحبا بالعالم", "Hello world", false, "ar-en");
checkContains(tutorArEn, "Arabic Source:", "AR→EN tutor: source labelled correctly");
checkContains(tutorArEn, "English Translation Attempt:", "AR→EN tutor: target labelled correctly");
checkDoesNotContain(tutorArEn, "English Source:", "AR→EN tutor: no wrong source label (this was the Phase 1 miss)");
checkDoesNotContain(tutorArEn, "Arabic Translation Attempt:", "AR→EN tutor: no wrong target label");

// isRTL still controls output language independently of direction
const tutorArEnRtl = buildTutorPrompt("مرحبا بالعالم", "Hello world", true, "ar-en");
checkContains(tutorArEnRtl, "in Arabic", "AR→EN tutor with isRTL=true: output language is Arabic");

// ─── 3.1 — Backward compat: direction defaults to en-ar ───────────

console.log("\n─ Backward compat: default direction ──");
const burstDefault = buildBurstPrompt("Hello", "",);
checkContains(burstDefault, "English-to-Arabic", "Burst default direction is en-ar");
const fullDefault = buildFullPrompt("Hello", "");
checkContains(fullDefault, "English sentence to Arabic", "Full default direction is en-ar");
const tutorDefault = buildTutorPrompt("Hello", "مرحبا", false);
checkContains(tutorDefault, "English Source:", "Tutor default direction is en-ar");

// ─── 3.2 — Data model: LTE bidirectional indexes ──────────────────

console.log("\n─ LTE bidirectional indexes (regression from PHASE 1) ─");
const lte = getLTE();
lte.load(SEED_CORPUS);
const stats = lte.getStats();
check(`LTE has ${SEED_CORPUS.length} entries`, stats.entries === SEED_CORPUS.length, `got ${stats.entries}`);
check(`LTE en-index has ${SEED_CORPUS.length} keys`, stats.enKeys === SEED_CORPUS.length, `got ${stats.enKeys}`);
check(`LTE ar-index has ${SEED_CORPUS.length} keys`, stats.arKeys === SEED_CORPUS.length, `got ${stats.arKeys}`);

// AR→EN lookup must return English (Latin) target
const arResult = lte.getSuggestion("الترجمة بمساعدة الحاسوب", "", "ar-en");
check(
  "AR→EN exact match returns English target",
  !!arResult && /[A-Za-z]/.test(arResult.match),
  `got "${arResult?.match}"`
);

// EN→AR lookup must return Arabic target
const enResult = lte.getSuggestion("Computer-assisted translation", "", "en-ar");
check(
  "EN→AR exact match returns Arabic target",
  !!enResult && /[\u0600-\u06FF]/.test(enResult.match),
  `got "${enResult?.match}"`
);

// Default direction is en-ar (backward compat)
const defaultResult = lte.getSuggestion("Machine translation", "");
check(
  "Default direction returns Arabic target",
  !!defaultResult && /[\u0600-\u06FF]/.test(defaultResult.match),
  `got "${defaultResult?.match}"`
);

// ─── 3.2 — Data model: AR→EN search returns English-target entries ─

console.log("\n─ LTE direction-aware search (regression from PHASE 1) ─");
const arSearch = lte.search("الترجمة", 5, "ar-en");
check("AR→EN search returns at least one result", arSearch.length > 0, `got ${arSearch.length}`);
// LTE.search returns CorpusEntry-shaped objects (en/ar fields). When
// direction is "ar-en", the search matched on the `ar` field, so the
// English target (what the translator would write) is in the `en` field.
check(
  "AR→EN search results have English (Latin) target in `en` field",
  arSearch.every((e) => /[A-Za-z]/.test(e.en) || e.en === ""),
  `first en: "${arSearch[0]?.en}"`
);

const enSearch = lte.search("translation", 5, "en-ar");
check("EN→AR search returns at least one result", enSearch.length > 0, `got ${enSearch.length}`);
// LTE.search returns CorpusEntry-shaped objects (en/ar fields), not
// GlossaryEntry-shaped (source_term/target_term). The Arabic target
// is in the `ar` field when the source matched is `en`.
check(
  "EN→AR search results have Arabic target in `ar` field",
  enSearch.every((e) => /[\u0600-\u06FF]/.test(e.ar) || e.ar === ""),
  `first ar: "${enSearch[0]?.ar}"`
);

// ─── 3.1 — normalize() strips Arabic ؟ (U+061F) ───────────────────

console.log("\n─ normalize() strips Arabic ؟ ─");
const qResult = lte.getSuggestion("الترجمة بمساعدة الحاسوب؟", "", "ar-en");
check(
  "AR→EN lookup with trailing ؟ still matches",
  !!qResult && /[A-Za-z]/.test(qResult.match),
  `got "${qResult?.match}"`
);

// ─── 3.4 — Type-level verification: TutorAnalysis shape ───────────
// (Runtime check that the prompt produces valid JSON-shape text is
//  not possible without a live Gemini call. We verify the prompt
//  structure instead — see buildTutorPrompt tests above.)

console.log("\n══════════════════════════════════════════════════════════════════");
console.log(`  PASS: ${pass}    FAIL: ${fail}`);
console.log("══════════════════════════════════════════════════════════════════\n");

if (fail > 0) process.exit(1);
