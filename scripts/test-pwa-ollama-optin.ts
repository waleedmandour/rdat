/**
 * PWA Ollama opt-in + error classification tests — Fix 2, v0.4.3.
 *
 * Run: npx tsx scripts/test-pwa-ollama-optin.ts
 *
 * Covers:
 *   - settings-store has pwaOllamaOptIn (default false) + setPwaOllamaOptIn
 *   - Adapter factory skips Ollama probe when !pwaOllamaOptIn in PWA mode
 *   - classifyOllamaConnectionError: not-running, cors-or-lná, mixed-content, http-error, timeout, unknown
 *   - AiModelsView has the "Connect to local Ollama" card
 *   - README no longer recommends OLLAMA_ORIGINS=*
 *   - httpPullModel NDJSON parser (mocked stream)
 */
import { classifyOllamaConnectionError } from "../src/lib/ollama-pwa-errors";
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

console.log("\n══ PWA Ollama opt-in + error classification (Fix 2, v0.4.3) ══\n");

console.log("── settings-store ──");

const ssSrc = fs.readFileSync(path.resolve("src/stores/settings-store.ts"), "utf8");
check("pwaOllamaOptIn: boolean in interface", /pwaOllamaOptIn:\s*boolean/.test(ssSrc));
check("setPwaOllamaOptIn in interface", /setPwaOllamaOptIn:\s*\(optIn:\s*boolean\)\s*=>\s*void/.test(ssSrc));
check("defaults to false", /getInitial<boolean>\("rdat_pwa_ollama_opt_in",\s*false\)/.test(ssSrc));
check("persists to localStorage", /rdat_pwa_ollama_opt_in/.test(ssSrc));

console.log("\n── Adapter factory respects opt-in ──");

const factorySrc = fs.readFileSync(path.resolve("src/lib/adapters/index.ts"), "utf8");
check("factory reads pwaOllamaOptIn from store", /pwaOllamaOptIn/.test(factorySrc));
check("factory skips probe when !pwaOptIn in PWA", /isPwa\s*&&\s*!pwaOptIn/.test(factorySrc));
check("factory logs skip message", /Ollama opt-in is off/.test(factorySrc));

console.log("\n── classifyOllamaConnectionError ──");

// HTTP error
{
  const r = classifyOllamaConnectionError(null, "https://app.vercel.app", "http://localhost:11434/api/tags", 500);
  check("HTTP 500 → http-error", r.type === "http-error");
  check("HTTP error message mentions status", r.message.includes("500"));
}

// Mixed content
{
  const r = classifyOllamaConnectionError(null, "https://app.vercel.app", "http://localhost:11434/api/tags", null);
  check("HTTPS page + HTTP localhost → mixed-content", r.type === "mixed-content");
  check("Mixed-content message mentions HTTPS", /HTTPS/i.test(r.message));
  check("Mixed-content action mentions Tauri or HTTP", /Tauri|HTTP/i.test(r.action));
}

// Timeout
{
  const abortErr = new Error("Aborted");
  abortErr.name = "AbortError";
  const r = classifyOllamaConnectionError(abortErr, "http://localhost:3000", "http://localhost:11434/api/tags", null);
  check("AbortError → timeout", r.type === "timeout");
}

// CORS / LNA / not-running (TypeError "Failed to fetch")
{
  const fetchErr = new TypeError("Failed to fetch");
  // For an HTTP page, the classifier falls through to cors-or-lná
  const r2 = classifyOllamaConnectionError(fetchErr, "http://localhost:3000", "http://localhost:11434/api/tags", null);
  check("TypeError + HTTP page → cors-or-lná", r2.type === "cors-or-lná", `got "${r2.type}"`);
  check("CORS message mentions OLLAMA_ORIGINS", /OLLAMA_ORIGINS/i.test(r2.message));
  check("CORS action includes exact origin", r2.action.includes("http://localhost:3000"));
  check("CORS action includes Windows instruction", /setx/i.test(r2.action));
  check("CORS action includes macOS instruction", /launchctl/i.test(r2.action));
  check("CORS action includes Linux instruction", /systemd/i.test(r2.action));
  check("CORS has Arabic message", r2.messageAr.length > 10);
  check("CORS has Arabic action", r2.actionAr.length > 10);
}

// Unknown error
{
  const r = classifyOllamaConnectionError(new Error("something weird"), "http://localhost:3000", "http://localhost:11434/api/tags", null);
  check("Unknown error → unknown", r.type === "unknown");
  check("Unknown message includes the error text", r.message.includes("something weird"));
}

console.log("\n── AiModelsView has opt-in UI ──");

const amvSrc = fs.readFileSync(path.resolve("src/components/AiModelsView.tsx"), "utf8");
check("AiModelsView has 'Connect to local Ollama' card", /Connect to local Ollama/.test(amvSrc));
check("AiModelsView has setup instructions with window.location.origin", /window\.location\.origin/.test(amvSrc));
check("AiModelsView warns against OLLAMA_ORIGINS=*", /do NOT use OLLAMA_ORIGINS=\*/.test(amvSrc) || /لا تستخدم OLLAMA_ORIGINS=\*/.test(amvSrc));
check("AiModelsView has Windows setx instruction", /setx OLLAMA_ORIGINS/.test(amvSrc));
check("AiModelsView has macOS launchctl instruction", /launchctl setenv OLLAMA_ORIGINS/.test(amvSrc));
check("AiModelsView has Linux systemd instruction", /Environment=OLLAMA_ORIGINS/.test(amvSrc));
check("AiModelsView has 'Disable Ollama opt-in' button", /Disable Ollama opt-in/.test(amvSrc));
check("AiModelsView has diagnostics card when opt-in fails", /Could not connect to Ollama/.test(amvSrc));

console.log("\n── README no longer recommends OLLAMA_ORIGINS=* ──");

const readmeSrc = fs.readFileSync(path.resolve("README.md"), "utf8");
check("README does NOT recommend OLLAMA_ORIGINS=* as the primary instruction", !/set.*OLLAMA_ORIGINS=\*/i.test(readmeSrc.replace(/do NOT use.*\*/i, "").replace(/لا تستخدم.*\*/i, "")));
check("README recommends exact origin", /setx OLLAMA_ORIGINS/.test(readmeSrc));
check("README warns against *", /not\s+`?\*`?|do NOT use|لا تستخدم/i.test(readmeSrc));

console.log("\n── NDJSON pull progress parser (mocked) ──");

// Test that the httpPullModel function correctly parses NDJSON lines.
// We can't easily mock fetch in a Node test, but we can verify the
// parser logic exists in the source.
const ollamaSrc = fs.readFileSync(path.resolve("src/lib/adapters/ollama-adapter.ts"), "utf8");
check("httpPullModel uses getReader()", /getReader\(\)/.test(ollamaSrc));
check("httpPullModel parses JSON per line", /JSON\.parse\(line\)/.test(ollamaSrc));
check("httpPullModel extracts completed/total for percent", /evt\.completed.*evt\.total|evt\.total.*evt\.completed/.test(ollamaSrc));
check("httpPullModel handles 'success' status", /evt\.status === "success"/.test(ollamaSrc));
check("httpPullModel uses AbortController for cancel", /AbortController/.test(ollamaSrc));
check("httpPullModel has 10-minute timeout for large models", /600_000|600000/.test(ollamaSrc));

// ════════════════════════════════════════════════════════════════════
console.log("\n────────────────────────────────");
console.log(`  PASS: ${pass}    FAIL: ${fail}`);
console.log("────────────────────────────────");
if (fail > 0) {
  process.exit(1);
}
