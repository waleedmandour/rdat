import { useLanguage } from "../context/LanguageContext";
import {
  Database,
  Wifi,
  WifiOff,
  RefreshCw,
  Cpu,
  Server,
  ServerCrash,
  Loader2,
  PenLine,
} from "lucide-react";
import {
  EngineMode,
  WebGPUInfo,
} from "../types";
import { cn } from "../lib/utils";
import { isTauriEnvironment } from "../lib/adapters/ollama-adapter";
import { useSettingsStore } from "../stores/settings-store";
import { useEditorActivityStore } from "../stores/editor-activity-store";

interface StatusBarProps {
  engineMode: EngineMode;
  webgpuInfo: WebGPUInfo;
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
  webgpuInfo,
  storageInfo,
}: StatusBarProps) {
  const { t, locale } = useLanguage();
  const isRTL = locale === "ar";
  const isTauri = isTauriEnvironment();
  const loadedModel = useSettingsStore((s) => s.loadedModel);
  const editorActivity = useEditorActivityStore((s) => s.activity);

  // Activity indicator for the status bar
  const renderActivityIndicator = () => {
    switch (editorActivity) {
      case "typing":
        return (
          <span className="flex items-center gap-1 text-blue-400">
            <PenLine className="w-3.5 h-3.5" />
            <span>{isRTL ? "يكتب..." : "Typing..."}</span>
          </span>
        );
      case "suggesting":
        return (
          <span className="flex items-center gap-1 text-primary">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>{isRTL ? "يقترح..." : "Suggesting..."}</span>
          </span>
        );
      case "loading-model":
        return (
          <span className="flex items-center gap-1 text-amber-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>{isRTL ? "تحميل النموذج..." : "Loading model..."}</span>
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-muted-foreground">
            <span>{isRTL ? "جاهز" : "Ready"}</span>
          </span>
        );
    }
  };

  // Determine the engine status display.
  // In Tauri mode: show Ollama status (based on whether a model is loaded).
  // In PWA mode: show WebGPU status (from useWebLLM hook).
  const renderEngineStatus = () => {
    if (isTauri) {
      // Tauri mode - show Ollama engine status
      if (loadedModel) {
        return (
          <span className="flex items-center gap-1 text-emerald-500">
            <Server className="w-3.5 h-3.5" />
            <span>{`Ollama: ${loadedModel}`}</span>
          </span>
        );
      }
      // Ollama detected but no model loaded - guide user to Models panel
      return (
        <span className="flex items-center gap-1 text-amber-500">
          <ServerCrash className="w-3.5 h-3.5" />
          <span>{locale === "en" ? "Ollama: no model loaded (go to Models)" : "Ollama: لا يوجد نموذج (اذهب للنماذج)"}</span>
        </span>
      );
    }

    // PWA mode — show WebGPU status (existing behavior)
    return (
      <span>
        {webgpuInfo.state === "ready"
          ? t("status.webgpu.ready")
          : webgpuInfo.state === "initializing"
            ? (locale === "en" ? `Loading ${webgpuInfo.progress || 0}%` : `جاري التحميل ${webgpuInfo.progress || 0}%`)
            : webgpuInfo.state === "error"
              ? (locale === "en" ? `WebGPU: ${webgpuInfo.error || "Error"}` : `WebGPU: ${webgpuInfo.error || "خطأ"}`)
              : t("status.webgpu.unavailable")}
      </span>
    );
  };

  return (
    <footer className="h-9 bg-surface border-t border-border flex items-center justify-between px-4 text-[11px] text-muted-foreground font-mono select-none">
      {/* Left items (Status, Activity, and Offline info) */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5 text-primary" />
          <span>{t("status.footer")}</span>
        </div>

        <div className="h-3.5 w-px bg-border" />

        {/* Editor activity indicator */}
        {renderActivityIndicator()}

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

        {/* Engine status — adapter-aware (Ollama in Tauri, WebGPU in PWA) */}
        <div className="flex items-center gap-1">
          {isTauri ? (
            renderEngineStatus()
          ) : (
            <>
              <Cpu className="w-3.5 h-3.5 text-muted-foreground" />
              {renderEngineStatus()}
            </>
          )}
        </div>
      </div>
    </footer>
  );
}
export default StatusBar;
