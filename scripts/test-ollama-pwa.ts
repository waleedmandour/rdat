/**
 * Ollama adapter PWA-HTTP + model filtering tests — v0.4.2.
 *
 * Run: npx tsx scripts/test-ollama-pwa.ts
 *
 * Covers:
 *   - RECOMMENDED_OLLAMA_MODELS includes gemma4:12b-qat
 *   - isHiddenModel filters embedding/vision/code models
 *   - The adapter factory tries Ollama in PWA mode (not just Tauri)
 *   - The HTTP backend functions exist + have the right signatures
 *     (we can't test live HTTP without a running Ollama, but we verify
 *     the code is wired)
 *   - listModels filters hidden models from the installed list
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

console.log("\n══ Ollama PWA + model filtering (v0.4.2) ══");

console.log("\n── RECOMMENDED_OLLAMA_MODELS includes gemma4:12b-it-qat ──");

const ollamaSrc = fs.readFileSync(path.resolve("src/lib/adapters/ollama-adapter.ts"), "utf8");
check("gemma4:12b-it-qat is in the recommended catalog", ollamaSrc.includes('id: "gemma4:12b-it-qat"'));
check("gemma4:12b-it-qat has a display name mentioning QAT", /gemma4:12b-it-qat[\s\S]*?QAT/i.test(ollamaSrc));
check("gemma4:12b-it-qat shows ~7.2 GB size", /gemma4:12b-it-qat[\s\S]*?~7\.2 GB/i.test(ollamaSrc));
check("gemma4:12b-qat (invalid) is NOT in the catalog", !ollamaSrc.includes('id: "gemma4:12b-qat"'));
check("Default model is still gemma4:e2b (not changed)", /DEFAULT_OLLAMA_MODEL\s*=\s*"gemma4:e2b"/.test(ollamaSrc));

console.log("\n── isHiddenModel filters non-translation models ──");

check("HIDDEN_MODEL_PREFIXES includes nomic-embed", ollamaSrc.includes('"nomic-embed"'));
check("HIDDEN_MODEL_PREFIXES includes llava", ollamaSrc.includes('"llava"'));
check("HIDDEN_MODEL_PREFIXES includes codellama", ollamaSrc.includes('"codellama"'));
check("HIDDEN_MODEL_PREFIXES includes mxbai-embed", ollamaSrc.includes('"mxbai-embed"'));
check("isHiddenModel function exists", /function isHiddenModel/.test(ollamaSrc));
check("listModels uses isHiddenModel filter", /visibleInstalled\s*=\s*installed\.filter\(/.test(ollamaSrc));
check("listModels supports showAll parameter", /async listModels\(showAll: boolean = false\)/.test(ollamaSrc));
check("listModels never hides loaded model", /m\.name === loadedModel/.test(ollamaSrc));

console.log("\n── HTTP backend for PWA mode ──");

check("OLLAMA_HTTP_BASE constant exists", /OLLAMA_HTTP_BASE\s*=\s*"http:\/\/localhost:11434"/.test(ollamaSrc));
check("httpHealthCheck function exists", /async function httpHealthCheck/.test(ollamaSrc));
check("httpListModels function exists", /async function httpListModels/.test(ollamaSrc));
check("httpPullModel function exists", /async function httpPullModel/.test(ollamaSrc));
check("httpTranslate function exists", /async function httpTranslate/.test(ollamaSrc));
check("httpRemoveModel function exists", /async function httpRemoveModel/.test(ollamaSrc));
check("httpPullModel uses streaming reader", /getReader\(\)/.test(ollamaSrc));
check("httpPullModel parses NDJSON progress", /JSON\.parse\(line\)/.test(ollamaSrc) && /evt\.status === "downloading"/.test(ollamaSrc));
check("httpTranslate uses /api/generate", /\/api\/generate/.test(ollamaSrc));
check("httpPullModel uses /api/pull", /\/api\/pull/.test(ollamaSrc));
check("httpListModels uses /api/tags", /\/api\/tags/.test(ollamaSrc));
check("httpRemoveModel uses /api/delete", /\/api\/delete/.test(ollamaSrc));

console.log("\n── OllamaAdapter uses HTTP backend in PWA mode ──");

check("isAvailable tries HTTP when !isTauriEnvironment", /if \(!isTauriEnvironment\(\)\)[\s\S]*?httpHealthCheck/.test(ollamaSrc));
check("listModels uses httpListModels when !isTauriEnvironment", /if \(isTauriEnvironment\(\)\)[\s\S]*?ollama_list_models[\s\S]*?\}\s*else\s*\{[\s\S]*?httpListModels/.test(ollamaSrc));
check("pullModel uses httpPullModel when !isTauriEnvironment", /if \(!isTauriEnvironment\(\)\)[\s\S]*?httpPullModel/.test(ollamaSrc));
check("removeModel uses httpRemoveModel when !isTauriEnvironment", /if \(!isTauriEnvironment\(\)\)[\s\S]*?httpRemoveModel/.test(ollamaSrc));
check("translate uses httpTranslate when !isTauriEnvironment", /if \(isTauriEnvironment\(\)\)[\s\S]*?ollama_translate[\s\S]*?\}\s*else\s*\{[\s\S]*?httpTranslate/.test(ollamaSrc));
check("No more 'Cannot pull models outside Tauri' error", !/Cannot pull models outside Tauri/.test(ollamaSrc));
check("No more 'Cannot remove models outside Tauri' error", !/Cannot remove models outside Tauri/.test(ollamaSrc));

console.log("\n── Adapter factory tries Ollama in PWA mode ──");

const factorySrc = fs.readFileSync(path.resolve("src/lib/adapters/index.ts"), "utf8");
check("Factory no longer gates Ollama on isTauriEnvironment only", !/if \(isTauriEnvironment\(\)\)\s*\{[\s\S]*?const ollama = new OllamaAdapter/.test(factorySrc));
check("Factory tries Ollama before WebLLM (both modes)", /Step 1: Try Ollama[\s\S]*?Step 2: Try WebLLM/.test(factorySrc));
check("Factory WebLLM is gated on !isTauriEnvironment (skip in Tauri)", /if \(!isTauriEnvironment\(\)\)\s*\{[\s\S]*?const webllm = new WebLLMAdapter/.test(factorySrc));
check("Factory logs PWA Ollama fallback message", /PWA mode: Ollama not reachable/.test(factorySrc));

console.log("\n── Instruction text font scaling ──");

const twSrc = fs.readFileSync(path.resolve("src/components/editors/TranslationWorkspace.tsx"), "utf8");
check("--instruction-font-size CSS variable is set on root", /"--instruction-font-size" as string/.test(twSrc));
check("Instruction font scales with editor font (71%)", /editorFontSize \* 0\.71/.test(twSrc));
check("Instruction font floored at 10px", /Math\.max\(10,/.test(twSrc));
check("Direction toggle bar uses var(--instruction-font-size)", /Direction Toggle Bar[\s\S]*?var\(--instruction-font-size/.test(twSrc));
check("Target panel header uses var(--instruction-font-size)", /Panel Header[\s\S]*?var\(--instruction-font-size/.test(twSrc));

const seSrc = fs.readFileSync(path.resolve("src/components/editors/SourceEditor.tsx"), "utf8");
check("Source panel header uses var(--instruction-font-size)", /Editor Panel Header[\s\S]*?var\(--instruction-font-size/.test(seSrc));
check("Import section uses var(--instruction-font-size)", /Inline Section for Source document importation[\s\S]*?var\(--instruction-font-size/.test(seSrc));

const teSrc = fs.readFileSync(path.resolve("src/components/editors/TargetEditor.tsx"), "utf8");
check("TargetEditor status row uses var(--instruction-font-size)", /var\(--instruction-font-size/.test(teSrc));

// ════════════════════════════════════════════════════════════════════
console.log("\n────────────────────────────────");
console.log(`  PASS: ${pass}    FAIL: ${fail}`);
console.log("────────────────────────────────");
if (fail > 0) {
  process.exit(1);
}
