/**
 * Model profiles tests — Fix 5, v0.4.3.
 *
 * Run: npx tsx scripts/test-model-profiles.ts
 */
import { getModelProfile, buildOllamaChatRequest } from "../src/lib/model-profiles";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? " — " + detail : ""}`); }
}

console.log("\n══ Model profiles (Fix 5, v0.4.3) ══\n");

console.log("── getModelProfile ──");

const g4 = getModelProfile("gemma4:e2b");
check("gemma4 → disableThinking=true", g4.disableThinking === true);
check("gemma4 → foldSystemIntoUser=false", g4.foldSystemIntoUser === false);
check("gemma4 → label='gemma4'", g4.label === "gemma4");

const q3 = getModelProfile("qwen3:4b");
check("qwen3 → disableThinking=true", q3.disableThinking === true);
check("qwen3 → label='qwen3'", q3.label === "qwen3");

const tg = getModelProfile("translategemma:12b");
check("translategemma → disableThinking=true", tg.disableThinking === true);
check("translategemma → foldSystemIntoUser=true", tg.foldSystemIntoUser === true);
check("translategemma → label='translategemma'", tg.label === "translategemma");

const q25 = getModelProfile("qwen2.5:3b");
check("qwen2.5 → disableThinking=false", q25.disableThinking === false);
check("qwen2.5 → label='qwen2.5'", q25.label === "qwen2.5");

const llama = getModelProfile("llama3.1:8b");
check("llama3 → disableThinking=false", llama.disableThinking === false);

const unknown = getModelProfile("some-unknown-model:7b");
check("unknown → default profile", unknown.label === "default");
check("unknown → disableThinking=false", unknown.disableThinking === false);

console.log("\n── buildOllamaChatRequest ──");

// Standard model (gemma4): system + user, think=false
{
  const req = buildOllamaChatRequest("gemma4:e2b", "sys", "usr", 256, 0.3);
  check("gemma4 request has 2 messages", (req.messages as any[]).length === 2);
  check("gemma4 request message[0].role='system'", (req.messages as any[])[0].role === "system");
  check("gemma4 request think=false", req.think === false);
  check("gemma4 request options.num_predict=256", (req.options as any).num_predict === 256);
}

// TranslateGemma: single user message, think=false
{
  const req = buildOllamaChatRequest("translategemma:12b", "sys", "usr", 256, 0.3);
  check("translategemma request has 1 message", (req.messages as any[]).length === 1);
  check("translategemma request message[0].role='user'", (req.messages as any[])[0].role === "user");
  check("translategemma request combines sys+usr", (req.messages as any[])[0].content.includes("sys") && (req.messages as any[])[0].content.includes("usr"));
  check("translategemma request think=false", req.think === false);
}

// Qwen 2.5: think undefined (not false)
{
  const req = buildOllamaChatRequest("qwen2.5:3b", "sys", "usr", 256, 0.3);
  check("qwen2.5 request think is undefined", req.think === undefined);
}

// ════════════════════════════════════════════════════════════════════
console.log("\n────────────────────────────────");
console.log(`  PASS: ${pass}    FAIL: ${fail}`);
console.log("────────────────────────────────");
if (fail > 0) process.exit(1);
