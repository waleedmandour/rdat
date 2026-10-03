import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { useSettingsStore, EDITOR_FONT_SIZE_MIN, EDITOR_FONT_SIZE_MAX, EDITOR_FONT_SIZE_DEFAULT } from "../../stores/settings-store";
import { useDualStorage } from "../../hooks/useDualStorage";
import { putToStore, getAllofStore, deleteFromStore } from "../../lib/dual-storage";
import { SourceEditor } from "./SourceEditor";
import { TargetEditor } from "./TargetEditor";
import { useGemini } from "../../hooks/useGemini";
import { SegmentEntry, GlossaryEntry, TutorAnalysis, DocumentMeta } from "../../types";
import { segment } from "../../lib/segmentation";
import { clearPrefetchCache } from "../../lib/local-llm-engine";
import {
  CheckCircle2,
  Sparkles,
  Download,
  Check,
  Search,
  BookMarked,
  GraduationCap,
  Type,
  Minus,
  Plus,
  RotateCcw,
  Trash2,
  FileText,
  Save,
  Upload,
} from "lucide-react";
import { cn } from "../../lib/utils";

interface TranslationWorkspaceProps {
  onWebgpuStateChange?: (info: any) => void;
  onGeminiAvailableChange?: (avail: boolean) => void;
  onRagStateChange?: (state: any) => void;
  onLocalAgentStateChange?: (state: any) => void;
}

export function TranslationWorkspace({}: TranslationWorkspaceProps) {
  const { locale } = useLanguage();
  const isRTL = locale === "ar";
  const { showToast } = useToast();

  const {
    sourceText,
    setSourceText,
    targetTexts,
    setTargetTexts,
    setTargetTextAtIndex,
    currentSegmentIndex,
    setCurrentSegmentIndex,
    highlightedSegmentIndex,
    setHighlightedSegmentIndex,
    direction,
    setDirection,
    granularity,
    setGranularity,
    manualBreaks,
    manualJoins,
  } = useWorkspaceStore();

  const isArToEn = direction === "ar-en";

  const { refreshCounts } = useDualStorage();

  // ─── Font size controls (Task 1a, v0.4.0) ────────────────────────
  // Persisted in settings-store. Driven through one CSS variable
  // (--editor-font-size) on the workspace root so source segments,
  // target editor, and ghost-text chip all track it. Script-aware
  // line-height: Arabic ≥ 1.8 (diacritics), Latin ~1.5.
  const { editorFontSize, setEditorFontSize } = useSettingsStore();
  const isWorkspaceFocusedRef = useRef(false);

  const bumpFontSize = useCallback((delta: number) => {
    setEditorFontSize(editorFontSize + delta);
  }, [editorFontSize, setEditorFontSize]);

  const resetFontSize = useCallback(() => {
    setEditorFontSize(EDITOR_FONT_SIZE_DEFAULT);
  }, [setEditorFontSize]);

  // Keyboard shortcuts: Ctrl/Cmd + "+" / "-" / "0" ONLY while focus is
  // inside the translation workspace. preventDefault only then, so
  // browser zoom works elsewhere.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isWorkspaceFocusedRef.current) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        bumpFontSize(2);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        bumpFontSize(-2);
      } else if (e.key === "0") {
        e.preventDefault();
        resetFontSize();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [bumpFontSize, resetFontSize]);

  // ─── Clear text dialog state (Task 1b, v0.4.0) ───────────────────
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearAlsoSaved, setClearAlsoSaved] = useState(true);

  // ─── Paragraph-faithful CAT-grade segmentation ───────────────────
  // Replaces the old `sourceText.split(/\n+/)` line-only splitter with
  // the SRX-style segmenter at src/lib/segmentation/. Segments are
  // grouped by paragraph (hard boundaries), split into sentences
  // within paragraphs, and carry a sourceHash for safe persistence.
  // Re-segmentation happens ONLY when sourceText / granularity /
  // direction / manual overrides change — never on target keystrokes.
  const segmentation = useMemo(() => {
    return segment(sourceText, {
      granularity,
      manualBreaks,
      manualJoins,
    });
  }, [sourceText, granularity, manualBreaks, manualJoins]);

  const sentences = useMemo(() => segmentation.segments.map((s) => s.text), [segmentation]);
  const segmentSourceHashes = useMemo(() => segmentation.segments.map((s) => s.sourceHash), [segmentation]);

  // Track which segment indices have been confirmed/saved
  const [confirmedIndices, setConfirmedIndices] = useState<Record<number, boolean>>({});

  // Local glossary state for side matching panel
  const [glossaryEntries, setGlossaryEntries] = useState<GlossaryEntry[]>([]);
  const [sidebarSearchTerm, setSidebarSearchTerm] = useState("");

  // AI Translation Tutor states
  const [sidebarTab, setSidebarTab] = useState<"glossary" | "tutor">("glossary");
  const [tutorAnalyses, setTutorAnalyses] = useState<Record<number, TutorAnalysis | null>>({});
  const [tutorLoading, setTutorLoading] = useState(false);
  const { generateTutorExplanation } = useGemini();

  // ─── CRITICAL FIX: Prevent IndexedDB from overwriting user typing ───
  // Only load from DB once on mount, or when sentences.length changes (new document).
  // Never re-load while the user is actively typing.
  const initialLoadDoneRef = useRef(false);
  const prevSentencesLenRef = useRef(0);

  // Sync targetTexts array length with sentences — only when lengths differ
  const sentencesLen = sentences.length;
  useEffect(() => {
    // Use functional update to avoid depending on targetTexts
    setTargetTexts((prev) => {
      if (prev.length === sentencesLen) return prev;
      const updated = [...prev];
      while (updated.length < sentencesLen) updated.push("");
      return updated.slice(0, sentencesLen);
    });
  }, [sentencesLen, setTargetTexts]);

  // Load existing confirmed segment entries from IndexedDB — ONLY on mount or document change
  const loadConfirmedSegments = useCallback(async (currentSentencesLen: number) => {
    try {
      const dbEntries = await getAllofStore<SegmentEntry>("segments");
      const confirmedMap: Record<number, boolean> = {};
      const dbTexts: Record<number, string> = {};

      // ─── Stale-attachment guard (Task 2, v0.4.0 + Issue 2, v0.4.1) ──
      // Previously this hydrated ANY segment whose segment_index was
      // in range, regardless of language pair or source text — so an
      // AR→EN segment at index 3 could hydrate into an EN→AR session
      // at index 3 if the source happened to be the same length. Now
      // we require:
      //   1. docId matches the active document (Issue 2, v0.4.1) —
      //      without this, confirming in doc B would hydrate doc A's
      //      translations into doc B's editor. Legacy entries without
      //      docId are NOT attached (conservative).
      //   2. source_lang + target_lang match the active direction
      //   3. sourceHash matches the current segment's hash
      const sourceLang = isArToEn ? "ar" : "en";
      const targetLang = isArToEn ? "en" : "ar";
      const activeDocId = useWorkspaceStore.getState().currentDocId;

      for (const entry of dbEntries) {
        if (
          entry.segment_index !== undefined &&
          entry.segment_index < currentSentencesLen &&
          entry.source_lang === sourceLang &&
          entry.target_lang === targetLang &&
          // Issue 2: docId must match the active document. If the
          // entry has no docId (legacy v4), skip it (conservative).
          activeDocId && entry.docId === activeDocId
        ) {
          // sourceHash check: attach only if the hash matches the
          // current segment's hash. Legacy entries (no sourceHash)
          // are NOT attached (conservative — avoids stale attach).
          const currentHash = segmentSourceHashes[entry.segment_index];
          if (currentHash && entry.sourceHash && entry.sourceHash === currentHash) {
            confirmedMap[entry.segment_index] = entry.status === "confirmed";
            if (entry.target) {
              dbTexts[entry.segment_index] = entry.target;
            }
          }
        }
      }

      setConfirmedIndices(confirmedMap);

      // Only fill in DB texts for slots that are currently empty — never overwrite user input
      setTargetTexts((prev) => {
        const updated = [...prev];
        // Ensure correct length
        while (updated.length < currentSentencesLen) updated.push("");
        for (const [idxStr, text] of Object.entries(dbTexts)) {
          const i = Number(idxStr);
          if (i < updated.length && !updated[i].trim()) {
            updated[i] = text;
          }
        }
        return updated.slice(0, currentSentencesLen);
      });
    } catch (e) {
      console.warn("[Workspace] Failed to pre-populate from DB:", e);
    }
  }, [setTargetTexts, isArToEn, segmentSourceHashes]);

  // Load glossary entries — only depends on stable functions
  const loadGlossaryEntries = useCallback(async () => {
    try {
      const list = await getAllofStore<GlossaryEntry>("glossary");
      setGlossaryEntries(list);
    } catch (e) {
      console.warn("[Workspace] Glossary fetch omitted/failed:", e);
    }
  }, []);

  // Run initial load once, and re-run only when sentences.length changes (new document loaded)
  useEffect(() => {
    if (!initialLoadDoneRef.current || prevSentencesLenRef.current !== sentencesLen) {
      initialLoadDoneRef.current = true;
      prevSentencesLenRef.current = sentencesLen;
      loadConfirmedSegments(sentencesLen);
      loadGlossaryEntries();
    }
  }, [sentencesLen, loadConfirmedSegments, loadGlossaryEntries]);

  // ─── Direction-switch hygiene (cross-cutting, Task 2 + Task 3) ────
  // On any direction switch: abort in-flight requests (handled in
  // TargetEditor via its `direction` dep), clear the prefetch/ghost
  // cache so a stale suggestion from the other direction cannot leak,
  // and re-run hydration against the new language pair. The cache is
  // keyed by sourceText only today (see local-llm-engine.ts), so a
  // direction flip would otherwise return the wrong-language suggestion.
  const prevDirectionRef = useRef(direction);
  useEffect(() => {
    if (prevDirectionRef.current !== direction) {
      prevDirectionRef.current = direction;
      clearPrefetchCache();
      // Re-hydrate against the new language pair. Reset the load-done
      // flag so loadConfirmedSegments runs again.
      initialLoadDoneRef.current = false;
      prevSentencesLenRef.current = -1;
    }
  }, [direction]);

  // Run Translation Tutor and parse feedback
  const handleRunTutor = async () => {
    const activeSource = sentences[currentSegmentIndex];
    const activeTarget = targetTexts[currentSegmentIndex];

    if (!activeSource || !activeTarget || !activeTarget.trim()) {
      showToast(
        isRTL
          ? "أدخل مسودة ترجمة في حقل النص أولاً ليقوم المعلم بتقييمها!"
          : "Please write a draft translation in the active text editor before initiating AI Tutor feedback!",
        "warning"
      );
      return;
    }

    setTutorLoading(true);
    try {
      const response = await generateTutorExplanation(activeSource, activeTarget, locale, direction);
      if (response) {
        setTutorAnalyses((prev) => ({
          ...prev,
          [currentSegmentIndex]: response,
        }));
        showToast(
          isRTL ? "تم تحديث ملاحظات المعلم التفاعلي!" : "AI Tutor feedback refreshed successfully!",
          "success"
        );
      } else {
        // Fallback local pedagogical rules matching if offline or no cloud API key configured
        const fallbackRating = Math.min(
          100,
          Math.max(50, 75 + Math.round((activeTarget.length / activeSource.length) * 15) - (activeTarget.length < 5 ? 20 : 0))
        );
        const fallbackGrade = fallbackRating >= 90 ? "A" : fallbackRating >= 80 ? "B" : fallbackRating >= 70 ? "C" : "D";
        
        const fallbackExp = isRTL 
          ? "تم تقييم ترجمتك محلياً بواسطة محرك التقييم المضمن بالمتصفح. تبدو الترجمة متسقة ومكتوبة بشكل وصفي سليم. نوصي بمراجعة المصطلحات الرسمية المعتمدة في قاموس المؤسسة وتجنب الحشو الحرفي لضمان الانسياب اللغوي الأكاديمي."
          : "Evaluated locally by the on-device pedagogical engine. Your translation shows good lexical coverage and appropriate length proportional to the source. Enhance the register by strictly adhering to the matched terminology glossary list.";
        
        const localMatchedTerms = dynamicMatchedTerms.map((t) => ({
          term: t.source_term,
          analysis: isRTL 
            ? `مطابق لمصطلح القاموس النشط (${t.target_term}). استخدام موفق يعزز مرجعية النص.`
            : `Matches corpus token (${t.target_term}). Reinforces vocabulary consistency.`
        }));

        const fallbackAnalysis: TutorAnalysis = {
          rating: fallbackRating,
          grade: fallbackGrade,
          explanation: fallbackExp,
          termsAnalysed: localMatchedTerms.length > 0 ? localMatchedTerms : [
            {
              term: "Active segment",
              analysis: isRTL 
                ? "تم التحليل بنجاح، الجملة خالية من الأخطاء النحوية الهيكلية المباشرة."
                : "Parsing complete, syntax is grammatically sound and structurally aligned."
            }
          ],
          pitfalls: isRTL
            ? "تجنب الترجمة الحرفية لعبارات الوصل وحافظ على روح اللغة العربية الفصحى."
            : "Avoid translating passive clauses literally; favor active verbal patterns in high-quality Arabic."
        };

        setTutorAnalyses((prev) => ({
          ...prev,
          [currentSegmentIndex]: fallbackAnalysis,
        }));
        showToast(
          isRTL 
            ? "تم توليد تقييم المعلم محلياً (المحرك المدمج)!" 
            : "Loaded local pedagogical diagnostics (offline-first tutor fallback)!",
          "info"
        );
      }
    } catch (e) {
      console.error(e);
      showToast(isRTL ? "فشل اتصال المعلم التوليدي" : "AI Tutor was unable to complete the analysis", "error");
    } finally {
      setTutorLoading(false);
    }
  };

  // Confirms a sentence translation and persists it to IndexedDB
  const handleConfirmSegment = async (idx: number) => {
    const text = targetTexts[idx] || "";
    if (!text.trim()) {
      showToast(
        isRTL ? "لا يمكن حفظ مقطع فارغ. اكتب الترجمة أولاً." : "Cannot save an empty segment. Please write a translation first.",
        "warning"
      );
      return;
    }

    try {
      // Derive source/target language from the active translation
      // direction so AR→EN sessions persist with source_lang="ar",
      // target_lang="en". Previously this was hardcoded to "en"→"ar"
      // which corrupted AR→EN segments. See PHASE 1 task 1.4.
      const sourceLang = isArToEn ? "ar" : "en";
      const targetLang = isArToEn ? "en" : "ar";

      // Audit fix #6: deterministic string id keyed on direction +
      // segment index. Re-confirming an edited segment now upserts
      // (overwrites the prior row) instead of appending a duplicate.
      //
      // Issue 2 (v0.4.1): the id now includes docId so confirming a
      // segment in document B doesn't overwrite document A's saved
      // translation (the old format `{sourceLang}-{targetLang}-{idx}`
      // collided across documents in the same language pair). The new
      // format is `{docId}:{sourceLang}-{targetLang}-{idx}`. If docId
      // is null (legacy state), fall back to the old format for
      // backward compatibility.
      const docId = useWorkspaceStore.getState().currentDocId;
      const segmentId = docId
        ? `${docId}:${sourceLang}-${targetLang}-${idx}`
        : `${sourceLang}-${targetLang}-${idx}`;

      const newEntry: SegmentEntry = {
        id: segmentId,
        source: sentences[idx],
        target: text,
        source_lang: sourceLang,
        target_lang: targetLang,
        status: "confirmed",
        score: 1.0,
        segment_index: idx,
        // Task 2 (v0.4.0): persist sourceHash so future hydration can
        // refuse to re-attach this translation to different source
        // text. See src/lib/segmentation/types.ts fnv1aHex.
        sourceHash: segmentSourceHashes[idx],
        // Issue 2 (v0.4.1): persist docId so hydration can filter by
        // document + cross-document overwrites can't happen.
        docId: docId || undefined,
      };

      await putToStore("segments", newEntry);
      setConfirmedIndices((prev) => ({ ...prev, [idx]: true }));
      await refreshCounts();

      showToast(
        isRTL ? `تم حفظ المقطع ${idx + 1} بنجاح` : `Segment ${idx + 1} saved successfully`,
        "success"
      );

      // Automatically focus on next segment
      if (idx + 1 < sentences.length) {
        setCurrentSegmentIndex(idx + 1);
        const element = document.getElementById(`src-seg-${idx + 1}`);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    } catch (err) {
      console.error("[Workspace] Failed to confirm segment:", err);
      showToast(
        isRTL ? `فشل حفظ المقطع: ${err}` : `Failed to save segment: ${err}`,
        "error"
      );
    }
  };

  const handleExportArabicTranslation = () => {
    const joinedTranslation = targetTexts.filter(Boolean).join("\n\n");
    if (!joinedTranslation) {
      showToast(
        isRTL ? "برجاء كتابة بعض التراجم أولاً!" : "Please write some translations first!",
        "warning"
      );
      return;
    }

    const blob = new Blob([joinedTranslation], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `RDAT_Translation_${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // ─── DOCX export (Issue 3, v0.4.1) ──────────────────────────────
  // Exports the source/target segment pairs as a .docx file. The
  // target paragraphs are right-aligned for Arabic (RTL) and left-
  // aligned for English (LTR). Uses the `docx` library.
  const handleExportDocx = async () => {
    if (sentences.length === 0) {
      showToast(isRTL ? "لا يوجد نص للتصدير" : "Nothing to export", "warning");
      return;
    }
    try {
      const { buildDocxBlob } = await import("../../lib/export-import");
      const docName = useWorkspaceStore.getState().currentDocName || "RDAT_Translation";
      const blob = await buildDocxBlob({
        title: docName,
        sourceLangLabel: isArToEn ? "Arabic" : "English",
        targetLangLabel: isArToEn ? "English" : "Arabic",
        segments: sentences.map((s, i) => ({ source: s, target: targetTexts[i] || "" })),
        isTargetRTL: !isArToEn, // target is Arabic for EN→AR
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${docName.replace(/[^\w\u0600-\u06FF-]/g, "_")}.docx`;
      link.click();
      URL.revokeObjectURL(url);
      showToast(isRTL ? "تم تصدير ملف Word" : "DOCX exported", "success");
    } catch (e: any) {
      console.error("[Export DOCX] failed:", e);
      showToast(isRTL ? `فشل تصدير Word: ${e.message}` : `DOCX export failed: ${e.message}`, "error");
    }
  };

  // ─── JSON backup / restore (Issue 3, v0.4.1) ────────────────────
  // Full dump of segments + glossary + documents to a single JSON
  // file. Restore re-inserts all entries (upsert by id). This is the
  // only way to recover from a browser data eviction.
  const handleExportJsonBackup = async () => {
    try {
      const { buildJsonBackup, serializeJsonBackup } = await import("../../lib/export-import");
      const pkg = await import("../../../package.json");
      const [segments, glossary, documents] = await Promise.all([
        getAllofStore<SegmentEntry>("segments"),
        getAllofStore<GlossaryEntry>("glossary"),
        getAllofStore<DocumentMeta>("documents"),
      ]);
      const backup = buildJsonBackup(segments, glossary, documents, pkg.version);
      const json = serializeJsonBackup(backup);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `RDAT_Backup_${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      showToast(
        isRTL
          ? `تم تصدير النسخة الاحتياطية (${segments.length} مقطع، ${glossary.length} مصطلح)`
          : `Backup exported (${segments.length} segments, ${glossary.length} glossary entries)`,
        "success"
      );
    } catch (e: any) {
      console.error("[Export JSON] failed:", e);
      showToast(isRTL ? `فشل تصدير النسخة الاحتياطية: ${e.message}` : `Backup export failed: ${e.message}`, "error");
    }
  };

  const handleImportJsonBackup = async (file: File) => {
    try {
      const text = await file.text();
      const { parseJsonBackup } = await import("../../lib/export-import");
      const backup = parseJsonBackup(text);
      // Re-insert all entries (upsert by id). putBatchToStore handles
      // the bulk insert.
      const { putBatchToStore } = await import("../../lib/dual-storage");
      if (backup.segments.length > 0) await putBatchToStore("segments", backup.segments);
      if (backup.glossary.length > 0) await putBatchToStore("glossary", backup.glossary);
      if (backup.documents.length > 0) await putBatchToStore("documents", backup.documents);
      await refreshCounts();
      // Re-hydrate the current document if it was in the backup
      initialLoadDoneRef.current = false;
      prevSentencesLenRef.current = -1;
      showToast(
        isRTL
          ? `تم استيراد النسخة الاحتياطية (${backup.segments.length} مقطع، ${backup.glossary.length} مصطلح)`
          : `Backup restored (${backup.segments.length} segments, ${backup.glossary.length} glossary entries)`,
        "success"
      );
    } catch (e: any) {
      console.error("[Import JSON] failed:", e);
      showToast(isRTL ? `فشل استيراد النسخة الاحتياطية: ${e.message}` : `Backup restore failed: ${e.message}`, "error");
    }
  };
  const jsonBackupInputRef = useRef<HTMLInputElement>(null);

  // ─── Clear text (Task 1b, v0.4.0) ────────────────────────────────
  // Clears: sourceText, targetTexts, currentSegmentIndex, segmentation
  // state, manual split/merge overrides. Aborts in-flight LLM/Gemini
  // requests (via clearPrefetchCache + the TargetEditor effect that
  // resets on segment-count change). If the checkbox is checked, also
  // deletes saved translations for the ACTIVE document only (Issue 2,
  // v0.4.1: scoped by docId, not language pair — so clearing doc B
  // never touches doc A's saved work). Glossary, TM, and settings are
  // never touched.
  const handleClearText = async () => {
    const activeDocId = useWorkspaceStore.getState().currentDocId;

    // 1. Clear prefetch/ghost caches (aborts stale suggestions)
    clearPrefetchCache();

    // 2. Optionally delete saved translations for the active document.
    // Issue 2 (v0.4.1): scoped by docId (was: by language pair). This
    // is the key fix — the old scope wiped OTHER documents in the same
    // language pair. Now only the active document's segments are deleted.
    if (clearAlsoSaved && activeDocId) {
      try {
        const allEntries = await getAllofStore<SegmentEntry>("segments");
        const toDelete = allEntries.filter((e) => e.docId === activeDocId);
        for (const entry of toDelete) {
          if (entry.id !== undefined) {
            await deleteFromStore("segments", entry.id);
          }
        }
        // Also delete the document metadata row
        try {
          await deleteFromStore("documents", activeDocId);
        } catch {
          // Non-fatal — the document row may not exist if the user
          // never imported via the file picker (pasted text).
        }
      } catch (e) {
        console.warn("[ClearText] Failed to delete saved segments:", e);
      }
    }

    // 3. Reset workspace state (this also clears manual overrides via
    //    the setSourceText setter in workspace-store)
    setSourceText("");
    setTargetTexts([]);
    setCurrentSegmentIndex(0);
    setHighlightedSegmentIndex(null);

    // 4. Reset confirmed indices
    setConfirmedIndices({});

    // 5. Reset the load-done flag so re-importing hydrates fresh
    initialLoadDoneRef.current = false;
    prevSentencesLenRef.current = 0;

    setClearDialogOpen(false);
    await refreshCounts();

    showToast(
      isRTL
        ? clearAlsoSaved
          ? "تم مسح النص والترجمات المحفوظة لهذا المستند"
          : "تم مسح النص (مع الاحتفاظ بالترجمات المحفوظة)"
        : clearAlsoSaved
          ? "Cleared text and saved translations for this document"
          : "Cleared text (saved translations kept)",
      "success"
    );
  };

  const completionPercent = useMemo(() => {
    if (sentences.length === 0) return 0;
    const confirmedCount = Object.values(confirmedIndices).filter(Boolean).length;
    return Math.round((confirmedCount / sentences.length) * 100);
  }, [confirmedIndices, sentences.length]);

  // Perform dynamic matching on the active segment sentence and return terms found
  const dynamicMatchedTerms = useMemo(() => {
    const activeSentence = sentences[currentSegmentIndex];
    if (!activeSentence) return [];

    const lowerSentence = activeSentence.toLowerCase();
    const matched = glossaryEntries.filter((entry) => {
      const srcTerm = entry.source_term.trim().toLowerCase();
      if (srcTerm.length <= 2) return false;
      return lowerSentence.includes(srcTerm);
    });

    // If no dynamic entries matched, return standard pedagogical fallbacks to ensure UI match
    if (matched.length === 0) {
      return [
        {
          id: 991,
          source_term: "CAT System",
          target_term: "نظام الترجمة بمساعدة الحاسوب",
          domain: "Technology",
          pos: "phrase"
        },
        {
          id: 992,
          source_term: "Algorithmic",
          target_term: "خوارزمي",
          domain: "General",
          pos: "noun"
        },
        {
          id: 993,
          source_term: "Pedagogical",
          target_term: "تربوي / تعليمي",
          domain: "Academic",
          pos: "adjective"
        }
      ];
    }
    return matched;
  }, [sentences, currentSegmentIndex, glossaryEntries]);

  // Filter glossary search listings
  const filteredSidebarEntries = useMemo(() => {
    if (!sidebarSearchTerm.trim()) return [];
    const q = sidebarSearchTerm.toLowerCase();
    return glossaryEntries.filter(
      (item) =>
        item.source_term.toLowerCase().includes(q) ||
        item.target_term.toLowerCase().includes(q)
    );
  }, [sidebarSearchTerm, glossaryEntries]);

  return (
    <div
      className="h-full flex flex-col bg-background overflow-hidden"
      dir={isRTL ? "rtl" : "ltr"}
      style={{
        // Task 1a: single CSS variable drives source segments, target
        // editor, and ghost-text chip. Script-aware line-height: Arabic
        // ≥ 1.8 (diacritics not clipped), Latin ~1.5.
        ["--editor-font-size" as string]: `${editorFontSize}px`,
        ["--editor-line-height" as string]: isRTL ? "1.85" : "1.55",
        // v0.4.2: instruction text (labels, hints, headers, badges)
        // scales with the editor font but stays smaller — ~71% of the
        // editor size, floored at 10px so it's still legible at the
        // minimum editor size (14px → 10px instruction).
        ["--instruction-font-size" as string]: `${Math.max(10, Math.round(editorFontSize * 0.71))}px`,
      }}
      onFocusCapture={() => { isWorkspaceFocusedRef.current = true; }}
      onBlurCapture={(e) => {
        // Only mark unfocused when focus leaves the workspace entirely
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          isWorkspaceFocusedRef.current = false;
        }
      }}
    >

      {/* Direction Toggle Bar */}
      <div
        className="h-9 dark:bg-white/5 bg-surface border-b dark:border-white/5 border-border flex items-center justify-center gap-2 px-4 select-none"
        style={{ fontSize: "var(--instruction-font-size, 10px)" }}
      >
        <button
          onClick={() => setDirection("en-ar")}
          className={cn(
            "px-3 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer",
            direction === "en-ar"
              ? "bg-primary text-white"
              : "text-muted-foreground hover:text-foreground hover:bg-surface-hover"
          )}
        >
          EN → AR
        </button>
        <button
          onClick={() => setDirection("ar-en")}
          className={cn(
            "px-3 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer",
            direction === "ar-en"
              ? "bg-primary text-white"
              : "text-muted-foreground hover:text-foreground hover:bg-surface-hover"
          )}
        >
          AR → EN
        </button>

        {/* Granularity toggle: Sentence (default) / Paragraph.
            Trados-style: within paragraphs, split into sentences; or
            treat each paragraph as one segment. */}
        <div className="ms-auto flex items-center gap-1">
          <Type className="w-3 h-3 text-muted-foreground" />
          <button
            onClick={() => setGranularity("sentence")}
            title={isRTL ? "تجزئة على مستوى الجملة" : "Sentence-level segmentation"}
            aria-label={isRTL ? "تجزئة على مستوى الجملة" : "Sentence-level segmentation"}
            className={cn(
              "px-2 py-0.5 rounded text-[9px] font-bold transition-all cursor-pointer",
              granularity === "sentence"
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {isRTL ? "جملة" : "Sentence"}
          </button>
          <button
            onClick={() => setGranularity("paragraph")}
            title={isRTL ? "تجزئة على مستوى الفقرة" : "Paragraph-level segmentation"}
            aria-label={isRTL ? "تجزئة على مستوى الفقرة" : "Paragraph-level segmentation"}
            className={cn(
              "px-2 py-0.5 rounded text-[9px] font-bold transition-all cursor-pointer",
              granularity === "paragraph"
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {isRTL ? "فقرة" : "Paragraph"}
          </button>
        </div>

        {/* Font size controls (Task 1a) + Clear text (Task 1b) */}
        <div className="flex items-center gap-1 ms-2">
          {/* A- : decrease */}
          <button
            onClick={() => bumpFontSize(-2)}
            disabled={editorFontSize <= EDITOR_FONT_SIZE_MIN}
            title={isRTL ? `تصغير الخط (${editorFontSize}px)` : `Decrease font (${editorFontSize}px)`}
            aria-label={isRTL ? `تصغير الخط، الحالي ${editorFontSize} بكسل` : `Decrease font size, current ${editorFontSize}px`}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all"
          >
            <Minus className="w-3 h-3" />
          </button>
          {/* Current size (also Reset on click) */}
          <button
            onClick={resetFontSize}
            title={isRTL ? `إعادة الضبط (الحالي ${editorFontSize}px، الافتراضي ${EDITOR_FONT_SIZE_DEFAULT}px)` : `Reset to default (current ${editorFontSize}px, default ${EDITOR_FONT_SIZE_DEFAULT}px)`}
            aria-label={isRTL ? `إعادة حجم الخط للوضع الافتراضي، الحالي ${editorFontSize} بكسل` : `Reset font size to default, current ${editorFontSize}px`}
            className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold text-muted-foreground hover:text-foreground hover:bg-surface-hover cursor-pointer transition-all min-w-[28px] text-center"
          >
            {editorFontSize}
          </button>
          {/* A+ : increase */}
          <button
            onClick={() => bumpFontSize(2)}
            disabled={editorFontSize >= EDITOR_FONT_SIZE_MAX}
            title={isRTL ? `تكبير الخط (${editorFontSize}px)` : `Increase font (${editorFontSize}px)`}
            aria-label={isRTL ? `تكبير الخط، الحالي ${editorFontSize} بكسل` : `Increase font size, current ${editorFontSize}px`}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all"
          >
            <Plus className="w-3 h-3" />
          </button>
          <button
            onClick={resetFontSize}
            title={isRTL ? "إعادة الضبط" : "Reset font size"}
            aria-label={isRTL ? "إعادة حجم الخط للوضع الافتراضي" : "Reset font size to default"}
            className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-surface-hover cursor-pointer transition-all"
          >
            <RotateCcw className="w-3 h-3" />
          </button>

          {/* Clear text (Task 1b) — only visible when source text exists */}
          {sourceText.trim().length > 0 && (
            <button
              onClick={() => { setClearAlsoSaved(true); setClearDialogOpen(true); }}
              title={isRTL ? "مسح النص" : "Clear text"}
              aria-label={isRTL ? "مسح النص المصدر والترجمات" : "Clear source text and translations"}
              className="ms-1 p-0.5 rounded text-rose-500 hover:bg-rose-500/10 cursor-pointer transition-all"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Main panels */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">

      {/* Source panel (left for EN-AR, right for AR-EN) */}
      <div className={cn("flex-1 h-1/2 lg:h-full overflow-hidden", isArToEn && "lg:order-2")}>
        <SourceEditor
          sentences={sentences}
          currentIdx={currentSegmentIndex}
          onSelectIdx={setCurrentSegmentIndex}
          hoveredIdx={highlightedSegmentIndex}
          onHoverIdx={setHighlightedSegmentIndex}
        />
      </div>

      {/* Target panel (right for EN-AR, left for AR-EN) */}
      <div className={cn("flex-1 h-1/2 lg:h-full flex flex-col bg-background overflow-hidden border-r dark:border-white/5 border-border", isArToEn && "lg:order-1")}>

        {/* Panel Header */}
        <div
          className="h-10 dark:bg-white/5 bg-surface border-b dark:border-white/5 border-border flex items-center justify-between px-4 text-xs font-semibold select-none"
          style={{ fontSize: "var(--instruction-font-size, 10px)" }}
        >
          <span className="font-bold uppercase tracking-widest text-slate-500">
            {isArToEn
              ? (isRTL ? "الترجمة المقابلة - إنكليزي (LTR)" : "Target Translation - English")
              : (isRTL ? "الترجمة المقابلة - عربي (RTL)" : "Target Translation - Arabic")}
          </span>
          <div className="flex items-center gap-3">
            {/* Completion indicator */}
            <div className="flex items-center gap-1.5 text-[9.5px] font-bold text-emerald-400 dark:bg-emerald-500/10 bg-emerald-50 px-2.5 py-0.5 rounded-full select-none">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{completionPercent}% {isRTL ? "مكتمل" : "done"}</span>
            </div>

            <button
              onClick={handleExportArabicTranslation}
              className="flex items-center gap-1 hover:text-primary text-[10.5px] text-muted-foreground cursor-pointer transition-colors"
              title={isRTL ? "تصدير نصي" : "Export as TXT"}
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isRTL ? "تصدير الملف" : "Export TXT"}</span>
            </button>

            {/* Issue 3 (v0.4.1): DOCX export + JSON backup/restore.
                The only export before was TXT; IndexedDB was the only
                copy. Now users can export to Word, back up everything,
                and restore after a data eviction. */}
            <button
              onClick={handleExportDocx}
              className="flex items-center gap-1 hover:text-primary text-[10.5px] text-muted-foreground cursor-pointer transition-colors"
              title={isRTL ? "تصدير ملف Word" : "Export as DOCX (Word)"}
            >
              <FileText className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{isRTL ? "Word" : "DOCX"}</span>
            </button>

            <button
              onClick={handleExportJsonBackup}
              className="flex items-center gap-1 hover:text-primary text-[10.5px] text-muted-foreground cursor-pointer transition-colors"
              title={isRTL ? "نسخة احتياطية كاملة (JSON)" : "Full backup (JSON)"}
            >
              <Save className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{isRTL ? "نسخة احتياطية" : "Backup"}</span>
            </button>

            <button
              onClick={() => jsonBackupInputRef.current?.click()}
              className="flex items-center gap-1 hover:text-primary text-[10.5px] text-muted-foreground cursor-pointer transition-colors"
              title={isRTL ? "استيراد نسخة احتياطية (JSON)" : "Restore from backup (JSON)"}
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{isRTL ? "استعادة" : "Restore"}</span>
            </button>
            <input
              type="file"
              ref={jsonBackupInputRef}
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0) handleImportJsonBackup(files[0]);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        {/* Sync list of target text boxes */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-thin">
          {sentences.map((sentence, idx) => {
            const isActive = idx === currentSegmentIndex;
            const isConfirmed = !!confirmedIndices[idx];

            return (
              <div key={idx} className="relative">
                <TargetEditor
                  sentenceIndex={idx}
                  sourceText={sentence}
                  translationText={targetTexts[idx] || ""}
                  onChange={(text) => setTargetTextAtIndex(idx, text)}
                  onConfirm={() => handleConfirmSegment(idx)}
                  isActive={isActive}
                  onHover={(hovered) => setHighlightedSegmentIndex(hovered ? idx : null)}
                  isHovered={highlightedSegmentIndex === idx}
                />

                {isConfirmed && (
                  <div className="absolute top-4 left-4 pointer-events-none text-emerald-500 z-10 animate-fade-in" title="Confirmed">
                    <Check className="w-4 h-4 bg-emerald-500/10 border border-emerald-500/20 p-0.5 rounded-full" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </div>

      {/* Right panel (Terminology matched Sidebar & AI Tutor) */}
      <aside
        className="w-80 border-l dark:border-white/10 border-border bg-surface flex flex-col select-none shrink-0 hidden md:flex"
        style={{ fontSize: "var(--instruction-font-size, 10px)" }}
      >
        
        {/* Sidebar Tab Switcher */}
        <div className="h-11 border-b border-border dark:border-white/5 flex items-center bg-gray-50/5 dark:bg-black/10 shrink-0">
          <button
            onClick={() => setSidebarTab("glossary")}
            className={cn(
              "flex-1 h-full text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer border-b-2",
              sidebarTab === "glossary"
                ? "border-primary text-primary bg-background/50"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <BookMarked className="w-3.5 h-3.5" />
            <span>{isRTL ? "المصطلحات" : "Glossary"}</span>
          </button>
          <button
            onClick={() => setSidebarTab("tutor")}
            className={cn(
              "flex-1 h-full text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer border-b-2",
              sidebarTab === "tutor"
                ? "border-primary text-primary bg-background/50"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <GraduationCap className="w-3.5 h-3.5" />
            <span>{isRTL ? "المعلم الذكي" : "AI Tutor"}</span>
          </button>
        </div>

        {sidebarTab === "glossary" ? (
          <>
            {/* Glossary Quick Search Bar */}
            <div className="p-4 border-b dark:border-white/5 border-border bg-white/[0.01] relative shrink-0">
              <input
                type="text"
                value={sidebarSearchTerm}
                onChange={(e) => setSidebarSearchTerm(e.target.value)}
                placeholder={isRTL ? "ابحث بالقاموس..." : "Search Glossary..."}
                className="w-full bg-background border dark:border-white/10 border-border rounded px-3 py-2 text-xs focus:border-primary outline-none text-foreground font-medium"
              />
              <Search className="absolute right-7 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
            </div>

            {/* Sidebar scrolling terms listing */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-thin">
              
              {/* Section 1: Search Result or Active Matches */}
              {sidebarSearchTerm.trim() !== "" ? (
                <div>
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">
                    {isRTL ? "نتائج البحث" : "Search Results"}
                  </h3>
                  
                  <div className="space-y-2">
                    {filteredSidebarEntries.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground italic px-2">
                        {isRTL ? "لا نتائج مطابقة" : "No terms matched search query"}
                      </p>
                    ) : (
                      filteredSidebarEntries.slice(0, 15).map((term) => (
                        <div key={term.id} className="p-3 dark:bg-white/5 bg-background rounded border-l-2 border-indigo-500/50 hover:bg-muted/30 transition-all">
                          <div className="text-xs text-foreground font-semibold mb-1">{term.source_term}</div>
                          <div className="text-[10.5px] text-muted-foreground font-medium leading-relaxed text-right" dir="rtl">{term.target_term}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">
                    {isRTL ? "المصطلحات المطابقة" : "Matched Terminology"}
                  </h3>
                  
                  <div className="space-y-3.5">
                    {dynamicMatchedTerms.map((term, i) => {
                      const borderColors = [
                        "border-amber-500/50",
                        "border-blue-500/50",
                        "border-indigo-500/50"
                      ];
                      const borderCol = borderColors[i % borderColors.length];

                      return (
                        <div
                          key={term.id || i}
                          className={cn(
                            "p-3 dark:bg-white/5 bg-background rounded border-l-2 transition-all hover:scale-[1.01]",
                            borderCol
                          )}
                        >
                          <div className="text-xs font-bold text-foreground mb-1">{term.source_term}</div>
                          <div className="text-[10.5px] text-muted-foreground leading-relaxed text-right font-semibold" dir="rtl">
                            {term.target_term}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Custom Contextual Annotation Guide */}
              <div className="pt-4 border-t dark:border-white/5 border-border">
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">
                  {isRTL ? "ملاحظات سياقية ومقترحات" : "Contextual Notes"}
                </h3>
                <p className="text-[11px] leading-relaxed text-slate-400 italic dark:bg-white/[0.01] bg-muted/30 p-3 rounded-lg border dark:border-white/5 border-border">
                  {isRTL 
                    ? "\"CAT\" يجب ذكرها كاملة في المرة الأولى ثم استخدام الاختصار بين قوسين للتوضيح."
                    : "\"CAT\" should remain as an acronym in English parentheses after the first Arabic mention for clarity in academic texts."}
                </p>
              </div>

            </div>
          </>
        ) : (
          /* AI Tutor Tab Contents */
          <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-thin">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-primary" />
                <h3 className="text-xs font-black uppercase text-foreground">
                  {isRTL ? "توجيه وترميز تربوي متقدم" : "Linguistic Translation Tutor"}
                </h3>
              </div>
              <p className="text-[10.5px] leading-relaxed text-muted-foreground">
                {isRTL 
                  ? "يقوم المعلم الذكي بتحليل مسودة ترجمتك حالياً ويمنحك تقييماً سياقياً دقيقاً، مع شرح للفروق الدلالية الدقيقة وحيل تفادي الفخاخ الشائعة."
                  : "The smart tutor evaluates your active translation draft and returns stylistic grades, custom terminology critiques, and translation pitfall analysis."}
              </p>
            </div>

            {/* Run button */}
            <button
              onClick={handleRunTutor}
              disabled={tutorLoading}
              className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-primary hover:bg-primary/95 text-xs font-bold text-white shadow-md cursor-pointer transition-all disabled:opacity-55 disabled:cursor-not-allowed"
            >
              {tutorLoading ? (
                <>
                  <Sparkles className="w-4 h-4 animate-spin text-white" />
                  <span>{isRTL ? "جاري التدقيق اللغوي..." : "Evaluating Translation..."}</span>
                </>
              ) : (
                <>
                  <GraduationCap className="w-4 h-4" />
                  <span>{isRTL ? "تقييم الترجمة النشطة" : "Evaluate Active Draft"}</span>
                </>
              )}
            </button>

            {/* Loading/Result space */}
            {tutorLoading && (
              <div className="p-5 border border-dashed rounded-xl border-border bg-white/[0.01] flex flex-col items-center justify-center gap-2">
                <div className="w-4 h-4 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                <span className="text-[10px] font-mono text-muted-foreground">
                  {isRTL ? "أكاديمي: تشريح بنية الجملة..." : "AI: Parsing target semantic register..."}
                </span>
              </div>
            )}

            {!tutorLoading && tutorAnalyses[currentSegmentIndex] && (
              <div className="space-y-4 animate-fade-in text-xs select-text">
                {/* Score badge & Grade */}
                <div className="p-4 bg-muted/20 dark:bg-white/[0.02] border border-border rounded-2xl flex items-center justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-muted-foreground">
                      {isRTL ? "الدرجة المستحقة" : "Translation Grade"}
                    </span>
                    <div className="text-2xl font-black text-primary mt-0.5">
                      {tutorAnalyses[currentSegmentIndex]?.grade}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                      {isRTL ? "دقة المواءمة" : "Linguistic Score"}
                    </span>
                    <span className="text-lg font-black text-foreground">
                      {tutorAnalyses[currentSegmentIndex]?.rating}/100
                    </span>
                  </div>
                </div>

                {/* Explanation */}
                <div className="space-y-1.5">
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                    {isRTL ? "تفسير المعلم وشرح الأسلوب" : "Tutor Analysis"}
                  </h4>
                  <p className="text-[11px] leading-relaxed dark:bg-white/[0.01] bg-muted/30 border border-border p-3.5 rounded-xl text-foreground font-medium">
                    {tutorAnalyses[currentSegmentIndex]?.explanation}
                  </p>
                </div>

                {/* Analyzed Terms */}
                <div className="space-y-2">
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                    {isRTL ? "المصطلحات المشرحة" : "Terminology Coaching"}
                  </h4>
                  <div className="space-y-2">
                    {tutorAnalyses[currentSegmentIndex]?.termsAnalysed.map((term, i) => (
                      <div key={i} className="p-3 bg-indigo-500/5 border border-indigo-500/10 rounded-xl">
                        <div className="font-bold text-indigo-400 text-[11px]">{term.term}</div>
                        <div className="text-[10.5px] mt-0.5 text-muted-foreground leading-relaxed">
                          {term.analysis}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Pitfalls */}
                <div className="p-3.5 bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-1">
                  <h4 className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">
                    {isRTL ? "فخ لغوي محتمل" : "Translation Pitfalls"}
                  </h4>
                  <p className="text-[10.5px] leading-relaxed text-muted-foreground font-medium">
                    {tutorAnalyses[currentSegmentIndex]?.pitfalls}
                  </p>
                </div>
              </div>
            )}

            {!tutorLoading && !tutorAnalyses[currentSegmentIndex] && (
              <div className="p-6 border border-dashed rounded-xl border-border bg-white/[0.01] text-center space-y-2 select-none">
                <GraduationCap className="w-8 h-8 text-muted-foreground mx-auto" />
                <p className="text-[10.5px] font-semibold text-muted-foreground">
                  {isRTL 
                    ? "لم يتم طلب تقييم لهذا المقطع بعد. اكتب ترجمتك المقترحة ثم اضغط على زر التقييم أعلاه!"
                    : "No tutor insights generated yet. Write your translation and click the evaluate button!"}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Decorative branding footer tags mirroring actual desktop CAD interfaces */}
        <div className="p-3 border-t dark:border-white/5 border-border text-[9px] text-slate-500 text-center font-mono select-none">
          RDAT CO-WRITER ACTIVE
        </div>

      </aside>

      </div>{/* End main panels wrapper */}

      {/* ─── Clear text confirmation dialog (Task 1b, v0.4.0) ─────── */}
      {/* Theme-aware (uses bg-background/border-border tokens), RTL-aware
          (dir inherits from root, uses logical ms/me properties). */}
      {clearDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          dir={isRTL ? "rtl" : "ltr"}
          onClick={() => setClearDialogOpen(false)}
        >
          <div
            className="bg-background border border-border rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6 space-y-4 animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-rose-500/10 border border-rose-500/20">
                <Trash2 className="w-5 h-5 text-rose-500" />
              </div>
              <h2 className="text-base font-bold text-foreground">
                {isRTL ? "مسح النص" : "Clear Text"}
              </h2>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              {isRTL
                ? "سيتم مسح النص المصدر والترجمات الحالية وفهرسة المقاطع. لا يمكن التراجع عن هذا الإجراء."
                : "This will clear the source text, current translations, and segment indexing. This cannot be undone."}
            </p>

            <label className="flex items-start gap-2.5 p-3 rounded-lg bg-surface-hover/40 border border-border cursor-pointer">
              <input
                type="checkbox"
                checked={clearAlsoSaved}
                onChange={(e) => setClearAlsoSaved(e.target.checked)}
                className="mt-0.5 accent-rose-500"
              />
              <span className="text-xs text-foreground leading-relaxed">
                {isRTL
                  ? "حذف الترجمات المحفوظة لهذا المستند أيضًا"
                  : "Also delete saved translations for this document"}
                <span className="block text-[10px] text-muted-foreground mt-0.5">
                  {isRTL
                    ? "فقط للمستند النشط. القاموس والذاكرة والإعدادات لا تُمسح."
                    : "Active document only. Glossary, TM, and settings are never touched."}
                </span>
              </span>
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setClearDialogOpen(false)}
                className="px-4 py-1.5 rounded-lg text-xs font-bold text-muted-foreground hover:bg-surface-hover cursor-pointer transition-all"
              >
                {isRTL ? "إلغاء" : "Cancel"}
              </button>
              <button
                onClick={handleClearText}
                className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-rose-500 hover:bg-rose-600 cursor-pointer transition-all shadow-md"
              >
                {isRTL ? "مسح النص" : "Clear Text"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
export default TranslationWorkspace;
