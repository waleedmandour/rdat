import { useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import { useSettingsStore } from "../stores/settings-store";
import { Key, Eye, EyeOff, CheckCircle2 } from "lucide-react";

export function ApiKeysView() {
  const { locale, t } = useLanguage();
  const isRTL = locale === "ar";

  const {
    geminiApiKey,
    setGeminiApiKey,
    rememberApiKey,
    setRememberApiKey,
    useCloudFallback,
    setUseCloudFallback,
  } = useSettingsStore();

  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <div className="h-full overflow-y-auto bg-background p-6" dir={isRTL ? "rtl" : "ltr"}>
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-black text-foreground">
            {t("nav.apiKeys")}
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {isRTL 
              ? "قم بتغذية بيئة العمل بمفاتيح التشغيل للاستفادة من الاقتراحات السحابية." 
              : "Provide your own API keys to query advanced cloud models and translation assistance."}
          </p>
        </div>

        {/* Gemini api key management card */}
        <div className="bg-surface border border-border p-5 rounded-xl space-y-4">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-primary" />
            <h3 className="text-xs font-bold text-foreground">
              {isRTL ? "مفتاح Gemini API" : "Gemini API Key Setup"}
            </h3>
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {isRTL
              ? "يتم حفظ مفتاحك في الذاكرة فقط افتراضياً ويُمحى عند إغلاق التطبيق. إذا أردت الإبقاء عليه بين الجلسات، فعّل خيار «تذكّر المفتاح على هذا الجهاز» أدناه. لا تتم مشاركة المفتاح مع أي طرف ثالث ويُمرَّر حصرياً عبر وكيل الخادم."
              : "Your API key is held in memory only by default and cleared when the app closes. To persist it between sessions, enable \"Remember API key on this device\" below. The key is never shared with third parties and is forwarded exclusively via the server proxy."}
          </p>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? "text" : "password"}
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
                placeholder={isRTL ? "أدخل مفتاح Gemini API هنا..." : "Enter your GEMINI_API_KEY..."}
                className="w-full bg-background border border-border rounded-lg pl-3 pr-10 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/50"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {geminiApiKey && (
              <button
                onClick={() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="px-4 py-2 bg-muted hover:bg-muted/80 rounded-lg text-xs font-semibold text-foreground shrink-0 cursor-pointer"
              >
                {copied ? (
                  <span className="flex items-center gap-1 text-emerald-500">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{isRTL ? "تم" : "Saved"}</span>
                  </span>
                ) : (
                  <span>{isRTL ? "حفظ" : "Save"}</span>
                )}
              </button>
            )}
          </div>

          {/* Cloud fallback switch */}
          <div className="flex items-center justify-between pt-3 border-t border-border/40 text-xs">
            <div>
              <div className="font-bold text-foreground">
                {isRTL ? "مفتاح الاحتياط السحابي التلقائي" : "Cloud Fallback Engine"}
              </div>
              <div className="text-[10.5px] text-muted-foreground mt-0.5">
                {isRTL ? "استخدام النماذج السحابية عند عدم توفر مطابقة دقيقة محلياً." : "Fall back to Gemini API models when local indices yield low confidence."}
              </div>
            </div>
            <input
              type="checkbox"
              checked={useCloudFallback}
              onChange={(e) => setUseCloudFallback(e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
          </div>

          {/* Remember API key opt-in (audit fix #2) */}
          <div className="flex items-center justify-between pt-3 border-t border-border/40 text-xs">
            <div>
              <div className="font-bold text-foreground">
                {isRTL ? "تذكّر المفتاح على هذا الجهاز" : "Remember API key on this device"}
              </div>
              <div className="text-[10.5px] text-muted-foreground mt-0.5">
                {isRTL
                  ? "إذا كان مفعّلاً، يُحفظ المفتاح في ذاكرة المتصفح بين الجلسات. معطّل افتراضياً للأمان — المفتاح يُحفظ في الذاكرة فقط ويُمحى عند الإغلاق."
                  : "When enabled, the key is persisted in browser storage between sessions. Disabled by default for security — the key is held in memory only and cleared on close."}
              </div>
            </div>
            <input
              type="checkbox"
              checked={rememberApiKey}
              onChange={(e) => setRememberApiKey(e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
export default ApiKeysView;
