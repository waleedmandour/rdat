import { useState, useCallback } from "react";
import { RAGState } from "../types";
import { getLTE } from "../lib/local-translation-engine";

export function useRAG() {
  const [ragState, setRagState] = useState<RAGState>(() => {
    // Read actual LTE stats on initialisation instead of hardcoding values
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

  const lteSearch = useCallback((query: string, limit = 5) => {
    // Perform standard fuzzy semantic character overlap search on our LTE phrase table
    return getLTE().search(query, limit);
  }, []);

  return {
    ragState,
    lteSearch,
  };
}
export default useRAG;
