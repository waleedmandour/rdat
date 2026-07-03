import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useLanguage } from "../context/LanguageContext";
import { useToast } from "../context/ToastContext";
import {
  X,
  Download,
  Server,
  Check,
  Loader2,
  ExternalLink,
  Terminal,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { isTauriEnvironment } from "../lib/adapters";
import { cn } from "../lib/utils";

/**
 * OllamaOnboardingModal — First-run onboarding for the local LLM engine.
 *
 * Triggered on app startup when:
 *   - Running inside Tauri (desktop app)
 *   - AND Ollama daemon is not reachable on localhost:11434
 *
 * The modal is SKIPPABLE — users can dismiss it and use the app in
 * degraded mode (LTE only, no local LLM). This respects user agency
 * per the project's design principles.
 *
 * The modal shows a 3-step guide:
 *   1. Download Ollama from ollama.com (opens in browser via Tauri shell)
 *   2. Start the daemon (platform-specific instructions)
 *   3. Click "Check Again" to verify and dismiss
 *
 * "Don't show again" option stores a flag in localStorage so the modal
 * doesn't reappear on every startup. Users can re-trigger it from the
 * Models panel if they install Ollama later.
 *
 * In PWA mode (not Tauri), this modal is never shown — the app falls
 * back to WebLLM or Gemini-only mode without prompting.
 */

const SKIP_FLAG_KEY = "rdat_skip_ollama_onboarding";

export function OllamaOnboardingModal({
  open,
  onClose,
  onRetry,
  isChecking,
}: {
  open: boolean;
  onClose: () => void;
  onRetry: () => Promise<boolean>;
  isChecking: boolean;
}) {
  const { locale } = useLanguage();
  const isRTL = locale === "ar";
  const { showToast } = useToast();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [checkResult, setCheckResult] = useState<"idle" | "checking" | "ok" | "fail">("idle");

  // Detect platform for step 2 instructions
  const [platform, setPlatform] = useState<"windows" | "macos" | "linux">("linux");
  useEffect(() => {
    if (typeof navigator !== "undefined") {
      const ua = navigator.userAgent.toLowerCase();
      if (ua.includes("win")) setPlatform("windows");
      else if (ua.includes("mac")) setPlatform("macos");
      else setPlatform("linux");
    }
  }, []);

  const handleSkip = () => {
    localStorage.setItem(SKIP_FLAG_KEY, "true");
    onClose();
    showToast(
      isRTL
        ? "تم التخطي. يمكنك تثبيت Ollama لاحقاً من لوحة النماذج."
        : "Skipped. You can install Ollama later from the Models panel.",
      "info"
    );
  };

  const handleCheckAgain = async () => {
    setCheckResult("checking");
    const healthy = await onRetry();
    if (healthy) {
      setCheckResult("ok");
      localStorage.removeItem(SKIP_FLAG_KEY);
      showToast(
        isRTL ? "تم اكتشاف Ollama! يمكنك الآن تحميل النماذج." : "Ollama detected! You can now load models.",
        "success"
      );
      setTimeout(() => onClose(), 1200);
    } else {
      setCheckResult("fail");
    }
  };

  const handleDownloadOllama = async () => {
    const url = "https://ollama.com/download";
    if (isTauriEnvironment()) {
      try {
        const { open } = await import("@tauri-apps/plugin-shell");
        await open(url);
      } catch {
        window.open(url, "_blank");
      }
    } else {
      window.open(url, "_blank");
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        dir={isRTL ? "rtl" : "ltr"}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          className="bg-background border border-border rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Server className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-sm font-black text-foreground">
                  {isRTL ? "إعداد Ollama" : "Set up Ollama"}
                </h2>
                <p className="text-[10px] text-muted-foreground">
                  {isRTL ? "المحرك الأساسي للترجمة المحلية" : "Primary engine for local translation"}
                </p>
              </div>
            </div>
            <button
              onClick={handleSkip}
              className="p-1.5 rounded-lg hover:bg-surface-hover text-muted-foreground hover:text-foreground cursor-pointer"
              title={isRTL ? "تخطٍّ" : "Skip"}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 space-y-4">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {isRTL
                ? "RDAT Copilot يستخدم Ollama لتشغيل النماذج المحلية للترجمة. اتبع الخطوات التالية للإعداد:"
                : "RDAT Copilot uses Ollama to run local translation models. Follow these steps to set it up:"}
            </p>

            {/* Step 1: Download */}
            <OnboardingStep
              number={1}
              title={isRTL ? "تحميل Ollama" : "Download Ollama"}
              isActive={step === 1}
              isDone={step > 1}
              onDone={() => setStep(2)}
            >
              <p className="text-[11px] text-muted-foreground mb-3">
                {isRTL
                  ? "حمّل Ollama من الموقع الرسمي. متاح لنظام التشغيل:"
                  : "Download Ollama from the official website. Available for:"}
                {" "}
                <span className="font-bold text-foreground">
                  {platform === "windows" ? "Windows" : platform === "macos" ? "macOS" : "Linux"}
                </span>
              </p>
              <button
                onClick={() => { handleDownloadOllama(); setStep(2); }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-xs font-bold hover:bg-primary/90 transition-all cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                {isRTL ? "فتح ollama.com" : "Open ollama.com"}
                <ExternalLink className="w-3 h-3" />
              </button>
            </OnboardingStep>

            {/* Step 2: Start daemon */}
            <OnboardingStep
              number={2}
              title={isRTL ? "تشغيل الخادم" : "Start the daemon"}
              isActive={step === 2}
              isDone={step > 2}
              onDone={() => setStep(3)}
            >
              <div className="text-[11px] text-muted-foreground space-y-2">
                {platform === "windows" && (
                  <p>
                    {isRTL
                      ? "بعد التثبيت، يبدأ Ollama تلقائياً. ابحث عن أيقونة Ollama في شريط المهام."
                      : "After installation, Ollama starts automatically. Look for the Ollama icon in your taskbar."}
                  </p>
                )}
                {platform === "macos" && (
                  <p>
                    {isRTL
                      ? "بعد التثبيت، افتح Ollama من مجلد التطبيقات. سيعمل في الخلفية."
                      : "After installation, open Ollama from your Applications folder. It will run in the background."}
                  </p>
                )}
                {platform === "linux" && (
                  <div className="space-y-2">
                    <p>
                      {isRTL
                        ? "بعد التثبيت، شغّل الخادم يدوياً:"
                        : "After installation, start the daemon manually:"}
                    </p>
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-black/30 dark:bg-black/40 border border-border font-mono text-[10px] text-foreground">
                      <Terminal className="w-3 h-3 text-primary shrink-0" />
                      <code className="flex-1">ollama serve</code>
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={() => setStep(3)}
                className="mt-3 text-[10px] font-bold text-primary hover:underline cursor-pointer"
              >
                {isRTL ? "التالي ←" : "Continue →"}
              </button>
            </OnboardingStep>

            {/* Step 3: Verify */}
            <OnboardingStep
              number={3}
              title={isRTL ? "التحقق" : "Verify connection"}
              isActive={step === 3}
              isDone={checkResult === "ok"}
            >
              <p className="text-[11px] text-muted-foreground mb-3">
                {isRTL
                  ? "بعد تشغيل Ollama، انقر للتحقق من الاتصال:"
                  : "Once Ollama is running, click to verify the connection:"}
              </p>
              <button
                onClick={handleCheckAgain}
                disabled={checkResult === "checking" || isChecking}
                className={cn(
                  "inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer",
                  checkResult === "ok"
                    ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40"
                    : "bg-primary text-white hover:bg-primary/90"
                )}
              >
                {checkResult === "checking" || isChecking ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : checkResult === "ok" ? (
                  <Check className="w-3.5 h-3.5" />
                ) : checkResult === "fail" ? (
                  <RefreshCw className="w-3.5 h-3.5" />
                ) : (
                  <Server className="w-3.5 h-3.5" />
                )}
                {checkResult === "checking" || isChecking
                  ? (isRTL ? "جاري التحقق..." : "Checking...")
                  : checkResult === "ok"
                    ? (isRTL ? "متصل!" : "Connected!")
                    : checkResult === "fail"
                      ? (isRTL ? "إعادة المحاولة" : "Check again")
                      : (isRTL ? "تحقق الآن" : "Check now")}
              </button>
              {checkResult === "fail" && (
                <div className="mt-2 flex items-start gap-1.5 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-600 dark:text-amber-400">
                  <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                  <span>
                    {isRTL
                      ? "لم يتم اكتشاف Ollama. تأكد من تثبيته وتشغيله، ثم حاول مرة أخرى."
                      : "Ollama not detected. Make sure it's installed and running, then try again."}
                  </span>
                </div>
              )}
            </OnboardingStep>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-border flex items-center justify-between">
            <button
              onClick={handleSkip}
              className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
            >
              {isRTL ? "تخطٍّ — الاستمرار بدون Ollama" : "Skip — continue without Ollama"}
            </button>
            <span className="text-[10px] text-muted-foreground/60 font-mono">
              {isRTL ? "الوضع المحدود: LTE فقط" : "Degraded mode: LTE only"}
            </span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Onboarding Step Component ────────────────────────────────────

function OnboardingStep({
  number,
  title,
  isActive,
  isDone,
  onDone,
  children,
}: {
  number: number;
  title: string;
  isActive: boolean;
  isDone: boolean;
  onDone?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(
      "border rounded-xl p-3 transition-all",
      isDone ? "border-emerald-500/30 bg-emerald-500/5" : isActive ? "border-primary/40 bg-primary/5" : "border-border opacity-60"
    )}>
      <div className="flex items-center gap-2 mb-2">
        <div className={cn(
          "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0",
          isDone ? "bg-emerald-500 text-white" : isActive ? "bg-primary text-white" : "bg-muted text-muted-foreground"
        )}>
          {isDone ? <Check className="w-3 h-3" /> : number}
        </div>
        <span className={cn(
          "text-xs font-bold",
          isDone ? "text-emerald-600 dark:text-emerald-400" : isActive ? "text-foreground" : "text-muted-foreground"
        )}>
          {title}
        </span>
      </div>
      {isActive && <div className="ml-8">{children}</div>}
    </div>
  );
}

export default OllamaOnboardingModal;

// ─── Helper: should the modal show? ───────────────────────────────

export function shouldShowOllamaOnboarding(): boolean {
  if (!isTauriEnvironment()) return false;
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(SKIP_FLAG_KEY) !== "true";
}

export function resetOllamaOnboardingSkip(): void {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(SKIP_FLAG_KEY);
  }
}
