/**
 * Vercel Serverless Function: /api/health
 *
 * Minimal health-check endpoint that returns runtime info without
 * calling any external APIs. Useful for diagnosing whether the
 * serverless function runtime itself is working (vs. a Gemini SDK
 * crash, a Node version issue, or a deployment problem).
 *
 * If this endpoint returns valid JSON, the runtime is healthy and
 * any issues are in the Gemini-specific endpoints. If this endpoint
 * ALSO fails, the problem is at the Vercel/deployment level.
 *
 * Response: {
 *   ok: true,
 *   timestamp: string,
 *   nodeVersion: string,
 *   vercelRegion: string,
 *   hasGoogleGenAi: boolean  // whether @google/genai imported successfully
 * }
 */
export default {
  async fetch(_request: Request) {
    let hasGoogleGenAi = false;
    let genAiImportError: string | null = null;

    // Try to import @google/genai to detect ESM/runtime issues
    try {
      await import("@google/genai");
      hasGoogleGenAi = true;
    } catch (e: any) {
      genAiImportError = e?.message || String(e);
    }

    return Response.json({
      ok: true,
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      vercelRegion: process.env.VERCEL_REGION || "unknown",
      hasGoogleGenAi,
      genAiImportError,
    });
  },
};
