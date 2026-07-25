# RDAT: Translation Copilot

**Professional Bidirectional English↔Arabic Computer-Assisted Translation (CAT) Environment**

[![Version](https://img.shields.io/badge/Version-0.3.1-6366f1?logo=semver&logoColor=white)](https://github.com/waleedmandour/rdat/releases/tag/v0.3.1)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.x-FFC131?logo=tauri&logoColor=white)](https://v2.tauri.app)
[![Ollama](https://img.shields.io/badge/Ollama-Local_LLM-22c55e?logo=ollama&logoColor=white)](https://ollama.com)
[![PWA Ready](https://img.shields.io/badge/PWA-Optional-6366f1?logo=pwa&logoColor=white)](https://github.com/waleedmandour/rdat)
[![CI](https://github.com/waleedmandour/rdat/actions/workflows/ci.yml/badge.svg)](https://github.com/waleedmandour/rdat/actions/workflows/ci.yml)

---

## Overview

RDAT: Translation Copilot is an AI-powered translation workspace purpose-built for professional **bidirectional English↔Arabic** translation workflows. It combines a segmented translation editor with a three-tier predictive ghost-text pipeline, from instant corpus lookups and RAG-augmented on-device LLM inference to cloud-based Gemini fallback, delivering real-time suggestions while keeping translators in full control of every word. As of v0.3.1, both EN→AR and AR→EN directions are fully supported end-to-end across all three tiers.

As of v0.3.1, RDAT ships in **two complementary forms**, sharing a single React/Vite frontend:

| Distribution | Best for | Install size | Local LLM |
|---|---|---|---|
| **Tauri Desktop App** (Windows, macOS, Linux) | Daily professional use; fastest inference; full offline | ~15 MB app + ~1.5 GB model | Ollama (PRIMARY) |
| **PWA on Vercel** (browser) | Try-before-install; mobile; locked-down machines | Zero install (browser) | WebLLM via WebGPU (optional) |

The system's primary engine is the **local LLM** (Ollama in desktop mode, WebLLM in browser mode). Gemini 2.5 Flash is a **secondary fallback** for when local tiers yield low confidence, complex passages, or when no local model is available. This local-first architecture ensures data privacy and offline capability: the Local Translation Engine (LTE) and on-device LLM models operate without any network egress, while glossary databases, translation memories, and segment history persist across sessions through IndexedDB.

---

## What's New in v0.3.1

v0.3.1 is a security and reliability release that fixes all 14 issues identified in the comprehensive repository audit. No new features — just hardening.

### Security
- **API key transport** (`src-tauri/src/commands/gemini.rs`): Gemini API key now sent via `x-goog-api-key` header instead of URL query parameter. URL query strings are logged by proxies and OS network diagnostics.
- **API key storage** (`src/stores/settings-store.ts`, `src/components/ApiKeysView.tsx`): key is no longer persisted to localStorage by default. Held in memory only and cleared on app close. Users can opt in to persistence via a new "Remember API key on this device" checkbox. One-time migration wipes any pre-existing key from older versions.
- **Content Security Policy** (`src-tauri/tauri.conf.json`): strict CSP enabled (was `null`). `script-src 'self'` blocks injected scripts; `connect-src` whitelists Ollama + Gemini endpoints; `frame-src 'none'` and `object-src 'none'` block iframes and plugins.
- **Vercel function abuse protection** (`api/_lib/rate-limit.ts`, all 3 endpoints): per-IP rate limiting (30 req/min, 200 req/hour) and input-size caps (10k chars sourceText, 5k chars targetPrefix). Returns 429 with `Retry-After` header on limit exceeded, 413 on oversized input.

### Reliability
- **IndexedDB connection leak** (`src/lib/dual-storage.ts`): `openDB()` now caches a single `IDBDatabase` connection instead of opening a new one per call. Previously, long sessions could exhaust the browser's ~75-connection cap and silently fail all DB operations. The cached connection auto-recovers if unexpectedly closed.
- **React Error Boundary** (`src/components/ErrorBoundary.tsx`, `src/App.tsx`, `src/components/WorkspaceShell.tsx`): top-level + per-panel boundaries catch uncaught render errors and show a fallback UI with "Try again" / "Reload page" buttons. A crash in one panel no longer takes down the whole app.
- **Vercel warmup in Tauri** (`src/main.tsx`): warmup interval now guarded by `isTauriEnvironment()`. Previously, the Tauri desktop app made a useless 404-ing fetch every 4 minutes forever.
- **useGemini retry logic** (`src/lib/gemini-direct.ts`, `src/hooks/useGemini.ts`): errors are now classified as `RetryableError` (network / 5xx / 429) or `FatalError` (4xx). Fatal errors are re-thrown immediately instead of being retried twice — saves API quota and 2s of latency on bad-key / malformed-request errors.

### Data Integrity
- **Segment duplicates** (`src/lib/dual-storage.ts`, `src/components/editors/TranslationWorkspace.tsx`): segments store migrated from autoIncrement-int to deterministic string ids (`"{sourceLang}-{targetLang}-{idx}"`). Re-confirming an edited segment now upserts instead of creating a duplicate. DB schema bumped to v3 with a drop-and-recreate migration (acceptable because old data was full of duplicates anyway).
- **Glossary ID collisions** (`src/components/GlossaryView.tsx`, `src/types.ts`): reference-DB entries now use string ids (`"{dbId}-{idx}"`) instead of hardcoded numeric ranges (10000+/20000+/30000+). JSON-uploaded entries no longer compute client-side `Date.now()+idx` ids — they omit `id` entirely and let IndexedDB autoIncrement. Eliminates the silent-overwrite risk when uploads and reference DBs coexisted.

### Architecture & Configuration
- **Over-permissioned Tauri capabilities** (`src-tauri/capabilities/default.json`): removed unused `dialog:allow-open`, `dialog:allow-save`, `fs:allow-read-text-file`, `fs:allow-write-text-file` permissions. File imports go through the browser's native `<input type=file>`, not the Tauri fs/dialog plugins, so these were unused attack surface.
- **Tauri updater signing** (`src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `.github/workflows/release.yml`): updater plugin re-enabled with a generated signing keypair. Private key stored as `TAURI_SIGNING_PRIVATE_KEY` GitHub Actions secret; public key set in `tauri.conf.json → plugins.updater.pubkey`. Release workflow now signs bundles and uploads `latest.json` so the app can auto-update. (OS-level code signing — Apple Developer ID / Windows cert — still requires paid certificates and is deferred.)
- **Vulnerable dependencies** (`package.json`, `package-lock.json`): `npm audit fix` cleared the high-severity postcss path-traversal advisory and the moderate protobufjs DoS advisory. `npm audit` now reports 0 vulnerabilities.
- **cargo-audit in CI** (`.github/workflows/ci.yml`): the CI workflow now runs `cargo audit --deny warnings` against `src-tauri/Cargo.lock` on every push/PR. Any RUSTSEC advisory in a Rust transitive dependency will fail the build.

### Verification
- `npm run lint`: clean (with `noUnusedLocals`/`noUnusedParameters` strict flags).
- `npm audit`: 0 vulnerabilities.
- `npx vite build`: succeeds (5.96s).
- `scripts/test-bidirectional-lte.ts`: 12/12 pass.
- `scripts/test-phase3-regression.ts`: 30/30 pass.
- Rust source files parse cleanly via `rustfmt --check`.
- All workflow YAML files validate.
- Tauri signing private key registered as GitHub Actions secret.

---

## What's New in v0.3.0

v0.3.0 is a major release that completes the bidirectional translation pipeline, polishes the dark/light theme, and adds GitHub Actions CI/CD with cross-platform Tauri builds.

### Bidirectional Translation (Phase 1)

AR→EN translation now works end-to-end across all three tiers — previously it only worked on the Tauri+Ollama path; every other tier silently hardcoded an EN→AR assumption.

- **Tier 0 (LTE)**: bidirectional `enIndex` + `arIndex` built in `load()`; `getSuggestion()` / `search()` take a `direction` parameter. Arabic sentence-splitting now recognises the Arabic question mark `؟` (U+061F) and Arabic-letter lookahead.
- **Tier 1 (Local LLM)**: `generateLocalTranslation()` / `generateRAGTranslation()` / `prefetchTranslation()` accept a `direction` parameter and call the shared `buildRAGSystemPrompt()` / `buildUserPrompt()` from `llm-adapter.ts`. The duplicated hardcoded prompts that caused the original bug are deleted.
- **Tier 2 (Gemini)**: `GeminiBurstRequest` / `GeminiFullRequest` / `GeminiTutorRequest` accept an optional `direction` field. New shared `api/_lib/prompts.ts` keeps PWA and Tauri prompt builders in sync.
- **AI Translation Tutor**: prompt now labels the source/target correctly for AR→EN attempts ("Arabic Source" / "English Translation Attempt") instead of always saying "English Source" / "Arabic Translation Attempt".
- **Segment persistence**: `source_lang` / `target_lang` derived from active direction on save.
- **Editor UI**: Source panel header, language tag, placeholder, and textarea direction all flip with direction. Target panel's speech-synthesis locale switches to `en-US` in AR→EN mode.

### Glossary UX (Phase 2)

- **"Download" → "Use" with persistence**: downloaded reference DBs are tracked in IndexedDB `sync_meta`, so the button label survives page reloads. "Use" is a toggle — clicking it removes that DB's entries.
- **Inline editing**: every glossary entry, regardless of source (manual, JSON upload, or reference DB), can be edited in place via a Pencil icon next to the existing Trash2. Edits trigger an LTE rebuild so ghost-text reflects the change immediately.
- **Dark-mode fixes**: 15 hardcoded `bg-[#0A0B0E]` / `dark:bg-[#0F1116]` patterns replaced with `bg-background` / `bg-surface` tokens across TranslationWorkspace, SourceEditor, TargetEditor, WelcomeTab, GlossaryView, QuickGuideModal. Toasts converted from always-dark to theme-aware `bg-surface` / `text-foreground`.

### Regression Sweep + Lint Hardening (Phase 3)

- **AI Tutor prompt**: direction-aware (see above).
- **Data model**: manual Add-Term and JSON-upload paths now derive `source_lang` / `target_lang` from active direction (with JSON honouring explicit per-row fields if present).
- **TypeScript strictness**: `noUnusedLocals` + `noUnusedParameters` now enabled in `tsconfig.json` so the existing `npm run lint` catches dead imports going forward. The Phase 1 dead-import root cause was "no lint rule was on at all" — that gap is now closed. All 30 pre-existing unused-var errors cleaned up.
- **README**: comprehensive Project Structure section added; stale "AR→EN pipeline future enhancement" line removed from Roadmap.

### CI/CD (new in v0.3.0)

- **`.github/workflows/ci.yml`**: runs on every push/PR — TypeScript strict lint, Phase 1 LTE smoke test (12/12), Phase 3 regression sweep (30/30), Vite production build.
- **`.github/workflows/release.yml`**: triggered by pushing a `v*` tag — builds Tauri installers in parallel for Windows (.exe NSIS), macOS Apple Silicon (.dmg), macOS Intel (.dmg), and Linux (.deb / .rpm / .AppImage). All four platform installers attach to the GitHub release automatically.

### Smoke Tests

Two offline smoke-test scripts ship in `scripts/`:

```
npx tsx scripts/test-bidirectional-lte.ts   # Phase 1 — 12 tests
npx tsx scripts/test-phase3-regression.ts   # Phase 3 — 30 tests
```

Both pass clean. Run them after any change to the LTE, prompt builders, or direction wiring.

---

## Architecture

### Three-Tier Ghost-Text Pipeline

RDAT's suggestion engine operates through a cascading three-tier pipeline. Each tier is consulted in order; the first tier to return a confident result supplies the ghost-text. If a higher-latency tier is already computing, its result replaces the current suggestion upon arrival, enabling progressive refinement without blocking the translator's flow.

```
+-----------------------------------------------------------------+
|                    Ghost-Text Pipeline                          |
|                                                                 |
|  Tier 0 - LTE (Local Translation Engine)                       |
|    |  N-gram / fuzzy / sentence-split matching against corpus  |
|    |  Latency: < 5 ms  |  Channel: lte                        |
|    |                                                            |
|  Tier 1 - Local LLM (PRIMARY ENGINE)                           |
|    |  RAG-augmented inference with selective glossary context  |
|    |  Tauri:  Ollama (native CUDA/Metal, gemma4:e2b default)   |
|    |  PWA:    WebLLM (WebGPU, q4f16_1 quantization)            |
|    |  Latency: 200-2000 ms  |  Channel: local-llm              |
|    |                                                            |
|  Tier 2 - Cloud Gemini (SECONDARY FALLBACK)                    |
|       Tauri:  Rust-side reqwest proxy to Gemini REST API       |
|       PWA:    Vercel serverless functions to @google/genai SDK |
|       Latency: 500-3000 ms  |  Channel: gemini                |
|       Supports burst (3 candidates) and full translation       |
+-----------------------------------------------------------------+
```

### Continuous Assistance (v0.2.0)

The ghost-text pipeline now features **idle-pause re-engagement**: after the translator stops typing for 2 seconds, the system automatically re-triggers the suggestion pipeline to provide fresh or updated suggestions during thinking pauses. This means the system never "gives up" after a single suggestion. It keeps trying while the translator pauses, similar to how Google Search autocomplete continues to refine results as you think.

### LLMAdapter Abstraction

Both local backends (Ollama and WebLLM) implement a unified `LLMAdapter` interface (`src/lib/llm-adapter.ts`), so the rest of the application, including the editor, status bar, and tier-fallback logic, works identically regardless of which backend is active. The adapter factory (`src/lib/adapters/index.ts`) auto-detects the environment at runtime:

1. **Inside Tauri + Ollama daemon reachable** -> `OllamaAdapter` (preferred: native CUDA/Metal acceleration, supports Gemma 4 / Qwen 3 / Llama 4). If Ollama is not detected on the first attempt, the factory waits 3 seconds and retries once to handle cold-start races.
2. **Else if WebGPU available** -> `WebLLMAdapter` (browser path only; skipped in Tauri mode since WebGPU in Tauri's webview is unreliable)
3. **Else** -> `null` (Gemini-only mode; the editor surfaces an amber hint guiding the user to install Ollama)

### Engine Modes

Three translation pipeline modes are available, selectable via the Models panel:

| Mode | Tier(s) Active | Best For |
|------|---------------|----------|
| **Hybrid** (Recommended) | LTE + Local LLM + Cloud Gemini | Maximum suggestion quality with graceful fallback |
| **Local** | LTE + Local LLM only | Zero data egress, full offline operation, privacy-sensitive environments |
| **Cloud** | Gemini API only | Complex passages requiring cloud-scale reasoning, or when no local model is available |

### Translation Direction

A direction toggle at the top of the editor lets you switch between **EN to AR** (English to Arabic, default) and **AR to EN** (Arabic to English). The direction is stored in the workspace state and persists across sessions.

---

## Key Features

### Segmented Translation Editor

A split-pane interface with synchronized source-target segment display. Source text is automatically segmented into logical sentences, each paired with a dedicated translation input field featuring RTL text direction, pronunciation playback via the Web Speech API, and a segment-level confirmation workflow. Segment focus triggers prefetching for zero-latency ghost-text on first keystroke.

### Ghost-Text Predictive Completions

Inline ghost-text suggestions appear in real time as translators type. The pipeline uses three trigger mechanisms:
- **Segment focus**: immediate prefetch + suggestion
- **Typing debounce**: 400 ms after the last keystroke
- **Idle-pause re-engagement**: 2 seconds after typing stops, the system re-triggers suggestions to provide continuous assistance during thinking pauses

Suggestions can be accepted with `Tab` (full), `Ctrl+Right` (word-by-word), or cycled with `Alt+]`. A **tier-source badge** next to each suggestion shows which tier produced it: green `LTE`, blue `local-llm` (with model name), or amber `GEMINI`.

### Status Bar Activity Indicators

The status bar shows the current editor activity in real time:
- **"Typing..."** (blue) while the user is typing
- **"Suggesting..."** (indigo, with spinner) while fetching suggestions
- **"Ready"** (muted) when idle
- **Engine status**: shows "Ollama: gemma4:e2b" (green) when a model is loaded, or "Ollama: no model loaded (go to Models)" (amber) when guidance is needed

### RAG-Augmented Local LLM (Primary Engine)

The local LLM is enhanced with Retrieval-Augmented Generation (RAG). Before inference, the system retrieves the top-*k* most relevant glossary/translation memory entries from the LTE and injects them into a structured system prompt that enforces terminological consistency. This means local-LLM translations respect your loaded domain vocabulary: they are not generic LLM output but glossary-aware, context-conditioned suggestions that improve as your corpus grows.

### Tier-Source Error Surfacing

When a tier fails, the editor surfaces a precise, actionable diagnostic instead of silently swallowing the error:
- **Tier 1 (local LLM) failures**: amber inline hint with a "Load Local Model" button that jumps to the Models panel
- **Tier 2 (Gemini) failures**: quiet gray inline hint with a "Set Gemini API Key" button
- **Health diagnostics**: when Ollama is not detected, the UI shows exactly which URLs were tried and which errors occurred, making remote diagnosis possible from a screenshot
- A per-session toast dedup prevents spamming the same error on every keystroke

### GTR Glossary and Terminology Management

A dedicated terminology management system supporting JSON file import, pre-loaded reference databases (WIPO Pearl Patent Terminology, Microsoft Tech Terminology, OPUS Parallel Corpus), and chunked IndexedDB storage. Loaded glossary entries are indexed into the LTE for instant matching and also serve as RAG context for the local LLM tier. The system ships with a built-in seed corpus of approximately 80 professionally curated EN-AR pairs spanning CAT terminology, technology, professional phrases, academic research, business, and legal domains.

### Document Import (.txt and .docx)

The Source Editor supports importing documents in two formats:
- **.txt**: plain text files, read directly
- **.docx**: Microsoft Word documents, text extracted via the `mammoth` library (dynamically imported, code-split to avoid bloating the main bundle)
- **.doc**: legacy binary format is not supported in the browser; users are prompted to convert to .docx or .txt

### AI Translation Tutor

An interactive pedagogical panel that evaluates active translation drafts. Powered by Gemini with structured JSON output, it provides a numerical rating (0-100), letter grade, detailed stylistic and grammatical analysis, per-term terminology coaching with contextual fit assessment, and common translation pitfall warnings. When offline or without an API key, a built-in local pedagogical engine provides fallback diagnostics.

### Segment Save with Feedback

The Confirm button (Ctrl+Enter) saves the current segment to IndexedDB and provides clear toast feedback:
- Success: "Segment N saved successfully"
- Warning: "Cannot save an empty segment. Please write a translation first."
- Error: "Failed to save segment: \<error details\>"

### Ollama Onboarding (Tauri only)

On first run in Tauri mode, if the Ollama daemon is not detected, a 3-step skippable onboarding modal guides the user through: (1) downloading Ollama from ollama.com, (2) starting the daemon (platform-specific instructions), and (3) verifying the connection. Users can skip and continue in degraded LTE-only mode. The app respects user agency and never blocks the editor.

### Ollama Detection Hardening (v0.2.0)

The Ollama detection pipeline has been hardened against common field-reported issues:
- **Proxy bypass**: all Ollama HTTP calls use `.no_proxy()` so corporate VPNs and security software do not intercept loopback traffic
- **IPv4 explicit**: uses `127.0.0.1` instead of `localhost` to avoid Windows IPv6 `::1` resolution issues
- **Multi-URL fallback**: tries `OLLAMA_HOST` env var, `127.0.0.1:11434`, then `localhost:11434`
- **OLLAMA_HOST normalization**: handles bare `host:port`, full URLs, and bare hosts without ports
- **Cold-start auto-retry**: if Ollama is not detected on the first attempt, waits 3 seconds and retries once
- **Structured diagnostics**: the UI shows which URLs were tried and which errors occurred

### PWA and Offline Support (browser mode)

When deployed as a PWA on Vercel, RDAT is a fully installable Progressive Web App. It includes a Web App Manifest with standalone display mode, a Service Worker with network-first navigation and cache-first static asset strategy, IndexedDB-based offline storage, and a native install prompt via the `beforeinstallprompt` event on supported browsers.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI Framework | React 19 + Vite 6 |
| Styling | Tailwind CSS 4 with CSS custom properties for theming |
| State Management | Zustand 5 |
| Animations | Motion (Framer Motion) |
| Icons | Lucide React |
| **Desktop Shell** | **Tauri 2.11.x** (Rust backend with reqwest, tokio, serde) |
| **Primary Local LLM** | **Ollama** (Gemma 4 E2B default; Qwen 3, Llama 4 also supported) |
| Browser Local LLM | `@mlc-ai/web-llm` (WebGPU-accelerated, fallback when no Ollama) |
| Cloud AI | Google Gemini 2.5 Flash |
| Cloud Proxy (Tauri) | Rust `gemini_translate` command via reqwest to Gemini REST API |
| Cloud Proxy (PWA) | Vercel Serverless Functions (Node.js 22.x runtime) to `@google/genai` SDK |
| Document Import | `mammoth` (DOCX text extraction, dynamically imported) |
| Local Development | Express.js (Gemini API proxy) via `tsx` |
| Storage | IndexedDB (custom dual-storage layer with chunked read/write) |
| PWA (optional) | Service Worker + Web App Manifest |
| Language | TypeScript 5.8 |

---

## Project Structure

```
rdat/
├── api/                              # Vercel serverless functions (PWA-mode cloud tier)
│   ├── _lib/
│   │   ├── gemini.ts                 # Lazy-init @google/genai SDK; user-key or env-var
│   │   └── prompts.ts                # Direction-aware prompt builders (burst / full / tutor)
│   └── translate/
│       ├── burst.ts                  # /api/translate/burst  — 3-candidate ghost-text suggestions
│       ├── full.ts                   # /api/translate/full   — single full translation
│       └── tutor-explain.ts          # /api/translate/tutor-explain — pedagogical feedback (JSON)
│
├── src/
│   ├── components/
│   │   ├── editors/
│   │   │   ├── TranslationWorkspace.tsx  # Top-level editor: direction toggle, source/target/tutor layout
│   │   │   ├── SourceEditor.tsx          # Source panel: import (.txt/.docx), segment list, direction-aware labels
│   │   │   ├── TargetEditor.tsx          # Target panel: ghost-text rendering, tier fallback, inline pronunciation
│   │   │   └── index.ts
│   │   ├── AiModelsView.tsx              # Models panel: Ollama + WebLLM catalog, pull/load/uninstall
│   │   ├── ApiKeysView.tsx               # API Keys panel: Gemini key entry + cloud-fallback toggle
│   │   ├── GlossaryView.tsx              # Glossary panel: add/edit/delete, JSON upload, reference-DB download/use
│   │   ├── InstallPWAButton.tsx          # PWA install prompt (beforeinstallprompt event)
│   │   ├── OllamaOnboardingModal.tsx     # 3-step skippable Ollama setup modal (Tauri only, first run)
│   │   ├── QuickGuideModal.tsx           # Keyboard-shortcut reference modal
│   │   ├── RdatLogo.tsx                  # Inline SVG logo component
│   │   ├── Settings.tsx                  # Settings panel: UI language, LTE confidence, danger zone
│   │   ├── Sidebar.tsx                   # Left nav rail: translator / glossary / models / api-keys / settings
│   │   ├── StatusBar.tsx                 # Bottom status bar: engine, activity, segment count, network
│   │   ├── WelcomeTab.tsx                # In-app welcome/dashboard tab (shown after onboarding)
│   │   ├── WelcomeWindow.tsx             # First-launch 3-page onboarding splash (always-dark by design)
│   │   └── WorkspaceShell.tsx            # App shell: theme toggle, sidebar, route switching, status bar
│   │
│   ├── context/
│   │   ├── LanguageContext.tsx           # i18n provider (EN/AR locale + t() helper)
│   │   └── ToastContext.tsx              # Toast notification provider (theme-aware, type-coloured borders)
│   │
│   ├── hooks/
│   │   ├── useDualStorage.ts             # IndexedDB CRUD + LTE rebuild + reference-DB download-state
│   │   ├── useGemini.ts                  # Cloud Gemini hook: burst / full / tutor with retry+backoff
│   │   ├── useLocalAgent.ts              # Local-agent state hook (legacy, retained for compatibility)
│   │   ├── useRAG.ts                     # RAG state hook: LTE corpus stats + lteSearch helper
│   │   └── useWebLLM.ts                  # WebLLM lifecycle hook (load/unload/progress)
│   │
│   ├── lib/
│   │   ├── adapters/
│   │   │   ├── index.ts                  # Adapter factory: auto-detects Tauri+Ollama vs WebGPU vs null
│   │   │   ├── ollama-adapter.ts         # OllamaAdapter — Tauri Rust proxy to localhost:11434
│   │   │   └── web-llm-adapter.ts        # WebLLMAdapter — @mlc-ai/web-llm via WebGPU (PWA fallback)
│   │   ├── dual-storage.ts               # IndexedDB layer: openDB, put/get/delete, chunked import, sync_meta
│   │   ├── gemini-direct.ts              # Gemini dispatcher: Tauri invoke vs Vercel fetch; direction-aware prompts
│   │   ├── llm-adapter.ts                # LLMAdapter interface + shared buildRAGSystemPrompt / buildUserPrompt
│   │   ├── local-llm-engine.ts           # WebLLM engine wrapper: load/unload, RAG inference, prefetch cache
│   │   ├── local-translation-engine.ts   # LTE: bidirectional en/ar indexes, n-gram + sentence-split matching
│   │   ├── seed-corpus.ts                # ~85-entry EN→AR starter corpus (TODO: source a licensed multi-k dict)
│   │   ├── utils.ts                      # cn() classname merge helper
│   │   └── vercel-warmup.ts              # Pre-warms Vercel serverless functions on app boot
│   │
│   ├── stores/
│   │   ├── editor-activity-store.ts      # Zustand: typing / suggesting / loading-model / idle (drives status bar)
│   │   ├── settings-store.ts             # Zustand: engineMode, useCloudFallback, loadedModel, geminiApiKey, theme
│   │   ├── ui-store.ts                   # Zustand: requestNav() for programmatic panel switches
│   │   └── workspace-store.ts            # Zustand: sourceText, targetTexts, currentSegmentIndex, direction
│   │
│   ├── i18n/
│   │   └── translations.ts               # EN/AR string tables for every UI label
│   │
│   ├── App.tsx                           # Root: theme bootstrap, WelcomeWindow gate, WorkspaceShell mount
│   ├── main.tsx                          # React entry point
│   ├── types.ts                          # Shared TS types (GlossaryEntry, SegmentEntry, TMEntry, etc.)
│   └── index.css                         # Tailwind 4 theme tokens: --bg-color / --fg-color / --surface-color / .dark
│
├── src-tauri/                             # Tauri 2 Rust backend (desktop app)
│   ├── src/
│   │   ├── main.rs                        # Tauri entry point
│   │   ├── lib.rs                         # Plugin registration + command registration
│   │   ├── commands.rs                    # Command dispatcher
│   │   └── commands/
│   │       ├── ollama.rs                  # ollama_health / ollama_list_models / ollama_pull_model / ollama_translate
│   │       └── gemini.rs                  # gemini_translate (reqwest proxy to Gemini REST API)
│   ├── capabilities/default.json          # Tauri 2 capability manifest (CSP, allowed commands)
│   ├── Cargo.toml                         # Rust dependencies (tauri, reqwest, tokio, serde)
│   └── tauri.conf.json                    # Tauri config: app identity, window, bundle targets
│
├── public/                                # Static assets served as-is
│   ├── manifest.webmanifest               # PWA manifest
│   ├── sw.js                              # Service Worker (network-first nav, cache-first assets)
│   └── *.png                              # PWA icons (192/512/maskable/source-1024)
│
├── docs/                                  # User guide (PDF + HTML, EN + AR)
├── scripts/                               # Offline smoke tests (bidirectional LTE, IndexedDB persistence)
├── server.ts                              # Local dev server: Express + Vite HMR + Gemini proxy
├── vite.config.ts                         # Vite config (React plugin, Tailwind 4 plugin, alias)
├── vercel.json                            # Vercel deployment config (API routes + SPA rewrite)
├── tsconfig.json                          # TS config (strict, noUnusedLocals/Parameters)
└── package.json                           # Scripts: dev / build / lint / tauri:dev / tauri:build
```

### Key Subsystems

#### Three-Tier Ghost-Text Pipeline

| Tier | File(s) | Role |
|------|---------|------|
| **Tier 0 — LTE** | `src/lib/local-translation-engine.ts` | Instant (<5 ms) corpus lookup. Bidirectional `enIndex` + `arIndex`; n-gram + sentence-split fallback. |
| **Tier 1 — Local LLM** | `src/lib/llm-adapter.ts`, `src/lib/adapters/`, `src/lib/local-llm-engine.ts` | RAG-augmented on-device inference. OllamaAdapter (Tauri) or WebLLMAdapter (PWA); shared `buildRAGSystemPrompt` / `buildUserPrompt` so both backends use identical direction-aware prompts. |
| **Tier 2 — Cloud Gemini** | `src/lib/gemini-direct.ts`, `api/translate/*.ts` | Cloud fallback. Direction-aware prompt builders in `api/_lib/prompts.ts` are shared between the Vercel functions and the Tauri Rust proxy path. |

#### State Management

| Store | File | Responsibility |
|-------|------|----------------|
| `useWorkspaceStore` | `src/stores/workspace-store.ts` | Source text, target texts, current segment index, **translation direction** (en-ar / ar-en) |
| `useSettingsStore` | `src/stores/settings-store.ts` | Engine mode (hybrid/local/cloud), cloud-fallback flag, loaded model ID, Gemini API key, **theme** |
| `useUIStore` | `src/stores/ui-store.ts` | Programmatic panel navigation (`requestNav("models")` etc.) |
| `useEditorActivityStore` | `src/stores/editor-activity-store.ts` | Editor activity state for the status-bar indicator (typing / suggesting / loading-model / idle) |

#### Persistence Layer

| Layer | File | Storage | Notes |
|-------|------|---------|-------|
| Glossary | `src/lib/dual-storage.ts` (glossary store) | IndexedDB | Chunked import; supports `source_db` tag for reference-DB grouping; `updateGlossary` for inline edit |
| Segments | `src/lib/dual-storage.ts` (segments store) | IndexedDB | Confirmed translations; `source_lang`/`target_lang` derived from active direction |
| Translation Memory | `src/lib/dual-storage.ts` (tm_entries store) | IndexedDB | Reserved for future TM reuse |
| Reference-DB state | `src/lib/dual-storage.ts` (sync_meta store, key `downloaded_reference_dbs`) | IndexedDB | Persists "Use" vs "Download" label across reloads |
| Settings | `src/stores/settings-store.ts` | localStorage | Engine mode, API key, theme |
| Onboarding seen | `src/components/WelcomeWindow.tsx` (localStorage key `rdat_welcome_seen`) | localStorage | First-launch gate |

---

### Supported Local Models

#### Ollama Catalog (Tauri: Primary)

| Tag | Model | Parameters | Approx. Size | Notes |
|-----|-------|-----------|-------------|-------|
| `gemma4:e2b` | **Gemma 4 E2B** (recommended starter) | 2B (Effective) | ~1.5 GB | Auto-selected default for new users |
| `gemma4:e4b` | Gemma 4 E4B | 4B (Effective) | ~3.0 GB | Higher quality, 2x download |
| `qwen3:1.7b` | Qwen 3 1.7B | 1.7B | ~1.1 GB | Fast multilingual |
| `qwen3:4b` | Qwen 3 4B | 4B | ~2.5 GB | Balanced |
| `llama4:8b` | Llama 4 8B | 8B | ~4.9 GB | Heavyweight |

#### WebLLM Catalog (PWA: Fallback when no Ollama)

| Catalog ID | Model | Parameters | Quantization | Approx. Size |
|------------|-------|-----------|-------------|-------------|
| `qwen-1.5b` | Qwen 2.5 1.5B Instruct | 1.5B | q4f16_1 | ~1 GB |
| `gemma-2b` | Gemma 2 2B IT | 2B | q4f16_1 | ~1.4 GB |
| `qwen-7b` | Qwen 2.5 7B Instruct | 7B | q4f16_1 | ~4 GB |
| `gemma-7b` | Gemma 2 9B IT | 9B | q4f16_1 | ~5 GB |
| `llama3-8b` | Llama 3.1 8B Instruct | 8B | q4f16_1 | ~4.5 GB |

> **Note:** WebLLM's catalog lags behind Ollama's. For the latest models (Gemma 4, Qwen 3, Llama 4), use the Tauri desktop app with Ollama.

---

## Getting Started

### Option A: Tauri Desktop App (Recommended for daily use)

#### Prerequisites

- **Node.js** 22+ and **npm**
- **Rust toolchain**: install via [rustup.rs](https://rustup.rs/) (Rust 1.77+)
- **Tauri 2 system prerequisites**: see [v2.tauri.app/prerequisites](https://v2.tauri.app/start/prerequisites/)
  - **Windows**: Microsoft Visual Studio C++ Build Tools
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Linux**: `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`
- **[Ollama](https://ollama.com/download)**: the local LLM daemon

#### Setup

```bash
git clone https://github.com/waleedmandour/rdat.git
cd rdat
git checkout feature/tauri-ollama-scaffold
npm install

# Generate Tauri icons from the source icon (one-time)
npm run tauri:icon

# Start Tauri dev mode (boots Rust backend + Vite dev server + native window)
npm run tauri:dev
# First run takes 5-10 min to compile Rust dependencies
```

On first launch, if Ollama is not running, the onboarding modal will guide you through installation. Once Ollama is running:

1. Open the **Models** panel
2. Click **Pull** on `gemma4:e2b` (recommended starter, ~1.5 GB download)
3. After the pull completes, click **Load**
4. Start translating. Ghost-text suggestions will appear with a blue `GEMMA4:E2B` badge.

#### Production Build

**Windows (use NSIS to avoid WiX path issues):**
```powershell
npm run tauri:build -- --bundles nsis
# Output: src-tauri\target\release\bundle\nsis\RDAT Copilot_0.3.1_x64-setup.exe
```

**macOS:**
```bash
npm run tauri:build
# Output: src-tauri/target/release/bundle/dmg/RDAT Copilot_0.3.1_aarch64.dmg
```

**Linux:**
```bash
npm run tauri:build
# Output: src-tauri/target/release/bundle/ (.deb, .rpm, .AppImage)
```

> **Windows note:** Do NOT build in `C:\Windows\System32\`. Use your user folder instead (e.g. `C:\Users\YourName\rdat`). Always include `-- --bundles nsis` to skip the WiX/MSI bundler which fails on usernames with spaces.

### Option B: PWA on Vercel (Try before install)

#### Prerequisites

- **Node.js** 22+ and **npm**
- **WebGPU-compatible browser** (Chrome 113+, Edge 113+) for on-device LLM inference in the browser
- **Google Gemini API key** (optional, for cloud fallback): obtain from [Google AI Studio](https://aistudio.google.com/apikey)

#### Setup

```bash
git clone https://github.com/waleedmandour/rdat.git
cd rdat
npm install

# For local dev (optional .env for dev-only key fallback):
echo "GEMINI_API_KEY=your-key-here" > .env

npm run dev
# Launches Express + Vite HMR at http://localhost:3000
```

#### Deploy to Vercel

The repository includes a `vercel.json` configuration. Connect the GitHub repository to Vercel and it will auto-deploy. **No environment variables are required**: the app uses a user-owned-key model where each user enters their own Gemini API key in the app's API Keys panel.

- **Framework:** Vite (auto-detected)
- **API routes:** Files under `api/**/*.ts` are deployed as serverless functions (Node.js 22.x runtime)
- **Environment variables:** None required (user-owned-key model)
- **SPA routing:** All non-API routes are rewritten to `index.html`

---

## Gemini API Key (User-Owned Model)

RDAT uses a **user-owned-key** model for Gemini access. Each user enters their own API key in the app's **API Keys** panel. The key is stored in the browser's localStorage and sent with each request. No keys are stored server-side.

- **In Tauri mode:** keys are sent to the Rust backend, which calls the Gemini REST API via `reqwest`. This avoids CORS issues and works with Google's post-June-19-2026 API key restrictions.
- **In PWA mode:** keys are sent to the Vercel serverless functions, which use the `@google/genai` SDK to call Gemini.

Get a free key from [Google AI Studio](https://aistudio.google.com/apikey). The API Keys panel includes a **Test Key** button that verifies the key works by performing a test translation.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Tab` | Accept full ghost-text suggestion |
| `Ctrl + Right` | Accept next word of suggestion |
| `Alt + ]` | Cycle through alternative candidates |
| `Esc` | Dismiss current suggestion |
| `Ctrl + Enter` | Confirm and save segment |

---

## Internationalization

RDAT supports full bilingual UI (English/Arabic) with automatic RTL layout switching. All interface elements (labels, placeholder text, contextual hints, and navigation) adapt to the selected language. The AI Translation Tutor can provide feedback in either English or Arabic depending on the active locale. Switch between EN/AR using the sidebar language toggle.

---

## Documentation

A comprehensive user guide is available as a PDF in the `docs/` directory:

- **[RDAT: Translation Copilot v0.2.0 User Guide (PDF)](docs/RDAT-Translation-Copilot-v0.2.0-User-Guide.pdf)** (6 pages, covers installation, translation workflow, tier system, troubleshooting, and more)
- [HTML source](docs/RDAT-Translation-Copilot-v0.2.0-User-Guide.html) (editable)

The guide is also attached as a downloadable asset on the [v0.2.0 release page](https://github.com/waleedmandour/rdat/releases/tag/v0.2.0).

For architectural details, adapter patterns, and migration notes, see [TAURI-MIGRATION.md](TAURI-MIGRATION.md).

---

## Roadmap

- **Streaming inference**: Streaming token generation for both Ollama and WebLLM to reduce time-to-first-token below 800 ms.
- **Context window expansion**: Pass previous/next segment source to the LLM for terminological consistency across segments.
- **Comprehensive EN↔AR dictionary**: The current seed corpus is ~85 hand-picked entries. Source a licensed multi-thousand-entry bidirectional dictionary dataset and ship it as a lazy-loaded JSON asset so Tier 0 (LTE) suggestions become genuinely comprehensive in both directions.
- **CI matrix for cross-platform builds**: GitHub Actions for Windows, macOS, and Linux installer production.
- **Updater signing**: Generate a Tauri updater keypair and host signed manifests on GitHub Releases.
- **Bundle Ollama in installer**: Eliminate the separate Ollama install step by bundling the daemon via `externalBin`.
- **IndexedDB migration between PWA and Tauri**: Add an explicit in-app export/import shortcut for glossary data.
- **LTE scale-up**: The current "rebuild the whole in-memory index on every mutation" approach (deferred via `queueMicrotask` since Phase 1) should be load-tested with a multi-thousand-entry corpus; if it janks, move the rebuild into a Web Worker.

---

## Citation

If you use RDAT: Translation Copilot in academic work, please cite:

> Mandour, W. (2026). *RDAT: Translation Copilot (Version 0.3.1)* [Computer software]. Zenodo. https://doi.org/10.5281/zenodo.21256765

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

```
MIT License
Copyright (c) 2026 Dr. Waleed Mandour
```

---

## Acknowledgements

**Developed by Dr. Waleed Mandour**, Assistant Lecturer at Sultan Qaboos University, Oman.

This tool supports academic researchers and professional translators working with English-Arabic bilingual corpora.

- Email: [w.abumandour@squ.edu.om](mailto:w.abumandour@squ.edu.om)
- Website: [waleedmandour.org](https://waleedmandour.org)
- ORCID: [0000-0002-9262-5993](https://orcid.org/0000-0002-9262-5993)
- Repository: [github.com/waleedmandour/rdat](https://github.com/waleedmandour/rdat)

The development of RDAT: Translation Copilot has been performed with the assistance of multi-AI agents. The primary AI assistant used throughout the development lifecycle was **GLM 5.2** (2026) by Z.ai, which was used for code generation, architectural analysis, debugging, documentation, and visual design. Additional AI agents were consulted for code review, research synthesis, and cross-platform testing guidance.

---

Built with &#10084;&#65039; to the Academic Community
