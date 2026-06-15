# RDAT Copilot

**Professional English↔Arabic Computer-Assisted Translation (CAT) Environment**

[![Deploy](https://img.shields.io/badge/Deploy-Vercel-000?logo=vercel&logoColor=white)](https://vercel.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-6366f1?logo=pwa&logoColor=white)](https://github.com/waleedmandour/rdat)

---

## Overview

RDAT Copilot is an AI-powered, browser-native translation workspace designed for professional English-to-Arabic translation workflows. Built as a Progressive Web App (PWA), it runs entirely in the browser with optional cloud-based LLM augmentation via Google Gemini, ensuring data privacy through local-first architecture while offering intelligent predictive suggestions, terminology management, and pedagogical feedback.

The system combines a segmented translation editor with real-time ghost-text predictions powered by a Local Translation Engine (LTE), GTR glossary databases, and an AI Translation Tutor — all accessible offline through the PWA shell.

---

## Key Features

### Segmented Translation Editor
A split-pane interface with synchronized source-target segment display. English source text is automatically segmented into logical sentences, each paired with a dedicated Arabic translation input field featuring RTL text direction, pronunciation playback via the Web Speech API, and segment-level confirmation workflow.

### Ghost-Text Predictive Completions
As translators type, the system projects inline ghost-text suggestions in real time. These predictions originate from two channels:
- **LTE (Local Translation Engine)** — Instant, on-device fuzzy matching using n-gram similarity, partial alignment, and sentence-split heuristics against loaded corpus entries. Zero network latency.
- **Cloud Fallback (Gemini API)** — When local confidence is low, up to 3 candidate translations are requested from Gemini 2.5 Flash and presented as cycling alternatives.

Suggestions are debounced (350ms) to avoid interfering with typing fluency, and can be accepted with `Tab` (full), `Ctrl+→` (word-by-word), or cycled with `Alt+]`.

### GTR Glossary & Vector Databases
A dedicated terminology management system supporting JSON file import, pre-loaded reference databases (WIPO Pearl Patent, Microsoft Tech Terminology, OPUS Parallel Corpus), and chunked IndexedDB storage. Loaded glossary entries are indexed into the LTE for instant matching during translation.

### AI Translation Tutor
An interactive pedagogical panel that evaluates active translation drafts. Powered by Gemini with structured JSON output, it provides:
- Numerical rating (0–100) and letter grade
- Detailed stylistic and grammatical analysis
- Per-term terminology coaching with contextual fit assessment
- Common translation pitfall warnings

When offline or without an API key, a built-in local pedagogical engine provides fallback diagnostics.

### PWA & Offline Support
RDAT Copilot is a fully installable Progressive Web App. It includes:
- Web App Manifest with standalone display mode
- Service Worker with network-first navigation and cache-first static asset strategy
- IndexedDB-based offline storage for all terminology and translation data
- Native install prompt via the `beforeinstallprompt` event on supported browsers

### Dual-Engine Architecture
Three translation pipeline modes are available:
| Mode | Description |
|------|-------------|
| **Hybrid** (Recommended) | Blends LTE phrase matching with cloud LLM suggestions |
| **Local** | Strictly offline — LTE + GTR glossaries only, zero data egress |
| **Cloud** | Pure Gemini API for complex translation nuances |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + Vite 6 |
| Styling | Tailwind CSS 4 with CSS custom properties for theming |
| State Management | Zustand 5 |
| Animations | Motion (Framer Motion) |
| Icons | Lucide React |
| Cloud AI | Google Gemini 2.5 Flash (`@google/genai` SDK) |
| Server | Express.js (local development proxy for Gemini API) |
| Storage | IndexedDB (via custom dual-storage layer) |
| PWA | Service Worker + Web App Manifest |
| Language | TypeScript 5.8 |

---

## Project Structure

```
rdat/
├── public/
│   ├── manifest.webmanifest    # PWA manifest
│   ├── sw.js                   # Service worker
│   ├── icon-192.png            # PWA icon (192×192)
│   └── icon-512.png            # PWA icon (512×512)
├── src/
│   ├── components/
│   │   ├── editors/
│   │   │   ├── SourceEditor.tsx       # Source text panel with import
│   │   │   ├── TargetEditor.tsx       # Translation editor with ghost text
│   │   │   └── TranslationWorkspace.tsx # Main workspace with sidebar
│   │   ├── AiModelsView.tsx           # Local model catalog & hardware profiler
│   │   ├── ApiKeysView.tsx            # Gemini API key management
│   │   ├── GlossaryView.tsx           # Terminology database manager
│   │   ├── InstallPWAButton.tsx       # PWA install prompt banner
│   │   ├── QuickGuideModal.tsx        # Keyboard shortcuts reference
│   │   ├── Settings.tsx               # App settings panel
│   │   ├── Sidebar.tsx                # Navigation sidebar
│   │   ├── StatusBar.tsx              # System status footer
│   │   └── WelcomeTab.tsx             # Dashboard landing page
│   ├── context/
│   │   ├── LanguageContext.tsx         # i18n provider (EN/AR)
│   │   └── ToastContext.tsx            # Toast notification system
│   ├── hooks/
│   │   ├── useDualStorage.ts          # IndexedDB storage hook
│   │   ├── useGemini.ts               # Gemini API integration
│   │   ├── useLocalAgent.ts           # Local agent state
│   │   ├── useRAG.ts                  # RAG/LTE search hook
│   │   └── useWebLLM.ts              # WebGPU model state
│   ├── i18n/
│   │   └── translations.ts            # EN/AR translation strings
│   ├── lib/
│   │   ├── dual-storage.ts            # IndexedDB CRUD operations
│   │   ├── local-translation-engine.ts # LTE n-gram matching engine
│   │   └── utils.ts                   # Utility functions
│   ├── stores/
│   │   ├── settings-store.ts          # Zustand settings store
│   │   └── workspace-store.ts         # Zustand workspace store
│   ├── types.ts                       # TypeScript type definitions
│   ├── App.tsx                        # Root component
│   ├── main.tsx                       # Entry point
│   └── index.css                      # Tailwind + theme variables
├── server.ts                          # Express server (Gemini API proxy)
├── vercel.json                        # Vercel deployment config
├── vite.config.ts                     # Vite build configuration
├── tsconfig.json                      # TypeScript configuration
└── package.json
```

---

## Getting Started

### Prerequisites
- Node.js 18+ and npm

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
   ```bash
   echo "GEMINI_API_KEY=your-key-here" > .env
   ```
   The API key can also be entered directly in the app's **API Keys** settings panel.

4. **Start the development server:**
   ```bash
   npm run dev
   ```
   This launches the Express server with Vite HMR at `http://localhost:3000`.

### Production Build

```bash
npm run build
npm start
```

### Deploy to Vercel

The repository includes a `vercel.json` configuration. Simply connect the GitHub repository to Vercel and it will auto-deploy. The Gemini API key can be set as an environment variable in the Vercel project settings.

> **Note:** The Express server (`server.ts`) provides API proxy routes for Gemini. On Vercel, you may need to adapt these as serverless API routes under an `api/` directory, or use the client-side API key input instead.

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

RDAT Copilot supports full bilingual UI (English/Arabic) with automatic RTL layout switching. All interface elements, labels, placeholder text, and contextual hints adapt to the selected language. Switch between EN/AR using the sidebar language toggle.

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

```
MIT License
Copyright (c) 2026 Dr. Waleed Mandour
```

---

## Academic Credit

Developed by **Dr. Waleed Abu Mandour**, Assistant Professor at Sultan Qaboos University, Oman. This tool supports academic researchers and professional translators working with English-Arabic bilingual corpora.

- Email: [w.abumandour@squ.edu.om](mailto:w.abumandour@squ.edu.om)
- Repository: [github.com/waleedmandour/rdat](https://github.com/waleedmandour/rdat)
