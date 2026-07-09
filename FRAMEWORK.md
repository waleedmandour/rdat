# RDAT: Translation Copilot - Framework and Workflow

> **Purpose:** This document describes the complete architecture, data flow, and runtime behavior of RDAT (Translation Copilot) v0.2.0. It is structured for direct translation into a visual on Napkin.AI. Each section is self-contained and can become one diagram node or one swimlane.

**Version:** 0.2.0
**Status:** Production (Tauri desktop) + Preview (PWA on Vercel)
**License:** MIT

---

## 1. System Overview

### 1.1 What RDAT Is

RDAT (Translation Copilot) is an AI-powered, local-first Computer-Assisted Translation (CAT) workspace purpose-built for professional English-to-Arabic and Arabic-to-English translation. It pairs a segmented translation editor with a three-tier predictive ghost-text pipeline that suggests completions in real time while keeping the human translator in full control of every word.

The core design principle is **local-first**: the primary translation engine runs on-device (no network egress), with cloud AI used only as a secondary fallback. This guarantees data privacy, offline capability, and consistent latency.

### 1.2 Dual-Path Architecture

RDAT ships in two complementary forms that share a single React/Vite frontend codebase:

| Distribution | Shell | Local LLM Backend | Cloud Proxy | Install Size |
|---|---|---|---|---|
| **Tauri Desktop App** | Tauri 2 (Rust backend) | Ollama daemon (PRIMARY) | Rust reqwest proxy to Gemini REST API | ~15 MB app + ~1.5 GB model |
| **PWA on Vercel** | Browser (Service Worker) | WebLLM via WebGPU (fallback) | Vercel serverless functions with @google/genai SDK | Zero install (browser) |

Both paths run the **same React frontend**. The runtime environment detects which shell is active and selects the appropriate adapters and proxies.

### 1.3 Primary and Secondary Engines

- **Primary engine:** Local LLM
  - In Tauri mode: Ollama (native CUDA/Metal acceleration, supports Gemma 4 / Qwen 3 / Llama 4)
  - In PWA mode: WebLLM (WebGPU-accelerated, q4f16_1 quantization)
- **Secondary engine:** Cloud Gemini 2.5 Flash
  - Used as fallback when the local LLM is unavailable, no model is loaded, or the local tier fails
  - Also used for the AI Translation Tutor (separate pedagogical feature, not part of the ghost-text pipeline)

The local LLM is enhanced with **RAG (Retrieval-Augmented Generation)**: before inference, the top-k most relevant glossary and translation-memory entries are retrieved from the LTE and injected into a structured system prompt. This makes local-LLM output glossary-aware and context-conditioned, not generic.

### 1.4 Engine Modes (User-Selectable)

Three modes are exposed in the Models panel and stored in localStorage (`rdat_engine_mode`):

| Mode | Active Tiers | Use Case |
|---|---|---|
| **Hybrid** (default) | LTE + Local LLM + Cloud Gemini | Maximum suggestion quality with graceful fallback |
| **Local** | LTE + Local LLM only | Zero data egress, full offline, privacy-sensitive environments |
| **Cloud** | Gemini API only | Complex passages, or when no local model is available |

---

## 2. Architecture Diagram (ASCII)

The diagram below shows the complete flow from source text import through to segment confirmation. Every node corresponds to a real module in the codebase.

```
+======================================================================================+
|                            RDAT TRANSLATION COPILOT - SYSTEM FLOW                    |
+======================================================================================+

[ USER ACTION ]
       |
       v
+---------------------------+        Import .txt (FileReader)
| Source Text Import        |------> | SourceEditor.tsx
| (.txt / .docx)            |        Import .docx (mammoth, dynamic import)
+---------------------------+
       |
       v
+---------------------------+
| Segmentation              |        Split on /(?<=[.!?])\s+|\n+/
| (TranslationWorkspace)    |        Each segment -> paired source/target row
+---------------------------+
       |
       v
+---------------------------+        On segment focus:
| Prefetch Full Translation |------> adapter.translate({ sourceText, targetPrefix: "" })
| (background, 0ms user UX) |        result cached via cachePrefetch() (TTL 120s)
+---------------------------+
       |
       v
+---------------------------+
| User Types in Target Cell |        Each keystroke resets debounce timer
+---------------------------+
       |
       v
+---------------------------+
| Debounce 500ms            |        LLM_DEBOUNCE_MS = 500
| (LLM_DEBOUNCE_MS)         |        Activity state -> "typing" then "suggesting"
+---------------------------+
       |
       v
+======================================================================================+
|                    THREE-TIER GHOST-TEXT PIPELINE (fetchSuggestions)                 |
+======================================================================================+
       |
       v
+---------------------------+        Tier 0: check prefetch cache (getPrefetch)
| TIER 0: LTE               |        Then LTE.getSuggestion() with:
| Local Translation Engine  |          - sentence-split matching
| Latency: < 5ms            |          - exact normalized match
| Channel: "lte"            |          - partial/prefix match (>0.4 score)
+---------------------------+          - n-gram trigram similarity (>0.25)
       |  (no confident match)
       v
+---------------------------+        Tier 1: await getActiveAdapter()
| TIER 1: Local LLM         |          - OllamaAdapter (Tauri) -> /api/chat
| (PRIMARY ENGINE)          |          - WebLLMAdapter (PWA) -> WebGPU
| Latency: 200-2000ms       |        RAG: getLTE().search(sourceText, 5) -> ragEntries
| Channel: "local-llm"      |        Prompt: buildRAGSystemPrompt + buildUserPrompt
+---------------------------+        Skip if prefix < 3 chars (MIN_PREFIX_FOR_LLM)
       |  (no adapter, no model, or inference fails)
       v
+---------------------------+        Tier 2: useGemini().generateBurst()
| TIER 2: Cloud Gemini      |          - Tauri: gemini_translate Rust command
| (SECONDARY FALLBACK)      |          - PWA: /api/translate/burst Vercel function
| Latency: 500-3000ms       |        Returns up to 3 candidates
| Channel: "gemini"         |        Retry: up to 2x with backoff (500ms, 1500ms)
+---------------------------+
       |
       v
+---------------------------+        Ghost text = computeGhostRemainder(typed, best)
| Ghost Text Rendered       |        Tier badge color:
| (in TargetEditor cell)    |          green  = LTE
|                           |          blue   = local-llm (with model name)
|                           |          amber  = GEMINI
+---------------------------+
       |
       +-----> [ Tab ]              Accept full ghost text
       +-----> [ Ctrl+Right ]       Accept next word
       +-----> [ Alt+] ]            Cycle alternative candidates
       +-----> [ Esc ]              Dismiss current suggestion
       |
       v
+---------------------------+        IDLE_PAUSE_MS = 2000
| Idle-Pause Re-Engagement  |        After 2s of no typing, re-trigger
| (2s timer)                |        fetchSuggestions() from Tier 0 again.
|                           |        Provides continuous assistance during
|                           |        translator thinking pauses.
+---------------------------+
       |
       v
+---------------------------+        Ctrl+Enter or Confirm button:
| User Confirms Segment     |        putToStore("segments", SegmentEntry)
| (Ctrl+Enter)              |        status -> "confirmed"
+---------------------------+
       |
       v
+---------------------------+
| IndexedDB Persistence     |        DB: rdat_copilot_db (version 2)
| (segments store)          |        Toast: "Segment N saved successfully"
+---------------------------+
```

---

## 3. Three-Tier Pipeline Detail

The ghost-text pipeline (`fetchSuggestions` in `TargetEditor.tsx`) consults tiers in strict order. The first tier to return a confident result supplies the ghost text. Higher-latency tiers are not awaited unless earlier tiers fail.

### 3.1 Tier 0: LTE (Local Translation Engine)

- **Module:** `src/lib/local-translation-engine.ts`
- **Class:** `LocalTranslationEngine` (singleton via `getLTE()`)
- **Latency:** < 5 ms
- **Channel badge:** `lte` (green)
- **Cost:** Free, always available, no network

**Matching strategy (in order):**

1. **Sentence-split matching:** If source contains multiple sentences, each sentence is matched independently and the Arabic parts are joined.
2. **Exact match:** Normalized (lowercased, punctuation stripped, whitespace collapsed) lookup in an in-memory `Map<normalizedSource, CorpusEntry>`.
3. **Partial / prefix match:** Substring containment either direction; scored by length ratio, threshold > 0.4 (scaled by 0.85).
4. **N-gram trigram similarity:** Jaccard similarity over character trigrams; threshold > 0.25.

**Output:** `LTEResult` with `match`, `source`, `remainder` (already stripped of the typed prefix), `score`, and `type` (`exact` / `partial` / `ngram` / `sentence-split`).

**Prefix alignment:** If the user's typed prefix does not exactly start the corpus match, a fuzzy alignment scan finds the best offset in the Arabic string. This makes the ghost remainder robust to minor typing deviations.

### 3.2 Tier 1: Local LLM (PRIMARY ENGINE)

- **Modules:**
  - Interface: `src/lib/llm-adapter.ts` (`LLMAdapter`)
  - Factory: `src/lib/adapters/index.ts` (`getActiveAdapter`)
  - Tauri backend: `src/lib/adapters/ollama-adapter.ts` (`OllamaAdapter`)
  - PWA backend: `src/lib/adapters/web-llm-adapter.ts` (`WebLLMAdapter`)
- **Latency:** 200 - 2000 ms
- **Channel badge:** `local-llm` (blue, with model name)
- **Backend selection at runtime:**
  - Inside Tauri + Ollama daemon reachable: `OllamaAdapter` (preferred, native CUDA/Metal)
  - Else if WebGPU available (PWA only): `WebLLMAdapter`
  - Else: `null` (Gemini-only mode, with an amber hint to install Ollama)

**RAG augmentation:** Before inference, `getLTE().search(sourceText, 5)` retrieves the top-5 glossary/translation-memory entries by trigram similarity. These are injected into the system prompt as a "Reference glossary" block, instructing the model to use those terms preferentially.

**Prompt structure:**
- System prompt: `buildRAGSystemPrompt(ragEntries, direction)` - role, rules, and reference glossary
- User prompt: `buildUserPrompt(sourceText, targetPrefix, direction)` - source text, typed prefix (if any), and a "continue only" instruction when a prefix exists

**Skip rule:** Tier 1 is skipped for prefixes shorter than 3 characters (`MIN_PREFIX_FOR_LLM = 3`). The LTE tier handles short prefixes instantly, so calling the LLM on every keystroke would waste resources.

### 3.3 Tier 2: Cloud Gemini (SECONDARY FALLBACK)

- **Modules:**
  - Hook: `src/hooks/useGemini.ts` (`generateBurst`)
  - Dispatcher: `src/lib/gemini-direct.ts` (Tauri vs PWA routing)
  - Tauri proxy: `src-tauri/src/commands/gemini.rs` (`gemini_translate` via reqwest)
  - PWA proxy: `api/translate/burst.ts` (Vercel function with `@google/genai`)
- **Latency:** 500 - 3000 ms
- **Channel badge:** `gemini` (amber)
- **Model:** `gemini-2.5-flash`
- **Output:** Up to 3 candidate completions (JSON-structured response)

**Retry policy:** Up to 2 retries with exponential backoff (500 ms, then 1500 ms) on network failures and 5xx errors. Non-retryable errors (4xx, missing API key) fail immediately.

**Skipped when:**
- `engineMode === "local"` (user disabled cloud)
- `useCloudFallback === false`
- No Gemini API key configured

---

## 4. LLMAdapter Pattern

### 4.1 Why an Adapter

Both local backends (Ollama and WebLLM) implement a unified `LLMAdapter` interface. The rest of the application (TargetEditor, status bar, tier-fallback logic) is identical regardless of which backend is active. This means:

- Adding a new backend (for example, llama.cpp or a remote Ollama instance) only requires writing one new adapter class.
- Tier-fallback code in `TargetEditor` never branches on backend type.
- The tier-source badge can show the model name without caring where it came from.

### 4.2 The Interface

Defined in `src/lib/llm-adapter.ts`. Key methods:

| Method | Purpose |
|---|---|
| `id` / `displayName` | Adapter identity |
| `isAvailable()` | Quick environment probe (does not verify a model is loaded) |
| `isModelLoaded()` / `getLoadedModelId()` | Model lifecycle query |
| `loadModel(modelId, onProgress?)` | Load (Ollama: verify installed; WebLLM: download + initialize) |
| `unloadModel()` | Release resources |
| `translate(opts: TranslateOptions)` | Generate translation candidates (best first) |
| `listModels()` | Catalog (Ollama: `/api/tags`; WebLLM: static `MODEL_MAP`) |
| `pullModel?(modelId, onProgress?)` | Download a model |
| `removeModel?(modelId)` | Delete from local store |
| `getLastError()` | Most recent error string |
| `onStateChange(cb)` / `getState()` / `getProgress()` | State subscription |

**TranslateOptions:**
```ts
{
  sourceText: string;
  targetPrefix?: string;     // already-typed Arabic prefix
  ragEntries?: CorpusEntry[]; // top-k glossary/TM hits
  maxTokens?: number;        // default 256
  temperature?: number;      // default 0.3 (deterministic)
}
```

### 4.3 OllamaAdapter (Tauri Mode)

- File: `src/lib/adapters/ollama-adapter.ts`
- Detected via `isTauriEnvironment()` (checks `window.__TAURI_INTERNALS__` or `window.__TAURI__`)
- All HTTP to Ollama happens on the Rust side via Tauri `invoke()`. The webview cannot call `http://localhost:11434` directly due to CORS and mixed-content restrictions.
- "Loading" a model means selecting it as active. The Ollama daemon itself lazy-loads weights on first inference and unloads after `OLLAMA_KEEP_ALIVE` (default 5 min).
- Catalog merges installed models (`/api/tags`) with a recommended catalog (Gemma 4, Qwen 2.5, Qwen 3, Llama 3.1).
- Default model: `gemma4:e2b` (`DEFAULT_OLLAMA_MODEL`).
- Prefix continuation handling: if the user typed a prefix, the model is asked to continue. The adapter combines `prefix + " " + continuation` into a full candidate so `computeGhostRemainder` can extract the visible remainder.

### 4.4 WebLLMAdapter (PWA Mode)

- File: `src/lib/adapters/web-llm-adapter.ts`
- Thin facade over `src/lib/local-llm-engine.ts` (the WebLLM wrapper). All real logic (model loading, state machine, prefetch cache) stays in the engine module.
- Requires WebGPU (Chrome 113+, Edge 113+). Safari and Firefox are unsupported.
- Catalog is static (`MODEL_MAP` in `local-llm-engine.ts`): Qwen 2.5 1.5B, Gemma 2 2B, Qwen 2.5 7B, Gemma 2 9B, Llama 3.1 8B. All use q4f16_1 quantization.
- Skipped in Tauri mode: WebGPU in Tauri's WebView2/WKWebView is unreliable, and even the capability check can hang.

### 4.5 Factory: getActiveAdapter()

Defined in `src/lib/adapters/index.ts`. Selection order:

1. **Inside Tauri + Ollama reachable:** `OllamaAdapter` (preferred). If not detected on first attempt, auto-retry.
2. **Else if WebGPU available:** `WebLLMAdapter` (PWA path only).
3. **Else:** `null` (Gemini-only mode; UI surfaces an amber hint).

**Auto-retry (cold-start handling):**
- If the user had a model loaded in a prior session (`loadedModel` in localStorage), retry up to 3 times with 2-second delays. The user had Ollama working before, so the daemon is likely just starting up.
- If no prior model, retry once after a 3-second delay.
- Each `isAvailable()` call has an 8-second timeout wrapped around the Rust health check (which itself tries 3 URLs at 5 seconds each).

**Auto-load:** Once Ollama is detected and a `loadedModel` is in localStorage, the factory automatically calls `loadModel(savedModel)` so the user does not have to manually re-select their model every restart.

**Memoization:** The selected adapter instance is memoized for the lifetime of the page. Callers must always go through `getActiveAdapter()` (or `getActiveAdapterSync()` for already-resolved instances) and never cache the adapter themselves.

**Reset:** `resetAdapter()` forces re-selection. Used after the user installs Ollama mid-session or after a manual "Recheck" from the UI.

### 4.6 Prompt Builders

Both adapters use the same shared prompt builders in `src/lib/llm-adapter.ts`, so prompt format changes apply uniformly.

**`buildRAGSystemPrompt(ragEntries, direction)`:**
- Base instructions: professional translator role, terminology consistency rule, "output only the translation" rule, no commentary.
- Direction-aware: switches between "English-to-Arabic" and "Arabic-to-English" instruction sets.
- RAG context: appends a "Reference glossary" block listing `en -> ar` pairs from the top-k LTE hits.

**`buildUserPrompt(sourceText, targetPrefix, direction)`:**
- Direction-aware labels: "English source" / "Arabic source" and "Arabic translation" / "English translation".
- If a prefix is present: instructs the model to output ONLY the next words that follow the prefix (no repetition, no explanation).
- If no prefix: instructs the model to output only the full translation.

---

## 5. Ollama Integration

### 5.1 Endpoint Selection

RDAT uses `/api/chat` (not `/api/generate`) for translation inference because:
- It is the recommended endpoint in Ollama's current API.
- It handles system prompts more reliably with small models.
- It returns a cleaner message structure.

The request body (built in `src-tauri/src/commands/ollama.rs`, `ollama_translate`):

```json
{
  "model": "<model-tag>",
  "messages": [
    { "role": "system", "content": "<system prompt with RAG>" },
    { "role": "user",   "content": "<user prompt with source + prefix>" }
  ],
  "stream": false,
  "think": false,
  "options": {
    "num_predict": "<max_tokens>",
    "temperature": "<0.3>"
  }
}
```

### 5.2 Qwen 3 Thinking Suppression

Qwen 3 models are "thinking" models: they emit reasoning into a `thinking` field and the final answer into `content`. With low `max_tokens` (256), the model can consume all tokens for thinking and leave `content` empty.

RDAT applies three layers of mitigation:
1. **Native API flag:** `"think": false` in the request body (the official Ollama approach, more reliable than appending `/no_think` to the prompt).
2. **Token budget boost:** For Qwen 3 models, `effective_max_tokens` is raised to at least 1024.
3. **Response cleanup (`strip_thinking_from_content`):**
   - Strip `<think>...</think>` tags if present.
   - If content starts with English reasoning phrases ("Okay, let's", "Let me", "The user wants"), find the first Arabic character (Unicode U+0600-U+06FF, plus supplement and presentation forms ranges) and return everything from that point.
   - If no Arabic is found at all, return empty (treat as pure thinking text).

The response parser also falls back gracefully:
1. Try `message.content` (normal case).
2. If empty, try `message.thinking` (model thought but ran out of tokens).
3. If still empty, try `response` field (legacy `/api/generate` format).

### 5.3 Proxy Bypass (.no_proxy())

All Ollama HTTP calls in Rust use `reqwest::Client::builder().no_proxy()`. Loopback traffic must never go through a corporate proxy or VPN. This is the #1 cause of "Ollama is installed but not detected" field reports on Windows machines with `HTTP_PROXY` env vars or OS-level PAC/WPAD auto-proxy configured.

### 5.4 IPv4 Explicit (127.0.0.1)

RDAT uses `127.0.0.1` (not `localhost`) because on Windows, `localhost` can resolve to `::1` (IPv6) first, and Ollama by default only listens on IPv4 `127.0.0.1`. Using the explicit IPv4 address avoids a silent DNS resolution mismatch.

### 5.5 Multi-URL Fallback

`ollama_health` tries three URL variants in order:
1. The normalized `OLLAMA_HOST` env var (if set)
2. `http://127.0.0.1:11434/api/tags` (IPv4 explicit, most reliable on Windows)
3. `http://localhost:11434/api/tags` (fallback for non-standard configs)

Each variant has a 5-second timeout. The first success short-circuits the loop.

### 5.6 OLLAMA_HOST Normalization

The `normalize_ollama_url` helper handles three input shapes:
- Full URL with scheme (`http://127.0.0.1:11434`) - used as-is.
- Bare `host:port` (`0.0.0.0:11434`) - prefixed with `http://`.
- Bare host without port (`my-host`) - prefixed with `http://` and `:11434` appended.

This matches Ollama's own convention and prevents "connection refused" errors from user-misconfigured env vars.

### 5.7 Cold-Start Auto-Retry

Ollama is commonly configured to autostart at login. When RDAT launches, the daemon may not have bound its HTTP listener yet. The adapter factory handles this race:

- First `isAvailable()` call (8-second timeout).
- If false and the user had a prior model: retry up to 3 times, 2-second delay between attempts.
- If false and no prior model: retry once after 3 seconds.
- The user still has a manual "Recheck" button in the UI (calls `resetAdapter()`).

### 5.8 Health Diagnostics

`ollama_health` returns a structured `HealthResult`:

```rust
struct HealthResult {
    healthy: bool,
    attempts: Vec<HealthAttempt>,  // one per URL tried
}
struct HealthAttempt {
    url: String,
    success: bool,
    error: Option<String>,  // classified: "Connection refused", "Timeout", "DNS failure", etc.
}
```

The JS adapter stashes the latest diagnostics in `lastHealthDiagnostics` and exposes `getHealthDiagnostics()`. The UI surfaces them so a screenshot of "Ollama not detected" contains enough information to diagnose the issue remotely (which URLs were tried, which errors occurred).

### 5.9 Model Catalog

The recommended Ollama catalog (defined in `OllamaAdapter`):

| Tag | Model | Parameters | Approx. Size | Notes |
|---|---|---|---|---|
| `gemma4:e2b` | Gemma 4 E2B (default starter) | 2B (Effective) | ~1.5 GB | Auto-selected for new users |
| `gemma4:e4b` | Gemma 4 E4B | 4B (Effective) | ~3.0 GB | Higher quality, 2x download |
| `qwen2.5:1.5b` | Qwen 2.5 1.5B | 1.5B | ~1.0 GB | Non-thinking, fast |
| `qwen2.5:3b` | Qwen 2.5 3B | 3B | ~2.0 GB | Non-thinking, balanced |
| `qwen3:1.7b` | Qwen 3 1.7B | 1.7B | ~1.1 GB | Thinking model (may be slower) |
| `qwen3:4b` | Qwen 3 4B | 4B | ~2.5 GB | Thinking model (may be slower) |
| `llama3.1:8b` | Llama 3.1 8B | 8B | ~4.9 GB | Stable, good Arabic |

The catalog merges with whatever the user has pulled (`/api/tags`), so user-installed models outside this list also appear with auto-parsed parameter and family metadata.

### 5.10 Streaming Pull Progress

`ollama_pull_model` streams NDJSON progress lines from Ollama's `/api/pull` endpoint and emits `ollama-pull-progress` Tauri events to the webview. The JS adapter subscribes to these events before invoking the command, so the Models panel shows real-time download percentage.

---

## 6. Ghost-Text Pipeline Flow (Step by Step)

The pipeline lives in `fetchSuggestions()` inside `src/components/editors/TargetEditor.tsx`. Below is the precise step-by-step sequence.

### Step 1: Segment Focus -> Prefetch Full Translation

When a segment becomes active (`isActive === true`) and has not been prefetched yet:
- `prefetchTranslation(sourceText)` is called (WebLLM path) for the legacy cache.
- In Tauri mode, if an adapter is already available and a model is loaded, `adapter.translate({ sourceText, targetPrefix: "", ragEntries })` runs in the background.
- The result is stored via `cachePrefetch(sourceText, translation)` with a 120-second TTL.
- If the segment already has typed text longer than `MIN_PREFIX_FOR_LLM` (3 chars), `fetchSuggestions()` is called immediately.

**Effect:** When the user starts typing, the first keystroke gets instant ghost text from the prefetch cache, no LLM call needed.

### Step 2: User Types -> 500ms Debounce

Each keystroke resets two timers:
- `debounceRef` (500 ms, `LLM_DEBOUNCE_MS`): fires `fetchSuggestions()`.
- `idleTimerRef` (2 s, `IDLE_PAUSE_MS`): fires a re-engagement pass after the debounce pass (see Step 7).

Activity state machine updates:
- On keystroke: `setEditorActivity("typing")` (blue "Typing..." in status bar).
- When debounce fires: `setEditorActivity("suggesting")` (indigo with spinner).

### Step 3: Tier 0 Check (LTE, Instant)

The first thing `fetchSuggestions` does:
1. Check the prefetch cache via `getPrefetch(sourceText)`. If present and the remainder is non-empty, render it as the ghost with tier `lte` and return.
2. If no prefetch hit and the LTE has a corpus loaded, call `lte.getSuggestion(sourceText, typedText)`. If it returns a result with a non-empty remainder, render it with tier `lte` and return.

LTE is always free, always instant, and always consulted first.

### Step 4: Tier 1 Check (Local LLM)

Only entered if `engineMode !== "cloud"`:
1. Get the adapter: try `getActiveAdapterSync()` first; if null, `await getActiveAdapter()` (this handles the cold-start race).
2. If an adapter exists:
   - Skip if `typedText.trim().length < MIN_PREFIX_FOR_LLM` (3 chars). Short prefixes are handled by LTE.
   - If no model is loaded: set `tierError` to an amber hint with a "Load Local Model" button (jumps to the Models panel). Notify once per session.
   - If a model is loaded: retrieve RAG entries via `getLTE().search(sourceText, 5)`, then call `adapter.translate({ sourceText, targetPrefix: typedText, ragEntries })`.
   - On success: compute the ghost remainder via `computeGhostRemainder(typedText, best)`, set tier to `local-llm`, clear prior local-llm errors, return.
   - On failure: set `tierError`, notify once with "Local LLM inference failed", fall through to Tier 2.
3. If no adapter exists (legacy PWA path): fall back to direct `generateRAGTranslation` / `generateLocalTranslation` calls from `local-llm-engine.ts` if a WebLLM model is loaded. Otherwise surface the "no model loaded" hint.

### Step 5: Tier 2 Check (Gemini Fallback)

Only entered if `useCloudFallback === true` and `engineMode !== "local"`:
1. Call `generateBurst(sourceText, typedText)` from the `useGemini` hook.
2. The hook dispatches to either the Rust `gemini_translate` command (Tauri) or the `/api/translate/burst` Vercel function (PWA).
3. Up to 3 candidates are returned. The first candidate supplies the ghost text.
4. On success: set tier to `gemini`, clear prior Gemini errors, return.
5. On failure: set `tierError` quietly (gray hint with "Set Gemini API Key" button), notify once with an info toast (not warning, because Gemini is optional).

### Step 6: Ghost Text Displayed with Tier Badge

If any tier succeeded, `ghostSuggestion` state holds the remainder text and `tierSource` holds the channel. The textarea renders a floating hint box at the bottom-left showing:
- A Sparkles icon (animated pulse)
- "Auto-complete" label
- The tier badge:
  - green `LTE`
  - blue `LLM` with a Cpu icon (and the model name when available)
  - amber `GEMINI`
- The ghost text itself

### Step 7: Idle-Pause Re-Engagement (2s Timer)

After the debounce pass completes, a second timer (`idleTimerRef`, 2 seconds) fires. If the segment is still active and there is typed text, `fetchSuggestions(translationText)` is called again from the top (Step 3).

This is the **continuous assistance** feature: the system does not give up after a single suggestion. While the translator pauses to think, the pipeline re-runs and may surface a fresh or refined suggestion (for example, if the adapter just finished loading or the prefetch cache was just populated).

### Accept / Cycle / Dismiss

| Input | Action |
|---|---|
| `Tab` | Append full `ghostSuggestion` to `translationText`, clear ghost. Sets `justAcceptedRef` to suppress the next debounce. |
| `Ctrl + Right` | Append only the next word (up to the first space) of the ghost. Keep the remainder as the new ghost. |
| `Alt + ]` | Cycle to the next candidate in `suggestionCandidates`. Recompute the ghost remainder for the new candidate. |
| `Esc` | Clear the ghost and all candidates. |
| `Ctrl + Enter` | Confirm the segment (see Step 8). |

### Step 8: Segment Confirm -> Save to IndexedDB

Triggered by `Ctrl + Enter` or the Confirm button:
- The `TranslationWorkspace` parent writes a `SegmentEntry` to the `segments` IndexedDB store via `putToStore("segments", entry)`.
- `SegmentEntry` includes: `source`, `target`, `source_lang`, `target_lang`, `status: "confirmed"`, `score`, `segment_index`, timestamps.
- Toast feedback: "Segment N saved successfully" (success), or "Cannot save an empty segment" (warning), or "Failed to save segment: \<error\>" (error).
- The confirmed segment index is tracked in `confirmedIndices` state so the UI can show a checkmark.

---

## 7. Data Flow

### 7.1 Source Text

```
User imports .txt / .docx
        |
        v
SourceEditor.tsx (handleFile)
   - .txt:  FileReader.readAsText
   - .docx: dynamic import("mammoth").extractRawText
        |
        v
workspace-store.setSourceText(text)
        |
        v
TranslationWorkspace.tsx
   - useMemo: split sourceText into sentences
   - setTargetTexts(Array(N).fill(""))
        |
        v
Rendered as paired source/target rows in split-pane editor
```

### 7.2 Glossary and Translation Memory

```
GlossaryView.tsx (JSON import or seed corpus)
        |
        v
IndexedDB "glossary" store  (putBatchToStore)
        |
        v
On app boot: getAllofStore<GlossaryEntry>("glossary")
        |
        v
getLTE().load(corpusEntries)   // CorpusEntry[] = { en, ar, type }
        |
        v
Serves TWO consumers:
   1. Tier 0 (LTE.getSuggestion)   - exact/partial/n-gram matching
   2. Tier 1 (getLTE().search)     - RAG context for local LLM prompt
```

A built-in seed corpus of approximately 80 professionally curated EN-AR pairs (CAT terminology, technology, professional phrases, academic research, business, legal) ships with the app in `src/lib/seed-corpus.ts`.

### 7.3 Translation Output

```
User types in TargetEditor
        |
        v
workspace-store.setTargetTextAtIndex(index, text)
        |
        v
(Cursor stays in editor; not persisted yet)
        |
        v
On Confirm (Ctrl+Enter):
   SegmentEntry = {
     source, target,
     source_lang, target_lang,
     status: "confirmed",
     score, segment_index, timestamps
   }
        |
        v
putToStore("segments", SegmentEntry)
        |
        v
confirmedIndices[index] = true   (UI checkmark)
```

On document load, existing confirmed segments are read back from IndexedDB and pre-filled into `targetTexts`, but only for slots that are currently empty (never overwriting active user typing).

### 7.4 Settings

All settings persist in `localStorage` via the `useSettingsStore` Zustand store:

| Key | localStorage Key | Default | Purpose |
|---|---|---|---|
| `engineMode` | `rdat_engine_mode` | `"hybrid"` | Which tiers are active |
| `geminiApiKey` | `rdat_gemini_api_key` | `""` | User-owned Gemini key |
| `useCloudFallback` | `rdat_cloud_fallback` | `true` | Whether Tier 2 is consulted |
| `useGtr` | `rdat_use_gtr` | `true` | GTR glossary feature flag |
| `downloadedModels` | `rdat_downloaded_models` | `[]` | Cached WebLLM model IDs |
| `loadedModel` | `rdat_loaded_model` | `""` | Currently selected model ID (used by adapter factory for auto-load and cold-start retry count) |

### 7.5 Storage Schema

**IndexedDB:** `rdat_copilot_db`, version 2

| Object Store | Key Path | Contents |
|---|---|---|
| `tm_entries` | `id` (auto-increment) | Translation memory entries |
| `glossary` | `id` (auto-increment) | Glossary term pairs |
| `segments` | `id` (auto-increment) | Confirmed segment translations |
| `sync_meta` | `key` | Sync metadata |

The storage layer (`src/lib/dual-storage.ts`) provides `putToStore`, `putBatchToStore`, `getAllofStore`, `deleteFromStore`, and `clearStore` helpers.

---

## 8. Technology Stack

### 8.1 Frontend

| Layer | Technology | Version |
|---|---|---|
| UI Framework | React | 19 |
| Build Tool | Vite | 6 |
| Language | TypeScript | 5.8 |
| Styling | Tailwind CSS | 4 (with CSS custom properties for theming) |
| State Management | Zustand | 5 |
| Animations | Motion (Framer Motion) | 12 |
| Icons | Lucide React | 0.546 |
| Document Import | mammoth | 1.8 (dynamic import for .docx) |

### 8.2 Desktop Shell

| Layer | Technology | Version |
|---|---|---|
| Desktop Framework | Tauri | 2.11.x |
| Backend Language | Rust | 1.77+ |
| HTTP Client (Rust) | reqwest | (with `no_proxy`, streaming, JSON) |
| Async Runtime | tokio | (Tauri default) |
| Serialization | serde | (serde_json for Ollama/Gemini payloads) |
| Tauri Plugins | dialog, fs, process, shell | 2.x |

### 8.3 AI / LLM

| Component | Technology | Version | Role |
|---|---|---|---|
| Primary Local LLM (Tauri) | Ollama | daemon | Gemma 4 / Qwen 2.5 / Qwen 3 / Llama 3.1 |
| Browser Local LLM (PWA) | @mlc-ai/web-llm | 0.2.84 | WebGPU-accelerated inference |
| Cloud AI | @google/genai | 2.4.0 | Gemini 2.5 Flash |
| Cloud Proxy (Tauri) | Rust `gemini_translate` command | - | reqwest to Gemini REST API |
| Cloud Proxy (PWA) | Vercel Serverless Functions | Node 22.x | @google/genai SDK |

### 8.4 Storage and PWA

| Component | Technology |
|---|---|
| Local Storage | IndexedDB (custom dual-storage layer, chunked read/write) |
| Settings | localStorage (via Zustand persist pattern) |
| PWA Manifest | Web App Manifest (standalone display) |
| Service Worker | `public/sw.js` (network-first navigation, cache-first static) |
| Install Prompt | `beforeinstallprompt` event on supported browsers |

### 8.5 Development

| Component | Technology |
|---|---|
| Local Dev Server | Express.js via `tsx` (`npm run dev`) |
| Local Dev Proxy | Gemini API proxy on `http://localhost:3000` |
| Lint / Typecheck | `tsc --noEmit` (`npm run lint`) |
| Tauri Dev | `npm run tauri:dev` (Rust compile + Vite HMR + native window) |
| Tauri Build | `npm run tauri:build` (NSIS on Windows, DMG on macOS, deb/rpm/AppImage on Linux) |

---

## 9. File Structure

### 9.1 Frontend (src/)

| Path | Role |
|---|---|
| `src/main.tsx` | React entry point |
| `src/App.tsx` | Root app component, routing |
| `src/types.ts` | TypeScript type definitions (ChannelSource, EngineMode, SegmentEntry, etc.) |
| `src/index.css` | Global styles + Tailwind |
| `src/i18n/translations.ts` | Bilingual UI strings (EN/AR) |
| **Components** | |
| `src/components/WorkspaceShell.tsx` | Main workspace layout shell |
| `src/components/Sidebar.tsx` | Navigation sidebar |
| `src/components/StatusBar.tsx` | Bottom status bar (activity + engine status) |
| `src/components/Settings.tsx` | Settings panel |
| `src/components/AiModelsView.tsx` | Models management panel (Ollama + WebLLM) |
| `src/components/ApiKeysView.tsx` | Gemini API key panel (with Test Key button) |
| `src/components/GlossaryView.tsx` | Glossary management panel (JSON import, seed corpora) |
| `src/components/WelcomeWindow.tsx` | Welcome / onboarding window |
| `src/components/WelcomeTab.tsx` | Welcome tab content |
| `src/components/QuickGuideModal.tsx` | Quick guide modal |
| `src/components/OllamaOnboardingModal.tsx` | Ollama setup onboarding (Tauri only, 3-step skippable) |
| `src/components/InstallPWAButton.tsx` | PWA install prompt button |
| `src/components/RdatLogo.tsx` | Logo component |
| **Editors** | |
| `src/components/editors/TranslationWorkspace.tsx` | Main split-pane workspace, segment confirm + save |
| `src/components/editors/SourceEditor.tsx` | Source text editor + .txt/.docx import |
| `src/components/editors/TargetEditor.tsx` | Target editor with the full ghost-text pipeline |
| `src/components/editors/index.ts` | Barrel export |
| **Context** | |
| `src/context/LanguageContext.tsx` | i18n context (EN/AR, RTL switching) |
| `src/context/ToastContext.tsx` | Toast notifications |
| **Hooks** | |
| `src/hooks/useGemini.ts` | Gemini API hook (Tier 2, with retry) |
| `src/hooks/useWebLLM.ts` | WebLLM lifecycle hook |
| `src/hooks/useDualStorage.ts` | IndexedDB read/write hook |
| `src/hooks/useRAG.ts` | RAG corpus loading hook |
| `src/hooks/useLocalAgent.ts` | Local agent hook |
| **Lib (Core Engine)** | |
| `src/lib/llm-adapter.ts` | LLMAdapter interface + `buildRAGSystemPrompt` + `buildUserPrompt` |
| `src/lib/adapters/index.ts` | Adapter factory: `getActiveAdapter`, `getActiveAdapterSync`, `resetAdapter` |
| `src/lib/adapters/ollama-adapter.ts` | `OllamaAdapter` (Tauri) + `isTauriEnvironment` + health diagnostics |
| `src/lib/adapters/web-llm-adapter.ts` | `WebLLMAdapter` (PWA) facade over local-llm-engine |
| `src/lib/local-llm-engine.ts` | WebLLM engine wrapper + MODEL_MAP + prefetch cache |
| `src/lib/local-translation-engine.ts` | LTE (Tier 0): sentence-split / exact / partial / n-gram matching |
| `src/lib/gemini-direct.ts` | Gemini Tauri/PWA dispatcher |
| `src/lib/dual-storage.ts` | IndexedDB layer (openDB, put/get/delete/clear) |
| `src/lib/seed-corpus.ts` | ~80 curated EN-AR seed pairs |
| `src/lib/vercel-warmup.ts` | Vercel function warmup helper |
| `src/lib/utils.ts` | Utilities (cn class merger) |
| **Stores (Zustand)** | |
| `src/stores/workspace-store.ts` | `sourceText`, `targetTexts[]`, `currentSegmentIndex`, `direction` |
| `src/stores/settings-store.ts` | `engineMode`, `geminiApiKey`, `loadedModel` (localStorage-backed) |
| `src/stores/ui-store.ts` | UI state, navigation requests |
| `src/stores/editor-activity-store.ts` | `activity`: idle / typing / suggesting / loading-model |

### 9.2 Tauri Backend (src-tauri/)

| Path | Role |
|---|---|
| `src-tauri/src/main.rs` | Tauri entry point |
| `src-tauri/src/lib.rs` | Tauri library (command registration) |
| `src-tauri/src/commands.rs` | Command module barrel |
| `src-tauri/src/commands/ollama.rs` | `ollama_health`, `ollama_list_models`, `ollama_pull_model`, `ollama_remove_model`, `ollama_translate` |
| `src-tauri/src/commands/gemini.rs` | `gemini_translate` (reqwest to Gemini REST API) |
| `src-tauri/Cargo.toml` | Rust dependencies (reqwest, tokio, serde, futures-util) |
| `src-tauri/tauri.conf.json` | Tauri config (window, bundle, capabilities) |
| `src-tauri/build.rs` | Build script |
| `src-tauri/capabilities/default.json` | Tauri permissions scope |

### 9.3 PWA / Vercel (api/, public/)

| Path | Role |
|---|---|
| `api/translate/burst.ts` | Vercel function: up to 3 ghost-text candidates via Gemini |
| `api/translate/full.ts` | Vercel function: full translation |
| `api/translate/tutor-explain.ts` | Vercel function: AI Translation Tutor |
| `api/_lib/gemini.ts` | Shared `@google/genai` SDK helper |
| `vercel.json` | Vercel config (framework auto-detect, SPA rewrites, no env vars) |
| `server.ts` | Express dev server (Gemini proxy for local PWA dev) |
| `public/sw.js` | Service Worker (network-first nav, cache-first assets) |
| `public/manifest.webmanifest` | PWA Web App Manifest |

### 9.4 Config

| Path | Role |
|---|---|
| `package.json` | npm scripts + dependencies |
| `vite.config.ts` | Vite config |
| `tsconfig.json` | TypeScript config |
| `index.html` | HTML entry |

---

## 10. Translation Direction

### 10.1 Supported Directions

RDAT supports two translation directions, toggled from the editor header:

| Direction | Source | Target | Default |
|---|---|---|---|
| `en-ar` | English | Arabic | Yes |
| `ar-en` | Arabic | English | |

The direction is stored in `workspace-store.ts` as `direction: TranslationDirection` and persists across the session.

### 10.2 Panel Swapping

The `isTargetRTL` flag is derived from direction:

```ts
const isTargetRTL = direction === "en-ar";
// Target is Arabic (RTL) for EN-AR
// Target is English (LTR) for AR-EN
```

This flag controls:
- The `dir` attribute on the target textarea (`rtl` or `ltr`).
- The text alignment (`text-right` for RTL, `text-left` for LTR).
- The placeholder label position (`right-4` for RTL, `left-4` for LTR).
- The ghost-text hint box direction.

The source panel mirrors this: when the target is RTL, the source is LTR, and vice versa.

### 10.3 Prompt Switching

Both shared prompt builders in `src/lib/llm-adapter.ts` accept a `direction` parameter and switch their content accordingly.

**`buildRAGSystemPrompt(ragEntries, direction)`:**
- For `en-ar`: "You are a professional English-to-Arabic translator... Produce Modern Standard Arabic suitable for professional/academic contexts."
- For `ar-en`: "You are a professional Arabic-to-English translator... Produce professional English suitable for academic contexts."
- Both share the same rules: use reference glossary terms preferentially, maintain terminological consistency, output only the translation, no commentary.
- The RAG block format `"en" -> "ar"` is the same in both directions because the corpus is stored as directional pairs.

**`buildUserPrompt(sourceText, targetPrefix, direction)`:**
- Direction-aware labels: "English source" / "Arabic source" and "Arabic translation" / "English translation" so far.
- Direction-aware target language name in the "continue the translation" and "translate to" instructions.

### 10.4 Adapter Integration

The `OllamaAdapter.translate()` method reads direction directly from the workspace store:

```ts
const direction = useWorkspaceStore.getState().direction || "en-ar";
const systemPrompt = buildRAGSystemPrompt(ragEntries, direction);
const userPrompt = buildUserPrompt(sourceText, targetPrefix, direction);
```

This means the adapter does not need to be re-initialized when the user flips direction. The very next inference call picks up the new direction from the store automatically.

### 10.5 Gemini Direction Awareness (Current State)

The Gemini burst endpoint in the Vercel function (`api/translate/burst.ts`) and the Rust `gemini_translate` command currently use EN-AR-oriented prompts. Full AR-EN support across the cloud tier (reverse LTE index, bidirectional Gemini prompts) is on the roadmap. The local LLM tier is fully bidirectional as of v0.2.0.

---

## Appendix A: Key Constants

| Constant | Value | Location | Purpose |
|---|---|---|---|
| `LLM_DEBOUNCE_MS` | 500 | TargetEditor.tsx | Debounce before LLM call |
| `IDLE_PAUSE_MS` | 2000 | TargetEditor.tsx | Idle-pause re-engagement delay |
| `MIN_PREFIX_FOR_LLM` | 3 | TargetEditor.tsx | Minimum chars before LLM is consulted |
| `DEVIATION_THRESHOLD` | 0.6 | TargetEditor.tsx | Edit-distance ratio that triggers re-fetch |
| `PREFETCH_TTL_MS` | 120000 | local-llm-engine.ts | Prefetch cache entry expiry |
| `DEFAULT_OLLAMA_MODEL` | `gemma4:e2b` | ollama-adapter.ts | Auto-selected model for new users |
| `MAX_RETRIES` (Gemini) | 2 | useGemini.ts | Cloud retry attempts |
| IndexedDB name | `rdat_copilot_db` | dual-storage.ts | Database name |
| IndexedDB version | 2 | dual-storage.ts | Schema version |

## Appendix B: Tier Badge Quick Reference

| Tier | Channel | Color | Icon | Label (EN) | Label (AR) |
|---|---|---|---|---|---|
| 0 | `lte` | green | - | LTE | ذاكرة |
| 1 | `local-llm` | blue | Cpu | LLM (+ model name) | محلي |
| 2 | `gemini` | amber | - | GEMINI | سحابي |

## Appendix C: Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Tab` | Accept full ghost-text suggestion |
| `Ctrl + Right` | Accept next word of suggestion |
| `Alt + ]` | Cycle through alternative candidates |
| `Esc` | Dismiss current suggestion |
| `Ctrl + Enter` | Confirm and save segment to IndexedDB |
