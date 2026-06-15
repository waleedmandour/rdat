/**
 * Vercel Serverless Function Warm-up Utility
 *
 * On Vercel's Free Tier, serverless functions experience cold starts
 * (500ms–3s) when they haven't been called recently. This utility
 * sends periodic lightweight requests to keep the functions warm,
 * ensuring ghost-text suggestions appear without perceptible delay.
 *
 * How it works:
 *   - Sends a HEAD/GET request to /api/translate/burst every 4 minutes
 *   - Vercel Free Tier functions stay warm for ~5 minutes after last call
 *   - Uses a simple ping (no heavy computation) to minimize execution time
 *   - Only runs when the browser tab is visible and online
 *   - Automatically stops when the tab is hidden or offline
 */

const WARMUP_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes (Vercel keeps warm ~5 min)
let warmupTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

/**
 * Send a lightweight ping to keep Vercel serverless functions warm.
 */
async function pingWarmup(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!navigator.onLine) return;

  try {
    // Use a lightweight request that will trigger the function but
    // return quickly (missing parameter → 400 response in <50ms)
    await fetch("/api/translate/burst", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceText: "" }), // Empty source → 400 fast
    });
    // We expect a 400 response — the function executed and stayed warm
  } catch {
    // Network error is fine — function may already be warm
  }
}

/**
 * Start the warm-up interval. Call this once when the app loads.
 * Safe to call multiple times — duplicates are ignored.
 */
export function startWarmup(): void {
  if (isRunning) return;
  isRunning = true;

  // Initial ping
  pingWarmup();

  // Set up recurring ping
  warmupTimer = setInterval(pingWarmup, WARMUP_INTERVAL_MS);

  // Pause warm-up when tab is hidden (saves bandwidth)
  document.addEventListener("visibilitychange", handleVisibilityChange);

  // Pause warm-up when offline
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  console.log("[Warmup] Vercel function warm-up started (every 4 min).");
}

/**
 * Stop the warm-up interval. Call this when the app unmounts.
 */
export function stopWarmup(): void {
  if (!isRunning) return;
  isRunning = false;

  if (warmupTimer) {
    clearInterval(warmupTimer);
    warmupTimer = null;
  }

  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.removeEventListener("online", handleOnline);
  window.removeEventListener("offline", handleOffline);

  console.log("[Warmup] Vercel function warm-up stopped.");
}

function handleVisibilityChange(): void {
  if (document.hidden) {
    // Tab hidden — pause warm-up to save bandwidth
    if (warmupTimer) {
      clearInterval(warmupTimer);
      warmupTimer = null;
    }
  } else {
    // Tab visible — resume warm-up with an immediate ping
    if (isRunning && !warmupTimer) {
      pingWarmup();
      warmupTimer = setInterval(pingWarmup, WARMUP_INTERVAL_MS);
    }
  }
}

function handleOnline(): void {
  // Network restored — ping immediately
  if (isRunning) {
    pingWarmup();
  }
}

function handleOffline(): void {
  // Network lost — pause warm-up (will resume on visibility change or online)
  if (warmupTimer) {
    clearInterval(warmupTimer);
    warmupTimer = null;
  }
}
