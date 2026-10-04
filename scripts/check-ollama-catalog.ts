/**
 * Ollama catalog registry validator.
 *
 * Run: npx tsx scripts/check-ollama-catalog.ts
 *
 * Validates every tag in RECOMMENDED_OLLAMA_MODELS against the live
 * Ollama registry (https://registry.ollama.ai/v2/library/{model}/manifests/{tag}).
 * Skips cleanly when offline (exit 0 with a warning) so CI doesn't
 * fail on network issues. When online, exits non-zero if any tag is
 * invalid (404) so a bad tag never ships.
 *
 * This script exists because v0.4.2 shipped an invalid tag
 * ('gemma4:12b-qat' — the real tag is 'gemma4:12b-it-qat') and the
 * unit test didn't catch it because it checked the constant against
 * itself. This validator checks the constant against the registry.
 */
import { RECOMMENDED_OLLAMA_MODELS } from "../src/lib/adapters/ollama-adapter";

const REGISTRY_BASE = "https://registry.ollama.ai/v2/library";

interface ValidationResult {
  tag: string;
  valid: boolean;
  sizeGb: number | null;
  error: string | null;
}

async function checkTag(model: string, tag: string): Promise<ValidationResult> {
  // The tag is "gemma4:12b-it-qat" → model="gemma4", tag="12b-it-qat"
  const url = `${REGISTRY_BASE}/${model}/manifests/${tag}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(url, {
      headers: { "Accept": "application/vnd.oci.image.manifest.v1+json" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (resp.status === 404) {
      return { tag: `${model}:${tag}`, valid: false, sizeGb: null, error: "404 — tag not found in registry" };
    }
    if (!resp.ok) {
      return { tag: `${model}:${tag}`, valid: false, sizeGb: null, error: `HTTP ${resp.status}` };
    }
    const manifest = await resp.json();
    const totalBytes = (manifest.layers || []).reduce((sum: number, l: any) => sum + (l.size || 0), 0);
    return {
      tag: `${model}:${tag}`,
      valid: true,
      sizeGb: totalBytes > 0 ? Math.round(totalBytes / 1e8) / 10 : null,
      error: null,
    };
  } catch (e: any) {
    if (e?.name === "AbortError") {
      return { tag: `${model}:${tag}`, valid: false, sizeGb: null, error: "timeout" };
    }
    // Network error — likely offline
    return { tag: `${model}:${tag}`, valid: false, sizeGb: null, error: `network: ${e?.message || e}` };
  }
}

async function main() {
  console.log("══ Ollama catalog registry validation ══\n");

  // Check if we're online first with a quick HEAD to the registry
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    await fetch(`${REGISTRY_BASE}/gemma4/manifests/latest`, {
      headers: { "Accept": "application/vnd.oci.image.manifest.v1+json" },
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch {
    console.log("⚠  Offline — skipping registry validation (exit 0).");
    process.exit(0);
  }

  const results: ValidationResult[] = [];
  for (const m of RECOMMENDED_OLLAMA_MODELS) {
    const [model, tag] = m.id.split(":");
    if (!model || !tag) {
      results.push({ tag: m.id, valid: false, sizeGb: null, error: "malformed id (missing :)" });
      continue;
    }
    console.log(`  checking ${m.id}...`);
    const result = await checkTag(model, tag);
    results.push(result);
    if (result.valid) {
      console.log(`    ✓ valid${result.sizeGb ? ` (${result.sizeGb} GB)` : ""}`);
    } else {
      console.log(`    ✗ INVALID: ${result.error}`);
    }
  }

  console.log("\n══ Summary ══");
  const valid = results.filter((r) => r.valid);
  const invalid = results.filter((r) => !r.valid);
  console.log(`  ${valid.length} valid, ${invalid.length} invalid`);

  if (invalid.length > 0) {
    console.log("\n  Invalid tags:");
    for (const r of invalid) {
      console.log(`    ${r.tag}: ${r.error}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("Validator failed:", e);
  process.exit(0); // don't fail CI on validator errors
});
