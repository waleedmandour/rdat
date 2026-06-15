import React from "react";
import { useLanguage } from "../context/LanguageContext";
import { useSettingsStore } from "../stores/settings-store";
import { Sliders, Languages, Trash2, HelpCircle } from "lucide-react";
import { useDualStorage } from "../hooks/useDualStorage";
import { useToast } from "../context/ToastContext";

export function SettingsPanel() {
  const { locale, setLocale, t } = useLanguage();
  const isRTL = locale === "ar";
  const { showToast } = useToast();

  const { engineMode, setEngineMode, useCloudFallback, setUseCloudFallback } = useSettingsStore();
  const { clearGlossary, refreshCounts } = useDualStorage();

  return (
    <div className="h-full overflow-y-auto bg-background p-6" dir={isRTL ? "rtl" : "ltr"}>
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-black text-foreground">
            {t("nav.settings")}
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {isRTL 
              ? "تحكم ببيئة العمل، ومقدار حساسية المطابقة، ومظهره المفضل." 
              : "Adjust matching bounds, configure translations, and default language settings."}
          </p>
        </div>

        {/* Preferences */}
        <div className="bg-surface border border-border p-5 rounded-xl space-y-4">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-primary" />
            <h3 className="text-xs font-bold text-foreground">
              {isRTL ? "إعدادات الترجمة العامة" : "Workspace Adjustments"}
            </h3>
          </div>

          <div className="divide-y divide-border/50 text-xs">
            {/* UI Language Selection */}
            <div className="flex items-center justify-between py-3">
              <div>
                <div className="font-bold text-foreground">
                  {isRTL ? "لغة الواجهة" : "Interface Language"}
                </div>
                <div className="text-[10.5px] text-muted-foreground mt-0.5">
                  {isRTL ? "اختر اللغة الافتراضية لعناصر التحكم والقوائم." : "Change the language of sidebars, modals and buttons."}
                </div>
              </div>
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value as any)}
                className="bg-background border border-border rounded px-2.5 py-1 text-xs text-foreground focus:outline-none focus:border-primary/50"
              >
                <option value="en">English (US)</option>
                <option value="ar">العربية (Arabic)</option>
              </select>
            </div>

            {/* Translation Confidence Threshold */}
            <div className="flex items-center justify-between py-3">
              <div>
                <div className="font-bold text-foreground">
                  {isRTL ? "حساسية المطابقة للـ LTE" : "LTE Alignment Confidence"}
                </div>
                <div className="text-[10.5px] text-muted-foreground mt-0.5">
                  {isRTL ? "الحد الأدنى لقوة التشابه المطلوب لعرض نصوص شبحية." : "Determine strict similarity constraint for ghost-text auto completions."}
                </div>
              </div>
              <select
                defaultValue="0.4"
                className="bg-background border border-border rounded px-2.5 py-1 text-xs text-foreground focus:outline-none focus:border-primary/50"
              >
                <option value="0.25">Low (0.25)</option>
                <option value="0.4">Standard (0.40)</option>
                <option value="0.6">Conservative (0.60)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Maintenance */}
        <div className="bg-surface border border-border p-5 rounded-xl space-y-4">
          <h3 className="text-xs font-bold text-red-500 uppercase tracking-wider">
            {isRTL ? "المنطقة الحرجة" : "Danger Zone"}
          </h3>
          
          <div className="flex items-center justify-between text-xs">
            <div>
              <div className="font-bold text-foreground">
                {isRTL ? "مسح الذاكرة المحلية المخزنة" : "Purge Indexed Database"}
              </div>
              <div className="text-[10.5px] text-muted-foreground mt-0.5">
                {isRTL ? "حذف جميع قواعد بيانات المصطلحات والقوالب المرفوعة والبدء من جديد." : "Irreversibly delete all local glossary entries, draft translations, and segments."}
              </div>
            </div>
            <button
              onClick={async () => {
                if (confirm(isRTL ? "هل أنت متأكد من حذف الذاكرة بالكامل؟" : "Confirm database deletion? All imports will be lost.")) {
                  await clearGlossary();
                  await refreshCounts();
                  showToast(
                    isRTL ? "تم حذف قاعدة البيانات بنجاح!" : "IndexedDB successfully cleared!",
                    "success"
                  );
                }
              }}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-red-500/10 text-red-500 font-bold rounded-lg cursor-pointer hover:bg-red-500/15 transition-all"
            >
              <Trash2 className="w-4 h-4" />
              <span>{isRTL ? "مسح كلي" : "Purge All Data"}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
export default SettingsPanel;
