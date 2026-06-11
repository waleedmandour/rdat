import React from "react";
import { useLanguage } from "../context/LanguageContext";
import { 
  Database,
  Wifi, 
  WifiOff, 
  RefreshCw, 
  Cpu, 
  CloudCheck 
} from "lucide-react";
import { 
  EngineMode, 
  GTRStatus, 
  WebGPUInfo, 
  RAGState, 
  LocalAgentState 
} from "../types";
import { cn } from "../lib/utils";

interface StatusBarProps {
  engineMode: EngineMode;
  gtrStatus: GTRStatus;
  webgpuInfo: WebGPUInfo;
  geminiAvailable: boolean;
  ragState: RAGState;
  localAgentState: LocalAgentState;
  segmentCount: number;
  wordCount: number;
  storageInfo: {
    tmCount: number;
    glossaryCount: number;
    segmentCount: number;
    isSyncing: boolean;
    isBackendReachable: boolean;
    lastSyncAt: number | null;
  };
}

export function StatusBar({
  engineMode,
  gtrStatus,
  webgpuInfo,
  geminiAvailable,
  ragState,
  localAgentState,
  segmentCount,
  wordCount,
  storageInfo,
}: StatusBarProps) {
  const { t, locale } = useLanguage();
  const isRTL = locale === "ar";

  return (
    <footer className="h-9 bg-surface border-t border-border flex items-center justify-between px-4 text-[11px] text-muted-foreground font-mono select-none">
      {/* Left items (Status and Offline info) */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5 text-primary" />
          <span>{t("status.footer")}</span>
        </div>

        <div className="h-3.5 w-px bg-border" />

        <div className="flex items-center gap-1.5">
          {storageInfo.isBackendReachable ? (
            <span className="flex items-center gap-1 text-emerald-500">
              <Wifi className="w-3.5 h-3.5" />
              <span>{locale === "en" ? "Online" : "متصل بالشبكة"}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-amber-500">
              <WifiOff className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
              <span>{locale === "en" ? "Offline" : "غير متصل بالشبكة (محلي)"}</span>
            </span>
          )}
        </div>

        {storageInfo.isSyncing && (
          <div className="flex items-center gap-1 text-primary animate-spin">
            <RefreshCw className="w-3.5 h-3.5" />
          </div>
        )}
      </div>

      {/* Right items (Detailed Engine stats) */}
      <div className={cn("flex items-center gap-4", isRTL && "flex-row-reverse")}>
        <div className="flex items-center gap-1">
          <span className="opacity-50">{t("status.segments")}:</span>
          <span className="font-semibold text-foreground">{storageInfo.segmentCount}</span>
        </div>

        <div className="h-3.5 w-px bg-border" />

        <div className="flex items-center gap-1">
          <span className="text-primary font-bold">
            [{t(`status.engine.${engineMode}`)}]
          </span>
        </div>

        <div className="h-3.5 w-px bg-border" />

        <div className="flex items-center gap-1">
          <span className={cn(
            "px-1.5 py-0.5 rounded text-[10px] font-bold",
            storageInfo.glossaryCount > 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          )}>
            GTR {storageInfo.glossaryCount > 0 ? `${storageInfo.glossaryCount} ${t("status.words")}` : "0"}
          </span>
        </div>

        <div className="h-3.5 w-px bg-border whitespace-nowrap" />

        {/* Local WebGPU Info */}
        <div className="flex items-center gap-1">
          <Cpu className="w-3.5 h-3.5 text-muted-foreground" />
          <span>
            {webgpuInfo.state === "ready" ? t("status.webgpu.ready") : t("status.webgpu.unavailable")}
          </span>
        </div>
      </div>
    </footer>
  );
}
export default StatusBar;
