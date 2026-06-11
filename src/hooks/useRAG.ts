import { useState, useCallback } from "react";
import { RAGState } from "../types";
import { getLTE } from "../lib/local-translation-engine";

export function useRAG() {
  const [ragState, setRagState] = useState<RAGState>({
    isWorkerReady: true,
    isCorpusLoaded: true,
    isLoading: false,
    error: null,
    corpusSize: 5,
    modelsLoaded: true,
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
