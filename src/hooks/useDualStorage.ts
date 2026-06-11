import { useState, useEffect, useCallback } from "react";
import { getAllofStore, putToStore, deleteFromStore, importGlossaryChunked, clearStore } from "../lib/dual-storage";
import { TMEntry, GlossaryEntry, SegmentEntry } from "../types";
import { getLTE } from "../lib/local-translation-engine";

export function useDualStorage() {
  const [tmCount, setTmCount] = useState(0);
  const [glossaryCount, setGlossaryCount] = useState(0);
  const [segmentCount, setSegmentCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isBackendReachable, setIsBackendReachable] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  const refreshCounts = useCallback(async () => {
    try {
      const tms = await getAllofStore<TMEntry>("tm_entries");
      const glossary = await getAllofStore<GlossaryEntry>("glossary");
      const segments = await getAllofStore<SegmentEntry>("segments");

      setTmCount(tms.length);
      setGlossaryCount(glossary.length);
      setSegmentCount(segments.length);

      // Load glossary entries into the local translation engine
      const lteEntries = glossary.map(g => ({
        en: g.source_term,
        ar: g.target_term,
        type: g.pos || "glossary"
      }));

      // Add default entries if empty is needed
      if (lteEntries.length > 0) {
        getLTE().load(lteEntries);
      } else {
        // Fallback default dictionary for testing
        getLTE().load([
          { en: "computer-assisted translation", ar: "الترجمة بمساعدة الحاسوب", type: "exact" },
          { en: "neural machine translation", ar: "الترجمة الآلية العصبية", type: "exact" },
          { en: "translation memory", ar: "ذاكرة الترجمة", type: "exact" },
          { en: "large language models", ar: "نماذج اللغات الكبيرة", type: "exact" },
          { en: "artificial intelligence", ar: "الذكاء الاصطناعي", type: "exact" },
        ]);
      }
    } catch (err) {
      console.error("[useDualStorage] Failed to count database:", err);
    }
  }, []);

  useEffect(() => {
    refreshCounts();

    // Polling sync network check
    const checkNetwork = () => {
      setIsBackendReachable(navigator.onLine);
    };

    window.addEventListener("online", checkNetwork);
    window.addEventListener("offline", checkNetwork);
    checkNetwork();

    return () => {
      window.removeEventListener("online", checkNetwork);
      window.removeEventListener("offline", checkNetwork);
    };
  }, [refreshCounts]);

  // Support for offline terminology database sync simulation/real fetch
  const syncOfflineTerminology = useCallback(async () => {
    if (!navigator.onLine) {
      console.warn("[Sync] Network offline. Sync queued.");
      setIsBackendReachable(false);
      return false;
    }

    setIsSyncing(true);
    setIsBackendReachable(true);

    try {
      // Simulate/Trigger full sync request
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Grab any new remote terminology items or push draft translations
      const current = await getAllofStore<GlossaryEntry>("glossary");
      if (current.length === 0) {
        // Seed default dataset if database is empty
        const defaultSet: GlossaryEntry[] = [
          { id: 1, source_term: "computer-assisted translation", target_term: "الترجمة بمساعدة الحاسوب", source_lang: "en", target_lang: "ar", pos: "noun" },
          { id: 2, source_term: "neural machine translation", target_term: "الترجمة الآلية العصبية", source_lang: "en", target_lang: "ar", pos: "noun" },
          { id: 3, source_term: "translation memory", target_term: "ذاكرة الترجمة", source_lang: "en", target_lang: "ar", pos: "noun" },
          { id: 4, source_term: "artificial intelligence", target_term: "الذكاء الاصطناعي", source_lang: "en", target_lang: "ar", pos: "noun" },
          { id: 5, source_term: "deep learning", target_term: "التعلم العميق", source_lang: "en", target_lang: "ar", pos: "noun" },
          { id: 6, source_term: "large language models", target_term: "نماذج اللغات الكبيرة", source_lang: "en", target_lang: "ar", pos: "noun" },
        ];
        await importGlossaryChunked(defaultSet);
      }

      setLastSyncAt(Date.now());
      await refreshCounts();
      return true;
    } catch (e) {
      console.error("[Sync] Terminology sync failed:", e);
      return false;
    } finally {
      setIsSyncing(false);
    }
  }, [refreshCounts]);

  const addGlossary = useCallback(async (entry: Omit<GlossaryEntry, "id">) => {
    await putToStore("glossary", entry);
    await refreshCounts();
  }, [refreshCounts]);

  const removeGlossary = useCallback(async (id: number) => {
    await deleteFromStore("glossary", id);
    await refreshCounts();
  }, [refreshCounts]);

  const clearGlossary = useCallback(async () => {
    await clearStore("glossary");
    await refreshCounts();
  }, [refreshCounts]);

  const importGlossary = useCallback(async (entries: GlossaryEntry[], onProgress?: (p: number) => void) => {
    await importGlossaryChunked(entries, onProgress);
    await refreshCounts();
  }, [refreshCounts]);

  return {
    tmCount,
    glossaryCount,
    segmentCount,
    isSyncing,
    isBackendReachable,
    lastSyncAt,
    syncOfflineTerminology,
    addGlossary,
    removeGlossary,
    clearGlossary,
    importGlossary,
    refreshCounts,
  };
}
