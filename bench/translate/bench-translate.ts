#!/usr/bin/env tsx
/**
 * bench-translate.ts — Translation benchmark CLI.
 *
 * Runs translation models against FLORES+, WMT24++, and domain data,
 * collecting raw generations + Ollama stats. Scoring is done separately
 * by python/score.py (sacrebleu chrF++).
 *
 * Usage:
 *   npx tsx bench/translate/bench-translate.ts [options]
 *
 * Options:
 *   --models <json>        Path to models.json (default: bench/translate/models.json)
 *   --sets <list>          Comma-separated: flores,wmt24pp,domain (default: all)
 *   --direction <dir>      en-ar | ar-en | both (default: both)
 *   --n <num>              Subsample N segments per set (0 = all, default: 0)
 *   --conditions <list>    Comma-separated: C1-native,C2-rdat-rag (default: C1-native)
 *   --ollama-url <url>     Ollama base URL (default: http://localhost:11434)
 *   --output <path>        Output JSON path (default: results/<date>-<sha>-<host>.json)
 *   --data-dir <path>      Data cache directory (default: bench/translate/.cache)
 *   --hf-token <token>     HuggingFace token for gated datasets
 *   --allow-cloud-domain   Allow domain data to go to cloud APIs (default: false)
 *   --list-models          List configured models and exit
 *   --dry-run              Render prompts and print them without calling Ollama
 *
 * Privacy: public benchmark data (FLORES+, WMT24++) may go to any
 * configured backend. Domain data NEVER goes to a cloud API unless
 * --allow-cloud-domain is passed.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ─── Types ─────────────────────────────────────────────────────────

interface Candidate {
  ref: string;
  family: string;
  source: "ollama" | "huggingface" | "cloud";
  promptProfile: string;
  supportsThinkingOff: boolean;
  licence: string;
  licenceNote: string;
}

interface BenchSegment {
  id: string;
  direction: "en-ar" | "ar-en";
  source: string;
  reference: string;
  dataset: string;
  glossaryTerms?: Array<{ source: string; target: string }>;
}

interface GenerationResult {
  candidateRef: string;
  condition: string;
  segmentId: string;
  direction: string;
  dataset: string;
  systemPrompt: string;
  userPrompt: string;
  hypothesis: string;
  reference: string;
  source: string;
  ollamaStats?: {
    total_duration_ns: number;
    load_duration_ns: number;
    prompt_eval_count: number;
    prompt_eval_duration_ns: number;
    eval_count: number;
    eval_duration_ns: number;
  };
  error: string | null;
  timestamp: string;
}

// ─── CLI parsing ───────────────────────────────────────────────────

function parseArgs(): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

const args = parseArgs();
const MODELS_PATH = args["models"] as string || path.join(__dirname, "models.json");
const SETS = (args["sets"] as string || "flores,wmt24pp,domain").split(",");
const DIRECTION = (args["direction"] as string || "both") as "en-ar" | "ar-en" | "both";
const N = parseInt(args["n"] as string || "0", 10);
const CONDITIONS = (args["conditions"] as string || "C1-native").split(",");
const OLLAMA_URL = (args["ollama-url"] as string || "http://localhost:11434").replace(/\/$/, "");
const OUTPUT_PATH = args["output"] as string || path.join(__dirname, "results", `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}.json`);
const DATA_DIR = args["data-dir"] as string || path.join(__dirname, ".cache");
const HF_TOKEN = args["hf-token"] as string || process.env.HF_TOKEN || "";
const ALLOW_CLOUD_DOMAIN = !!args["allow-cloud-domain"];
const LIST_MODELS = !!args["list-models"];
const DRY_RUN = !!args["dry-run"];

// ─── Main ──────────────────────────────────────────────────────────

async function main() {
  const modelsJson = JSON.parse(fs.readFileSync(MODELS_PATH, "utf8"));
  const candidates: Candidate[] = modelsJson.candidates;

  if (LIST_MODELS) {
    console.log("Configured candidates:");
    for (const c of candidates) {
      console.log(`  ${c.ref.padEnd(45)} ${c.family.padEnd(15)} ${c.source.padEnd(12)} ${c.licence}`);
    }
    process.exit(0);
  }

  console.log("══ Translation Benchmark ══");
  console.log(`  Models:     ${candidates.length} candidates`);
  console.log(`  Sets:       ${SETS.join(", ")}`);
  console.log(`  Direction:  ${DIRECTION}`);
  console.log(`  N:          ${N || "all"}`);
  console.log(`  Conditions: ${CONDITIONS.join(", ")}`);
  console.log(`  Ollama URL: ${OLLAMA_URL}`);
  console.log(`  Output:     ${OUTPUT_PATH}`);
  console.log(`  HF token:   ${HF_TOKEN ? "set" : "not set"}`);
  console.log(`  Cloud domain: ${ALLOW_CLOUD_DOMAIN ? "ALLOWED" : "blocked"}`);
  console.log(`  Dry run:    ${DRY_RUN}`);
  console.log();

  // Load datasets
  const segments: BenchSegment[] = [];
  for (const set of SETS) {
    const setSegments = await loadDataset(set, DATA_DIR, HF_TOKEN, DIRECTION, N);
    segments.push(...setSegments);
    console.log(`  ${set}: ${setSegments.length} segments loaded`);
  }

  if (segments.length === 0) {
    console.error("No segments loaded. Exiting.");
    process.exit(1);
  }

  // Run generations
  const results: GenerationResult[] = [];
  const cache = loadCache();

  for (const candidate of candidates) {
    console.log(`\n── ${candidate.ref} (${candidate.family}) ──`);

    for (const condition of CONDITIONS) {
      for (const seg of segments) {
        // Privacy check: domain data + cloud model
        if (seg.dataset === "domain" && candidate.source === "cloud" && !ALLOW_CLOUD_DOMAIN) {
          console.log(`  SKIP (privacy): domain segment ${seg.id} → cloud model ${candidate.ref}`);
          continue;
        }

        // Render prompt
        const { renderPrompt } = await import("./profiles");
        const promptResult = renderPrompt(
          candidate.family,
          condition as any,
          seg.direction,
          seg.source,
          seg.glossaryTerms
        );

        if (DRY_RUN) {
          console.log(`  [DRY] ${candidate.ref} | ${condition} | ${seg.id}`);
          console.log(`    system: ${promptResult.systemPrompt.slice(0, 80)}...`);
          console.log(`    user:   ${promptResult.userPrompt.slice(0, 80)}...`);
          continue;
        }

        // Cache check
        const cacheKey = `${candidate.ref}::${condition}::${seg.direction}::${seg.id}::${crypto.createHash("sha256").update(promptResult.systemPrompt + promptResult.userPrompt).digest("hex").slice(0, 16)}`;
        if (cache.has(cacheKey)) {
          results.push(cache.get(cacheKey)!);
          process.stdout.write(".");
          continue;
        }

        // Generate
        try {
          const result = await generateTranslation(
            OLLAMA_URL,
            candidate,
            promptResult.systemPrompt,
            promptResult.userPrompt,
            seg
          );
          result.condition = condition;
          cache.set(cacheKey, result);
          results.push(result);
          saveCache(cache);
          process.stdout.write(".");
        } catch (e: any) {
          console.error(`\n  ERROR: ${e.message}`);
          results.push({
            candidateRef: candidate.ref,
            condition,
            segmentId: seg.id,
            direction: seg.direction,
            dataset: seg.dataset,
            systemPrompt: promptResult.systemPrompt,
            userPrompt: promptResult.userPrompt,
            hypothesis: "",
            reference: seg.reference,
            source: seg.source,
            error: e.message,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  }

  console.log(`\n\nGenerated ${results.length} translations (${results.filter(r => r.error).length} errors).`);

  // Save results
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  const output = {
    timestamp: new Date().toISOString(),
    args: { SETS, DIRECTION, N, CONDITIONS, OLLAMA_URL },
    candidates: candidates.map(c => ({ ref: c.ref, family: c.family, licence: c.licence, licenceNote: c.licenceNote })),
    results,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Results saved to ${OUTPUT_PATH}`);
}

// ─── Ollama client ─────────────────────────────────────────────────

async function generateTranslation(
  ollamaUrl: string,
  candidate: Candidate,
  systemPrompt: string,
  userPrompt: string,
  seg: BenchSegment
): Promise<GenerationResult> {
  const isTranslategemma = candidate.family === "translategemma";

  // Build request body
  let body: Record<string, unknown>;
  if (isTranslategemma && !systemPrompt) {
    // TranslateGemma: single user message, no system
    body = {
      model: candidate.ref,
      messages: [{ role: "user", content: userPrompt }],
      stream: false,
      options: { temperature: 0, seed: 42, num_ctx: 4096, num_predict: 256 },
    };
  } else {
    body = {
      model: candidate.ref,
      messages: [
        ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
        { role: "user", content: userPrompt },
      ],
      stream: false,
      think: candidate.supportsThinkingOff ? false : undefined,
      options: { temperature: 0, seed: 42, num_ctx: 4096, num_predict: 256 },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const resp = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Ollama HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }

    const data = await resp.json();
    const hypothesis = (data.message?.content || "").trim();

    return {
      candidateRef: candidate.ref,
      condition: "",
      segmentId: seg.id,
      direction: seg.direction,
      dataset: seg.dataset,
      systemPrompt,
      userPrompt,
      hypothesis,
      reference: seg.reference,
      source: seg.source,
      ollamaStats: data.total_duration ? {
        total_duration_ns: data.total_duration || 0,
        load_duration_ns: data.load_duration || 0,
        prompt_eval_count: data.prompt_eval_count || 0,
        prompt_eval_duration_ns: data.prompt_eval_duration || 0,
        eval_count: data.eval_count || 0,
        eval_duration_ns: data.eval_duration || 0,
      } : undefined,
      error: null,
      timestamp: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Dataset loaders ───────────────────────────────────────────────

async function loadDataset(
  set: string,
  dataDir: string,
  hfToken: string,
  direction: string,
  n: number
): Promise<BenchSegment[]> {
  fs.mkdirSync(dataDir, { recursive: true });

  switch (set.trim()) {
    case "flores":
      return loadFlores(dataDir, hfToken, direction, n);
    case "wmt24pp":
      return loadWmt24pp(dataDir, hfToken, direction, n);
    case "domain":
      return loadDomain(direction, n);
    default:
      console.warn(`Unknown dataset: ${set}`);
      return [];
  }
}

async function loadFlores(dataDir: string, hfToken: string, direction: string, n: number): Promise<BenchSegment[]> {
  // FLORES+ is gated on HuggingFace. The user must accept terms + use a token.
  // We download via the datasets-server API (which respects gating with a token).
  // Configs: "eng_Latn" and "arb_Arab" — we fetch both and align by sentence ID.
  const cacheFile = path.join(dataDir, "flores_plus.json");
  if (fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    return filterAndSubsample(cached, direction, n);
  }

  console.log("  Downloading FLORES+ (gated — requires HF token)...");
  const segments: BenchSegment[] = [];

  for (const dir of ["en-ar", "ar-en"]) {
    if (direction !== "both" && direction !== dir) continue;
    const srcLang = dir === "ar-en" ? "arb_Arab" : "eng_Latn";
    const tgtLang = dir === "ar-en" ? "eng_Latn" : "arb_Arab";

    // FLORES+ devtest split
    const url = `https://datasets-server.huggingface.co/rows?dataset=openlanguagedata/flores_plus&config=${srcLang}-${tgtLang}&split=devtest&offset=0&length=1012`;
    const headers: Record<string, string> = {};
    if (hfToken) headers["Authorization"] = `Bearer ${hfToken}`;

    try {
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        console.warn(`  FLORES+ ${dir}: HTTP ${resp.status} (is the HF token set + terms accepted?)`);
        continue;
      }
      const data = await resp.json();
      const rows = data.rows || [];
      for (const row of rows) {
        const r = row.row;
        segments.push({
          id: `flores_${dir}_${r.id || segments.length}`,
          direction: dir as "en-ar" | "ar-en",
          source: r.source || r.text || "",
          reference: r.target || r.translation || "",
          dataset: "flores",
        });
      }
    } catch (e: any) {
      console.warn(`  FLORES+ ${dir}: ${e.message}`);
    }
  }

  fs.writeFileSync(cacheFile, JSON.stringify(segments, null, 2));
  return filterAndSubsample(segments, direction, n);
}

async function loadWmt24pp(dataDir: string, _hfToken: string, direction: string, n: number): Promise<BenchSegment[]> {
  const cacheFile = path.join(dataDir, "wmt24pp.json");
  if (fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    return filterAndSubsample(cached, direction, n);
  }

  console.log("  Downloading WMT24++ (en-ar_EG + en-ar_SA)...");
  const segments: BenchSegment[] = [];

  for (const config of ["en-ar_EG", "en-ar_SA"]) {
    const url = `https://datasets-server.huggingface.co/rows?dataset=google/wmt24pp&config=${config}&split=train&offset=0&length=1000`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        console.warn(`  WMT24++ ${config}: HTTP ${resp.status}`);
        continue;
      }
      const data = await resp.json();
      const rows = data.rows || [];
      for (const row of rows) {
        const r = row.row;
        // Skip canary rows
        if (r.source?.includes("CANARY")) continue;
        segments.push({
          id: `wmt24pp_${config}_${r.segment_id ?? segments.length}`,
          direction: "en-ar" as const,
          source: r.source || "",
          reference: r.target || "", // post-edit
          dataset: "wmt24pp",
          // We also store original_target for multi-reference scoring
          glossaryTerms: r.original_target ? [{ source: "__original_target__", target: r.original_target }] : undefined,
        });
      }
    } catch (e: any) {
      console.warn(`  WMT24++ ${config}: ${e.message}`);
    }
  }

  fs.writeFileSync(cacheFile, JSON.stringify(segments, null, 2));
  return filterAndSubsample(segments, direction, n);
}

function loadDomain(direction: string, n: number): BenchSegment[] {
  const domainDir = path.join(__dirname, "data", "domain");
  const segments: BenchSegment[] = [];

  for (const file of fs.readdirSync(domainDir).filter(f => f.endsWith(".tsv"))) {
    const content = fs.readFileSync(path.join(domainDir, file), "utf8");
    const lines = content.trim().split("\n").slice(1); // skip header
    for (const line of lines) {
      const [id, dir, source, reference, glossaryJson] = line.split("\t");
      if (direction !== "both" && direction !== dir) continue;
      let glossaryTerms: Array<{ source: string; target: string }> | undefined;
      if (glossaryJson && glossaryJson !== "") {
        try { glossaryTerms = JSON.parse(glossaryJson); } catch { /* ignore */ }
      }
      segments.push({ id, direction: dir as "en-ar" | "ar-en", source, reference, dataset: "domain", glossaryTerms });
    }
  }

  // If no domain files exist, load the synthetic sample
  if (segments.length === 0) {
    const sampleFile = path.join(domainDir, "sample_synthetic.tsv");
    if (fs.existsSync(sampleFile)) {
      const content = fs.readFileSync(sampleFile, "utf8");
      const lines = content.trim().split("\n").slice(1);
      for (const line of lines) {
        const [id, dir, source, reference, glossaryJson] = line.split("\t");
        if (direction !== "both" && direction !== dir) continue;
        let glossaryTerms: Array<{ source: string; target: string }> | undefined;
        if (glossaryJson && glossaryJson !== "") {
          try { glossaryTerms = JSON.parse(glossaryJson); } catch { /* ignore */ }
        }
        segments.push({ id, direction: dir as "en-ar" | "ar-en", source, reference, dataset: "domain", glossaryTerms });
      }
    }
  }

  return filterAndSubsample(segments, direction, n);
}

function filterAndSubsample(segments: BenchSegment[], direction: string, n: number): BenchSegment[] {
  let filtered = direction === "both" ? segments : segments.filter(s => s.direction === direction);
  if (n > 0 && filtered.length > n) {
    // Seeded subsample for reproducibility
    const seed = 42;
    const rng = mulberry32(seed);
    const indices = [...filtered.keys()].sort(() => rng() - 0.5).slice(0, n);
    filtered = indices.map(i => filtered[i]);
  }
  return filtered;
}

function mulberry32(seed: number) {
  return function() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Cache ─────────────────────────────────────────────────────────

const CACHE_FILE = path.join(__dirname, ".cache", "generation-cache.json");

function loadCache(): Map<string, GenerationResult> {
  if (!fs.existsSync(CACHE_FILE)) return new Map();
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    return new Map(Object.entries(data));
  } catch {
    return new Map();
  }
}

function saveCache(cache: Map<string, GenerationResult>) {
  try {
    const obj: Record<string, GenerationResult> = {};
    for (const [k, v] of cache.entries()) obj[k] = v;
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj));
  } catch {
    // Non-fatal
  }
}

// ─── Run ───────────────────────────────────────────────────────────

main().catch(e => {
  console.error("Benchmark failed:", e);
  process.exit(1);
});
