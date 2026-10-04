/**
 * Ollama catalog fixture tests — v0.4.3.
 *
 * Run: npx tsx scripts/test-ollama-catalog.ts
 *
 * Unlike test-ollama-pwa.ts (which checked the constant against itself),
 * this test asserts the catalog against a FIXTURE of known-valid tags
 * verified against the live Ollama registry on 2026-10-03. The fixture
 * is the source of truth; the catalog must match it.
 *
 * The fixture tags were verified live:
 *   - https://ollama.com/library/gemma4/tags (lists e2b-it-qat, e4b-it-qat, 12b-it-qat)
 *   - https://registry.ollama.ai/v2/library/gemma4/manifests/12b-it-qat (200 OK, 7.15 GB)
 *
 * If Ollama renames a tag in the future, this test fails and forces a
 * human to verify the new tag before shipping.
 */

// ─── Fixture: known-valid tags (verified 2026-10-03) ───────────────
// DO NOT derive this from the catalog — it's the independent check.
const KNOWN_VALID_TAGS = new Set([
  "gemma4:e2b",
  "gemma4:e4b",
  "gemma4:12b",
  "gemma4:e2b-it-qat",
  "gemma4:e4b-it-qat",
  "gemma4:12b-it-qat",
  "qwen2.5:1.5b",
  "qwen2.5:3b",
  "qwen3:1.7b",
  "qwen3:4b",
  "llama3.1:8b",
]);

// Tags that are KNOWN-INVALID (must never appear in the catalog)
const KNOWN_INVALID_TAGS = new Set([
  "gemma4:12b-qat",       // v0.4.2 bug — real tag is gemma4:12b-it-qat
  "gemma4:e2b-qat",       // missing -it- infix
  "gemma4:e4b-qat",       // missing -it- infix
  "translategemma",       // doesn't exist on Ollama (only on HF)
  "translategemma:12b",   // doesn't exist on Ollama
]);

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

console.log("\n══ Ollama catalog fixture validation (v0.4.3) ══\n");

// Read the catalog source + extract the tags
import * as fs from "fs";
import * as path from "path";

const ollamaSrc = fs.readFileSync(path.resolve("src/lib/adapters/ollama-adapter.ts"), "utf8");

// Extract all `id: "..."` values from RECOMMENDED_OLLAMA_MODELS
const catalogTagMatches = ollamaSrc.matchAll(/id:\s*"([^"]+)"/g);
const catalogTags: string[] = [];
for (const m of catalogTagMatches) {
  catalogTags.push(m[1]);
}

console.log(`Catalog tags found: ${catalogTags.length}`);
catalogTags.forEach((t) => console.log(`  - ${t}`));

console.log("\n── Every catalog tag is in the known-valid fixture ──");

for (const tag of catalogTags) {
  check(
    `"${tag}" is a known-valid tag`,
    KNOWN_VALID_TAGS.has(tag),
    `not in fixture. Verify at https://ollama.com/library/${tag.split(":")[0]}/tags`
  );
}

console.log("\n── No known-invalid tags appear in the catalog ──");

for (const badTag of KNOWN_INVALID_TAGS) {
  check(
    `"${badTag}" is NOT in the catalog`,
    !catalogTags.includes(badTag),
    `found in catalog — this tag is invalid`
  );
}

console.log("\n── Specific tag checks (the v0.4.2 bug) ──");

check(
  "gemma4:12b-it-qat IS in the catalog (the correct tag)",
  catalogTags.includes("gemma4:12b-it-qat"),
  "must be present — it's the registry-valid QAT tag"
);
check(
  "gemma4:12b-qat is NOT in the catalog (the v0.4.2 bug)",
  !catalogTags.includes("gemma4:12b-qat"),
  "must be absent — this tag does not exist in the registry"
);
check(
  "gemma4:e2b-it-qat IS in the catalog",
  catalogTags.includes("gemma4:e2b-it-qat")
);
check(
  "gemma4:e4b-it-qat IS in the catalog",
  catalogTags.includes("gemma4:e4b-it-qat")
);
check(
  "translategemma is NOT in the Ollama catalog (it's HF-only)",
  !catalogTags.some((t) => t.startsWith("translategemma")),
  "translategemma doesn't exist on Ollama — only on HuggingFace"
);

console.log("\n── Catalog size sanity ──");

check("Catalog has at least 8 models", catalogTags.length >= 8, `got ${catalogTags.length}`);
check("Catalog has at most 15 models", catalogTags.length <= 15, `got ${catalogTags.length}`);

// ════════════════════════════════════════════════════════════════════
console.log("\n────────────────────────────────");
console.log(`  PASS: ${pass}    FAIL: ${fail}`);
console.log("────────────────────────────────");
if (fail > 0) {
  process.exit(1);
}
