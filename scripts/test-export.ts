/**
 * Export / import tests — Issue 3, v0.4.1.
 *
 * Run: npx tsx scripts/test-export.ts
 *
 * Covers:
 *   - buildJsonBackup produces a valid structure (version, arrays, timestamp)
 *   - validateJsonBackup accepts valid + rejects invalid
 *   - parseJsonBackup round-trips (serialize → parse → identical)
 *   - parseJsonBackup throws on invalid JSON / wrong version / missing arrays
 *   - buildDocxBlob produces a non-empty Blob (smoke test — full DOCX
 *     structure validation is out of scope for a unit test)
 *   - main.tsx calls navigator.storage.persist() on boot (grep source)
 */
import {
  buildJsonBackup,
  serializeJsonBackup,
  parseJsonBackup,
  validateJsonBackup,
  buildDocxBlob,
} from "../src/lib/export-import";
import type { SegmentEntry, GlossaryEntry, DocumentMeta } from "../src/types";
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

console.log("\n══ Export / import (Issue 3, v0.4.1) ══");

console.log("\n── buildJsonBackup ──");

const sampleSegments: SegmentEntry[] = [
  { id: "doc1:en-ar-0", source: "Hello", target: "مرحبا", source_lang: "en", target_lang: "ar", status: "confirmed", score: 1.0, segment_index: 0, sourceHash: "aabbccdd", docId: "doc1" },
  { id: "doc1:en-ar-1", source: "World", target: "عالم", source_lang: "en", target_lang: "ar", status: "confirmed", score: 1.0, segment_index: 1, sourceHash: "eeff0011", docId: "doc1" },
];
const sampleGlossary: GlossaryEntry[] = [
  { id: 1, source_term: "CAT", target_term: "الترجمة بمساعدة الحاسوب", source_lang: "en", target_lang: "ar" },
];
const sampleDocuments: DocumentMeta[] = [
  { id: "doc1", name: "test.txt", source_lang: "en", target_lang: "ar", segment_count: 2, created_at: "2026-10-03T10:00:00Z", updated_at: "2026-10-03T10:00:00Z" },
];

const backup = buildJsonBackup(sampleSegments, sampleGlossary, sampleDocuments, "0.4.1");
check("backup.version = 1", backup.version === 1);
check("backup.app_version = '0.4.1'", backup.app_version === "0.4.1");
check("backup.created_at is an ISO string", !isNaN(Date.parse(backup.created_at)), `got "${backup.created_at}"`);
check("backup.segments has 2 entries", backup.segments.length === 2);
check("backup.glossary has 1 entry", backup.glossary.length === 1);
check("backup.documents has 1 entry", backup.documents.length === 1);
check("backup.segments[0].docId is preserved", backup.segments[0].docId === "doc1");
check("backup.segments[0].sourceHash is preserved", backup.segments[0].sourceHash === "aabbccdd");

console.log("\n── validateJsonBackup ──");

check("valid backup → null", validateJsonBackup(backup) === null);
check("null → error", validateJsonBackup(null) !== null);
check("non-object → error", validateJsonBackup("not an object") !== null);
check("wrong version → error", validateJsonBackup({ ...backup, version: 2 }) !== null);
check("missing segments → error", validateJsonBackup({ version: 1, glossary: [], documents: [] }) !== null);
check("missing glossary → error", validateJsonBackup({ version: 1, segments: [], documents: [] }) !== null);
check("missing documents → error", validateJsonBackup({ version: 1, segments: [], glossary: [] }) !== null);
check("segments not array → error", validateJsonBackup({ version: 1, segments: "x", glossary: [], documents: [] }) !== null);

console.log("\n── parseJsonBackup round-trip ──");

{
  const json = serializeJsonBackup(backup);
  check("serialize produces a string", typeof json === "string");
  const restored = parseJsonBackup(json);
  check("round-trip: version preserved", restored.version === backup.version);
  check("round-trip: segments length matches", restored.segments.length === backup.segments.length);
  check("round-trip: segment[0].id matches", restored.segments[0].id === backup.segments[0].id);
  check("round-trip: segment[0].docId matches", restored.segments[0].docId === backup.segments[0].docId);
  check("round-trip: glossary length matches", restored.glossary.length === backup.glossary.length);
  check("round-trip: documents length matches", restored.documents.length === backup.documents.length);
}

console.log("\n── parseJsonBackup error handling ──");

check("invalid JSON throws", (() => { try { parseJsonBackup("{not valid json"); return false; } catch { return true; } })());
check("wrong version throws", (() => { try { parseJsonBackup(JSON.stringify({ ...backup, version: 99 })); return false; } catch { return true; } })());
check("missing segments throws", (() => { try { parseJsonBackup(JSON.stringify({ version: 1, glossary: [], documents: [] })); return false; } catch { return true; } })());

console.log("\n── buildDocxBlob smoke test ──");

{
  const blob = await buildDocxBlob({
    title: "Test Document",
    sourceLangLabel: "English",
    targetLangLabel: "Arabic",
    segments: [
      { source: "Hello world.", target: "مرحبا بالعالم." },
      { source: "Goodbye.", target: "وداعاً." },
    ],
    isTargetRTL: true,
  });
  check("buildDocxBlob returns a Blob", blob instanceof Blob);
  check("blob is non-empty", blob.size > 0, `size=${blob.size}`);
  check("blob type is correct", blob.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document", `type="${blob.type}"`);
  // A minimal DOCX zip is ~3-4 KB; with 2 segments it should be > 5 KB
  check("blob size > 5KB (real DOCX content)", blob.size > 5000, `size=${blob.size}`);
}

console.log("\n── navigator.storage.persist() on boot ──");

const mainSrc = fs.readFileSync(path.resolve("src/main.tsx"), "utf8");
check("main.tsx calls navigator.storage.persist()", /navigator\.storage\?\.persist|navigator\.storage\.persist/.test(mainSrc));
check("persist call is guarded by !isTauriEnvironment()", /!isTauriEnvironment\(\)[\s\S]*?navigator\.storage[\s\S]*?persist/.test(mainSrc));
check("persist call has a .catch (best-effort)", /persist\(\)\.catch/.test(mainSrc));

console.log("\n── Toolbar wiring (TranslationWorkspace) ──");

const twSrc = fs.readFileSync(path.resolve("src/components/editors/TranslationWorkspace.tsx"), "utf8");
check("handleExportDocx exists", /handleExportDocx\s*=/.test(twSrc));
check("handleExportJsonBackup exists", /handleExportJsonBackup\s*=/.test(twSrc));
check("handleImportJsonBackup exists", /handleImportJsonBackup\s*=/.test(twSrc));
check("DOCX button in toolbar", /onClick=\{handleExportDocx\}/.test(twSrc));
check("Backup button in toolbar", /onClick=\{handleExportJsonBackup\}/.test(twSrc));
check("Restore button in toolbar", /jsonBackupInputRef\.current\?\.click\(\)/.test(twSrc));
check("JSON file input accepts .json", /accept=["']\.json["']/.test(twSrc));
check("JSON file input resets value after change", /e\.target\.value\s*=\s*["']["']/.test(twSrc));

// ════════════════════════════════════════════════════════════════════
console.log("\n────────────────────────────────");
console.log(`  PASS: ${pass}    FAIL: ${fail}`);
console.log("────────────────────────────────");
if (fail > 0) {
  process.exit(1);
}
