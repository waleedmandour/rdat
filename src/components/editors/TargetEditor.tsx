import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { getLTE } from "../../lib/local-translation-engine";
import {
  isModelLoaded,
  generateLocalTranslation,
  generateRAGTranslation,
  getLoadedModelId,
} from "../../lib/local-llm-engine";
import { useGemini } from "../../hooks/useGemini";
import { useSettingsStore } from "../../stores/settings-store";
import { 
  Sparkles, 
  HelpCircle, 
  CornerDownLeft, 
  ChevronRight, 
  Volume2,
  Cpu
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
// Levenshtein-based edit distance for deviation detection.
// When the user's typed text diverges significantly from the last
// ghost suggestion, we re-trigger a new suggestion fetch.
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

/** Returns a normalised deviation ratio (0–1) between typed text and suggestion. */
function deviationRatio(typed: string, suggestion: string): number {
  if (!suggestion) return 0;
  const maxLen = Math.max(typed.length, suggestion.length);
  if (maxLen === 0) return 0;
  return editDistance(typed, suggestion) / maxLen;
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

  const [ghostSuggestion, setGhostSuggestion] = useState<string>("");
  const [suggestionCandidates, setSuggestionCandidates] = useState<string[]>([]);
  const [candidateIndex, setCandidateIndex] = useState(0);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestFetchId = useRef(0);

  // ─── KEY FIX: Use a ref to track the "just-accepted" state ───
  // When the user accepts a ghost suggestion (Tab / Ctrl+Right), we set this
  // flag so the next translationText change doesn't trigger a new suggestion fetch.
  const justAcceptedRef = useRef(false);

  // ─── RISK MITIGATION: Prefetch on segment focus ───
  // Track whether this segment has been prefetched on initial focus.
  // When a segment becomes active for the first time, we immediately
  // fire a suggestion fetch (0ms debounce) so the user sees ghost-text
  // right away instead of waiting 400ms.
  const hasPrefetchedRef = useRef(false);

  // ─── RISK MITIGATION: Edit distance deviation detection ───
  // Track the last suggestion text so we can measure how far the user
  // has deviated. If deviation exceeds the threshold, we re-trigger
  // a new suggestion fetch even within the debounce window.
  const lastSuggestionTextRef = useRef<string>("");
  const DEVIATION_THRESHOLD = 0.6; // Re-trigger if >60% of characters differ

  // Debounced suggestion fetcher — avoids firing on every keystroke.
  // Uses refs for store values to keep the callback identity stable.
  const engineModeRef = useRef(engineMode);
  const useCloudFallbackRef = useRef(useCloudFallback);
  useEffect(() => { engineModeRef.current = engineMode; }, [engineMode]);
  useEffect(() => { useCloudFallbackRef.current = useCloudFallback; }, [useCloudFallback]);

  const fetchSuggestions = useCallback(async (typedText: string) => {
    // ── TIER 1: LTE Dictionary Match (instant, <5ms) ──
    // The Local Translation Engine uses exact/partial/n-gram matching against
    // the user's glossary corpus. It's the fastest tier and always runs first.
    // RISK MITIGATION: LTE remains as a lightweight fallback even when
    // higher tiers fail — it costs nothing and often produces useful matches.
    const lte = getLTE();
    if (lte.getStats().entries > 0) {
      const localMatch = lte.getSuggestion(sourceText, typedText);
      
      if (localMatch && localMatch.remainder) {
        setGhostSuggestion(localMatch.remainder);
        setSuggestionCandidates([localMatch.match]);
        setCandidateIndex(0);
        lastSuggestionTextRef.current = localMatch.match;
        return;
      }
    }

    // ── TIER 2: Local LLM On-Device Inference (~200-2000ms via WebGPU) ──
    // If a local model is loaded and the engine mode is not "cloud",
    // we ask the on-device LLM for a translation suggestion. This runs
    // entirely in the browser using WebGPU — no data leaves the device.
    // RISK MITIGATION: Uses selective RAG (generateRAGTranslation) to
    // include only the top-5 most relevant glossary entries as context,
    // keeping the prompt within token limits of smaller models.
    if (isModelLoaded() && engineModeRef.current !== "cloud") {
      const fetchId = ++latestFetchId.current;
      try {
        const lte = getLTE();
        const llmCandidates = lte.getStats().entries > 0
          ? await generateRAGTranslation(sourceText, typedText, 5)
          : await generateLocalTranslation(sourceText, typedText);
        // Discard stale results if a newer fetch was triggered
        if (fetchId !== latestFetchId.current) return;

        if (llmCandidates.length > 0) {
          setSuggestionCandidates(llmCandidates);
          setCandidateIndex(0);

          const best = llmCandidates[0];
          lastSuggestionTextRef.current = best;
          // Compute ghost remainder by removing the typed prefix
          if (typedText.trim() && best.startsWith(typedText.trim())) {
            setGhostSuggestion(best.substring(typedText.trim().length));
          } else if (typedText.trim() && best.includes(typedText.trim())) {
            // If the typed text appears somewhere in the translation, show the rest
            const idx = best.indexOf(typedText.trim());
            setGhostSuggestion(best.substring(idx + typedText.trim().length));
          } else {
            // No prefix overlap — show the full suggestion as ghost
            setGhostSuggestion(" " + best);
          }
          return;
        }
      } catch (e) {
        console.warn("[TargetEditor] Local LLM inference failed:", e);
        // Fall through to cloud fallback — LTE already checked above as
        // lightweight fallback, so this is the next tier.
      }
    }

    // ── TIER 3: Cloud Gemini Fallback ──
    // If LTE and Local LLM didn't produce results, and cloud is enabled,
    // we call the Gemini API for a cloud-based translation suggestion.
    if (useCloudFallbackRef.current && engineModeRef.current !== "local") {
      const fetchId = ++latestFetchId.current;
      try {
        const candidates = await generateBurst(sourceText, typedText);
        // Discard stale results if a newer fetch was triggered
        if (fetchId !== latestFetchId.current) return;
        if (candidates && candidates.length > 0) {
          setSuggestionCandidates(candidates);
          setCandidateIndex(0);
          
          // Deduct typed prefix to get the ghost remainder
          const best = candidates[0];
          lastSuggestionTextRef.current = best;
          if (best.startsWith(typedText)) {
            setGhostSuggestion(best.substring(typedText.length));
          } else {
            setGhostSuggestion(" " + best);
          }
          return;
        }
      } catch (e) {
        console.warn("[TargetEditor] Gemini burst failed:", e);
      }
    }

    // No suggestion found from any tier — clear
    setGhostSuggestion("");
    setSuggestionCandidates([]);
    lastSuggestionTextRef.current = "";
  }, [sourceText, generateBurst]);

  // ─── RISK MITIGATION: Prefetch on segment focus ───
  // When a segment becomes active, immediately fetch a suggestion with
  // zero debounce. Subsequent keystrokes use the normal 400ms debounce.
  useEffect(() => {
    if (!isActive) {
      hasPrefetchedRef.current = false;
      setGhostSuggestion("");
      setSuggestionCandidates([]);
      setCandidateIndex(0);
      justAcceptedRef.current = false;
      lastSuggestionTextRef.current = "";
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      return;
    }

    // On first activation, prefetch immediately (0ms debounce)
    if (!hasPrefetchedRef.current) {
      hasPrefetchedRef.current = true;
      // Skip if we just accepted a suggestion
      if (justAcceptedRef.current) {
        justAcceptedRef.current = false;
        return;
      }
      fetchSuggestions(translationText);
      return;
    }

    // Fetch suggestions even when the target is empty — the user should
    // see a ghost-text suggestion as soon as they focus a blank segment.
    // Previously this block returned early and prevented any suggestion
    // from appearing on empty text, which was the primary reason ghost-
    // text never showed up for new/untranslated segments.

    // If we just accepted a suggestion, skip this cycle and reset the flag
    if (justAcceptedRef.current) {
      justAcceptedRef.current = false;
      return;
    }

    // ─── RISK MITIGATION: Edit distance deviation detection ───
    // If the user's typed text has deviated significantly from the last
    // suggestion, re-trigger immediately instead of waiting for debounce.
    if (lastSuggestionTextRef.current && translationText.trim()) {
      const deviation = deviationRatio(translationText.trim(), lastSuggestionTextRef.current);
      if (deviation > DEVIATION_THRESHOLD) {
        // User has diverged — fetch fresh suggestions immediately
        fetchSuggestions(translationText);
        return;
      }
    }

    // Clear any pending debounce timer
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      fetchSuggestions(translationText);
    }, 400);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [isActive, translationText, fetchSuggestions]);

  // Keybindings handler
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 1. Tab accepts the full suggestion
    if (e.key === "Tab" && ghostSuggestion) {
      e.preventDefault();
      justAcceptedRef.current = true; // Prevent re-fetch
      const acceptedText = translationText + ghostSuggestion;
      onChange(acceptedText);
      setGhostSuggestion("");
      setSuggestionCandidates([]);
      return;
    }

    // 2. Ctrl + Right Arrow accepts next word of prediction
    if (e.key === "ArrowRight" && e.ctrlKey && ghostSuggestion) {
      e.preventDefault();
      const trimmedSuggestion = ghostSuggestion.trimStart();
      const firstSpaceIdx = trimmedSuggestion.indexOf(" ");
      let nextPortion = "";

      if (firstSpaceIdx === -1) {
        nextPortion = ghostSuggestion;
      } else {
        // Keep the leading spaces, plus the word, plus the space
        const leadingSpacesCount = ghostSuggestion.length - trimmedSuggestion.length;
        nextPortion = ghostSuggestion.substring(0, leadingSpacesCount + firstSpaceIdx + 1);
      }

      justAcceptedRef.current = true; // Prevent re-fetch for partial acceptance
      const updatedText = translationText + nextPortion;
      onChange(updatedText);

      // Update ghost to show remaining portion after word acceptance
      const remainingGhost = ghostSuggestion.substring(nextPortion.length);
      if (remainingGhost.trim()) {
        setGhostSuggestion(remainingGhost);
      } else {
        setGhostSuggestion("");
        setSuggestionCandidates([]);
      }
      return;
    }

    // 3. Alt + ] cycles translation candidates
    if (e.key === "]" && e.altKey && suggestionCandidates.length > 1) {
      e.preventDefault();
      const nextIdx = (candidateIndex + 1) % suggestionCandidates.length;
      setCandidateIndex(nextIdx);

      const nextCandidate = suggestionCandidates[nextIdx];
      if (nextCandidate.startsWith(translationText)) {
        setGhostSuggestion(nextCandidate.substring(translationText.length));
      } else {
        setGhostSuggestion(" " + nextCandidate);
      }
      return;
    }

    // 4. Escape dismisses suggestion
    if (e.key === "Escape") {
      e.preventDefault();
      setGhostSuggestion("");
      setSuggestionCandidates([]);
      return;
    }

    // 5. Ctrl + Enter confirms the segment
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      onConfirm();
      return;
    }
  }

  // Text-To-Speech (audio pronunciation) for student practice
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
      {/* Floating segment label matching styling of Immersive UI */}
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

      {/* Editor Main Text Area */}
      <div className="relative w-full">
        <textarea
          ref={inputRef}
          value={translationText}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          dir="rtl"
          placeholder={isRTL ? "أدخل الترجمة العربية هنا..." : "Enter translation in Arabic..."}
          rows={2}
          className="w-full bg-background/50 dark:bg-[#0A0B0E] border dark:border-white/10 border-border/80 rounded-xl p-4 text-sm md:text-base text-foreground text-right focus:outline-none focus:border-primary/50 font-medium leading-relaxed resize-none transition-all"
        />

        {/* Predictive ghost translation overlay */}
        {ghostSuggestion && isActive && (
          <div
            className="absolute bottom-3 left-4 pointer-events-none select-none text-[10px] font-mono text-primary/40 bg-primary/5 border border-primary/20 px-2.5 py-0.5 rounded-md flex items-center gap-1.5"
            dir={isRTL ? "rtl" : "ltr"}
          >
            <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
            <span>[Tab] {isRTL ? "إتمام تلقائي" : "Auto-complete"} ({loadedModel && isModelLoaded() ? (
              <span className="inline-flex items-center gap-0.5"><Cpu className="w-3 h-3" />{loadedModel.toUpperCase()}</span>
            ) : "LTE"}): {ghostSuggestion}</span>
          </div>
        )}
      </div>

      {/* Shortcut Indicator and Actions Bar */}
      {isActive && (
        <div className="flex flex-wrap items-center justify-between pt-3 border-t dark:border-white/5 border-border/40 text-[10px] text-muted-foreground leading-loose" dir={isRTL ? "rtl" : "ltr"}>
          
          {/* Predictive options/tips matching the design spec instructions */}
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
