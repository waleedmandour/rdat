# RDAT Copilot

**Professional English-to-Arabic Computer-Assisted Translation (CAT) Environment**

[![Version](https://img.shields.io/badge/Version-0.2.0_Pre--release-6366f1?logo=semver&logoColor=white)](https://github.com/waleedmandour/rdat/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.x-FFC131?logo=tauri&logoColor=white)](https://v2.tauri.app)
[![Ollama](https://img.shields.io/badge/Ollama-Local_LLM-22c55e?logo=ollama&logoColor=white)](https://ollama.com)
[![PWA Ready](https://img.shields.io/badge/PWA-Optional-6366f1?logo=pwa&logoColor=white)](https://github.com/waleedmandour/rdat)

---

## Overview

RDAT Copilot is an AI-powered translation workspace purpose-built for professional English-to-Arabic translation workflows. It combines a segmented translation editor with a three-tier predictive ghost-text pipeline — from instant corpus lookups and RAG-augmented on-device LLM inference to cloud-based Gemini fallback — delivering real-time suggestions while keeping translators in full control of every word.

As of v0.2.0, RDAT Copilot ships in **two complementary forms**, sharing a single React/Vite frontend:

| Distribution | Best for | Install size | Local LLM |
|---|---|---|---|
| **Tauri Desktop App** (Windows, macOS, Linux) | Daily professional use; fastest inference; full offline | ~15 MB app + ~1.5 GB model | Ollama (PRIMARY) |
| **PWA on Vercel** (browser) | Try-before-install; mobile; locked-down machines | Zero install (browser) | WebLLM via WebGPU (optional) |

The system's primary engine is the **local LLM** (Ollama in desktop mode, WebLLM in browser mode). Gemini 2.5 Flash is a **secondary fallback** for when local tiers yield low confidence, complex passages, or when no local model is available. This local-first architecture ensures data privacy and offline capability: the Local Translation Engine (LTE) and on-device LLM models operate without any network egress, while glossary databases, translation memories, and segment history persist across sessions through IndexedDB.

---

## Architecture

### Three-Tier Ghost-Text Pipeline

RDAT Copilot's suggestion engine operates through a cascading three-tier pipeline. Each tier is consulted in order; the first tier to return a confident result supplies the ghost-text. If a higher-latency tier is already computing, its result replaces the current suggestion upon arrival, enabling progressive refinement without blocking the translator's flow.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Ghost-Text Pipeline                          │
│                                                                 │
│  Tier 0 ─ LTE (Local Translation Engine)                       │
│    │  N-gram / fuzzy / sentence-split matching against corpus  │
│    │  Latency: < 5 ms  |  Channel: lte                        │
│    │                                                            │
│  Tier 1 ─ Local LLM (PRIMARY ENGINE)                           │
│    │  RAG-augmented inference with selective glossary context  │
│    │  Tauri:  Ollama (native CUDA/Metal, gemma4:e2b default)   │
│    │  PWA:    WebLLM (WebGPU, q4f16_1 quantization)            │
│    │  Latency: 200–2000 ms  |  Channel: local-llm              │
│    │                                                            │
│  Tier 2 ─ Cloud Gemini (SECONDARY FALLBACK)                    │
│       Tauri:  Rust-side reqwest proxy → Gemini REST API        │
│       PWA:    Vercel serverless functions → @google/genai SDK  │
│       Latency: 500–3000 ms  |  Channel: gemini                │
│       Supports burst (3 candidates) and full translation       │
└─────────────────────────────────────────────────────────────────┘
```

### LLMAdapter Abstraction

Both local backends (Ollama and WebLLM) implement a unified `LLMAdapter` interface (`src/lib/llm-adapter.ts`), so the rest of the application — including the editor, status bar, and tier-fallback logic — works identically regardless of which backend is active. The adapter factory (`src/lib/adapters/index.ts`) auto-detects the environment at runtime:

1. **Inside Tauri + Ollama daemon reachable** → `OllamaAdapter` (preferred: native CUDA/Metal acceleration, supports Gemma 4 / Qwen 3 / Llama 4)
2. **Else if WebGPU available** → `WebLLMAdapter` (browser path, or Tauri fallback when Ollama is not installed)
3. **Else** → `null` (Gemini-only mode; the editor surfaces an amber hint guiding the user to install Ollama)

### Engine Modes

Three translation pipeline modes are available, selectable via the Settings panel:

| Mode | Tier(s) Active | Best For |
|------|---------------|----------|
| **Hybrid** (Recommended) | LTE + Local LLM + Cloud Gemini | Maximum suggestion quality with graceful fallback |
| **Local** | LTE + Local LLM only | Zero data egress, full offline operation, privacy-sensitive environments |
| **Cloud** | Gemini API only | Complex passages requiring cloud-scale reasoning, or when no local model is available |

---

## Key Features

### Segmented Translation Editor

A split-pane interface with synchronized source-target segment display. English source text is automatically segmented into logical sentences, each paired with a dedicated Arabic translation input field featuring RTL text direction, pronunciation playback via the Web Speech API, and a segment-level confirmation workflow. Segment focus triggers prefetching for zero-latency ghost-text on first keystroke.

### Ghost-Text Predictive Completions

Inline ghost-text suggestions appear in real time as translators type. Suggestions are debounced (350 ms) to avoid interfering with typing fluency, and can be accepted with `Tab` (full), `Ctrl+→` (word-by-word), or cycled with `Alt+]`. A **tier-source badge** next to each suggestion shows which tier produced it — green `LTE`, blue `local-llm` (with model name), or amber `GEMINI` — so translators always know the provenance of a suggestion.

### RAG-Augmented Local LLM (Primary Engine)

The local LLM is enhanced with Retrieval-Augmented Generation (RAG). Before inference, the system retrieves the top-*k* most relevant glossary/translation memory entries from the LTE and injects them into a structured system prompt that enforces terminological consistency. This means local-LLM translations respect your loaded domain vocabulary — they are not generic LLM output but glossary-aware, context-conditioned suggestions that improve as your corpus grows.

### Tier-Source Error Surfacing

When a tier fails, the editor surfaces a precise, actionable diagnostic instead of silently swallowing the error:
- **Tier 1 (local LLM) failures** → amber inline hint with a "Load Local Model" button that jumps to the Models panel
- **Tier 2 (Gemini) failures** → quiet gray inline hint with a "Set Gemini API Key" button
- A per-session toast dedup prevents spamming the same error on every keystroke

### GTR Glossary & Terminology Management

A dedicated terminology management system supporting JSON file import, pre-loaded reference databases (WIPO Pearl Patent Terminology, Microsoft Tech Terminology, OPUS Parallel Corpus), and chunked IndexedDB storage. Loaded glossary entries are indexed into the LTE for instant matching and also serve as RAG context for the local LLM tier. The system ships with a built-in seed corpus of approximately 80 professionally curated EN→AR pairs spanning CAT terminology, technology, professional phrases, academic research, business, and legal domains.

### AI Translation Tutor

An interactive pedagogical panel that evaluates active translation drafts. Powered by Gemini with structured JSON output, it provides a numerical rating (0–100), letter grade, detailed stylistic and grammatical analysis, per-term terminology coaching with contextual fit assessment, and common translation pitfall warnings. When offline or without an API key, a built-in local pedagogical engine provides fallback diagnostics.

### Ollama Onboarding (Tauri only)

On first run in Tauri mode, if the Ollama daemon is not detected, a 3-step skippable onboarding modal guides the user through: (1) downloading Ollama from ollama.com, (2) starting the daemon (platform-specific instructions), and (3) verifying the connection. Users can skip and continue in degraded LTE-only mode — the app respects user agency and never blocks the editor.

### PWA & Offline Support (browser mode)

When deployed as a PWA on Vercel, RDAT Copilot is a fully installable Progressive Web App. It includes a Web App Manifest with standalone display mode, a Service Worker with network-first navigation and cache-first static asset strategy, IndexedDB-based offline storage, and a native install prompt via the `beforeinstallprompt` event on supported browsers.

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
| Cloud Proxy (Tauri) | Rust `gemini_translate` command via reqwest → Gemini REST API |
| Cloud Proxy (PWA) | Vercel Serverless Functions (Node.js 22.x runtime) → `@google/genai` SDK |
| Local Development | Express.js (Gemini API proxy) via `tsx` |
| Storage | IndexedDB (custom dual-storage layer with chunked read/write) |
| PWA (optional) | Service Worker + Web App Manifest |
| Language | TypeScript 5.8 |

### Supported Local Models

#### Ollama Catalog (Tauri — Primary)

| Tag | Model | Parameters | Approx. Size | Notes |
|-----|-------|-----------|-------------|-------|
| `gemma4:e2b` | **Gemma 4 E2B** (recommended starter) | 2B (Effective) | ~1.5 GB | Auto-selected default for new users |
| `gemma4:e4b` | Gemma 4 E4B | 4B (Effective) | ~3.0 GB | Higher quality, 2× download |
| `qwen3:1.7b` | Qwen 3 1.7B | 1.7B | ~1.1 GB | Fast multilingual |
| `qwen3:4b` | Qwen 3 4B | 4B | ~2.5 GB | Balanced |
| `llama4:8b` | Llama 4 8B | 8B | ~4.9 GB | Heavyweight |

#### WebLLM Catalog (PWA — Fallback when no Ollama)

| Catalog ID | Model | Parameters | Quantization | Approx. Size |
|------------|-------|-----------|-------------|-------------|
| `qwen-1.5b` | Qwen 2.5 1.5B Instruct | 1.5B | q4f16_1 | ~1 GB |
| `gemma-2b` | Gemma 2 2B IT | 2B | q4f16_1 | ~1.4 GB |
| `qwen-7b` | Qwen 2.5 7B Instruct | 7B | q4f16_1 | ~4 GB |
| `gemma-7b` | Gemma 2 9B IT | 9B | q4f16_1 | ~5 GB |
| `llama3-8b` | Llama 3.1 8B Instruct | 8B | q4f16_1 | ~4.5 GB |

> **Note:** WebLLM's catalog lags behind Ollama's. For the latest models (Gemma 4, Qwen 3, Llama 4), use the Tauri desktop app with Ollama.

---

## Project Structure

```
rdat/
├── api/                                    # Vercel serverless functions (PWA mode)
│   ├── _lib/gemini.ts                     # User-owned-key Gemini SDK helper
│   ├── translate/
│   │   ├── burst.ts                       # Ghost-text burst suggestions
│   │   ├── full.ts                        # Full segment translation
│   │   └── tutor-explain.ts               # AI Translation Tutor analysis
│   └── health.ts                          # Runtime health-check endpoint
├── src-tauri/                              # Tauri 2 desktop backend (Rust)
│   ├── Cargo.toml                         # Rust deps: tauri 2, reqwest, tokio
│   ├── tauri.conf.json                    # App identity, window, bundle config
│   ├── capabilities/default.json          # WebView permissions
│   ├── icons/                             # Generated app icons (all platforms)
│   └── src/
│       ├── main.rs                        # Binary entry
│       ├── lib.rs                         # Tauri builder + command registration
│       └── commands/
│           ├── ollama.rs                  # ollama_health/list/pull/remove/translate
│           └── gemini.rs                  # gemini_translate (Rust→Gemini REST proxy)
├── public/                                 # PWA assets (manifest, sw, icons)
├── src/
│   ├── components/
│   │   ├── editors/
│   │   │   ├── SourceEditor.tsx
│   │   │   ├── TargetEditor.tsx           # Ghost-text pipeline + tier badges
│   │   │   └── TranslationWorkspace.tsx
│   │   ├── AiModelsView.tsx              # Adapter-aware model catalog (Ollama/WebLLM)
│   │   ├── ApiKeysView.tsx               # Gemini key management + Test button
│   │   ├── GlossaryView.tsx
│   │   ├── OllamaOnboardingModal.tsx     # 3-step skippable Ollama setup guide
│   │   ├── QuickGuideModal.tsx
│   │   ├── Settings.tsx
│   │   ├── Sidebar.tsx
│   │   ├── StatusBar.tsx
│   │   └── WelcomeTab.tsx
│   ├── context/                           # Language + Toast providers
│   ├── hooks/
│   │   ├── useGemini.ts                  # Tauri/PWA Gemini dispatcher
│   │   ├── useWebLLM.ts                  # WebGPU model lifecycle
│   │   ├── useRAG.ts                     # RAG/LTE search hook
│   │   └── useDualStorage.ts             # IndexedDB → LTE loading
│   ├── lib/
│   │   ├── llm-adapter.ts                # LLMAdapter interface + shared prompts
│   │   ├── adapters/
│   │   │   ├── index.ts                  # Factory: getActiveAdapter()
│   │   │   ├── ollama-adapter.ts         # Ollama backend (Tauri)
│   │   │   └── web-llm-adapter.ts        # WebLLM backend (browser)
│   │   ├── gemini-direct.ts              # Tauri/PWA Gemini call dispatcher
│   │   ├── local-llm-engine.ts           # WebLLM engine + RAG + prefetch
│   │   ├── local-translation-engine.ts   # LTE n-gram / fuzzy matching
│   │   ├── seed-corpus.ts                # ~80 EN→AR seed pairs
│   │   └── utils.ts
│   ├── stores/
│   │   ├── settings-store.ts             # Zustand settings
│   │   ├── workspace-store.ts            # Zustand workspace
│   │   └── ui-store.ts                   # Cross-component nav requests
│   ├── types.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── server.ts                             # Express dev server (PWA dev)
├── vercel.json                           # Vercel PWA deployment config
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## Getting Started

### Option A — Tauri Desktop App (Recommended for daily use)

#### Prerequisites

- **Node.js** 22+ and **npm**
- **Rust toolchain** — install via [rustup.rs](https://rustup.rs/) (Rust 1.77+)
- **Tauri 2 system prerequisites** — see [v2.tauri.app/prerequisites](https://v2.tauri.app/start/prerequisites/)
  - **Windows:** Microsoft Visual Studio C++ Build Tools
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  - **Linux:** `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`
- **[Ollama](https://ollama.com/download)** — the local LLM daemon

#### Setup

```bash
git clone https://github.com/waleedmandour/rdat.git
cd rdat
npm install

# Generate Tauri icons from the PWA icon (one-time)
npm run tauri:icon

# Start Tauri dev mode (boots Rust backend + Vite dev server + native window)
npm run tauri:dev
# First run takes 5–10 min to compile Rust dependencies
```

On first launch, if Ollama is not running, the onboarding modal will guide you through installation. Once Ollama is running:

1. Open the **Models** panel
2. Click **Pull** on `gemma4:e2b` (recommended starter, ~1.5 GB download)
3. After the pull completes, click **Load**
4. Start translating — ghost-text suggestions will appear with a blue `GEMMA4:E2B` badge

#### Production Build

```bash
npm run tauri:build
# Produces installers in src-tauri/target/release/bundle/:
#   Windows: .msi + .exe (NSIS)
#   macOS:   .dmg + .app
#   Linux:   .deb, .rpm, .AppImage
```

### Option B — PWA on Vercel (Try before install)

#### Prerequisites

- **Node.js** 22+ and **npm**
- **WebGPU-compatible browser** (Chrome 113+, Edge 113+) for on-device LLM inference in the browser
- **Google Gemini API key** (optional, for cloud fallback) — obtain from [Google AI Studio](https://aistudio.google.com/apikey)

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

The repository includes a `vercel.json` configuration. Connect the GitHub repository to Vercel and it will auto-deploy. **No environment variables are required** — the app uses a user-owned-key model where each user enters their own Gemini API key in the app's API Keys panel.

- **Framework:** Vite (auto-detected)
- **API routes:** Files under `api/**/*.ts` are deployed as serverless functions (Node.js 22.x runtime)
- **Environment variables:** None required (user-owned-key model)
- **SPA routing:** All non-API routes are rewritten to `index.html`

---

## Gemini API Key (User-Owned Model)

RDAT Copilot uses a **user-owned-key** model for Gemini access. Each user enters their own API key in the app's **API Keys** panel — the key is stored in the browser's localStorage and sent with each request. No keys are stored server-side.

- **In Tauri mode:** keys are sent to the Rust backend, which calls the Gemini REST API via `reqwest`. This avoids CORS issues and works with Google's post-June-19-2026 API key restrictions.
- **In PWA mode:** keys are sent to the Vercel serverless functions, which use the `@google/genai` SDK to call Gemini.

Get a free key from [Google AI Studio](https://aistudio.google.com/apikey). The API Keys panel includes a **Test Key** button that verifies the key works by performing a test translation.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Tab` | Accept full ghost-text suggestion |
| `Ctrl + →` | Accept next word of suggestion |
| `Alt + ]` | Cycle through alternative candidates |
| `Esc` | Dismiss current suggestion |
| `Ctrl + Enter` | Confirm and save segment |

---

## Internationalization

RDAT Copilot supports full bilingual UI (English/Arabic) with automatic RTL layout switching. All interface elements — labels, placeholder text, contextual hints, and navigation — adapt to the selected language. The AI Translation Tutor can provide feedback in either English or Arabic depending on the active locale. Switch between EN/AR using the sidebar language toggle.

---

## Roadmap

- **Continuous-assistance multi-trigger system** — Idle-pause re-engagement, post-accept re-suggestion, and post-dismissal cooldown to provide Google-style autocomplete that persists during translator thinking pauses (2–3 s).
- **Streaming inference** — Streaming token generation for both Ollama and WebLLM to reduce time-to-first-token below 800 ms.
- **Context window expansion** — Pass previous/next segment source to the LLM for terminological consistency across segments.
- **Arabic-to-English (AR→EN) translation direction** — Currently unidirectional (EN→AR).
- **CI matrix for cross-platform builds** — GitHub Actions for Windows, macOS, and Linux installer production.
- **Updater signing** — Generate a Tauri updater keypair and host signed manifests on GitHub Releases.

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

```
MIT License
Copyright (c) 2026 Dr. Waleed Mandour
```

---

## Acknowledgements

**Developed by Dr. Waleed Abu Mandour**, Assistant Professor at Sultan Qaboos University, Oman.

This tool supports academic researchers and professional translators working with English-Arabic bilingual corpora.

- Email: [w.abumandour@squ.edu.om](mailto:w.abumandour@squ.edu.om)
- Repository: [github.com/waleedmandour/rdat](https://github.com/waleedmandour/rdat)

The development of RDAT Copilot has been performed with the assistance of multi-AI agents, including **GLM-5.1** (2026). These AI-assisted development tools were used for code generation, architectural analysis, debugging, and documentation throughout the project lifecycle.
