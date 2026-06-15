import React, { useState, useEffect, useRef } from "react";
import { useLanguage } from "../context/LanguageContext";
import { HardDrive, X, Sparkles, Download } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPWAButton() {
  const { locale } = useLanguage();
  const isRTL = locale === "ar";
  const [showPrompt, setShowPrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Check if app is already running as standalone PWA
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;

    if (isStandalone) {
      setIsInstalled(true);
      return;
    }

    // Capture the beforeinstallprompt event
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
      // Show the install prompt after a short delay
      setTimeout(() => setShowPrompt(true), 2500);
    };

    // Listen for successful installation
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setShowPrompt(false);
      deferredPromptRef.current = null;
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    // Also show a generic tip after 4s if the beforeinstallprompt hasn't fired
    // (e.g., on browsers that don't support it, or where the app is already installable)
    const tipTimer = setTimeout(() => {
      if (!deferredPromptRef.current && !isStandalone) {
        setShowPrompt(true);
      }
    }, 4000);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      clearTimeout(tipTimer);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPromptRef.current) {
      // Use the native install prompt
      await deferredPromptRef.current.prompt();
      const choice = await deferredPromptRef.current.userChoice;
      if (choice.outcome === "accepted") {
        setIsInstalled(true);
        setShowPrompt(false);
      }
      deferredPromptRef.current = null;
    }
  };

  if (!showPrompt || isInstalled) return null;

  const hasNativePrompt = !!deferredPromptRef.current;

  return (
    <div
      className="bg-primary/10 border-b border-primary/20 text-foreground px-4 py-2.5 text-xs flex items-center justify-between font-medium select-none animate-slide-down"
      dir={isRTL ? "rtl" : "ltr"}
    >
      <div className="flex items-center gap-2.5">
        <Sparkles className="w-4 h-4 text-primary shrink-0 animate-bounce" />
        <span>
          {hasNativePrompt
            ? isRTL
              ? "تثبيت تطبيق RDAT على جهازك للعمل دون اتصال!"
              : "Install RDAT Copilot on your device for offline access!"
            : isRTL
              ? "تلميح: أضف التطبيق لشاشتك المنزلية عبر النقر على زر مشاركة المتصفح → 'إضافة للشاشة الرئيسية' لتشغيله كـ PWA حتى دون إنترنت."
              : "Tip: Pin RDAT Copilot to your homescreen. Click your Browser Share menu → 'Add to Homescreen' to access your offline CAT database natively!"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {hasNativePrompt && (
          <button
            onClick={handleInstallClick}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-[10px] font-bold hover:bg-primary/95 transition-all cursor-pointer shadow-md"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isRTL ? "تثبيت التطبيق" : "Install App"}</span>
          </button>
        )}
        <button
          onClick={() => setShowPrompt(false)}
          className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-foreground cursor-pointer shrink-0 ml-2 rtl:ml-0 rtl:mr-2"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
export default InstallPWAButton;
