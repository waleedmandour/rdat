import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { startWarmup } from './lib/vercel-warmup';
import { isTauriEnvironment } from './lib/adapters/ollama-adapter';

// Start Vercel serverless function warm-up to prevent cold starts
// when the user triggers Cloud Gemini suggestions.
//
// Audit fix #9: only run in PWA/browser mode. In Tauri desktop mode
// there are no Vercel functions to keep warm — the frontend is bundled
// into the app and loaded from tauri://localhost. Every 4-min fetch
// to /api/translate/burst would 404 and waste bandwidth + fill the
// console with noise.
if (!isTauriEnvironment()) {
  startWarmup();
}

// Issue 3 (v0.4.1): request persistent storage on boot so the browser
// is less likely to evict IndexedDB data (segments, glossary, TM) under
// storage pressure. Best-effort — don't block on it. Some browsers
// prompt the user; others auto-grant based on heuristics (installed
// PWA, bookmarks, frequent visits). If denied, data still works but
// may be evicted. In Tauri mode, storage is always persistent (no
// browser eviction), so skip the call.
if (!isTauriEnvironment() && navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {
    // Non-fatal — the app still works without persistence.
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
