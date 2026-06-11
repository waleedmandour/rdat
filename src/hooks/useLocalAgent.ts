import { useState } from "react";
import { LocalAgentState } from "../types";

export function useLocalAgent() {
  const [localAgentState] = useState<LocalAgentState>("connected");
  return { localAgentState };
}
