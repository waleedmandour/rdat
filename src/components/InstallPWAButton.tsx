import React, { useState, useEffect } from "react";
import { useLanguage } from "../context/LanguageContext";
import { HardDrive, X, Sparkles } from "lucide-react";

export function InstallPWAButton() {
  const { locale } = useLanguage();
  const isRTL = locale === "ar";
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    // Check if app is not already running standalone
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
    if (!isStandalone) {
      const timer = setTimeout(() => {
        setShowPrompt(true);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  if (!showPrompt) return null;

  return (
    <div
      className="bg-primary/20 border-b border-primary/20 text-foreground px-4 py-2 text-xs flex items-center justify-between font-medium select-none animate-slide-down"
      dir={isRTL ? "rtl" : "ltr"}
    >
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary shrink-0 animate-bounce" />
        <span>
          {isRTL 
            ? "تلميح: أضف التطبيق لشاشتك المنزلية عبر النقر على زر مشاركة المتصفح → 'إضافة للشاشة الرئيسية' لتشغيله كـ PWA حتى دون إنترنت." 
            : "Tip: Pin RDAT Copilot to your homescreen. Click your Browser Share menu → 'Add to Homescreen' to access your offline CAT database natively!"}
        </span>
      </div>
      <button
        onClick={() => setShowPrompt(false)}
        className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-foreground cursor-pointer shrink-0 ml-4 rtl:ml-0 rtl:mr-4"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
export default InstallPWAButton;
