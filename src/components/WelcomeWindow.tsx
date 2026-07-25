import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useLanguage } from "../context/LanguageContext";
import { RdatLogo } from "./RdatLogo";
import { ChevronLeft, ChevronRight, Check, Server, Download, Play } from "lucide-react";

/**
 * WelcomeWindow - 3-page onboarding flow shown on first launch.
 *
 * Page 1: Welcome + app overview
 * Page 2: Install Ollama instructions
 * Page 3: Ready to translate (launch editor)
 *
 * Stored in localStorage so it only shows once. User can re-trigger
 * from Settings if needed.
 *
 * PHASE 2 task 2.2 — THEME-AWARENESS FLAGGED FOR PROJECT OWNER:
 * This splash is intentionally always-dark (bg-[#0A0B0E], bg-black/80
 * overlay, text-white/NN throughout). It has a distinct visual identity
 * (gradient progress bar, hero iconography) and is shown only once per
 * install. Converting it to follow the theme toggle would require
 * redesigning every text-white/NN opacity layer for a light-mode
 * counterpart. If the project owner decides it should follow the
 * toggle, the conversion is mechanical but spread across ~30 class
 * strings in this file. Until then it stays always-dark by design.
 */
const WELCOME_SEEN_KEY = "rdat_welcome_seen";

export function shouldShowWelcome(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(WELCOME_SEEN_KEY) !== "true";
}

export function markWelcomeSeen(): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(WELCOME_SEEN_KEY, "true");
  }
}

export function resetWelcome(): void {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(WELCOME_SEEN_KEY);
  }
}

interface WelcomeWindowProps {
  onComplete: () => void;
}

export function WelcomeWindow({ onComplete }: WelcomeWindowProps) {
  const { locale } = useLanguage();
  const isRTL = locale === "ar";
  const [page, setPage] = useState(0);
  const totalPages = 3;

  const handleComplete = () => {
    markWelcomeSeen();
    onComplete();
  };

  const handleNext = () => {
    if (page < totalPages - 1) {
      setPage(page + 1);
    } else {
      handleComplete();
    }
  };

  const handlePrev = () => {
    if (page > 0) setPage(page - 1);
  };

  const handleSkip = () => {
    handleComplete();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md"
      dir={isRTL ? "rtl" : "ltr"}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-[#0A0B0E] border border-white/10 rounded-2xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden"
      >
        {/* Progress bar */}
        <div className="h-1 bg-white/5">
          <motion.div
            className="h-full bg-gradient-to-r from-primary to-emerald-500"
            animate={{ width: `${((page + 1) / totalPages) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>

        <div className="p-8 min-h-[400px] flex flex-col">
          <AnimatePresence mode="wait">
            {/* Page 1: Welcome */}
            {page === 0 && (
              <motion.div
                key="page1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex-1 flex flex-col items-center text-center justify-center"
              >
                <RdatLogo size={80} className="mb-6" />
                <h1 className="text-2xl font-black text-white mb-2">
                  {isRTL ? "مرحباً بك في RDAT" : "Welcome to RDAT"}
                </h1>
                <p className="text-sm text-white/60 mb-4">
                  {isRTL ? "مساعد الترجمة الاحترافي" : "Translation Copilot"}
                </p>
                <p className="text-xs text-white/50 leading-relaxed max-w-sm">
                  {isRTL
                    ? "بيئة ترجمة احترافية مدعومة بالذكاء الاصطناعي للترجمة من الإنجليزية إلى العربية. تستخدم نماذج لغوية محلية عبر Ollama لتقديم اقتراحات فورية أثناء الترجمة."
                    : "An AI-powered translation workspace for professional English-to-Arabic translation. Uses local LLMs via Ollama to provide real-time suggestions as you translate."}
                </p>
                <div className="mt-6 grid grid-cols-3 gap-3 w-full max-w-xs">
                  <div className="text-center">
                    <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center mx-auto mb-1">
                      <Server className="w-5 h-5 text-primary" />
                    </div>
                    <span className="text-[9px] text-white/50">
                      {isRTL ? "محرك محلي" : "Local Engine"}
                    </span>
                  </div>
                  <div className="text-center">
                    <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center mx-auto mb-1">
                      <Check className="w-5 h-5 text-emerald-400" />
                    </div>
                    <span className="text-[9px] text-white/50">
                      {isRTL ? "خصوصية كاملة" : "Full Privacy"}
                    </span>
                  </div>
                  <div className="text-center">
                    <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center mx-auto mb-1">
                      <Play className="w-5 h-5 text-amber-400" />
                    </div>
                    <span className="text-[9px] text-white/50">
                      {isRTL ? "اقتراحات فورية" : "Live Suggestions"}
                    </span>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Page 2: Install Ollama */}
            {page === 1 && (
              <motion.div
                key="page2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex-1 flex flex-col"
              >
                <h2 className="text-lg font-bold text-white mb-4 text-center">
                  {isRTL ? "إعداد Ollama" : "Set Up Ollama"}
                </h2>
                <div className="space-y-4 flex-1">
                  <div className="flex items-start gap-3 p-3 bg-white/5 rounded-lg">
                    <div className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold shrink-0">1</div>
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {isRTL ? "تحميل Ollama" : "Download Ollama"}
                      </p>
                      <p className="text-xs text-white/50 mt-1">
                        {isRTL ? "من الموقع الرسمي ollama.com/download" : "From ollama.com/download"}
                      </p>
                      <a
                        href="https://ollama.com/download"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 mt-2 text-xs text-primary hover:underline"
                      >
                        <Download className="w-3 h-3" />
                        {isRTL ? "فتح الرابط" : "Open download page"}
                      </a>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-white/5 rounded-lg">
                    <div className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold shrink-0">2</div>
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {isRTL ? "تثبيت وتشغيل" : "Install and Run"}
                      </p>
                      <p className="text-xs text-white/50 mt-1">
                        {isRTL
                          ? "يثبت Ollama تلقائياً على Windows و macOS. على Linux، شغل: ollama serve"
                          : "Ollama auto-starts on Windows and macOS. On Linux, run: ollama serve"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-white/5 rounded-lg">
                    <div className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold shrink-0">3</div>
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {isRTL ? "تحميل نموذج" : "Pull a Model"}
                      </p>
                      <p className="text-xs text-white/50 mt-1">
                        {isRTL
                          ? "من لوحة النماذج في التطبيق، اضغط Pull على gemma4:e2b"
                          : "From the Models panel in the app, click Pull on gemma4:e2b"}
                      </p>
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-white/40 text-center mt-4">
                  {isRTL
                    ? "يمكنك تخطي هذه الخطوة واستخدام التطبيق في وضع محدود"
                    : "You can skip this and use the app in limited mode"}
                </p>
              </motion.div>
            )}

            {/* Page 3: Ready */}
            {page === 2 && (
              <motion.div
                key="page3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex-1 flex flex-col items-center text-center justify-center"
              >
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mb-4">
                  <Check className="w-8 h-8 text-emerald-400" />
                </div>
                <h2 className="text-xl font-bold text-white mb-2">
                  {isRTL ? "أنت جاهز!" : "You're Ready!"}
                </h2>
                <p className="text-sm text-white/60 mb-6 max-w-sm">
                  {isRTL
                    ? "ابدأ الترجمة الآن. اكتب نصاً بالإنجليزية في اللوحة اليسرى، ثم اكتب الترجمة العربية. ستظهر اقتراحات تلقائية أثناء الكتابة وعند التوقف."
                    : "Start translating now. Type English text in the left panel, then type your Arabic translation. Suggestions will appear as you type and when you pause."}
                </p>
                <div className="space-y-2 w-full max-w-xs">
                  <div className="flex items-center gap-2 text-xs text-white/50">
                    <kbd className="px-2 py-0.5 bg-white/10 rounded text-white/70 font-mono text-[10px]">Tab</kbd>
                    <span>{isRTL ? "لقبول الاقتراح" : "Accept suggestion"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-white/50">
                    <kbd className="px-2 py-0.5 bg-white/10 rounded text-white/70 font-mono text-[10px]">Ctrl+Enter</kbd>
                    <span>{isRTL ? "لحفظ المقطع" : "Save segment"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-white/50">
                    <kbd className="px-2 py-0.5 bg-white/10 rounded text-white/70 font-mono text-[10px]">Esc</kbd>
                    <span>{isRTL ? "لرفض الاقتراح" : "Dismiss suggestion"}</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Navigation */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-white/5">
            <button
              onClick={handleSkip}
              className="text-xs text-white/40 hover:text-white/70 transition-colors cursor-pointer"
            >
              {isRTL ? "تخطٍّ" : "Skip"}
            </button>
            <div className="flex items-center gap-2">
              {page > 0 && (
                <button
                  onClick={handlePrev}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-white/60 hover:text-white hover:bg-white/5 transition-all cursor-pointer flex items-center gap-1"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  {isRTL ? "التالي" : "Back"}
                </button>
              )}
              <button
                onClick={handleNext}
                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-primary text-white hover:bg-primary/90 transition-all cursor-pointer flex items-center gap-1"
              >
                {page === totalPages - 1
                  ? (isRTL ? "ابدأ الترجمة" : "Start Translating")
                  : (isRTL ? "التالي" : "Next")}
                {page < totalPages - 1 && <ChevronRight className="w-3.5 h-3.5" />}
                {page === totalPages - 1 && <Check className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default WelcomeWindow;
