# Tauri 2 + Ollama Migration Guide

This document explains how RDAT Copilot is structured to run as **both** a
PWA (on Vercel) **and** a native desktop app (via Tauri 2 + Ollama),
sharing a single React/Vite frontend.

> **Status:** Scaffold complete. PWA path unchanged. Tauri path ready for
> local testing once Rust + Ollama are installed.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                  Single React/Vite Frontend                       │
│  (src/components/*, src/hooks/*, src/lib/* — shared codebase)    │
└──────────────────────────┬───────────────────────────────────────┘
                           │
            ┌──────────────┴──────────────┐
            │                             │
            ▼                             ▼
┌──────────────────────┐      ┌──────────────────────────┐
│   PWA Deployment     │      │   Tauri 2 Desktop App    │
│   (Vercel)           │      │   (Win/macOS/Linux)      │
├──────────────────────┤      ├──────────────────────────┤
│ • WebLLM (WebGPU)    │      │ • OllamaAdapter (PRIMARY)│
│ • Gemini API routes  │      │   ↳ Tauri Rust commands  │
│   (serverless)       │      │   ↳ localhost:11434      │
│ • Service Worker     │      │ • WebLLM (FALLBACK)      │
└──────────────────────┘      │ • Gemini direct API call │
                              │   (user-provided key)    │
                              └──────────────────────────┘
```

### Adapter pattern (the key abstraction)

The frontend never talks to WebLLM or Ollama directly. Instead, it calls
through the `LLMAdapter` interface (`src/lib/llm-adapter.ts`):

```typescript
interface LLMAdapter {
  isAvailable(): Promise<boolean>;
  isModelLoaded(): boolean;
  loadModel(modelId: string, onProgress?): Promise<void>;
  unloadModel(): Promise<void>;
  translate(opts: TranslateOptions): Promise<string[]>;
  listModels(): Promise<ModelInfo[]>;
  pullModel?(modelId: string, onProgress?): Promise<void>;
  getLastError(): string | null;
  onStateChange(cb): () => void;
  // ...
}
```

The factory (`src/lib/adapters/index.ts`) picks the right adapter at runtime:

1. **Inside Tauri + Ollama running** → `OllamaAdapter` (PRIMARY — native CUDA/Metal)
2. **Else if WebGPU available** → `WebLLMAdapter` (browser path, or Tauri fallback)
3. **Else** → `null` (Gemini-only mode; `TargetEditor` shows the amber hint)

This means the same `TargetEditor.tsx` works in all three modes without
modification — the tier-fallback logic and error-surfacing code is identical.

---

## Project layout (new files)

```
rdat/
├── src/
│   ├── lib/
│   │   ├── llm-adapter.ts              # LLMAdapter interface + shared prompt builders
│   │   ├── adapters/
│   │   │   ├── index.ts                # Factory: getActiveAdapter()
│   │   │   ├── web-llm-adapter.ts      # Wraps existing local-llm-engine.ts
│   │   │   └── ollama-adapter.ts       # Calls Tauri Rust commands
│   │   └── local-llm-engine.ts         # (existing — WebLLM, unchanged)
│   └── components/editors/
│       └── TargetEditor.tsx            # Updated: uses adapter when available
├── src-tauri/                          # NEW — Tauri 2 Rust backend
│   ├── Cargo.toml                      # Rust deps: tauri 2, reqwest, tokio, serde
│   ├── tauri.conf.json                 # App identity, window, bundle, updater
│   ├── build.rs                        # Tauri build script
│   ├── capabilities/
│   │   └── default.json                # WebView permissions (CSP, plugins)
│   ├── icons/
│   │   └── README.md                   # How to generate icons from PWA icon
│   └── src/
│       ├── main.rs                     # Binary entry point
│       ├── lib.rs                      # Tauri app builder + command registration
│       ├── commands.rs                 # Module declarations
│       └── commands/
│           └── ollama.rs               # ollama_health, _list_models, _pull_model,
│                                       # _remove_model, _translate
└── package.json                        # +@tauri-apps/api, +@tauri-apps/cli, +scripts
```

---

## Setup — what you need to install

### 1. Rust toolchain (required for Tauri build)

Install via [rustup](https://rustup.rs/):

```bash
# Linux/macOS
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Windows: download rustup-init.exe from https://rustup.rs
```

Verify:
```bash
rustc --version    # need 1.77+
cargo --version
```

### 2. Tauri 2 system prerequisites

**Linux (Debian/Ubuntu):**
```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
                    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

**macOS:** Xcode Command Line Tools
```bash
xcode-select --install
```

**Windows:** Microsoft Visual Studio C++ Build Tools (download from
https://visualstudio.microsoft.com/visual-cpp-build-tools/) — select
"Desktop development with C++" workload. WebView2 is preinstalled on
Windows 11; on Windows 10 download the Evergreen runtime.

### 3. Ollama daemon

Install from https://ollama.com/download. After installation, verify:
```bash
ollama --version
ollama serve &          # starts the daemon on localhost:11434
curl http://localhost:11434/api/tags
```

Pull your first model:
```bash
ollama pull qwen2.5:1.5b    # ~1 GB, recommended starting point
```

---

## Development workflow

### PWA mode (unchanged)

```bash
npm run dev              # Vite + Express on http://localhost:3000
npm run build            # produces dist/ for Vercel
```

### Tauri desktop mode

```bash
# One-time: generate app icons from the existing PWA icon
npm run tauri:icon       # creates src-tauri/icons/* from public/icon-512.png

# Start Tauri dev (boots Rust backend + Vite dev server + webview window)
npm run tauri:dev        # first run takes 5-10 min to compile Rust deps
```

The Vite dev server runs on `:3000` (per `tauri.conf.json → devUrl`) and
Tauri opens a native window pointing at it. Hot reload works for both
frontend (Vite HMR) and Rust (auto-recompile on save).

### Production build

```bash
npm run tauri:build      # produces installers in src-tauri/target/release/bundle/
```

Output per platform:
- **Windows:** `.msi` installer + `.exe` (NSIS)
- **macOS:** `.dmg` + `.app` (universal binary if built on Apple Silicon)
- **Linux:** `.deb`, `.rpm`, `.AppImage`

---

## What works vs. what's TODO

### ✅ Working in v0.2.0

- **Adapter pattern wired into `TargetEditor`** — the active adapter
  (Ollama or WebLLM) is consulted first; legacy direct-call path retained
  as fallback for early-page-load when the async factory hasn't resolved.
- **All five Ollama Tauri commands implemented in Rust:**
  - `ollama_health` — multi-URL health check with 5s timeout, `.no_proxy()`,
    structured diagnostics returned to UI (which URLs tried, which errors)
  - `ollama_list_models` — merges installed models with recommended catalog
  - `ollama_pull_model` — streams progress events to webview
  - `ollama_remove_model` — deletes from daemon's store
  - `ollama_translate` — calls `/api/generate` with system+user prompt
- **Gemini direct API call in Tauri mode** ✅ — Rust-side `gemini_translate`
  command proxies to Gemini REST API via reqwest. `gemini-direct.ts`
  dispatcher routes Tauri→Rust, PWA→Vercel functions.
- **Ollama onboarding modal** ✅ — 3-step skippable guide with platform-
  specific instructions and "Check Again" verification.
- **Adapter-aware AiModelsView** ✅ — shows Ollama or WebLLM catalog based
  on active adapter, with pull/load/remove and live progress bars.
- **Engine status diagnostics in UI** ✅ — when Ollama is not detected, the
  UI shows exactly which URLs were tried and which errors occurred, so a
  screenshot is enough to diagnose the issue.
- **Cold-start auto-retry** ✅ — on initial launch, if Ollama isn't detected
  on the first attempt, the adapter factory waits 3s and retries once
  before giving up. Handles Ollama autostart race.
- **Proxy bypass** ✅ — all Ollama reqwest clients use `.no_proxy()` so
  corporate VPNs/security software don't intercept loopback traffic.
- **OLLAMA_HOST normalization** ✅ — handles bare `host:port`, full URLs,
  and bare hosts without ports.
- **Single-source version string** ✅ — `package.json` version is injected
  via `vite.config.ts` `define` into `import.meta.env.VITE_APP_VERSION`,
  consumed by i18n translations. No more hand-editing 4 files per release.
- **Shell scope configured** ✅ — `tauri.conf.json` has `plugins.shell.open`
  regex allowing `https://*` URLs for the "Download Ollama" button.
- **Shared RAG prompt builder** — both adapters use the same
  `buildRAGSystemPrompt()` so glossary-context behavior is identical.
- **PWA build still works** — dynamic imports of `@tauri-apps/api/*` are
  tree-shaken out of the PWA bundle because `isTauriEnvironment()` returns
  false at module-eval time.

### ⚠️ TODO (future releases)

1. **useWebLLM hook rename / generalize** — currently hard-coded to the
   WebLLM engine state. Should be renamed to `useLLM` and re-pointed at
   the active adapter's `onStateChange()`.

2. **Bundle Ollama in installer** — currently users must install Ollama
   themselves. Future option: bundle the Ollama binary in the Tauri
   installer via `externalBin` in `tauri.conf.json`. Adds ~200 MB to
   installer size but eliminates the separate-install step.

3. **CI matrix for cross-platform builds** — GitHub Actions workflow
   with `windows-latest`, `macos-latest`, `ubuntu-22.04` jobs running
   `npm run tauri:build` and uploading artifacts to GitHub Releases.

4. **Updater signing** — `tauri.conf.json → plugins.updater.pubkey` is
   empty. Generate a keypair with `tauri signer generate` and add the
   public key, then sign release binaries with the private key in CI.

5. **Streaming inference** — current `ollama_translate` uses
   `"stream": false` for simplicity. For lower time-to-first-token,
   switch to streaming and emit translation chunks via Tauri events,
   then have `TargetEditor` progressively fill the ghost text.

6. **Continuous-assistance multi-trigger system** — idle-pause re-engagement,
   post-accept re-suggestion, post-dismissal cooldown. Currently ghost-text
   only fires on segment focus, text change, and deviation. The "assistance
   that persists during thinking pauses" behavior is the core differentiator
   but hasn't been built yet.

7. **IndexedDB migration between PWA and Tauri** — each webview origin has
   its own storage, so glossaries/TM don't carry over. Add an explicit
   in-app export/import shortcut.

---

## Verification matrix

| Environment | Local LLM | Gemini | Status |
|---|---|---|---|
| PWA, Chrome 113+, no model loaded | WebLLM available but inactive | Vercel function | ✅ Tier-error hint shows "Load Local Model" |
| PWA, Chrome 113+, model loaded | WebLLM (WebGPU) | Vercel function | ✅ Tier-source badge shows blue model name |
| PWA, Safari (no WebGPU) | Unavailable | Vercel function | ✅ Falls through to Gemini; amber hint shows "WebGPU not available" |
| Tauri, Ollama running, model pulled | OllamaAdapter (primary) | Rust proxy ✅ | ✅ Tier-source badge shows model name (Ollama) |
| Tauri, Ollama not running | null (no WebLLM fallback) | Rust proxy ✅ | ✅ Amber hint with diagnostics + Recheck + Download buttons |
| Tauri, Ollama cold-start race | Auto-retry after 3s | Rust proxy ✅ | ✅ Picks up Ollama on second attempt |
| Tauri, corporate proxy/VPN | `.no_proxy()` bypasses it | Rust proxy ✅ | ✅ Loopback traffic never goes through proxy |

---

## Why Tauri 2 + Ollama over alternatives

| Option | Pros | Cons |
|---|---|---|
| **Tauri 2 + Ollama** (this scaffold) | Native CUDA/Metal, no WebGPU dependency, 3-10× faster inference, supports 70B models, real FS, tiny binary (~15 MB) | Per-OS installers, requires Rust toolchain to build, Ollama must be installed by user |
| Electron + Ollama | Mature ecosystem, simpler toolchain | 100+ MB binaries, more memory, no real advantage over Tauri |
| PWA + WebLLM only (status quo) | Zero install, instant updates | Browser-only, 5 GB model cap, slower than native, no real FS |
| Tauri 2 + bundled LLM (no Ollama) | Single binary, no deps | Must ship model weights, can't reuse models user already has via Ollama, no GPU acceleration layer |

The hybrid approach (this scaffold) gives you **both** the PWA's
zero-install story **and** Tauri's native performance, with a single
React codebase.

---

## FAQ

**Q: Can I drop the PWA path entirely and go Tauri-only?**
A: Yes — delete `public/sw.js`, `public/manifest.webmanifest`, the SW
registration in `index.html`, and the `vercel.json` rewrites. But you
lose mobile support and instant updates. Recommend keeping both.

**Q: Will Ollama work over the network (not localhost)?**
A: Yes — set `OLLAMA_HOST` env var before launching Tauri. The Rust
code reads it via `std::env::var("OLLAMA_HOST")`. Useful for hosting
Ollama on a separate GPU machine.

**Q: Can I use a non-Ollama backend (e.g., llama.cpp server, LM Studio)?**
A: Yes — implement a new `LLMAdapter` (e.g. `LlamaCppAdapter`) and add
it to the factory's selection order. The interface is OpenAI-compatible
so most local servers work with minor HTTP-client tweaks.

**Q: How does the user enter their Gemini API key in Tauri mode?**
A: Same UI as PWA — the `ApiKeysView` component persists the key in
localStorage. The TODO item is wiring that key to a direct Gemini REST
call (no Vercel proxy) in Tauri mode.

**Q: Are IndexedDB glossaries shared between PWA and Tauri?**
A: No — each webview origin has its own IndexedDB. The PWA at
`https://rdat.vercel.app` and the Tauri app at `tauri://localhost` are
separate origins. Use the Glossary panel's JSON import/export to
transfer data between them.
