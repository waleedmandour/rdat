/**
 * Lightweight per-instance rate limiter for Vercel serverless functions.
 *
 * SECURITY (audit fix #4): without rate limiting, anyone could hit
 * /api/translate/* indefinitely and either exhaust the env-default
 * Gemini API key quota or rack up charges for whoever's key was used.
 *
 * This is a simple in-memory token bucket per client IP. It only
 * limits within a single serverless instance — Vercel may spin up
 * multiple instances under load, so the effective limit is N× this
 * (where N is the number of warm instances). That's still much better
 * than no limit at all and is the cheapest fix that doesn't require
 * external state (Redis/KV). For a stricter limit, wire up
 * @vercel/kv or Upstash Redis and replace this module.
 *
 * Limits:
 *   - 30 requests per minute per IP (ghost-text burst use is well
 *     under this; a translator typing fast generates ~10 req/min)
 *   - 200 requests per hour per IP (sustained-use cap)
 */

const WINDOW_MS_MIN = 60 * 1000;
const WINDOW_MS_HOUR = 60 * 60 * 1000;
const MAX_PER_MIN = 30;
const MAX_PER_HOUR = 200;

interface Bucket {
  minuteHits: number[];
  hourHits: number[];
}

// Map<ip, Bucket>. Cleared when the serverless instance recycles
// (Vercel reuses instances for ~5 min between cold starts).
const buckets = new Map<string, Bucket>();

function getClientIp(request: Request): string {
  // Vercel populates x-forwarded-for with the client IP. Fall back to
  // "unknown" if missing (rare; usually only happens behind a custom
  // proxy). When the IP is unknown, all such requests share a single
  // bucket — acceptable degradation.
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

function pruneOldHits(hits: number[], windowMs: number): number[] {
  const cutoff = Date.now() - windowMs;
  return hits.filter((t) => t > cutoff);
}

export interface RateLimitResult {
  allowed: boolean;
  /** Reason for denial, if not allowed. */
  reason?: string;
  /** Seconds until the client should retry, if not allowed. */
  retryAfterSeconds?: number;
}

export function checkRateLimit(request: Request): RateLimitResult {
  const ip = getClientIp(request);
  const now = Date.now();

  let bucket = buckets.get(ip);
  if (!bucket) {
    bucket = { minuteHits: [], hourHits: [] };
    buckets.set(ip, bucket);
  }

  bucket.minuteHits = pruneOldHits(bucket.minuteHits, WINDOW_MS_MIN);
  bucket.hourHits = pruneOldHits(bucket.hourHits, WINDOW_MS_HOUR);

  if (bucket.minuteHits.length >= MAX_PER_MIN) {
    const oldestMin = bucket.minuteHits[0] ?? now;
    const retryAfterSeconds = Math.ceil((WINDOW_MS_MIN - (now - oldestMin)) / 1000);
    return {
      allowed: false,
      reason: "Rate limit exceeded: too many requests per minute",
      retryAfterSeconds: Math.max(1, retryAfterSeconds),
    };
  }

  if (bucket.hourHits.length >= MAX_PER_HOUR) {
    const oldestHour = bucket.hourHits[0] ?? now;
    const retryAfterSeconds = Math.ceil((WINDOW_MS_HOUR - (now - oldestHour)) / 1000);
    return {
      allowed: false,
      reason: "Rate limit exceeded: too many requests per hour",
      retryAfterSeconds: Math.max(1, retryAfterSeconds),
    };
  }

  bucket.minuteHits.push(now);
  bucket.hourHits.push(now);
  return { allowed: true };
}

/**
 * Input-size guard for translation requests. Caps sourceText and
 * targetPrefix to a reasonable length so a malicious caller can't
 * exhaust the function's memory/timeout budget by POSTing a 10MB body.
 *
 * 10,000 chars is ~1,500-2,000 words — far beyond any realistic
 * single-segment translation. Long documents are split into segments
 * client-side before being sent.
 */
export const MAX_SOURCE_TEXT_LENGTH = 10_000;
export const MAX_TARGET_PREFIX_LENGTH = 5_000;

export interface SizeCheckResult {
  ok: boolean;
  error?: string;
}

export function checkInputSize(sourceText: unknown, targetPrefix: unknown): SizeCheckResult {
  if (typeof sourceText === "string" && sourceText.length > MAX_SOURCE_TEXT_LENGTH) {
    return {
      ok: false,
      error: `sourceText too long (${sourceText.length} chars; max ${MAX_SOURCE_TEXT_LENGTH}). Split the document into smaller segments.`,
    };
  }
  if (typeof targetPrefix === "string" && targetPrefix.length > MAX_TARGET_PREFIX_LENGTH) {
    return {
      ok: false,
      error: `targetPrefix too long (${targetPrefix.length} chars; max ${MAX_TARGET_PREFIX_LENGTH}).`,
    };
  }
  return { ok: true };
}
