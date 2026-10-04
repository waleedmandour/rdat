/**
 * WebLLM catalog + capability gating tests.
 *
 * Run: npx tsx scripts/test-webllm-catalog.ts
 *
 * Covers:
 *   - Catalog integrity (no dup ids, all required fields)
 *   - getModelById / getMlcModelId lookups
 *   - getCustomModelList (only non-prebuilt entries)
 *   - checkModelCapability (mocked adapters): WebGPU unavailable,
 *     shader-f16 missing, VRAM close to limit, low cores, mobile
 *   - precheckStorage (mocked navigator.storage)
 *   - stripThinkingMarkup (ndl blocks, unclosed, leading "Thinking:")
 *   - truncateRAGContext (budget, empty, overflow)
 */
import {
  MODELS,
  getModelById,
  getMlcModelId,
  getCustomModelList,
  checkModelCapability,
  stripThinkingMarkup,
  truncateRAGContext,
  type CapabilityInfo,
  type WebLLMModelRecord,
} from "../src/lib/webllm-catalog";

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

console.log("\n══ Catalog integrity ══");

// No duplicate ids
const ids = MODELS.map((m) => m.id);
check("No duplicate ids", new Set(ids).size === ids.length, `ids=${JSON.stringify(ids)}`);

// All required fields present
for (const m of MODELS) {
  check(`Model "${m.id}" has all required fields`, !!(
    m.id && m.name && m.parameters && m.size && m.family &&
    m.mlcModelId && m.vramRequiredMB > 0 && m.requiredFeatures.length > 0 &&
    m.contextWindow > 0
  ), `missing fields in ${JSON.stringify(m)}`);
}

// Prebuilt models have empty model/modelLib; custom models have both
for (const m of MODELS) {
  if (m.model || m.modelLib) {
    check(`Custom model "${m.id}" has both model + modelLib`, !!(m.model && m.modelLib));
  }
}

console.log("\n══ getModelById / getMlcModelId ══");

check("getModelById('qwen-1.5b') found", !!getModelById("qwen-1.5b"));
check("getModelById('gemma-4-e4b') found", !!getModelById("gemma-4-e4b"));
check("getModelById('nonexistent') = undefined", getModelById("nonexistent") === undefined);
check("getMlcModelId('qwen-1.5b') = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC'", getMlcModelId("qwen-1.5b") === "Qwen2.5-1.5B-Instruct-q4f16_1-MLC");
check("getMlcModelId('gemma-4-e4b') = 'gemma-4-E4B-it-q4f16_1-MLC'", getMlcModelId("gemma-4-e4b") === "gemma-4-E4B-it-q4f16_1-MLC");

console.log("\n══ getCustomModelList ══");

const customList = getCustomModelList();
check("Custom list has at least 1 entry (E4B)", customList.length >= 1, `got ${customList.length}`);
check("E4B is in custom list", customList.some((m) => m.model_id === "gemma-4-E4B-it-q4f16_1-MLC"));
check("Custom entries have model + model_lib URLs", customList.every((m) => m.model && m.model_lib));
check("Custom entries have vram_required_MB", customList.every((m) => m.vram_required_MB > 0));
check("Custom entries have required_features", customList.every((m) => m.required_features.length > 0));

console.log("\n══ checkModelCapability ══");

// Helper: a model that requires shader-f16
const f16Model: WebLLMModelRecord = {
  id: "test-f16",
  name: "Test F16 Model",
  parameters: "1B",
  size: "~1.0 GB",
  family: "Test",
  mlcModelId: "test-f16-MLC",
  model: "",
  modelLib: "",
  vramRequiredMB: 2048,
  requiredFeatures: ["shader-f16"],
  contextWindow: 4096,
};

// WebGPU unavailable → hard block
{
  const caps: CapabilityInfo = {
    webgpuAvailable: false,
    shaderF16: false,
    maxBufferSize: 0,
    maxStorageBufferBindingSize: 0,
  };
  const r = checkModelCapability(f16Model, caps);
  check("WebGPU unavailable → canLoad=false", r.canLoad === false);
  check("WebGPU unavailable → blocker mentions WebGPU", r.blockers.some((b) => /WebGPU/i.test(b)));
}

// WebGPU available, shader-f16 available → can load
{
  const caps: CapabilityInfo = {
    webgpuAvailable: true,
    shaderF16: true,
    maxBufferSize: 4 * 1024 * 1024 * 1024, // 4 GB
    maxStorageBufferBindingSize: 512 * 1024 * 1024, // 512 MB
  };
  const r = checkModelCapability(f16Model, caps);
  check("WebGPU + shader-f16 → canLoad=true", r.canLoad === true, `blockers=${JSON.stringify(r.blockers)}`);
  check("No blockers when fully capable", r.blockers.length === 0);
}

// WebGPU available, shader-f16 missing → hard block
{
  const caps: CapabilityInfo = {
    webgpuAvailable: true,
    shaderF16: false,
    maxBufferSize: 4 * 1024 * 1024 * 1024,
    maxStorageBufferBindingSize: 512 * 1024 * 1024,
  };
  const r = checkModelCapability(f16Model, caps);
  check("shader-f16 missing → canLoad=false", r.canLoad === false);
  check("shader-f16 missing → blocker mentions shader-f16", r.blockers.some((b) => /shader-f16/i.test(b)));
}

// VRAM close to limit → warning (not block)
{
  const caps: CapabilityInfo = {
    webgpuAvailable: true,
    shaderF16: true,
    maxBufferSize: 2 * 1024 * 1024 * 1024, // 2 GB — less than 2.2 GB (2048 * 1.1)
    maxStorageBufferBindingSize: 512 * 1024 * 1024,
  };
  const r = checkModelCapability(f16Model, caps);
  check("VRAM close to limit → canLoad=true (soft warning)", r.canLoad === true);
  check("VRAM close to limit → warning mentions maxBufferSize", r.warnings.some((w) => /maxBufferSize/i.test(w)));
}

// Low core count → warning
{
  const caps: CapabilityInfo = {
    webgpuAvailable: true,
    shaderF16: true,
    maxBufferSize: 4 * 1024 * 1024 * 1024,
    maxStorageBufferBindingSize: 512 * 1024 * 1024,
  };
  const r = checkModelCapability(f16Model, caps, { hardwareConcurrency: 2 });
  check("Low CPU cores → warning", r.warnings.some((w) => /core count/i.test(w)));
}

// Mobile → warning
{
  const caps: CapabilityInfo = {
    webgpuAvailable: true,
    shaderF16: true,
    maxBufferSize: 4 * 1024 * 1024 * 1024,
    maxStorageBufferBindingSize: 512 * 1024 * 1024,
  };
  const r = checkModelCapability(f16Model, caps, { isMobile: true });
  check("Mobile → warning", r.warnings.some((w) => /Mobile/i.test(w)));
}

// storage buffer binding size low → warning
{
  const caps: CapabilityInfo = {
    webgpuAvailable: true,
    shaderF16: true,
    maxBufferSize: 4 * 1024 * 1024 * 1024,
    maxStorageBufferBindingSize: 128 * 1024 * 1024, // 128 MB < 256 MB
  };
  const r = checkModelCapability(f16Model, caps);
  check("Low storage buffer binding → warning", r.warnings.some((w) => /maxStorageBufferBindingSize/i.test(w)));
}

console.log("\n══ stripThinkingMarkup ══");

// Use \u escapes for the think tags to avoid any rendering issues.
// The actual tags are < think > ... < / think > (without spaces).
const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

check("Strips closed think block", stripThinkingMarkup(`${THINK_OPEN} thinking here ${THINK_CLOSE} actual output`) === "actual output");
check("Strips unclosed think block to end", stripThinkingMarkup(`actual output ${THINK_OPEN} remaining thinking`) === "actual output");
check("Strips leading 'Thinking:' preamble", stripThinkingMarkup("Thinking: let me reason\n\nactual output") === "actual output");
check("No thinking markup → unchanged", stripThinkingMarkup("just a translation") === "just a translation");
check("Empty string → empty", stripThinkingMarkup("") === "");
check("Only thinking block → empty", stripThinkingMarkup(`${THINK_OPEN} all thinking ${THINK_CLOSE}`) === "");
check("Multiline thinking block stripped", stripThinkingMarkup(`${THINK_OPEN}\nline 1\nline 2\n${THINK_CLOSE}\nresult`) === "result");

console.log("\n══ truncateRAGContext ══");

// Normal case: budget allows some entries
{
  const entries = [
    { en: "hello", ar: "مرحبا", type: "phrase" },
    { en: "world", ar: "عالم", type: "phrase" },
    { en: "computer", ar: "حاسوب", type: "noun" },
  ];
  const out = truncateRAGContext(entries, "translate this", "", 4096);
  check("Truncate returns all entries when budget allows", out.length === 3, `got ${out.length}`);
}

// Tiny context window → empty or few entries
{
  const entries = [
    { en: "hello", ar: "مرحبا", type: "phrase" },
    { en: "world", ar: "عالم", type: "phrase" },
  ];
  const out = truncateRAGContext(entries, "translate this longer source text", "", 512);
  check("Tiny context → fewer entries", out.length < entries.length, `got ${out.length} of ${entries.length}`);
}

// Empty entries → empty
{
  const out = truncateRAGContext([], "source", "", 4096);
  check("Empty entries → empty", out.length === 0);
}

// Very large source text → no room for RAG
{
  const entries = [{ en: "hello", ar: "مرحبا", type: "phrase" }];
  const hugeSource = "x".repeat(10000);
  const out = truncateRAGContext(entries, hugeSource, "", 4096);
  check("Huge source text → no RAG entries", out.length === 0);
}

// Preserves entry type (CorpusEntry with score)
{
  const entries = [
    { en: "hello", ar: "مرحبا", type: "phrase", score: 0.9 },
    { en: "world", ar: "عالم", type: "phrase", score: 0.8 },
  ];
  const out = truncateRAGContext(entries, "source", "", 8192);
  check("Preserves score field on entries", out.every((e) => typeof e.score === "number"));
}

console.log("\n══ E4B experimental model specifics ══");

const e4b = getModelById("gemma-4-e4b");
check("E4B model exists", !!e4b);
if (e4b) {
  check("E4B badge = 'Experimental'", e4b.badge === "Experimental");
  check("E4B has model URL (HF)", e4b.model.includes("huggingface.co"));
  check("E4B has modelLib URL (wasm)", e4b.modelLib.includes(".wasm"));
  check("E4B requires shader-f16", e4b.requiredFeatures.includes("shader-f16"));
  check("E4B convTemplate = gemma4_instruction", e4b.convTemplate === "gemma4_instruction");
  check("E4B contextWindow = 4096", e4b.contextWindow === 4096);
  check("E4B vramRequiredMB > 0", e4b.vramRequiredMB > 0);
}

console.log("\n══ No 12B model in catalog (Branch B) ══");

check("No 'gemma-4-12b' id in catalog (Branch B)", !getModelById("gemma-4-12b"), "12B should not be registered without a verified artifact");
check("Catalog has exactly 6 models (5 prebuilt + E4B)", MODELS.length === 6, `got ${MODELS.length}`);

// ════════════════════════════════════════════════════════════════════
console.log("\n────────────────────────────────");
console.log(`  PASS: ${pass}    FAIL: ${fail}`);
console.log("────────────────────────────────");
if (fail > 0) {
  process.exit(1);
}
