/**
 * Shared Gemini SDK helper for Vercel Serverless Functions.
 *
 * Architecture (user-owned key model):
 *   The Gemini API key is ALWAYS provided by the user via the in-app
 *   API Keys panel. It is sent in the request body on every call and
 *   passed to this helper as `userProvidedKey`.
 *
 *   The server does NOT read `process.env.GEMINI_API_KEY`. This keeps
 *   the deployment zero-config (no Vercel env vars to set) and ensures
 *   each user bears their own API quota and billing.
 *
 *   If no key is provided, we throw a clear, actionable error that
 *   the frontend can surface to guide the user to the API Keys panel.
 */
import { GoogleGenAI } from "@google/genai";

// Cache the instance per-key to avoid re-constructing on every request.
// Keys are user-specific and may differ across requests, so we key the
// cache by the key itself. The cache is bounded to prevent unbounded
// memory growth in serverless environments.
const MAX_CACHE_SIZE = 8;
const instanceCache = new Map<string, GoogleGenAI>();

export function getAI(userProvidedKey?: string): GoogleGenAI {
  if (!userProvidedKey || !userProvidedKey.trim()) {
    throw new Error(
      "No Gemini API key provided. Please open the API Keys panel in the app and enter your key. " +
      "Get one for free at https://aistudio.google.com/apikey"
    );
  }

  const trimmedKey = userProvidedKey.trim();

  // Return cached instance if available
  const cached = instanceCache.get(trimmedKey);
  if (cached) return cached;

  // Evict oldest entry if cache is full (simple FIFO-ish via Map insertion order)
  if (instanceCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = instanceCache.keys().next().value;
    if (oldestKey) instanceCache.delete(oldestKey);
  }

  const instance = new GoogleGenAI({ apiKey: trimmedKey });
  instanceCache.set(trimmedKey, instance);
  return instance;
}
