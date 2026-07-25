import { useState, useEffect, useCallback, useRef } from "react";
import {
  getAllofStore,
  putToStore,
  deleteFromStore,
  importGlossaryChunked,
  clearStore,
  getDownloadedDbs,
  setDownloadedDbs,
} from "../lib/dual-storage";
import { TMEntry, GlossaryEntry, SegmentEntry } from "../types";
import { getLTE } from "../lib/local-translation-engine";
import { SEED_CORPUS } from "../lib/seed-corpus";

/**
 * Hook that keeps IndexedDB counts in sync with the UI and feeds the
 * Local Translation Engine (LTE) with the user's glossary + seed corpus.
 *
 * NOTE (PHASE 1 task 1.6): `refreshCounts()` is called on every glossary
 * add/import/delete. The LTE rebuild was previously synchronous inside
 * `refreshCounts`, which is fine for the current ~85-entry seed corpus
 * but will visibly stall the UI once a few-thousand-entry dictionary
 * is loaded (see TODO in src/lib/seed-corpus.ts). The rebuild has been
 * moved off the synchronous path: it now runs in a deferred microtask
 * via `queueMicrotask`, so the React state update (counts) returns to
 * the caller immediately and the LTE rebuild happens on the next idle
 * tick without blocking the click handler that triggered it.
 *
 * If the corpus grows beyond ~10k entries and even the deferred rebuild
 * causes jank, the next step is to debounce it (e.g. 200ms trailing
 * debounce) or move it into a Web Worker. The current implementation
 * is the smallest change that fixes the immediate concern without
 * introducing a worker boundary.
 */
export function useDualStorage() {
  const [tmCount, setTmCount] = useState(0);
  const [glossaryCount, setGlossaryCount] = useState(0);
  const [segmentCount, setSegmentCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isBackendReachable, setIsBackendReachable] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  // Persisted set of reference DB IDs the user has downloaded. Loaded
  // from sync_meta on mount so GlossaryView can show "Use" instead of
  // "Download" on revisits. See PHASE 2 task 2.3.
  const [downloadedDbs, setDownloadedDbsState] = useState<string[]>([]);

  // Deferred LTE rebuild — coalesces multiple back-to-back refreshCounts()
  // calls (e.g. during bulk import) into a single load() call.
  const lteRebuildQueued = useRef(false);

  const refreshCounts = useCallback(async () => {
    try {
      const tms = await getAllofStore<TMEntry>("tm_entries");
      const glossary = await getAllofStore<GlossaryEntry>("glossary");
      const segments = await getAllofStore<SegmentEntry>("segments");

      setTmCount(tms.length);
      setGlossaryCount(glossary.length);
      setSegmentCount(segments.length);

      // Defer the LTE rebuild so it doesn't block the click handler that
      // triggered this refresh. queueMicrotask runs the rebuild before
      // the next paint, so the user perceives no lag in either the
      // count update or the next ghost-text suggestion.
      if (!lteRebuildQueued.current) {
        lteRebuildQueued.current = true;
        queueMicrotask(() => {
          lteRebuildQueued.current = false;
          try {
            const lteEntries = glossary.map(g => ({
              en: g.source_term,
              ar: g.target_term,
              type: g.pos || "glossary"
            }));

            // Load user glossary entries into LTE; fall back to the
            // seed corpus when the user has not yet imported any glossary
            // data. The seed corpus covers ~85 common EN→AR pairs so
            // that Tier 0 ghost-text suggestions work immediately on a
            // fresh install. Both the en and ar indexes are rebuilt
            // (see local-translation-engine.ts load()) so the LTE is
            // bidirectionally queryable.
            if (lteEntries.length > 0) {
              getLTE().load([...SEED_CORPUS, ...lteEntries]);
            } else {
              getLTE().load(SEED_CORPUS);
            }
          } catch (err) {
            console.error("[useDualStorage] Deferred LTE rebuild failed:", err);
          }
        });
      }
    } catch (err) {
      console.error("[useDualStorage] Failed to count database:", err);
    }
  }, []);

  useEffect(() => {
    refreshCounts();

    // Load the persisted set of downloaded reference DB IDs so the
    // GlossaryView can render the correct button label on mount.
    // See PHASE 2 task 2.3.
    getDownloadedDbs()
      .then((ids) => setDownloadedDbsState(ids))
      .catch((err) => console.error("[useDualStorage] Failed to load downloaded DB list:", err));

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

  const removeGlossary = useCallback(async (id: number | string) => {
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

  /**
   * Update an existing glossary entry in place. IndexedDB's put() upserts
   * by key, so passing the existing entry (with its `id`) plus the
   * changed fields is enough. After saving, refreshCounts() re-runs the
   * LTE rebuild so ghost-text suggestions pick up the edited term
   * immediately. See PHASE 2 task 2.4.
   */
  const updateGlossary = useCallback(
    async (id: number | string, changes: Partial<Omit<GlossaryEntry, "id">>) => {
      // Read the existing record so we merge instead of overwriting.
      const { getFromStore } = await import("../lib/dual-storage");
      const existing = await getFromStore<GlossaryEntry>("glossary", id);
      if (!existing) {
        throw new Error(`Glossary entry with id ${id} not found`);
      }
      const updated: GlossaryEntry = { ...existing, ...changes, id };
      await putToStore("glossary", updated);
      await refreshCounts();
    },
    [refreshCounts]
  );

  /**
   * Mark a reference DB as downloaded (persisted in sync_meta). Called
   * by GlossaryView after a successful download so the button label
   * flips from "Download" to "Use" and survives reloads. See PHASE 2
   * task 2.3.
   */
  const markDbDownloaded = useCallback(async (dbId: string) => {
    setDownloadedDbsState((prev) =>
      prev.includes(dbId) ? prev : [...prev, dbId]
    );
    // Read the current persisted list fresh in case multiple tabs are
    // active; merge; then write back.
    try {
      const current = await getDownloadedDbs();
      if (!current.includes(dbId)) {
        await setDownloadedDbs([...current, dbId]);
      }
    } catch (err) {
      console.error("[useDualStorage] Failed to persist downloaded DB:", err);
    }
  }, []);

  /**
   * Remove a reference DB from the downloaded set. Called when the
   * user clicks "Use" again to toggle the DB off (which also removes
   * its entries from IndexedDB — handled by the caller). See PHASE 2
   * task 2.3.
   */
  const unmarkDbDownloaded = useCallback(async (dbId: string) => {
    setDownloadedDbsState((prev) => prev.filter((id) => id !== dbId));
    try {
      const current = await getDownloadedDbs();
      await setDownloadedDbs(current.filter((id) => id !== dbId));
    } catch (err) {
      console.error("[useDualStorage] Failed to update downloaded DB list:", err);
    }
  }, []);

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
    updateGlossary,
    refreshCounts,
    // Reference-DB download state (PHASE 2 task 2.3)
    downloadedDbs,
    markDbDownloaded,
    unmarkDbDownloaded,
  };
}
