import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { getLTE } from "../../lib/local-translation-engine";
import type { CorpusEntry } from "../../lib/local-translation-engine";
import {
  isModelLoaded,
  generateLocalTranslation,
  generateRAGTranslation,
  prefetchTranslation,
  getPrefetch,
} from "../../lib/local-llm-engine";
import { getActiveAdapterSync, isTauriEnvironment } from "../../lib/adapters";
import type { LLMAdapter } from "../../lib/llm-adapter";
import { useGemini } from "../../hooks/useGemini";
import { useSettingsStore } from "../../stores/settings-store";
import { useUIStore } from "../../stores/ui-store";
import { useEditorActivityStore } from "../../stores/editor-activity-store";
import { useToast } from "../../context/ToastContext";
import {
  Sparkles,
  HelpCircle,
  CornerDownLeft,
  Volume2,
  Cpu,
  AlertTriangle,
  Zap
} from "lucide-react";
import { cn } from "../../lib/utils";

interface TargetEditorProps {
  sentenceIndex: number;
  sourceText: string;
  translationText: string;
  onChange: (text: string) => void;
  onConfirm: () => void;
  isActive: boolean;
  onHover: (hovered: boolean) => void;
  isHovered: boolean;
}

// ─── Edit Distance Utility ────────────────────────────────────────
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function deviationRatio(typed: string, suggestion: string): number {
  if (!suggestion) return 0;
  const maxLen = Math.max(typed.length, suggestion.length);
  if (maxLen === 0) return 0;
  return editDistance(typed, suggestion) / maxLen;
}

/**
 * Helper: compute ghost-text remainder from a full translation candidate
 * and the user's typed prefix.
 */
function computeGhostRemainder(typedText: string, candidate: string): string {
  const trimmed = typedText.trim();
  if (trimmed && candidate.startsWith(trimmed)) {
    return candidate.substring(trimmed.length);
  }
  if (trimmed && candidate.includes(trimmed)) {
    const idx = candidate.indexOf(trimmed);
    return candidate.substring(idx + trimmed.length);
  }
  // No prefix overlap — show the full suggestion as ghost
  return " " + candidate;
}

export function TargetEditor({
  sentenceIndex,
  sourceText,
  translationText,
  onChange,
  onConfirm,
  isActive,
  onHover,
  isHovered,
}: TargetEditorProps) {
  const { locale } = useLanguage();
  const isRTL = locale === "ar";

  const { generateBurst, loading } = useGemini();
  const { engineMode, useCloudFallback, loadedModel } = useSettingsStore();
  const { showToast } = useToast();
  const requestNav = useUIStore((s) => s.requestNav);
  const setEditorActivity = useEditorActivityStore((s) => s.setActivity);

  const [ghostSuggestion, setGhostSuggestion] = useState<string>("");
  const [suggestionCandidates, setSuggestionCandidates] = useState<string[]>([]);
  const [candidateIndex, setCandidateIndex] = useState(0);

  // ─── Tier Tracking State ───────────────────────────────────────
  // tierSource: which tier produced the current ghost suggestion
  //   - "lte"       : Tier 0 (Local Translation Engine — instant n-gram match)
  //   - "local-llm" : Tier 1 (WebGPU on-device LLM — PRIMARY ENGINE)
  //   - "gemini"    : Tier 2 (Cloud Gemini — SECONDARY fallback)
  //   - null        : No suggestion currently active
  //
  // tierError: when a tier failed, why. Used to render the inline
  // amber hint with action buttons (Load Model / Set API Key).
  // Note: tierError is NOT cleared when a different tier succeeds —
  // we want the user to keep seeing that the primary engine is down
  // even if Gemini is currently carrying the load.
  const [tierSource, setTierSource] = useState<"lte" | "local-llm" | "gemini" | null>(null);
  const [tierError, setTierError] = useState<{ tier: "local-llm" | "gemini"; message: string } | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestFetchId = useRef(0);

  const justAcceptedRef = useRef(false);
  const hasPrefetchedRef = useRef(false);
  const lastSuggestionTextRef = useRef<string>("");
  const DEVIATION_THRESHOLD = 0.6;
  const IDLE_PAUSE_MS = 2000; // Re-engage suggestions after 2s pause

  // Per-session toast dedup — prevents spamming the same error toast
  // on every keystroke / segment switch. Keys are error-class strings
  // (e.g. "tier1-no-model", "tier2-gemini-failed"). Cleared for a key
  // when that tier subsequently succeeds, so the user gets notified
  // again if it breaks a second time.
  const notifiedRef = useRef<Set<string>>(new Set());

  const notifyOnce = useCallback((
    key: string,
    message: string,
    type: "warning" | "error" | "info",
    clearOnSuccessKeys: string[] = []
  ) => {
    if (notifiedRef.current.has(key)) return;
    notifiedRef.current.add(key);
    // Clear any stale success keys so we can re-notify if it breaks again
    clearOnSuccessKeys.forEach((k) => notifiedRef.current.delete(k));
    showToast(message, type);
  }, [showToast]);

  const engineModeRef = useRef(engineMode);
  const useCloudFallbackRef = useRef(useCloudFallback);
  const loadedModelRef = useRef(loadedModel);
  const isRTLRef = useRef(isRTL);
  useEffect(() => { engineModeRef.current = engineMode; }, [engineMode]);
  useEffect(() => { useCloudFallbackRef.current = useCloudFallback; }, [useCloudFallback]);
  useEffect(() => { loadedModelRef.current = loadedModel; }, [loadedModel]);
  useEffect(() => { isRTLRef.current = isRTL; }, [isRTL]);

  const fetchSuggestions = useCallback(async (typedText: string) => {
    // ════════════════════════════════════════════════════════════════
    // Phase 3: Simplified 2-tier ghost-text pipeline
    //
    //   TIER 0: Prefetch Cache (instant, 0ms)
    //   TIER 1: RAG-LLM (LTE corpus as RAG + WebGPU inference)
    //           - LTE exact/partial matches are checked first (instant)
    //           - If no exact match, RAG-augmented LLM generates suggestion
    //           - LTE corpus feeds directly into the LLM as RAG context
    //   TIER 2: Cloud Gemini (fallback when local tiers fail)
    // ════════════════════════════════════════════════════════════════

    // ════════════════════════════════════════════════════════════════
    // Tier priority (per project spec):
    //   Tier 0  LTE           — instant corpus lookup (always free)
    //   Tier 1  Local LLM     — PRIMARY ENGINE (WebGPU on-device)
    //   Tier 2  Cloud Gemini  — SECONDARY fallback (only when Tier 1 down)
    //
    // Tier 1 failures are surfaced prominently (warning toast + amber
    // inline hint) because it is the core engine. Tier 2 failures are
    // surfaced quietly (info toast + gray hint) because it is optional.
    // ════════════════════════════════════════════════════════════════

    // ── TIER 0: Prefetch Cache + LTE (instant, 0ms) ──
    const cachedTranslation = getPrefetch(sourceText);
    if (cachedTranslation) {
      const remainder = computeGhostRemainder(typedText, cachedTranslation);
      if (remainder.trim()) {
        setGhostSuggestion(remainder);
        setSuggestionCandidates([cachedTranslation]);
        setCandidateIndex(0);
        setTierSource("lte");
        setTierError(null);
        lastSuggestionTextRef.current = cachedTranslation;
        return;
      }
    }

    const lte = getLTE();
    const hasCorpus = lte.getStats().entries > 0;

    // Step 0a: LTE instant exact/partial match (<5ms, always check)
    if (hasCorpus) {
      const localMatch = lte.getSuggestion(sourceText, typedText);
      if (localMatch && localMatch.remainder) {
        setGhostSuggestion(localMatch.remainder);
        setSuggestionCandidates([localMatch.match]);
        setCandidateIndex(0);
        setTierSource("lte");
        setTierError(null);
        lastSuggestionTextRef.current = localMatch.match;
        return;
      }
    }

    // ── TIER 1: Local LLM (PRIMARY ENGINE) ──
    // LTE corpus entries become RAG context for the LLM.
    //
    // Adapter pattern: in Tauri desktop mode with Ollama installed,
    // we use the OllamaAdapter (native CUDA/Metal, faster, supports
    // larger models). Otherwise we fall back to the legacy WebLLM
    // path (in-browser WebGPU). Both paths produce the same shape
    // of output (string[] candidates) so the rest of the pipeline
    // is identical.
    //
    // If Tier 1 is unavailable, we surface the precise reason so the
    // user knows exactly why ghost-text is missing — instead of the
    // old behavior where Tier 1 was silently skipped.
    const isCloudOnlyMode = engineModeRef.current === "cloud";
    if (!isCloudOnlyMode) {
      const adapter = getActiveAdapterSync();

      // ── Branch A: Active adapter (Ollama in Tauri, or WebLLM via adapter) ──
      if (adapter) {
        if (!adapter.isModelLoaded()) {
          const reason = !loadedModelRef.current
            ? (isTauriEnvironment()
                ? (isRTLRef.current
                    ? "لم يتم تحميل أي نموذج محلي بعد. افتح لوحة «النماذج» لتثبيت نموذج من Ollama."
                    : "No local model loaded yet. Open the Models panel to install a model from Ollama.")
                : (isRTLRef.current
                    ? "لم يتم تحميل أي نموذج محلي بعد. افتح لوحة «النماذج» لتحميل نموذج Qwen 1.5B أو Gemma 2B."
                    : "No local model loaded yet. Open the Models panel to load Qwen 1.5B or Gemma 2B."))
            : (isRTLRef.current
                ? "WebGPU غير متاح في هذا المتصفح. استخدم Chrome 113+ أو Edge 113+ لتشغيل النماذج المحلية."
                : "WebGPU not available in this browser. Use Chrome 113+ or Edge 113+ to run local models.");
          setTierError({ tier: "local-llm", message: reason });
          notifyOnce(
            "tier1-no-model",
            isRTLRef.current ? "المحرك الأساسي معطّل: " + reason : "Primary engine inactive: " + reason,
            "warning"
          );
        } else {
          const fetchId = ++latestFetchId.current;
          try {
            // Retrieve RAG entries from LTE for the adapter
            const ragEntries: CorpusEntry[] | undefined = hasCorpus
              ? getLTE().search(sourceText, 5)
              : undefined;

            const llmCandidates = await adapter.translate({
              sourceText,
              targetPrefix: typedText,
              ragEntries,
            });
            if (fetchId !== latestFetchId.current) return;

            if (llmCandidates.length > 0) {
              const best = llmCandidates[0];
              const remainder = computeGhostRemainder(typedText, best);
              setGhostSuggestion(remainder);
              setSuggestionCandidates(llmCandidates);
              setCandidateIndex(0);
              setTierSource("local-llm");
              setTierError((prev) => prev?.tier === "local-llm" ? null : prev);
              notifiedRef.current.delete("tier1-no-model");
              notifiedRef.current.delete("tier1-inference-failed");
              lastSuggestionTextRef.current = best;
              return;
            }
          } catch (e: any) {
            console.warn("[TargetEditor] Adapter inference failed:", e);
            const msg = e?.message || String(e);
            setTierError({ tier: "local-llm", message: msg });
            notifyOnce(
              "tier1-inference-failed",
              isRTLRef.current ? "فشل الاستدلال المحلي: " + msg : "Local LLM inference failed: " + msg,
              "warning"
            );
          }
        }
      }
      // ── Branch B: No adapter (legacy PWA path, direct WebLLM calls) ──
      // This branch is taken when the adapter factory hasn't resolved
      // yet (early page load) or returned null. We keep the original
      // direct-call path so the existing PWA behavior is unchanged.
      else if (isModelLoaded()) {
        const fetchId = ++latestFetchId.current;
        try {
          const llmCandidates = hasCorpus
            ? await generateRAGTranslation(sourceText, typedText, 5)
            : await generateLocalTranslation(sourceText, typedText);
          if (fetchId !== latestFetchId.current) return;

          if (llmCandidates.length > 0) {
            const best = llmCandidates[0];
            const remainder = computeGhostRemainder(typedText, best);
            setGhostSuggestion(remainder);
            setSuggestionCandidates(llmCandidates);
            setCandidateIndex(0);
            setTierSource("local-llm");
            setTierError((prev) => prev?.tier === "local-llm" ? null : prev);
            notifiedRef.current.delete("tier1-no-model");
            notifiedRef.current.delete("tier1-inference-failed");
            lastSuggestionTextRef.current = best;
            return;
          }
        } catch (e: any) {
          console.warn("[TargetEditor] Local LLM inference failed:", e);
          const msg = e?.message || String(e);
          setTierError({ tier: "local-llm", message: msg });
          notifyOnce(
            "tier1-inference-failed",
            isRTLRef.current ? "فشل الاستدلال المحلي: " + msg : "Local LLM inference failed: " + msg,
            "warning"
          );
        }
      } else {
        // No adapter AND no WebLLM model loaded — surface the reason
        const reason = !loadedModelRef.current
          ? (isRTLRef.current
              ? "لم يتم تحميل أي نموذج محلي بعد. افتح لوحة «النماذج» لتحميل نموذج."
              : "No local model loaded yet. Open the Models panel to load a model.")
          : (isRTLRef.current
              ? "WebGPU غير متاح في هذا المتصفح. في وضع سطح المكتب، ثبّت Ollama للحصول على الأداء الأمثل."
              : "WebGPU not available in this browser. In desktop mode, install Ollama for best performance.");
        setTierError({ tier: "local-llm", message: reason });
        notifyOnce(
          "tier1-no-model",
          isRTLRef.current ? "المحرك الأساسي معطّل: " + reason : "Primary engine inactive: " + reason,
          "warning"
        );
      }
    }

    // ── TIER 2: Cloud Gemini (SECONDARY FALLBACK) ──
    // Gemini is the SECONDARY tier. Failures here are quieter (info
    // toast) because the primary local-LLM tier should normally carry
    // the load. We still surface them so the user knows Gemini isn't
    // silently swallowing requests.
    if (useCloudFallbackRef.current && engineModeRef.current !== "local") {
      const fetchId = ++latestFetchId.current;
      try {
        const candidates = await generateBurst(sourceText, typedText);
        if (fetchId !== latestFetchId.current) return;
        if (candidates && candidates.length > 0) {
          const best = candidates[0];
          const remainder = computeGhostRemainder(typedText, best);
          setGhostSuggestion(remainder);
          setSuggestionCandidates(candidates);
          setCandidateIndex(0);
          setTierSource("gemini");
          // Only clear Gemini-tier errors — keep local-llm errors visible
          // so the user remembers the primary engine is still down.
          setTierError((prev) => prev?.tier === "gemini" ? null : prev);
          notifiedRef.current.delete("tier2-gemini-failed");
          lastSuggestionTextRef.current = best;
          return;
        }
      } catch (e: any) {
        console.warn("[TargetEditor] Gemini burst failed:", e);
        const msg = e?.message || String(e);
        setTierError((prev) => prev ?? { tier: "gemini", message: msg });
        notifyOnce(
          "tier2-gemini-failed",
          isRTLRef.current ? "Gemini الاحتياطي غير متاح: " + msg : "Gemini fallback unavailable: " + msg,
          "info"
        );
      }
    }

    // No suggestion found from any tier — clear ghost text but KEEP
    // tierError visible so the inline hint can guide the user.
    setGhostSuggestion("");
    setSuggestionCandidates([]);
    setTierSource(null);
    lastSuggestionTextRef.current = "";

    // Reset activity to idle after fetch completes
    setEditorActivity("idle");
  }, [sourceText, generateBurst]);

  // ─── Prefetch on segment focus + typing debounce + idle-pause re-engagement ───
  // Three trigger mechanisms:
  //   1. Segment focus: immediate prefetch + fetch
  //   2. Typing debounce: 400ms after last keystroke
  //   3. Idle pause: 2s after typing debounce fires, re-engage to provide
  //      "continuous assistance" during translator thinking pauses.
  //      This is the key differentiator: the system doesn't give up after
  //      one suggestion. It keeps trying while the translator pauses.
  useEffect(() => {
    if (!isActive) {
      hasPrefetchedRef.current = false;
      setGhostSuggestion("");
      setSuggestionCandidates([]);
      setCandidateIndex(0);
      setTierSource(null);
      justAcceptedRef.current = false;
      lastSuggestionTextRef.current = "";
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      return;
    }

    if (!hasPrefetchedRef.current) {
      hasPrefetchedRef.current = true;
      if (justAcceptedRef.current) {
        justAcceptedRef.current = false;
        return;
      }
      prefetchTranslation(sourceText).catch(() => {});
      fetchSuggestions(translationText).finally(() => setEditorActivity("idle"));
      return;
    }

    if (justAcceptedRef.current) {
      justAcceptedRef.current = false;
      return;
    }

    // Edit distance deviation detection
    if (lastSuggestionTextRef.current && translationText.trim()) {
      const deviation = deviationRatio(translationText.trim(), lastSuggestionTextRef.current);
      if (deviation > DEVIATION_THRESHOLD) {
        fetchSuggestions(translationText).finally(() => setEditorActivity("idle"));
        return;
      }
    }

    // Clear any existing timers
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

    // Timer 1: typing debounce (400ms) - fires shortly after typing stops
    setEditorActivity("typing");
    debounceRef.current = setTimeout(() => {
      setEditorActivity("suggesting");
      fetchSuggestions(translationText).finally(() => setEditorActivity("idle"));

      // Timer 2: idle-pause re-engagement (2s after debounce)
      // If the user hasn't typed anything for 2 seconds after the initial
      // suggestion, re-trigger to provide a fresh/updated suggestion.
      // This handles the "translator pauses to think" scenario.
      idleTimerRef.current = setTimeout(() => {
        // Only re-engage if the segment is still active and user hasn't typed
        if (isActive && translationText.trim()) {
          fetchSuggestions(translationText).finally(() => setEditorActivity("idle"));
        }
      }, IDLE_PAUSE_MS);
    }, 400);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
    };
  }, [isActive, translationText, fetchSuggestions, sourceText]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab" && ghostSuggestion) {
      e.preventDefault();
      justAcceptedRef.current = true;
      onChange(translationText + ghostSuggestion);
      setGhostSuggestion("");
      setSuggestionCandidates([]);
      return;
    }

    if (e.key === "ArrowRight" && e.ctrlKey && ghostSuggestion) {
      e.preventDefault();
      const trimmedSuggestion = ghostSuggestion.trimStart();
      const firstSpaceIdx = trimmedSuggestion.indexOf(" ");
      let nextPortion = "";
      if (firstSpaceIdx === -1) {
        nextPortion = ghostSuggestion;
      } else {
        const leadingSpacesCount = ghostSuggestion.length - trimmedSuggestion.length;
        nextPortion = ghostSuggestion.substring(0, leadingSpacesCount + firstSpaceIdx + 1);
      }
      justAcceptedRef.current = true;
      onChange(translationText + nextPortion);
      const remainingGhost = ghostSuggestion.substring(nextPortion.length);
      setGhostSuggestion(remainingGhost.trim() ? remainingGhost : "");
      if (!remainingGhost.trim()) setSuggestionCandidates([]);
      return;
    }

    if (e.key === "]" && e.altKey && suggestionCandidates.length > 1) {
      e.preventDefault();
      const nextIdx = (candidateIndex + 1) % suggestionCandidates.length;
      setCandidateIndex(nextIdx);
      const nextCandidate = suggestionCandidates[nextIdx];
      setGhostSuggestion(computeGhostRemainder(translationText, nextCandidate));
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setGhostSuggestion("");
      setSuggestionCandidates([]);
      return;
    }

    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      onConfirm();
      return;
    }
  }

  const handlePronunciation = () => {
    if (!translationText) return;
    const utterance = new SpeechSynthesisUtterance(translationText);
    utterance.lang = "ar-SA";
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={cn(
        "transition-all duration-200 flex flex-col gap-3 select-text relative",
        isActive
          ? "dark:bg-white/[0.02] bg-primary/5 border dark:border-white/15 border-primary/40 rounded-xl p-6 shadow-2xl z-10"
          : isHovered
          ? "dark:bg-white/[0.01] bg-surface-hover/50 border border-border/70 rounded-xl p-5 opacity-80"
          : "border-transparent py-4 opacity-50 hover:opacity-80"
      )}
    >
      {isActive && (
        <div className="absolute -top-3 right-6 px-2.5 py-0.5 bg-primary text-[9px] font-black tracking-widest text-white rounded-md shadow-md uppercase">
          {locale === "en" ? `Segment ${String(sentenceIndex + 1).padStart(2, "0")}` : `المقطع ${String(sentenceIndex + 1).padStart(2, "0")}`}
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground mr-1.5 ml-1.5">
        {!isActive && (
          <span className="font-semibold text-[9.5px] bg-muted/60 dark:bg-white/5 text-muted-foreground px-2 py-0.5 rounded">
            {locale === "en" ? `#${String(sentenceIndex + 1).padStart(2, "0")}` : `#${String(sentenceIndex + 1).padStart(2, "0")}`}
          </span>
        )}
        {isActive && <div />}
        
        <div className="flex items-center gap-2">
          {translationText && (
            <button
              onClick={handlePronunciation}
              className="p-1 rounded hover:bg-muted dark:hover:bg-white/5 text-muted-foreground hover:text-foreground cursor-pointer"
              title={isRTL ? "نطق الترجمة" : "Pronounce translation"}
            >
              <Volume2 className="w-3.5 h-3.5" />
            </button>
          )}
          <span className="font-bold text-primary text-[10px] tracking-widest">AR-SA</span>
        </div>
      </div>

      <div className="relative w-full">
        {/* Placeholder label — rendered above the textarea content area
            instead of as a native placeholder, so it never overlaps with
            the ghost-text suggestion box at the bottom. Only shows when
            the textarea is empty. */}
        {!translationText && (
          <div
            className="absolute top-3.5 right-4 text-sm md:text-base text-muted-foreground/40 font-medium pointer-events-none select-none"
            dir="rtl"
          >
            {isRTL ? "أدخل الترجمة العربية هنا..." : "Enter translation in Arabic..."}
          </div>
        )}
        <textarea
          ref={inputRef}
          value={translationText}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          dir="rtl"
          placeholder=""
          rows={2}
          className="w-full bg-background/50 dark:bg-[#0A0B0E] border dark:border-white/10 border-border/80 rounded-xl p-4 text-sm md:text-base text-foreground text-right focus:outline-none focus:border-primary/50 font-medium leading-relaxed resize-none transition-all"
        />

        {ghostSuggestion && isActive && (
          <div
            className="absolute bottom-3 left-4 pointer-events-none select-none text-[10px] font-mono text-primary/40 bg-primary/5 border border-primary/20 px-2.5 py-0.5 rounded-md flex items-center gap-1.5"
            dir={isRTL ? "rtl" : "ltr"}
          >
            <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
            <span>[Tab] {isRTL ? "إتمام تلقائي" : "Auto-complete"} (
              <span className={cn(
                "inline-flex items-center gap-0.5 px-1 rounded font-bold",
                tierSource === "lte" && "bg-emerald-500/15 text-emerald-500",
                tierSource === "local-llm" && "bg-blue-500/15 text-blue-500",
                tierSource === "gemini" && "bg-amber-500/15 text-amber-500"
              )}>
                {tierSource === "lte" && (isRTL ? "ذاكرة" : "LTE")}
                {tierSource === "local-llm" && loadedModel && (
                  <><Cpu className="w-3 h-3" />{loadedModel.toUpperCase()}</>
                )}
                {tierSource === "gemini" && (isRTL ? "سحابي" : "GEMINI")}
              </span>
            ): {ghostSuggestion}</span>
          </div>
        )}
      </div>

      {isActive && !ghostSuggestion && tierError && (
        <div
          className={cn(
            "mt-1 p-3 rounded-lg border text-[11px] flex items-start gap-2",
            tierError.tier === "local-llm"
              ? "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400"
              : "border-slate-500/25 bg-slate-500/5 text-muted-foreground"
          )}
          dir={isRTL ? "rtl" : "ltr"}
        >
          <AlertTriangle className={cn(
            "w-3.5 h-3.5 shrink-0 mt-0.5",
            tierError.tier === "local-llm" ? "text-amber-500" : "text-muted-foreground"
          )} />
          <div className="flex-1">
            <div className="font-bold mb-1">
              {tierError.tier === "local-llm"
                ? (isRTL ? "المحرك الأساسي معطّل" : "Primary engine inactive")
                : (isRTL ? "الترجمة السحابية غير متاحة" : "Cloud fallback unavailable")}
            </div>
            <div className="text-[10px] opacity-80 mb-2 leading-relaxed">
              {tierError.message}
            </div>
            <div className="flex gap-2 flex-wrap">
              {tierError.tier === "local-llm" && (
                <button
                  onClick={() => requestNav("models")}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-600 dark:text-amber-400 font-bold text-[10px] transition-all cursor-pointer"
                >
                  <Cpu className="w-3 h-3" />
                  {isRTL ? "تحميل نموذج محلي" : "Load Local Model"}
                </button>
              )}
              {tierError.tier === "gemini" && (
                <button
                  onClick={() => requestNav("api-keys")}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-500/15 hover:bg-slate-500/25 border border-slate-500/30 text-foreground font-bold text-[10px] transition-all cursor-pointer"
                >
                  <Zap className="w-3 h-3" />
                  {isRTL ? "إعداد مفتاح Gemini" : "Set Gemini API Key"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {isActive && (
        <div className="flex flex-wrap items-center justify-between pt-3 border-t dark:border-white/5 border-border/40 text-[10px] text-muted-foreground leading-loose" dir={isRTL ? "rtl" : "ltr"}>
          
          {suggestionCandidates.length > 0 ? (
            <div className="flex items-center gap-1.5 text-primary">
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                {isRTL 
                  ? `اضغط [Tab] للقبول أو Alt + ] للتنقل`
                  : `Press [Tab] to accept ghost translation | Alt + ] to cycle`}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/50" />
              <span>Ctrl + Enter {isRTL ? "للحفظ والتأكيد" : "to confirm segment"}</span>
            </div>
          )}

          <div className="flex items-center gap-3">
            {suggestionCandidates.length > 0 && (
              <div className="px-2 py-0.5 dark:bg-white/10 bg-primary/10 rounded text-[9px] text-primary font-mono tracking-tighter">
                {isRTL ? "مطابقة" : "MATCH"} 94%
              </div>
            )}
            <button
              onClick={onConfirm}
              className="flex items-center gap-1.5 p-1 px-3 py-1 rounded bg-primary text-white text-xs font-bold hover:bg-primary/95 transition-all cursor-pointer shadow-md"
            >
              <span>{isRTL ? "تأكيد" : "Confirm"}</span>
              <CornerDownLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
export default TargetEditor;
