import { useState } from "react";
import { WebGPUInfo } from "../types";

export function useWebLLM() {
  const [webgpuInfo] = useState<WebGPUInfo>({
    state: "ready",
  });
  return { webgpuInfo };
}
