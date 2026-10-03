/**
 * Document entity (docId) tests — Issue 2, v0.4.1.
 *
 * Run: npx tsx scripts/test-doc-id.ts
 *
 * Covers:
 *   - DB v5 migration adds `docId` index + `documents` store (additive)
 *   - SegmentEntry type has docId field
 *   - DocumentMeta type exists
 *   - StoreName includes "documents"
 *   - workspace-store generates a docId on setSourceText (non-empty)
 *   - workspace-store clears docId on setSourceText("")
 *   - Segment id format includes docId: `{docId}:{src}-{tgt}-{idx}`
 *   - No hardcoded `{sourceLang}-{targetLang}-{idx}` id construction
 *     remains in TranslationWorkspace (must include docId)
 *   - Clear-text is scoped by docId (grep the source for the filter)
 */
import * as fs from "fs";
import * as path from "path";

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

console.log("\n══ Document entity (docId) — Issue 2, v0.4.1 ══");

console.log("\n── DB migration (dual-storage.ts) ──");

const dsSrc = fs.readFileSync(path.resolve("src/lib/dual-storage.ts"), "utf8");
check("DB_VERSION = 5", /DB_VERSION\s*=\s*5/.test(dsSrc), "expected DB_VERSION = 5");
check("Migration comment mentions v4 → v5", /v4.*v5|v5.*additive/i.test(dsSrc));
check("createIndex('docId') present", /createIndex\(\s*["']docId["']/.test(dsSrc));
check("createIndex('docId') is unique:false", /createIndex\(\s*["']docId["']\s*,\s*["']docId["']\s*,\s*\{\s*unique:\s*false\s*\}/.test(dsSrc));
check("'documents' object store created", /createObjectStore\(\s*["']documents["']/.test(dsSrc));
check("No drop of segments store in v4→v5 path (additive)", !/deleteObjectStore\(\s*["']segments["']\s*\)/.test(dsSrc) || /oldVersion\s*<\s*3/.test(dsSrc), "segments store should not be dropped on v4→v5");

console.log("\n── Types (types.ts) ──");

const typesSrc = fs.readFileSync(path.resolve("src/types.ts"), "utf8");
check("SegmentEntry has docId?: string", /docId\?\s*:\s*string/.test(typesSrc));
check("DocumentMeta interface exists", /export\s+interface\s+DocumentMeta/.test(typesSrc));
check("DocumentMeta has id: string", /interface\s+DocumentMeta[\s\S]*?id:\s*string/.test(typesSrc));
check("DocumentMeta has name: string", /interface\s+DocumentMeta[\s\S]*?name:\s*string/.test(typesSrc));
check("DocumentMeta has source_lang + target_lang", /interface\s+DocumentMeta[\s\S]*?source_lang[\s\S]*?target_lang/.test(typesSrc));
check("DocumentMeta has segment_count", /interface\s+DocumentMeta[\s\S]*?segment_count/.test(typesSrc));
check("StoreName includes 'documents'", /["']documents["']/.test(typesSrc));

console.log("\n── workspace-store.ts ──");

const wsSrc = fs.readFileSync(path.resolve("src/stores/workspace-store.ts"), "utf8");
check("currentDocId: string | null in state", /currentDocId:\s*string\s*\|\s*null/.test(wsSrc));
check("currentDocName: string in state", /currentDocName:\s*string/.test(wsSrc));
check("setCurrentDoc action exists", /setCurrentDoc:\s*\(/.test(wsSrc));
check("setSourceText generates a docId", /setSourceText[\s\S]*?currentDocId[\s\S]*?generateDocId/.test(wsSrc));
check("setSourceText('') clears docId to null", /sourceText\.trim\(\)\s*\?\s*generateDocId\(\)\s*:\s*null/.test(wsSrc));
check("generateDocId uses crypto.randomUUID", /crypto\.randomUUID/.test(wsSrc));
check("generateDocId has fallback", /catch[\s\S]*?doc-/.test(wsSrc));

console.log("\n── TranslationWorkspace.tsx (confirm + hydration + clear) ──");

const twSrc = fs.readFileSync(path.resolve("src/components/editors/TranslationWorkspace.tsx"), "utf8");
check("Segment id includes docId prefix", /`\$\{docId\}:\$\{sourceLang\}-\$\{targetLang\}-\$\{idx\}`/.test(twSrc));
check("Segment id has legacy fallback (no docId)", /`\$\{sourceLang\}-\$\{targetLang\}-\$\{idx\}`/.test(twSrc));
check("Confirm persists entry.docId", /docId:\s*docId\s*\|\|\s*undefined/.test(twSrc));
check("Hydration filters by entry.docId === activeDocId", /entry\.docId\s*===\s*activeDocId/.test(twSrc));
check("Hydration reads activeDocId from store", /useWorkspaceStore\.getState\(\)\.currentDocId/.test(twSrc));
check("Clear-text scoped by docId (e.docId === activeDocId)", /toDelete\s*=\s*allEntries\.filter\(\s*\(\s*e\s*\)\s*=>\s*e\.docId\s*===\s*activeDocId/.test(twSrc));
check("Clear-text deletes document metadata row", /deleteFromStore\(\s*["']documents["']/.test(twSrc));

console.log("\n── SourceEditor.tsx (docName capture) ──");

const seSrc = fs.readFileSync(path.resolve("src/components/editors/SourceEditor.tsx"), "utf8");
check("SourceEditor captures pendingFileName from file", /setPendingFileName\(file\.name/.test(seSrc));
check("SourceEditor calls setCurrentDoc with filename", /setCurrentDoc\(docId,\s*name\)/.test(seSrc));

console.log("\n── No legacy positional-id-only construction remains ──");

// The old id format was `${sourceLang}-${targetLang}-${idx}` with no
// docId. The new format requires docId (with a legacy fallback). Check
// that the ONLY occurrence of the legacy format is in the fallback.
const legacyMatches = twSrc.match(/`\$\{sourceLang\}-\$\{targetLang\}-\$\{idx\}`/g) || [];
check("Legacy id format appears only once (the fallback)", legacyMatches.length === 1, `found ${legacyMatches.length} occurrences`);
check("The legacy fallback is conditional on !docId", /docId\s*\?\s*`\$\{docId\}:[\s\S]*?:\s*`\$\{sourceLang\}/.test(twSrc));

// ════════════════════════════════════════════════════════════════════
console.log("\n────────────────────────────────");
console.log(`  PASS: ${pass}    FAIL: ${fail}`);
console.log("────────────────────────────────");
if (fail > 0) {
  process.exit(1);
}
