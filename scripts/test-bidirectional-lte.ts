/**
 * Smoke test for the bidirectional Local Translation Engine.
 *
 * Verifies:
 *   - AR→EN exact match works (was previously broken)
 *   - AR→EN partial match works (was previously broken)
 *   - AR→EN n-gram fallback returns an English target (was previously
 *     comparing Arabic trigrams to Latin trigrams and always missing)
 *   - EN→AR still works (no regression)
 *   - Arabic multi-sentence input splits correctly (the previous
 *     regex required a Latin capital letter after the terminator)
 *   - normalize() strips the Arabic question mark ؟ (U+061F)
 *
 * Run with: npx tsx scripts/test-bidirectional-lte.ts
 */
import { getLTE } from "../src/lib/local-translation-engine";
import { SEED_CORPUS } from "../src/lib/seed-corpus";

const lte = getLTE();
lte.load(SEED_CORPUS);

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

console.log("\n══ AR→EN direction ══");
console.log("Loaded corpus:", lte.getStats());

// 1. AR→EN exact match — look up the Arabic side of a known seed entry
//    and expect the English side back as the match.
const arQuery = "الترجمة بمساعدة الحاسوب"; // "Computer-assisted translation"
const arResult = lte.getSuggestion(arQuery, "", "ar-en");
check(
  "AR→EN exact match returns a result",
  !!arResult,
  `result=${JSON.stringify(arResult)}`
);
check(
  "AR→EN exact match returns English target",
  !!arResult && /Computer-assisted translation/i.test(arResult.match),
  `match="${arResult?.match}"`
);

// 2. AR→EN partial match — substring of an Arabic source entry
const arPartial = "الترجمة"; // appears in many Arabic seed entries
const arPartialResult = lte.getSuggestion(arPartial, "", "ar-en");
check(
  "AR→EN partial match returns a result",
  !!arPartialResult,
  `result=${JSON.stringify(arPartialResult)}`
);
check(
  "AR→EN partial match returns an English (Latin) target",
  !!arPartialResult && /[A-Za-z]/.test(arPartialResult.match),
  `match="${arPartialResult?.match}"`
);

// 3. AR→EN n-gram fallback — Arabic text not in corpus but close to an entry
const arNgram = "الترجمة بمساعدة الحاسوب هي عملية معقدة"; // longer than seed entry
const arNgramResult = lte.getSuggestion(arNgram, "", "ar-en");
check(
  "AR→EN n-gram fallback returns a result (not silent miss)",
  !!arNgramResult,
  `result=${JSON.stringify(arNgramResult)}`
);

// 4. AR→EN with target prefix — verify remainder computation works
const arWithPrefix = lte.getSuggestion("الترجمة بمساعدة الحاسوب", "Computer", "ar-en");
check(
  "AR→EN with English prefix returns non-empty remainder",
  !!arWithPrefix && arWithPrefix.remainder.length > 0,
  `remainder="${arWithPrefix?.remainder}"`
);

console.log("\n══ EN→AR direction (regression check) ══");

// 5. EN→AR exact match still works
const enResult = lte.getSuggestion("Computer-assisted translation", "", "en-ar");
check(
  "EN→AR exact match returns a result",
  !!enResult,
  `result=${JSON.stringify(enResult)}`
);
check(
  "EN→AR exact match returns Arabic target",
  !!enResult && /الترجمة بمساعدة الحاسوب/.test(enResult.match),
  `match="${enResult?.match}"`
);

// 6. EN→AR with prefix still works
const enWithPrefix = lte.getSuggestion("Computer-assisted translation", "الترجمة", "en-ar");
check(
  "EN→AR with Arabic prefix returns non-empty remainder",
  !!enWithPrefix && enWithPrefix.remainder.length > 0,
  `remainder="${enWithPrefix?.remainder}"`
);

// 7. Default direction is still "en-ar" (backward compat)
const defaultDir = lte.getSuggestion("Machine translation", "");
check(
  "Default direction is en-ar (backward compat)",
  !!defaultDir && /الترجمة الآلية/.test(defaultDir.match),
  `match="${defaultDir?.match}"`
);

console.log("\n══ Sentence splitting (Arabic) ══");

// 8. Arabic multi-sentence input should now split (previously required
//    a Latin capital letter after the terminator and never split).
//    Verify that getSuggestion on a multi-sentence Arabic input doesn't
//    silently return null. Use two seed Arabic sentences joined with ". ".
const arMulti = "الترجمة بمساعدة الحاسوب. الترجمة الآلية.";
const arMultiResult = lte.getSuggestion(arMulti, "", "ar-en");
check(
  "Arabic multi-sentence input does not silently return null",
  !!arMultiResult,
  `result=${JSON.stringify(arMultiResult)}`
);

console.log("\n══ normalize() strips Arabic ؟ (U+061F) ══");

// 9. Search for an Arabic entry with ؟ appended — should still match
//    because normalize() strips ؟.
const arWithQuestion = "الترجمة بمساعدة الحاسوب؟";
const arQResult = lte.getSuggestion(arWithQuestion, "", "ar-en");
check(
  "normalize() strips Arabic ؟ so lookup still matches",
  !!arQResult && /Computer-assisted translation/i.test(arQResult.match),
  `match="${arQResult?.match}"`
);

console.log(`\n────────────────────────────────`);
console.log(`  PASS: ${pass}    FAIL: ${fail}`);
console.log(`────────────────────────────────\n`);

if (fail > 0) {
  process.exit(1);
}
