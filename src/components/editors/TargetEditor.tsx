import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { getLTE } from "../../lib/local-translation-engine";
import {
  isModelLoaded,
  generateLocalTranslation,
  generateRAGTranslation,
  prefetchTranslation,
  getPrefetch,
} from "../../lib/local-llm-engine";
import { useGemini } from "../../hooks/useGemini";
import { useSettingsStore } from "../../stores/settings-store";
import { 
  Sparkles, 
  HelpCircle, 
  CornerDownLeft, 
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

  const [ghostSuggestion, setGhostSuggestion] = useState<string>("");
  const [suggestionCandidates, setSuggestionCandidates] = useState<string[]>([]);
  const [candidateIndex, setCandidateIndex] = useState(0);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestFetchId = useRef(0);

  const justAcceptedRef = useRef(false);
  const hasPrefetchedRef = useRef(false);
  const lastSuggestionTextRef = useRef<string>("");
  const DEVIATION_THRESHOLD = 0.6;

  const engineModeRef = useRef(engineMode);
  const useCloudFallbackRef = useRef(useCloudFallback);
  useEffect(() => { engineModeRef.current = engineMode; }, [engineMode]);
  useEffect(() => { useCloudFallbackRef.current = useCloudFallback; }, [useCloudFallback]);

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

    // ── TIER 0: Prefetch Cache (instant, 0ms) ──
    const cachedTranslation = getPrefetch(sourceText);
    if (cachedTranslation) {
      const remainder = computeGhostRemainder(typedText, cachedTranslation);
      if (remainder.trim()) {
        setGhostSuggestion(remainder);
        setSuggestionCandidates([cachedTranslation]);
        setCandidateIndex(0);
        lastSuggestionTextRef.current = cachedTranslation;
        return;
      }
    }

    // ── TIER 1: RAG-LLM (LTE + Local LLM merged) ──
    // LTE is now the RAG retrieval layer that feeds into the LLM.
    // We still check LTE for instant exact matches first (they're free),
    // then fall through to the RAG-augmented LLM for fuzzy/complex cases.
    const lte = getLTE();
    const hasCorpus = lte.getStats().entries > 0;

    // Step 1a: LTE instant exact/partial match (<5ms, always check)
    if (hasCorpus) {
      const localMatch = lte.getSuggestion(sourceText, typedText);
      if (localMatch && localMatch.remainder) {
        setGhostSuggestion(localMatch.remainder);
        setSuggestionCandidates([localMatch.match]);
        setCandidateIndex(0);
        lastSuggestionTextRef.current = localMatch.match;
        return;
      }
    }

    // Step 1b: RAG-augmented Local LLM inference
    // LTE corpus entries become RAG context for the LLM — this is the
    // core of the Phase 3 pipeline simplification.
    if (isModelLoaded() && engineModeRef.current !== "cloud") {
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
          lastSuggestionTextRef.current = best;
          return;
        }
      } catch (e) {
        console.warn("[TargetEditor] Local LLM inference failed:", e);
      }
    }

    // ── TIER 2: Cloud Gemini Fallback ──
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
          lastSuggestionTextRef.current = best;
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

  // ─── Prefetch on segment focus ───
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

    if (!hasPrefetchedRef.current) {
      hasPrefetchedRef.current = true;
      if (justAcceptedRef.current) {
        justAcceptedRef.current = false;
        return;
      }
      prefetchTranslation(sourceText).catch(() => {});
      fetchSuggestions(translationText);
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
        fetchSuggestions(translationText);
        return;
      }
    }

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
