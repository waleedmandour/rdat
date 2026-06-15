import { useState, useCallback, useEffect } from "react";
import { RAGState } from "../types";
import { getLTE } from "../lib/local-translation-engine";

/**
 * Hook that tracks the RAG (Retrieval-Augmented Generation) state.
 *
 * Phase 2 enhancement: Dynamically tracks the LTE corpus state instead
 * of hardcoding values. Re-reads LTE stats whenever the corpus might
 * change (e.g., after glossary import, sync, or seed corpus load).
 *
 * The ragState object is consumed by the StatusBar and WorkspaceShell
 * to display real-time corpus statistics and availability information.
 */
export function useRAG() {
  const [ragState, setRagState] = useState<RAGState>(() => {
    const lte = getLTE();
    const stats = lte.getStats();
    return {
      isWorkerReady: true,
      isCorpusLoaded: stats.entries > 0,
      isLoading: false,
      error: null,
      corpusSize: stats.entries,
      modelsLoaded: true,
    };
  });

  // Periodically refresh corpus stats to catch asynchronous loads
  // (e.g., when useDualStorage finishes loading glossary into LTE)
  useEffect(() => {
    const refreshInterval = setInterval(() => {
      const lte = getLTE();
      const stats = lte.getStats();
      setRagState((prev) => {
        // Only update if something changed — avoid unnecessary re-renders
        if (
          prev.isCorpusLoaded !== (stats.entries > 0) ||
          prev.corpusSize !== stats.entries
        ) {
          return {
            ...prev,
            isCorpusLoaded: stats.entries > 0,
            corpusSize: stats.entries,
          };
        }
        return prev;
      });
    }, 2000); // Check every 2 seconds

    return () => clearInterval(refreshInterval);
  }, []);

  const lteSearch = useCallback((query: string, limit = 5) => {
    return getLTE().search(query, limit);
  }, []);

  /**
   * Force-refresh the RAG state — call after glossary imports or syncs
   * to immediately reflect the new corpus size in the UI.
   */
  const refreshRagState = useCallback(() => {
    const lte = getLTE();
    const stats = lte.getStats();
    setRagState({
      isWorkerReady: true,
      isCorpusLoaded: stats.entries > 0,
      isLoading: false,
      error: null,
      corpusSize: stats.entries,
      modelsLoaded: true,
    });
  }, []);

  return {
    ragState,
    lteSearch,
    refreshRagState,
  };
}
export default useRAG;
