/**
 * Gemini model configuration tests (Issue 1, v0.4.1).
 *
 * Run: npx tsx scripts/test-gemini-model-config.ts
 *
 * Covers:
 *   - DEFAULT_GEMINI_MODEL is non-empty and is a known-good ID
 *   - isModelRetiredMessage() detects retirement patterns
 *   - isModelRetiredStatus() detects 404/503
 *   - ModelRetiredError surfaces the right message + model ID
 *   - The settings-store default matches DEFAULT_GEMINI_MODEL
 *   - No hardcoded "gemini-2.5-flash" remains in the codebase
 *     (grep the source files)
 */
import {
  DEFAULT_GEMINI_MODEL,
  isModelRetiredMessage,
  isModelRetiredStatus,
  MODEL_RETIRED_PATTERNS,
} from "../src/lib/gemini-config";
import { ModelRetiredError } from "../src/lib/gemini-direct";
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

console.log("\n══ Gemini model configuration (Issue 1, v0.4.1) ══");

console.log("\n── DEFAULT_GEMINI_MODEL ──");

check("DEFAULT_GEMINI_MODEL is non-empty", !!DEFAULT_GEMINI_MODEL, `got "${DEFAULT_GEMINI_MODEL}"`);
check("DEFAULT_GEMINI_MODEL starts with 'gemini-'", DEFAULT_GEMINI_MODEL.startsWith("gemini-"), `got "${DEFAULT_GEMINI_MODEL}"`);
check("DEFAULT_GEMINI_MODEL is NOT the deprecated gemini-2.5-flash", (DEFAULT_GEMINI_MODEL as string) !== "gemini-2.5-flash", `got "${DEFAULT_GEMINI_MODEL}"`);
check("DEFAULT_GEMINI_MODEL contains 'flash' (the fast tier)", /flash/i.test(DEFAULT_GEMINI_MODEL), `got "${DEFAULT_GEMINI_MODEL}"`);
console.log(`    (default model: ${DEFAULT_GEMINI_MODEL})`);

console.log("\n── isModelRetiredMessage ──");

check("detects 'not found'", isModelRetiredMessage("Model gemini-2.5-flash not found"));
check("detects 'not available'", isModelRetiredMessage("Model is not available"));
check("detects 'no longer available'", isModelRetiredMessage("This model is no longer available to new users"));
check("detects 'deprecated'", isModelRetiredMessage("The model has been deprecated"));
check("detects 'shut down' (one word)", isModelRetiredMessage("Model was shutdown"));
check("detects 'shut down' (two words)", isModelRetiredMessage("Model was shut down"));
check("detects 'retired'", isModelRetiredMessage("The model is retired"));
check("detects 'discontinued'", isModelRetiredMessage("This model has been discontinued"));
check("detects 'unsupported model'", isModelRetiredMessage("Unsupported model: gemini-2.5-flash"));
check("does NOT flag a normal 401 error", !isModelRetiredMessage("API key not valid. Please pass a valid API key."));
check("does NOT flag a normal 429 error", !isModelRetiredMessage("Rate limit exceeded"));
check("does NOT flag a network error", !isModelRetiredMessage("Network error: Failed to fetch"));
check("does NOT flag empty string", !isModelRetiredMessage(""));
check("MODEL_RETIRED_PATTERNS has at least 8 patterns", MODEL_RETIRED_PATTERNS.length >= 8, `got ${MODEL_RETIRED_PATTERNS.length}`);

console.log("\n── isModelRetiredStatus ──");

check("404 is a retired-model status", isModelRetiredStatus(404));
check("503 is a retired-model status", isModelRetiredStatus(503));
check("400 is NOT a retired-model status", !isModelRetiredStatus(400));
check("401 is NOT a retired-model status", !isModelRetiredStatus(401));
check("429 is NOT a retired-model status", !isModelRetiredStatus(429));
check("500 is NOT a retired-model status (generic 5xx)", !isModelRetiredStatus(500));
check("200 is NOT a retired-model status", !isModelRetiredStatus(200));

console.log("\n── ModelRetiredError ──");

{
  const err = new ModelRetiredError("gemini-2.5-flash");
  check("ModelRetiredError has name 'ModelRetiredError'", err.name === "ModelRetiredError");
  check("ModelRetiredError message mentions the model id", err.message.includes("gemini-2.5-flash"), `got "${err.message}"`);
  check("ModelRetiredError message is actionable (mentions API Keys)", /API Keys/i.test(err.message), `got "${err.message}"`);
  check("ModelRetiredError message mentions the default model", err.message.includes(DEFAULT_GEMINI_MODEL), `got "${err.message}"`);
  check("ModelRetiredError message links to deprecations page", err.message.includes("deprecations"), `got "${err.message}"`);
  check("ModelRetiredError is an Error instance", err instanceof Error);
}

console.log("\n── No hardcoded gemini-2.5-flash remains ──");

// Check that no source file (excluding this test + the gemini-config.ts
// comments) still hardcodes "gemini-2.5-flash" as a model ID.
const srcDirs = ["src", "api", "src-tauri/src"];
const violations: string[] = [];
for (const dir of srcDirs) {
  const root = path.resolve(dir);
  if (!fs.existsSync(root)) continue;
  walk(root, (filepath) => {
    if (filepath.endsWith(".ts") || filepath.endsWith(".tsx") || filepath.endsWith(".rs")) {
      const content = fs.readFileSync(filepath, "utf8");
      // Allow references in comments (// ... or /* ... */ or //! ...)
      // and in the gemini-config.ts file itself (which documents the
      // old default). Flag only actual string-literal usage.
      const lines = content.split("\n");
      lines.forEach((line, i) => {
        // Skip comment lines
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        // Skip gemini-config.ts (it legitimately mentions the old model in comments + docs)
        if (filepath.includes("gemini-config")) return;
        // Skip this test file
        if (filepath.includes("test-gemini-model-config")) return;
        // Flag "gemini-2.5-flash" in actual code lines
        if (line.includes("gemini-2.5-flash") && !trimmed.startsWith("//")) {
          violations.push(`${filepath}:${i + 1}: ${trimmed.slice(0, 100)}`);
        }
      });
    }
  });
}
check("No hardcoded 'gemini-2.5-flash' in source code", violations.length === 0, violations.length > 0 ? `\n${violations.join("\n")}` : "");

console.log("\n── Settings store default ──");

// We can't easily import the store in a Node test (it touches localStorage),
// but we can verify the default by reading the source.
{
  const storeSrc = fs.readFileSync(path.resolve("src/stores/settings-store.ts"), "utf8");
  check("settings-store imports DEFAULT_GEMINI_MODEL", /import.*DEFAULT_GEMINI_MODEL.*from.*gemini-config/.test(storeSrc));
  check("settings-store has geminiModel field", /geminiModel:\s*string/.test(storeSrc));
  check("settings-store has setGeminiModel setter", /setGeminiModel:/.test(storeSrc));
  check("settings-store persists to rdat_gemini_model key", /rdat_gemini_model/.test(storeSrc));
  check("settings-store does NOT default to gemini-2.5-flash", !/getInitial.*"gemini-2.5-flash"/.test(storeSrc));
}

// ════════════════════════════════════════════════════════════════════
console.log("\n────────────────────────────────");
console.log(`  PASS: ${pass}    FAIL: ${fail}`);
console.log("────────────────────────────────");
if (fail > 0) {
  process.exit(1);
}

// ─── Helper: recursive directory walk ──────────────────────────────
function walk(dir: string, cb: (filepath: string) => void) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules, dist, .git, target
      if (["node_modules", "dist", ".git", "target", "icons"].includes(entry.name)) continue;
      walk(full, cb);
    } else {
      cb(full);
    }
  }
}
