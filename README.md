# RDAT Copilot

**Professional English-to-Arabic Computer-Assisted Translation (CAT) Environment**

[![Deploy](https://img.shields.io/badge/Deploy-Vercel-000?logo=vercel&logoColor=white)](https://vercel.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-6366f1?logo=pwa&logoColor=white)](https://github.com/waleedmandour/rdat)
[![WebGPU](https://img.shields.io/badge/WebGPU-Local_LLM-22c55e?logo=webgpu&logoColor=white)](https://caniuse.com/webgpu)

---

## Overview

RDAT Copilot is an AI-powered, browser-native translation workspace purpose-built for professional English-to-Arabic translation workflows. It combines a segmented translation editor with a three-tier predictive ghost-text pipeline — from instant corpus lookups and RAG-augmented on-device LLM inference to cloud-based Gemini fallback — delivering real-time suggestions while keeping translators in full control of every word.

Built as a Progressive Web App (PWA), RDAT Copilot runs entirely in the browser with optional cloud augmentation via Google Gemini 2.5 Flash. Its local-first architecture ensures data privacy and offline capability: the Local Translation Engine (LTE) and on-device WebGPU models operate without any network egress, while glossary databases, translation memories, and segment history persist across sessions through IndexedDB.

The system is designed around the principle that professional translators should never have to choose between speed and quality. Ghost-text suggestions appear inline as you type, drawn from progressively smarter tiers that balance latency against nuance — from sub-5ms n-gram matches to RAG-enriched LLM completions that respect your loaded terminology, to cloud-scale Gemini translations for complex or ambiguous passages.

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
│  Tier 1 ─ RAG-LLM (WebGPU On-Device Model)                    │
│    │  RAG-augmented inference with selective glossary context  │
│    │  Latency: 200–2000 ms  |  Channel: rag / webllm          │
│    │  Prefetch on segment focus for zero-latency display       │
│    │                                                            │
│  Tier 2 ─ Cloud Gemini (Gemini 2.5 Flash)                     │
│       Serverless API routes with structured JSON output        │
│       Latency: 500–3000 ms  |  Channel: gemini                │
│       Supports burst (3 candidates) and full translation       │
└─────────────────────────────────────────────────────────────────┘
```

#### Tier 0 — LTE (Local Translation Engine)

The LTE provides instant, zero-network suggestions using a multi-strategy matching engine against the loaded corpus. It performs exact matching, partial/prefix alignment, trigram similarity scoring, and multi-sentence splitting — all against an in-memory normalized English-key index. When the user has typed an Arabic prefix, the LTE computes the ghost remainder by aligning the prefix against the matched Arabic entry using fuzzy trigram alignment, allowing for minor typographical variations.

The LTE is seeded with approximately 80 professionally curated EN→AR pairs covering CAT terminology, technology, academic, business, and legal domains. Users can extend the corpus by importing glossary JSON files or by adding entries through the Glossary Manager.

#### Tier 1 — RAG-Augmented Local LLM

When the LTE returns no match or a low-confidence result, the on-device WebGPU model generates a RAG-augmented translation. This tier constructs a structured system prompt enriched with the top-*k* most relevant glossary entries retrieved from the LTE via n-gram similarity search. The prompt enforces terminological consistency and instructs the model to use glossary terms preferentially, producing translations that respect the user's loaded domain vocabulary rather than generic output.

Key features of this tier include:

- **Selective RAG context** — Only the top 5 most relevant entries are injected into the system prompt, keeping context within the token limits of smaller models (1.5B–9B parameters) while maximizing domain relevance.
- **Segment prefetch** — When the translator focuses a new segment, a full RAG translation is computed and cached before typing begins. The ghost-text system compares the user's typed prefix against this cached translation to instantly produce a suggestion remainder, with no LLM call needed until the translator deviates significantly.
- **Deviation-triggered re-fetch** — If the translator's typed text deviates more than 60% from the last suggestion (measured by normalized edit distance), the tier automatically re-triggers a fresh RAG inference to keep suggestions aligned with the translator's evolving intent.
- **Model catalog** — Five quantized models are available, ranging from Qwen 2.5 1.5B (fastest, ~1 GB) to Llama 3.1 8B and Gemma 2 9B (highest quality, ~4–5 GB), all using q4f16_1 quantization for optimal speed/quality tradeoff on WebGPU.

#### Tier 2 — Cloud Gemini

When local tiers yield insufficient results, or when the user operates in cloud-only mode, serverless API routes powered by Gemini 2.5 Flash provide high-quality translations. Three endpoints are available:

| Endpoint | Purpose | Response |
|----------|---------|----------|
| `/api/translate/burst` | Generate up to 3 predictive Arabic candidates conditioned on a typed prefix | `{ suggestions: string[] }` |
| `/api/translate/full` | Generate a complete Arabic translation of a source segment | `{ translation: string }` |
| `/api/translate/tutor-explain` | Provide pedagogical analysis of a translation attempt with rating, grade, term-by-term coaching, and pitfall warnings | `{ rating, grade, explanation, termsAnalysed, pitfalls }` |

All API routes use the modern Web Standard `fetch` handler pattern (ESM-compatible) and support both server-side `GEMINI_API_KEY` environment variables and per-request user-provided keys.

### Engine Modes

Three translation pipeline modes are available, selectable via the Settings panel:

| Mode | Tier(s) Active | Best For |
|------|---------------|----------|
| **Hybrid** (Recommended) | LTE + RAG-LLM + Cloud Gemini | Maximum suggestion quality with graceful fallback |
| **Local** | LTE + RAG-LLM only | Zero data egress, full offline operation, privacy-sensitive environments |
| **Cloud** | Gemini API only | Complex passages requiring cloud-scale reasoning, or when WebGPU is unavailable |

---

## Key Features

### Segmented Translation Editor

A split-pane interface with synchronized source-target segment display. English source text is automatically segmented into logical sentences, each paired with a dedicated Arabic translation input field featuring RTL text direction, pronunciation playback via the Web Speech API, and a segment-level confirmation workflow. Segment focus triggers prefetching for zero-latency ghost-text on first keystroke.

### Ghost-Text Predictive Completions

Inline ghost-text suggestions appear in real time as translators type. Suggestions are debounced (350 ms) to avoid interfering with typing fluency, and can be accepted with `Tab` (full), `Ctrl+→` (word-by-word), or cycled with `Alt+]`. The three-tier pipeline ensures that instant LTE matches appear first, then RAG-enriched LLM completions refine the suggestion, and finally cloud Gemini candidates arrive as a backstop for ambiguous or complex passages.

### RAG-Augmented On-Device LLM

The local WebGPU model is enhanced with Retrieval-Augmented Generation (RAG). Before inference, the system retrieves the top-*k* most relevant glossary/translation memory entries from the LTE and injects them into a structured system prompt that enforces terminological consistency. This means on-device translations respect your loaded domain vocabulary — they are not generic LLM output but glossary-aware, context-conditioned suggestions that improve as your corpus grows.

### GTR Glossary & Terminology Management

A dedicated terminology management system supporting JSON file import, pre-loaded reference databases (WIPO Pearl Patent Terminology, Microsoft Tech Terminology, OPUS Parallel Corpus), and chunked IndexedDB storage. Loaded glossary entries are indexed into the LTE for instant matching and also serve as RAG context for the local LLM tier. The system ships with a built-in seed corpus of approximately 80 professionally curated EN→AR pairs spanning CAT terminology, technology, professional phrases, academic research, business, and legal domains.

### AI Translation Tutor

An interactive pedagogical panel that evaluates active translation drafts. Powered by Gemini with structured JSON output, it provides a numerical rating (0–100), letter grade, detailed stylistic and grammatical analysis, per-term terminology coaching with contextual fit assessment, and common translation pitfall warnings. When offline or without an API key, a built-in local pedagogical engine provides fallback diagnostics.

### PWA & Offline Support

RDAT Copilot is a fully installable Progressive Web App. It includes a Web App Manifest with standalone display mode, a Service Worker with network-first navigation and cache-first static asset strategy, IndexedDB-based offline storage for all terminology, glossary, and translation data, and a native install prompt via the `beforeinstallprompt` event on supported browsers. The entire LTE and local LLM pipeline operates offline without any network dependency.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI Framework | React 19 + Vite 6 |
| Styling | Tailwind CSS 4 with CSS custom properties for theming |
| State Management | Zustand 5 |
| Animations | Motion (Framer Motion) |
| Icons | Lucide React |
| On-Device AI | `@mlc-ai/web-llm` — WebGPU-accelerated LLM inference in the browser |
| Cloud AI | Google Gemini 2.5 Flash via `@google/genai` SDK |
| Serverless API | Vercel Serverless Functions (Node.js 20.x runtime) |
| Local Development | Express.js (Gemini API proxy) via `tsx` |
| Storage | IndexedDB (custom dual-storage layer with chunked read/write) |
| PWA | Service Worker + Web App Manifest |
| Language | TypeScript 5.8 |

### Supported On-Device Models

| Catalog ID | Model | Parameters | Quantization | Approx. Size |
|------------|-------|-----------|-------------|-------------|
| `qwen-1.5b` | Qwen 2.5 1.5B Instruct | 1.5B | q4f16_1 | ~1 GB |
| `gemma-2b` | Gemma 2 2B IT | 2B | q4f16_1 | ~1.4 GB |
| `qwen-7b` | Qwen 2.5 7B Instruct | 7B | q4f16_1 | ~4 GB |
| `gemma-7b` | Gemma 2 9B IT | 9B | q4f16_1 | ~5 GB |
| `llama3-8b` | Llama 3.1 8B Instruct | 8B | q4f16_1 | ~4.5 GB |

All models are downloaded on demand via the browser Cache API and persist across sessions. WebGPU availability is required for on-device inference; see [caniuse.com/webgpu](https://caniuse.com/webgpu) for browser support.

---

## Project Structure

```
rdat/
├── api/
│   ├── _lib/
│   │   └── gemini.ts                     # Shared Gemini SDK helper (lazy init)
│   └── translate/
│       ├── burst.ts                      # Ghost-text burst suggestions (3 candidates)
│       ├── full.ts                       # Full segment translation
│       └── tutor-explain.ts             # AI Translation Tutor analysis
├── public/
│   ├── manifest.webmanifest              # PWA manifest
│   ├── sw.js                             # Service worker
│   ├── icon-192.png                      # PWA icon (192x192)
│   └── icon-512.png                      # PWA icon (512x512)
├── src/
│   ├── components/
│   │   ├── editors/
│   │   │   ├── SourceEditor.tsx           # Source text panel with import
│   │   │   ├── TargetEditor.tsx           # Translation editor with ghost-text pipeline
│   │   │   └── TranslationWorkspace.tsx   # Main workspace with sidebar
│   │   ├── AiModelsView.tsx              # WebGPU model catalog & hardware profiler
│   │   ├── ApiKeysView.tsx               # Gemini API key management
│   │   ├── GlossaryView.tsx              # Terminology database manager
│   │   ├── InstallPWAButton.tsx          # PWA install prompt banner
│   │   ├── QuickGuideModal.tsx           # Keyboard shortcuts reference
│   │   ├── Settings.tsx                  # App settings panel
│   │   ├── Sidebar.tsx                   # Navigation sidebar
│   │   ├── StatusBar.tsx                 # System status footer (WebGPU, LTE, RAG)
│   │   └── WelcomeTab.tsx               # Dashboard landing page
│   ├── context/
│   │   ├── LanguageContext.tsx            # i18n provider (EN/AR) with RTL switching
│   │   └── ToastContext.tsx              # Toast notification system
│   ├── hooks/
│   │   ├── useDualStorage.ts             # IndexedDB → LTE loading with seed corpus
│   │   ├── useGemini.ts                  # Gemini API integration with retry logic
│   │   ├── useLocalAgent.ts              # Local agent state
│   │   ├── useRAG.ts                     # RAG/LTE search hook with live stats
│   │   └── useWebLLM.ts                 # WebGPU model lifecycle management
│   ├── i18n/
│   │   └── translations.ts               # EN/AR UI translation strings
│   ├── lib/
│   │   ├── dual-storage.ts               # IndexedDB CRUD operations
│   │   ├── local-llm-engine.ts           # WebGPU LLM engine + RAG + prefetch cache
│   │   ├── local-translation-engine.ts   # LTE n-gram / fuzzy / sentence-split matching
│   │   ├── seed-corpus.ts                # ~80 EN→AR seed pairs (CAT, tech, academic, legal)
│   │   └── utils.ts                      # Utility functions
│   ├── stores/
│   │   ├── settings-store.ts             # Zustand settings (engine mode, API keys, models)
│   │   └── workspace-store.ts            # Zustand workspace (source/target segments)
│   ├── types.ts                          # TypeScript type definitions
│   ├── App.tsx                           # Root component
│   ├── main.tsx                          # Entry point
│   └── index.css                         # Tailwind + theme variables
├── server.ts                             # Express dev server (Gemini API proxy)
├── vercel.json                           # Vercel deployment configuration
├── vite.config.ts                        # Vite build configuration
├── tsconfig.json                         # TypeScript configuration
└── package.json
```

---

## Getting Started

### Prerequisites

- **Node.js** 18+ and **npm**
- **WebGPU-compatible browser** (Chrome 113+, Edge 113+) for on-device LLM inference
- **Google Gemini API key** (optional, for cloud features) — obtain from [Google AI Studio](https://aistudio.google.com/apikey)

### Local Development

1. **Clone the repository:**
   ```bash
   git clone https://github.com/waleedmandour/rdat.git
   cd rdat
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Gemini API key (optional, for cloud features):**

   The app uses a **user-owned key** model — each user enters their own
   Gemini API key in the app's **API Keys** panel at runtime. The key is
   stored in the browser's localStorage and sent with each request.

   For **local development convenience only**, you may optionally place
   a key in a `.env` file (this is used as a fallback when no user key
   is provided, and is NOT used in production):
   ```bash
   echo "GEMINI_API_KEY=your-key-here" > .env
   ```
   Get a free key from [Google AI Studio](https://aistudio.google.com/apikey).

4. **Start the development server:**
   ```bash
   npm run dev
   ```
   This launches the Express server with Vite HMR at `http://localhost:3000`.

### Production Build

```bash
npm run build
```

This produces the Vite static build in `dist/`. The Vercel deployment configuration handles both the static assets and the serverless API routes.

### Deploy to Vercel

The repository includes a `vercel.json` configuration. Simply connect the GitHub repository to Vercel and it will auto-deploy. Key configuration points:

- **Framework:** Vite (auto-detected)
- **API routes:** Files under `api/**/*.ts` are deployed as serverless functions with Node.js 20.x runtime
- **Environment variables:** **None required.** The app uses a user-owned-key model — each user enters their own Gemini API key in the app's API Keys panel. No server-side environment variables need to be configured.
- **SPA routing:** All non-API routes are rewritten to `index.html` for client-side routing

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

- **Arabic-to-English (AR→EN) translation direction** — The current pipeline is unidirectional (EN→AR). Future releases will introduce a reverse LTE index, bidirectional system prompts, and AR→EN seed corpus entries to support full bidirectional translation workflows.
- **Streaming inference** — Server-Sent Events streaming for cloud Gemini translations to reduce time-to-first-token on the Vercel Free Tier.
- **Vercel function warm-up** — Periodic keep-alive pings to mitigate cold-start latency on serverless API routes.
- **Onboarding flow** — Guided first-run experience for WebGPU setup, model selection, and glossary import.

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
