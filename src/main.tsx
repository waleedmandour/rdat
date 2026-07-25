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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
