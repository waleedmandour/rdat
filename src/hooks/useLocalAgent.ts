import { useState, useEffect } from "react";
import { LocalAgentState } from "../types";
import {
  getEngineState,
  onEngineStateChange,
  type LLMEngineState,
} from "../lib/local-llm-engine";

/**
 * Hook that reflects the real state of the local LLM agent.
 *
 * Previously a dead stub returning hardcoded "connected".
 * Now it maps the LLM engine state to the LocalAgentState type:
 *   - "idle"       → "disconnected"
 *   - "loading"    → "syncing"
 *   - "ready"      → "ready"
 *   - "generating" → "ready" (still operational)
 *   - "error"      → "error"
 */
export function useLocalAgent() {
  const [localAgentState, setLocalAgentState] = useState<LocalAgentState>(() => {
    const s = getEngineState();
    return mapState(s);
  });

  useEffect(() => {
    const unsubscribe = onEngineStateChange(
      (state: LLMEngineState) => {
        setLocalAgentState(mapState(state));
      }
    );

    return unsubscribe;
  }, []);

  return { localAgentState };
}

function mapState(state: LLMEngineState): LocalAgentState {
  switch (state) {
    case "idle":
      return "disconnected";
    case "loading":
      return "syncing";
    case "ready":
    case "generating":
      return "ready";
    case "error":
      return "error";
  }
}

export default useLocalAgent;
