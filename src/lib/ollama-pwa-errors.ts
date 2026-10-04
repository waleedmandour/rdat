/**
 * PWA Ollama connection error classification.
 *
 * Fix 2 (v0.4.3): when the PWA probes localhost:11434, the failure can
 * have several distinct causes, each requiring a different user message:
 *
 *   1. Ollama not running (connection refused)
 *   2. CORS blocked (OLLAMA_ORIGINS not set to this app's origin)
 *   3. Chrome Local Network Access permission denied
 *   4. Mixed-content block (HTTPS page → HTTP localhost)
 *   5. Network error (generic fallback)
 *
 * Distinguishing these from a fetch() failure is tricky because the
 * browser collapses CORS + LNA + mixed-content into a generic
 * TypeError("Failed to fetch"). We use heuristics:
 *
 *   - If we're on an HTTPS page and probing http://localhost → likely
 *     mixed-content (Chrome blocks this silently).
 *   - If the fetch threw a TypeError with no response → likely CORS or
 *     LNA or not-running. We can't distinguish CORS from not-running
 *     from JS alone (CORS failures look identical to connection-refused).
 *     The message tells the user to check both.
 *   - If we got a response with a non-200 status → Ollama is running
 *     but something else is wrong.
 */

export type OllamaConnectionErrorType =
  | "not-running"
  | "cors-or-lná"
  | "mixed-content"
  | "http-error"
  | "timeout"
  | "unknown";

export interface OllamaConnectionError {
  type: OllamaConnectionErrorType;
  message: string;
  messageAr: string;
  action: string;
  actionAr: string;
}

/**
 * Classify a PWA Ollama connection failure.
 *
 * @param error - the thrown error (TypeError from fetch, or an AbortError)
 * @param pageOrigin - the origin of the current page (window.location.origin)
 * @param ollamaUrl - the URL we tried to reach (http://localhost:11434/api/tags)
 * @param httpStatus - if we got a response, its status code (else null)
 */
export function classifyOllamaConnectionError(
  error: unknown,
  pageOrigin: string,
  ollamaUrl: string,
  httpStatus: number | null
): OllamaConnectionError {
  // If we got an HTTP response, Ollama is running but something is wrong
  if (httpStatus !== null && httpStatus !== 200) {
    return {
      type: "http-error",
      message: `Ollama responded with HTTP ${httpStatus}. It may be an old version or misconfigured.`,
      messageAr: `أولاما رد بـ HTTP ${httpStatus}. قد يكون إصداراً قديماً أو غير مُهيأ بشكل صحيح.`,
      action: "Update Ollama to the latest version and restart it.",
      actionAr: "حدّث أولاما إلى أحدث إصدار وأعِد تشغيله.",
    };
  }

  // Mixed-content: HTTPS page trying to reach HTTP localhost
  if (pageOrigin.startsWith("https://") && ollamaUrl.startsWith("http://")) {
    return {
      type: "mixed-content",
      message: "Browser blocked the connection: this page is HTTPS but Ollama is HTTP. Chrome blocks mixed-content.",
      messageAr: "المتصفح حظر الاتصال: هذه الصفحة HTTPS لكن أولاما HTTP. كروم يحظر المحتوى المختلط.",
      action: "Use the Tauri desktop app (which has no mixed-content restriction), or serve the PWA over HTTP (localhost only).",
      actionAr: "استخدم تطبيق سطح المكتب Tauri (بدون قيود المحتوى المختلط)، أو شغّل الـ PWA عبر HTTP (محلي فقط).",
    };
  }

  // Timeout
  if (error instanceof Error && error.name === "AbortError") {
    return {
      type: "timeout",
      message: "Connection timed out. Ollama may be starting up or overloaded.",
      messageAr: "انتهت مهلة الاتصال. قد يكون أولاما يبدأ التشغيل أو محمّلاً بشكل زائد.",
      action: "Wait a few seconds and try again.",
      actionAr: "انتظر بضع ثوانٍ ثم حاول مرة أخرى.",
    };
  }

  // TypeError "Failed to fetch" — the browser collapsed CORS / LNA / not-running
  // into one opaque error. We can't distinguish them from JS, so we tell
  // the user to check all three causes.
  const errMsg = error instanceof Error ? error.message : String(error);
  if (errMsg.includes("Failed to fetch") || errMsg.includes("NetworkError") || errMsg.includes("load failed")) {
    return {
      type: "cors-or-lná",
      message: "Could not reach Ollama. This is usually one of: (1) Ollama is not running, (2) OLLAMA_ORIGINS is not set to this app's origin, or (3) Chrome blocked Local Network Access.",
      messageAr: "تعذّر الوصول إلى أولاما. عادةً يكون أحد الأسباب: (1) أولاما لا يعمل، (2) OLLAMA_ORIGINS غير مضبوط على أصل هذا التطبيق، أو (3) كروم حظر الوصول إلى الشبكة المحلية.",
      action: `Set OLLAMA_ORIGINS to exactly "${pageOrigin}" and restart Ollama. On Windows: setx OLLAMA_ORIGINS "${pageOrigin}" then restart. On macOS: launchctl setenv OLLAMA_ORIGINS "${pageOrigin}" then restart. On Linux: add Environment=OLLAMA_ORIGINS="${pageOrigin}" to the systemd unit.`,
      actionAr: `اضبط OLLAMA_ORIGINS على "${pageOrigin}" بالضبط وأعِد تشغيل أولاما. على ويندوز: setx OLLAMA_ORIGINS "${pageOrigin}" ثم أعد التشغيل. على ماك: launchctl setenv OLLAMA_ORIGINS "${pageOrigin}" ثم أعد التشغيل. على لينكس: أضف Environment=OLLAMA_ORIGINS="${pageOrigin}" إلى وحدة systemd.`,
    };
  }

  // Unknown error
  return {
    type: "unknown",
    message: `Unexpected error: ${errMsg}`,
    messageAr: `خطأ غير متوقع: ${errMsg}`,
    action: "Check the browser console for details.",
    actionAr: "تحقق من وحدة تحكم المتصفح للتفاصيل.",
  };
}
