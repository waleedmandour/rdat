import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { getLTE } from "../../lib/local-translation-engine";
import { useGemini } from "../../hooks/useGemini";
import { useSettingsStore } from "../../stores/settings-store";
import { 
  Sparkles, 
  HelpCircle, 
  CornerDownLeft, 
  ChevronRight, 
  Volume2
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

  // Trigger local matching and/or API candidate bursts
  const fetchSuggestions = useCallback(async (typedText: string) => {
    // 1. First consult our Instant Local Translation Engine (LTE)
    const localMatch = getLTE().getSuggestion(sourceText, typedText);
    
    if (localMatch && localMatch.remainder) {
      setGhostSuggestion(localMatch.remainder);
      setSuggestionCandidates([localMatch.match]);
      setCandidateIndex(0);
      return;
    }

    // 2. If LTE has no exact alignment, consult cloud fallback if enabled
    if (useCloudFallback && engineMode !== "local" && typedText.trim().length > 1) {
      try {
        const candidates = await generateBurst(sourceText, typedText);
        if (candidates && candidates.length > 0) {
          setSuggestionCandidates(candidates);
          setCandidateIndex(0);
          
          // Deduct typed prefix to get the ghost remainder
          const best = candidates[0];
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

    setGhostSuggestion("");
    setSuggestionCandidates([]);
  }, [sourceText, useCloudFallback, engineMode, generateBurst]);

  useEffect(() => {
    if (isActive && translationText) {
      fetchSuggestions(translationText);
    } else {
      setGhostSuggestion("");
      setSuggestionCandidates([]);
    }
  }, [isActive, translationText, fetchSuggestions]);

  // Keybindings handler
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 1. Tab accepts the full suggestion
    if (e.key === "Tab" && ghostSuggestion) {
      e.preventDefault();
      const acceptedText = translationText + ghostSuggestion;
      onChange(acceptedText);
      setGhostSuggestion("");
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

      const updatedText = translationText + nextPortion;
      onChange(updatedText);
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
    }

    // 4. Escape dismisses suggestion
    if (e.key === "Escape") {
      e.preventDefault();
      setGhostSuggestion("");
      setSuggestionCandidates([]);
    }

    // 5. Ctrl + Enter confirms the segment
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      onConfirm();
    }
  };

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
        {ghostSuggestion && (
          <div
            className="absolute bottom-3 left-4 pointer-events-none select-none text-[10px] font-mono text-primary/40 bg-primary/5 border border-primary/20 px-2.5 py-0.5 rounded-md flex items-center gap-1.5"
            dir={isRTL ? "rtl" : "ltr"}
          >
            <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
            <span>[Tab] {isRTL ? "إتمام تلقائي" : "Auto-complete"} ({loadedModel ? loadedModel.toUpperCase() : "LTE"}): {ghostSuggestion}</span>
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
                MATCH 94%
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
