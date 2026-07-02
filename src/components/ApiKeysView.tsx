import React, { useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import { useSettingsStore } from "../stores/settings-store";
import { useToast } from "../context/ToastContext";
import { Key, Eye, EyeOff, CheckCircle2, Loader2, ExternalLink, XCircle } from "lucide-react";

export function ApiKeysView() {
  const { locale, t } = useLanguage();
  const isRTL = locale === "ar";
  const { showToast } = useToast();

  const { geminiApiKey, setGeminiApiKey, useCloudFallback, setUseCloudFallback } = useSettingsStore();

  const [showKey, setShowKey] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testMessage, setTestMessage] = useState<string>("");

  /**
   * Test the entered Gemini API key by calling the /api/translate/full
   * endpoint with a trivial source text. If the key is valid, Gemini
   * will return a translation; if not, we get a clear error.
   *
   * This is essential now that the server has no fallback key — users
   * need immediate feedback that their key works before relying on it
   * in the editor.
   */
  const handleTestKey = async () => {
    if (!geminiApiKey.trim()) {
      setTestStatus("fail");
      setTestMessage(isRTL ? "الرجاء إدخال مفتاح أولاً" : "Please enter a key first");
      return;
    }

    setTestStatus("testing");
    setTestMessage("");

    try {
      const response = await fetch("/api/translate/full", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceText: "Hello world.",
          geminiApiKey: geminiApiKey.trim(),
        }),
      });

      // Defensive parsing — Vercel may return non-JSON error pages on
      // function crashes, cold starts, or Node version issues.
      let rawText: string;
      try {
        rawText = await response.text();
      } catch (e: any) {
        throw new Error(`Failed to read response: ${e?.message || e}`);
      }

      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        const preview = rawText.slice(0, 200).replace(/\s+/g, " ").trim();
        const contentType = response.headers.get("content-type") || "";
        let diagnose: string;
        if (preview.toLowerCase().startsWith("a server error")) {
          diagnose = isRTL
            ? `خطأ في خادم Vercel (الحالة ${response.status}). غالباً مشكلة في تشغيل الدالة البرمجية. حاول مرة أخرى خلال 30 ثانية.`
            : `Vercel serverless function crashed (status ${response.status}). Likely a cold-start or runtime issue. Retry in 30s.`;
        } else if (contentType.includes("text/html") || preview.startsWith("<!DOCTYPE") || preview.startsWith("<html")) {
          diagnose = isRTL
            ? `استجابة HTML بدلاً من JSON (الحالة ${response.status}). مسار API قد لا يكون منشوراً بشكل صحيح.`
            : `Received HTML instead of JSON (status ${response.status}). The API route may not be deployed correctly.`;
        } else {
          diagnose = isRTL
            ? `استجابة غير صالحة (الحالة ${response.status})`
            : `Invalid response (status ${response.status})`;
        }
        setTestStatus("fail");
        setTestMessage(`${diagnose}\n\nPreview: "${preview}"`);
        showToast(isRTL ? "فشل التحقق من المفتاح" : "Key verification failed", "error");
        return;
      }

      if (response.ok && data.translation) {
        setTestStatus("ok");
        setTestMessage(
          isRTL
            ? `المفتاح صالح. ترجمة الاختبار: "${data.translation}"`
            : `Key is valid. Test translation: "${data.translation}"`
        );
        showToast(
          isRTL ? "تم التحقق من المفتاح بنجاح!" : "API key verified successfully!",
          "success"
        );
      } else {
        setTestStatus("fail");
        const errMsg = data.error || `HTTP ${response.status}`;
        setTestMessage(errMsg);
        showToast(
          isRTL ? "فشل التحقق من المفتاح: " + errMsg : "Key verification failed: " + errMsg,
          "error"
        );
      }
    } catch (err: any) {
      setTestStatus("fail");
      const msg = err?.message || String(err);
      setTestMessage(msg);
      showToast(
        isRTL ? "خطأ في الشبكة: " + msg : "Network error: " + msg,
        "error"
      );
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-background p-6" dir={isRTL ? "rtl" : "ltr"}>
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-black text-foreground">
            {t("nav.apiKeys")}
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {isRTL
              ? "أدخل مفتاحك الخاص للاستفادة من الاقتراحات السحابية. يتم حفظ المفتاح في متصفحك فقط."
              : "Provide your own API key for cloud-based suggestions. Your key is stored in your browser only."}
          </p>
        </div>

        {/* Gemini API key management card */}
        <div className="bg-surface border border-border p-5 rounded-xl space-y-4">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-primary" />
            <h3 className="text-xs font-bold text-foreground">
              {isRTL ? "مفتاح Gemini API" : "Gemini API Key Setup"}
            </h3>
          </div>

          <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/15 text-[11px] text-muted-foreground leading-relaxed">
            <Key className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
            <div>
              {isRTL ? (
                <span>
                  مفتاحك يُحفظ في متصفحك فقط (localStorage) ويُرسل مع كل طلب إلى الخادم.
                  لا يتم تخزين أي مفاتيح على الخادم. احصل على مفتاح مجاني من{" "}
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary font-bold hover:underline inline-flex items-center gap-0.5"
                  >
                    Google AI Studio <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </span>
              ) : (
                <span>
                  Your key is stored in your browser only (localStorage) and sent with each
                  request to the server. No keys are stored server-side. Get a free key from{" "}
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary font-bold hover:underline inline-flex items-center gap-0.5"
                  >
                    Google AI Studio <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? "text" : "password"}
                value={geminiApiKey}
                onChange={(e) => {
                  setGeminiApiKey(e.target.value);
                  // Reset test status when key changes
                  if (testStatus !== "idle") {
                    setTestStatus("idle");
                    setTestMessage("");
                  }
                }}
                placeholder={isRTL ? "أدخل مفتاح Gemini API هنا..." : "Enter your Gemini API key (starts with AIza...)..."}
                className="w-full bg-background border border-border rounded-lg pl-3 pr-10 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/50"
                spellCheck={false}
                autoComplete="off"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                title={showKey ? (isRTL ? "إخفاء" : "Hide") : (isRTL ? "إظهار" : "Show")}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* Test Key button — essential now that server has no fallback */}
            <button
              onClick={handleTestKey}
              disabled={!geminiApiKey.trim() || testStatus === "testing"}
              className="px-4 py-2 bg-primary/10 hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed border border-primary/30 rounded-lg text-xs font-bold text-primary shrink-0 cursor-pointer transition-all flex items-center gap-1.5"
              title={isRTL ? "اختبر المفتاح" : "Test key"}
            >
              {testStatus === "testing" ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{isRTL ? "جارٍ..." : "Testing..."}</span>
                </>
              ) : testStatus === "ok" ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>{isRTL ? "صالح" : "Valid"}</span>
                </>
              ) : testStatus === "fail" ? (
                <>
                  <XCircle className="w-3.5 h-3.5 text-rose-500" />
                  <span>{isRTL ? "إعادة" : "Retry"}</span>
                </>
              ) : (
                <>
                  <Key className="w-3.5 h-3.5" />
                  <span>{isRTL ? "اختبر" : "Test"}</span>
                </>
              )}
            </button>
          </div>

          {/* Test result feedback */}
          {testMessage && (
            <div
              className={
                "p-2.5 rounded-lg text-[11px] font-mono leading-relaxed " +
                (testStatus === "ok"
                  ? "bg-emerald-500/10 border border-emerald-500/25 text-emerald-600 dark:text-emerald-400"
                  : "bg-rose-500/10 border border-rose-500/25 text-rose-600 dark:text-rose-400")
              }
              dir="ltr"
            >
              {testMessage}
            </div>
          )}

          {/* Cloud fallback switch */}
          <div className="flex items-center justify-between pt-3 border-t border-border/40 text-xs">
            <div>
              <div className="font-bold text-foreground">
                {isRTL ? "مفتاح الاحتياط السحابي التلقائي" : "Cloud Fallback Engine"}
              </div>
              <div className="text-[10.5px] text-muted-foreground mt-0.5">
                {isRTL
                  ? "استخدام Gemini عند عدم توفر مطابقة محلية دقيقة."
                  : "Fall back to Gemini when local tiers yield low confidence."}
              </div>
            </div>
            <input
              type="checkbox"
              checked={useCloudFallback}
              onChange={(e) => setUseCloudFallback(e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
          </div>
        </div>

        {/* Privacy note */}
        <div className="bg-surface border border-border p-4 rounded-xl text-[11px] text-muted-foreground leading-relaxed">
          <div className="font-bold text-foreground mb-1.5 flex items-center gap-1.5">
            <Key className="w-3.5 h-3.5 text-primary" />
            {isRTL ? "ملاحظة الخصوصية" : "Privacy Note"}
          </div>
          {isRTL
            ? "يُحفظ مفتاح Gemini API في localStorage الخاص بمتصفحك ولا يُرسل إلا إلى وظائف Vercel Serverless الخاصة بهذا المشروع. لا يتم تخزين المفتاح على الخادم، ولا يتم تسجيله في سجلات الخادم. كل مستخدم يستخدم مفتاحه الخاص وحصته من Gemini."
            : "Your Gemini API key is stored in your browser's localStorage and is only sent to this project's Vercel serverless functions. The key is not stored server-side and is not logged. Each user uses their own key and their own Gemini quota."}
        </div>
      </div>
    </div>
  );
}
export default ApiKeysView;
