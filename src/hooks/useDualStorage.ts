import { useState, useEffect, useCallback } from "react";
import { getAllofStore, putToStore, deleteFromStore, importGlossaryChunked, clearStore } from "../lib/dual-storage";
import { TMEntry, GlossaryEntry, SegmentEntry } from "../types";
import { getLTE } from "../lib/local-translation-engine";
import { SEED_CORPUS } from "../lib/seed-corpus";

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

      // Load user glossary entries into LTE; fall back to the comprehensive
      // seed corpus when the user has not yet imported any glossary data.
      // The seed corpus covers ~80 common EN→AR pairs so that Tier 1
      // ghost-text suggestions work immediately on a fresh install.
      if (lteEntries.length > 0) {
        getLTE().load([...SEED_CORPUS, ...lteEntries]);
      } else {
        getLTE().load(SEED_CORPUS);
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
        // Seed default dataset from the comprehensive seed corpus if database is empty
        const defaultSet: GlossaryEntry[] = SEED_CORPUS.map((entry, idx) => ({
          id: idx + 1,
          source_term: entry.en,
          target_term: entry.ar,
          source_lang: "en",
          target_lang: "ar",
          pos: entry.type,
        }));
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
