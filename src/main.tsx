import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { startWarmup } from './lib/vercel-warmup';

// Start Vercel serverless function warm-up to prevent cold starts
// when the user triggers Cloud Gemini suggestions.
startWarmup();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
