/**
 * Shared Gemini SDK helper for Vercel Serverless Functions.
 *
 * Lazy-initialises the Google GenAI client on first request, using either
 * the user-supplied key from the request body or the GEMINI_API_KEY
 * environment variable configured on Vercel.
 */
import { GoogleGenAI } from "@google/genai";

let aiInstance: GoogleGenAI | null = null;

export function getAI(userProvidedKey?: string): GoogleGenAI {
  const apiKey = userProvidedKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured. Please supply a valid key under the AI Studio Settings panel or API Keys view."
    );
  }
  // Cache the instance only when using the env-var key (same key every time).
  // User-provided keys may differ per request, so we create a fresh instance.
  if (!userProvidedKey && aiInstance) return aiInstance;

  const instance = new GoogleGenAI({ apiKey });
  if (!userProvidedKey) aiInstance = instance;
  return instance;
}
