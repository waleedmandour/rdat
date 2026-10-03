/**
 * Shared Gemini configuration constants.
 *
 * Single source of truth for the default Gemini model ID. Referenced
 * by:
 *   - src/stores/settings-store.ts (frontend default)
 *   - src/lib/gemini-direct.ts (Tauri path default)
 *   - api/translate/burst.ts, full.ts, tutor-explain.ts (Vercel path
 *     default; also respects the GEMINI_MODEL env var)
 *   - src-tauri/src/commands/gemini.rs (Rust default — kept in sync
 *     manually; see the comment at the default assignment)
 *
 * Issue 1 (v0.4.1): the model ID was previously hardcoded as
 * "gemini-2.5-flash" in 7 places. It is now configurable. The default
 * is upgraded to "gemini-3.8-flash" (the latest stable Flash model as
 * of 2026-10-03; "gemini-4.0-flash" does not exist yet — the Gemini
 * 4.0 line has not shipped).
 *
 * Source for the current model lineup:
 *   https://ai.google.dev/gemini-api/docs/models
 *   https://ai.google.dev/gemini-api/docs/deprecations
 *
 * The deprecations page shows "gemini-2.5-flash" with "No shutdown
 * date announced" as of 2026-10-03, but Google's own note says listed
 * dates are "the earliest possible dates" and some teams have seen
 * "no longer available" errors before the announced date. Upgrading
 * to 3.8 Flash is the safe move.
 */

/**
 * The default Gemini model ID used when the user has not configured a
 * custom model and no GEMINI_MODEL env var is set.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

/**
 * Error message body patterns that indicate a model has been retired
 * or is no longer available. Used by isModelRetiredError() to classify
 * a Gemini API error as a ModelRetiredError (which surfaces a specific
 * actionable message instead of a generic fatal error).
 *
 * Sources: Google's deprecation communications + community reports of
 * pre-announcement shutdowns (discuss.ai.google.dev threads).
 */
export const MODEL_RETIRED_PATTERNS: readonly RegExp[] = [
  /not found/i,
  /not available/i,
  /no longer available/i,
  /deprecated/i,
  /shut\s*down/i,
  /retired/i,
  /discontinued/i,
  /model.*not\s*supported/i,
  /unsupported\s+model/i,
] as const;

/**
 * Check whether an error message indicates the Gemini model has been
 * retired or is no longer available. Pure — no side effects.
 *
 * @param message - the error message string (from the API response body
 *                   or the thrown Error's .message)
 * @returns true if the message matches a retirement pattern
 */
export function isModelRetiredMessage(message: string): boolean {
  if (!message) return false;
  return MODEL_RETIRED_PATTERNS.some((re) => re.test(message));
}

/**
 * Check whether an HTTP status code is consistent with a retired model.
 * Google returns 404 (model not found) or 503 (service unavailable /
 * model deprecated) for retired models, depending on the stage.
 *
 * @param status - the HTTP status code
 * @returns true if the status is 404 or 503
 */
export function isModelRetiredStatus(status: number): boolean {
  return status === 404 || status === 503;
}
