import React, { useState, useEffect, useCallback } from "react";
import { useLanguage } from "../context/LanguageContext";
import { useSettingsStore } from "../stores/settings-store";
import { useToast } from "../context/ToastContext";
import {
  Cpu,
  Download,
  Check,
  Sparkles,
  Play,
  AlertCircle,
  RefreshCw,
  Trash2,
  Server,
  ServerCrash,
  Loader2,
  ExternalLink,
  Zap,
} from "lucide-react";
import { cn } from "../lib/utils";
import { getActiveAdapter, resetAdapter, isTauriEnvironment } from "../lib/adapters";
import { getHealthDiagnostics, type HealthDiagnostics } from "../lib/adapters/ollama-adapter";
import type { LLMAdapter, ModelInfo } from "../lib/llm-adapter";

/**
 * AiModelsView — Adapter-aware model management panel.
 *
 * This component is the single source of truth for model lifecycle in the
 * app. It detects the active LLM adapter (Ollama in Tauri, WebLLM in
 * browser, or none) and renders the appropriate catalog and controls.
 *
 * Three modes:
 *   1. Ollama mode (Tauri + Ollama daemon running):
 *      - Shows Ollama daemon status indicator (green/red)
 *      - Shows recommended Ollama catalog (Gemma 4, Qwen 3, Llama 4)
 *      - "Pull" button downloads a model via `adapter.pullModel()`
 *      - "Load" button selects a pulled model as active
 *      - "Remove" button deletes a pulled model
 *
 *   2. WebLLM mode (browser with WebGPU, or Tauri fallback):
 *      - Shows WebGPU status indicator
 *      - Shows WebLLM catalog (Qwen 2.5, Gemma 2, Llama 3.1)
 *      - "Download" button caches model weights via browser Cache API
 *      - "Load" button loads model into WebGPU memory
 *
 *   3. No adapter (no Ollama, no WebGPU):
 *      - Shows warning + "Install Ollama" CTA (in Tauri)
 *      - Or "Use Chrome 113+" CTA (in browser)
 */
export function AiModelsView() {
  const { locale, t } = useLanguage();
  const { showToast } = useToast();
  const isRTL = locale === "ar";

  const {
    engineMode,
    setEngineMode,
    useGtr,
    setUseGtr,
    loadedModel,
    setLoadedModel,
  } = useSettingsStore();

  // ─── Adapter State ───────────────────────────────────────────────
  const [adapter, setAdapter] = useState<LLMAdapter | null>(null);
  const [adapterLoading, setAdapterLoading] = useState(true);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [daemonHealthy, setDaemonHealthy] = useState<boolean>(false);
  const [adapterState, setAdapterState] = useState<string>("idle");
  const [adapterError, setAdapterError] = useState<string | null>(null);
  const [healthDiagnostics, setHealthDiagnostics] = useState<HealthDiagnostics | null>(null);

  // ─── Model Operation State ───────────────────────────────────────
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [pullingModelId, setPullingModelId] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<number>(0);

  // ─── Hardware Specs (for display) ────────────────────────────────
  const [cpuCores, setCpuCores] = useState<number>(4);
  const [deviceMemory, setDeviceMemory] = useState<number>(8);
  const [cpuModel, setCpuModel] = useState<string>("Intel Core / Apple M-series");
  const [evaluatingSpecs, setEvaluatingSpecs] = useState<boolean>(true);

  // ─── Detect active adapter on mount ──────────────────────────────
  // Safety: if getActiveAdapter() hasn't resolved in 20 seconds, force
  // the loading state to clear. The factory can take up to ~15s when
  // it does 3 retries with 2s delays each (for users with a saved model
  // whose Ollama is slow to start). 20s is a generous safety margin.
  useEffect(() => {
    let cancelled = false;
    const safetyTimer = setTimeout(() => {
      if (!cancelled && adapterLoading) {
        console.warn("[AiModelsView] Adapter detection timed out after 20s.");
        setAdapter(null);
        setAdapterLoading(false);
        setDaemonHealthy(false);
      }
    }, 20000);

    (async () => {
      setAdapterLoading(true);
      const activeAdapter = await getActiveAdapter();
      if (cancelled) return;
      clearTimeout(safetyTimer);
      setAdapter(activeAdapter);

      if (activeAdapter) {
        // Subscribe to adapter state changes
        const unsubscribe = activeAdapter.onStateChange((state, progress, error) => {
          if (cancelled) return;
          setAdapterState(state);
          setLoadingProgress(progress);
          setAdapterError(error);
          if (state === "ready") {
            setLoadingModelId(null);
          }
        });

        // Load model list
        try {
          const modelList = await activeAdapter.listModels();
          if (cancelled) return;
          setModels(modelList);
        } catch (e: any) {
          console.warn("[AiModelsView] Failed to list models:", e);
        }

        // Check daemon health (for Ollama)
        try {
          const healthy = await activeAdapter.isAvailable();
          if (cancelled) return;
          setDaemonHealthy(healthy);
        } catch {
          if (!cancelled) setDaemonHealthy(false);
        }

        return () => {
          unsubscribe();
        };
      }
      setAdapterLoading(false);
    })();
    return () => { cancelled = true; clearTimeout(safetyTimer); };
  }, []);

  // ─── Hardware specs detection ────────────────────────────────────
  useEffect(() => {
    setTimeout(() => {
      if (typeof navigator !== "undefined") {
        setCpuCores(navigator.hardwareConcurrency || 4);
        setDeviceMemory((navigator as any).deviceMemory || 8);
        if (navigator.userAgent.includes("Macintosh")) {
          setCpuModel("Apple Silicon / Intel Xeon");
        } else if (navigator.userAgent.includes("Android") || navigator.userAgent.includes("iPhone")) {
          setCpuModel("ARM Mobile SoC");
        } else {
          setCpuModel("Intel Core / AMD Ryzen");
        }
      }
      setEvaluatingSpecs(false);
    }, 400);
  }, []);

  // ─── Refresh model list ──────────────────────────────────────────
  // Also used as the "Recheck" button handler when no adapter is detected.
  // Resets the adapter cache and re-runs full detection so that if the
  // user just started Ollama, we pick it up without requiring an app restart.
  const refreshModels = useCallback(async () => {
    // Reset the adapter cache so getActiveAdapter() re-detects from scratch
    resetAdapter();
    setAdapterLoading(true);
    setAdapter(null);
    setDaemonHealthy(false);
    setHealthDiagnostics(null);

    const activeAdapter = await getActiveAdapter();
    setAdapter(activeAdapter);

    if (activeAdapter) {
      try {
        const modelList = await activeAdapter.listModels();
        setModels(modelList);
        const healthy = await activeAdapter.isAvailable();
        setDaemonHealthy(healthy);
      } catch (e: any) {
        console.warn("[AiModelsView] Refresh failed:", e);
      }
    } else if (isTauriEnvironment()) {
      // Capture diagnostics for the UI — shows which URLs were tried
      // and which errors occurred, so the user can self-diagnose.
      const diag = getHealthDiagnostics();
      setHealthDiagnostics(diag);
    }
    setAdapterLoading(false);
  }, []);

  // ─── Pull / Download a model ─────────────────────────────────────
  const handlePullModel = async (modelId: string) => {
    if (!adapter || !adapter.pullModel) {
      showToast(
        isRTL ? "هذا المحرك لا يدعم سحب النماذج" : "This adapter does not support pulling models",
        "warning"
      );
      return;
    }
    setPullingModelId(modelId);
    setPullProgress(0);
    try {
      await adapter.pullModel(modelId, (p) => setPullProgress(p));
      showToast(
        isRTL ? `تم سحب النموذج بنجاح: ${modelId}` : `Model pulled successfully: ${modelId}`,
        "success"
      );
      await refreshModels();
    } catch (e: any) {
      const msg = e?.message || String(e);
      showToast(
        isRTL ? `فشل سحب النموذج: ${msg}` : `Failed to pull model: ${msg}`,
        "error"
      );
    } finally {
      setPullingModelId(null);
      setPullProgress(0);
    }
  };

  // ─── Load a model (select it as active) ──────────────────────────
  const handleLoadModel = async (modelId: string) => {
    if (!adapter) return;
    setLoadingModelId(modelId);
    setLoadingProgress(0);
    try {
      await adapter.loadModel(modelId, (p) => setLoadingProgress(p));
      setLoadedModel(modelId);
      showToast(
        isRTL ? `تم تحميل النموذج: ${modelId}` : `Model loaded: ${modelId}`,
        "success"
      );
    } catch (e: any) {
      const msg = e?.message || String(e);
      showToast(
        isRTL ? `فشل تحميل النموذج: ${msg}` : `Failed to load model: ${msg}`,
        "error"
      );
    } finally {
      setLoadingModelId(null);
    }
  };

  // ─── Unload the current model ────────────────────────────────────
  const handleUnloadModel = async () => {
    if (!adapter || !loadedModel) return;
    try {
      await adapter.unloadModel();
      setLoadedModel("");
      showToast(
        isRTL ? "تم إلغاء تحميل النموذج" : "Model unloaded",
        "info"
      );
    } catch (e: any) {
      showToast(
        isRTL ? `فشل إلغاء التحميل: ${e.message}` : `Failed to unload: ${e.message}`,
        "error"
      );
    }
  };

  // ─── Remove a model from local storage ───────────────────────────
  const handleRemoveModel = async (modelId: string) => {
    if (!adapter || !adapter.removeModel) return;
    if (!confirm(
      isRTL
        ? `هل أنت متأكد من حذف النموذج "${modelId}"؟`
        : `Are you sure you want to remove "${modelId}"?`
    )) return;
    try {
      await adapter.removeModel(modelId);
      if (loadedModel === modelId) {
        await handleUnloadModel();
      }
      showToast(
        isRTL ? `تم حذف النموذج: ${modelId}` : `Model removed: ${modelId}`,
        "info"
      );
      await refreshModels();
    } catch (e: any) {
      showToast(
        isRTL ? `فشل الحذف: ${e.message}` : `Failed to remove: ${e.message}`,
        "error"
      );
    }
  };

  // ─── Render ──────────────────────────────────────────────────────

  if (adapterLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3" dir={isRTL ? "rtl" : "ltr"}>
        <div className="flex items-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">
            {isRTL ? "جاري التحقق من المحرك..." : "Detecting engine..."}
          </span>
        </div>
        {/* Skip button — if detection takes too long, user can force-continue
            to see the no-adapter warning instead of waiting forever. */}
        <button
          onClick={() => {
            console.warn("[AiModelsView] User clicked Skip — forcing no-adapter state.");
            setAdapter(null);
            setAdapterLoading(false);
            setDaemonHealthy(false);
          }}
          className="mt-2 text-[10px] text-muted-foreground/60 hover:text-foreground underline cursor-pointer"
        >
          {isRTL ? "تخطٍّ" : "Skip"}
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background p-6" dir={isRTL ? "rtl" : "ltr"}>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-black text-foreground flex items-center gap-2">
            <Cpu className="w-5 h-5 text-primary" />
            {t("nav.models")}
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {isRTL
              ? "إدارة النماذج المحلية للترجمة الآلية. المحرك الأساسي للمشروع."
              : "Manage local models for machine translation. The project's primary engine."}
          </p>
        </div>

        {/* Engine Status Banner */}
        <EngineStatusBanner
          adapter={adapter}
          daemonHealthy={daemonHealthy}
          adapterState={adapterState}
          adapterError={adapterError}
          loadedModel={loadedModel}
          isRTL={isRTL}
          onRefresh={refreshModels}
          diagnostics={healthDiagnostics}
        />

        {/* Hardware Profile (compact) */}
        <div className="bg-surface border border-border p-4 rounded-xl">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
            {isRTL ? "مواصفات الجهاز" : "Hardware Profile"}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
            <div>
              <div className="text-muted-foreground">{isRTL ? "المعالج" : "CPU"}</div>
              <div className="font-bold text-foreground">{evaluatingSpecs ? "..." : cpuModel}</div>
            </div>
            <div>
              <div className="text-muted-foreground">{isRTL ? "أنوية المعالج" : "CPU Cores"}</div>
              <div className="font-bold text-foreground">{evaluatingSpecs ? "..." : cpuCores}</div>
            </div>
            <div>
              <div className="text-muted-foreground">{isRTL ? "الذاكرة (GB)" : "Memory (GB)"}</div>
              <div className="font-bold text-foreground">{evaluatingSpecs ? "..." : deviceMemory}</div>
            </div>
            <div>
              <div className="text-muted-foreground">{isRTL ? "المحرك" : "Engine"}</div>
              <div className="font-bold text-primary">
                {adapter ? adapter.displayName : (isRTL ? "غير متاح" : "None")}
              </div>
            </div>
          </div>
        </div>

        {/* Model Catalog */}
        {adapter ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                {isRTL ? "كتالوج النماذج" : "Model Catalog"}
              </h3>
              <button
                onClick={refreshModels}
                className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                {isRTL ? "تحديث" : "Refresh"}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {models.map((model) => (
                <ModelCard
                  key={model.id}
                  model={model}
                  isLoaded={loadedModel === model.id}
                  isPulling={pullingModelId === model.id}
                  pullProgress={pullProgress}
                  isLoading={loadingModelId === model.id}
                  loadingProgress={loadingProgress}
                  adapterId={adapter.id}
                  isRTL={isRTL}
                  onPull={() => handlePullModel(model.id)}
                  onLoad={() => handleLoadModel(model.id)}
                  onRemove={() => handleRemoveModel(model.id)}
                />
              ))}
            </div>
          </div>
        ) : (
          <NoAdapterWarning isRTL={isRTL} isTauri={isTauriEnvironment()} />
        )}

        {/* Engine Mode Settings */}
        <div className="bg-surface border border-border p-4 rounded-xl space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            {isRTL ? "إعدادات المحرك" : "Engine Settings"}
          </h3>
          <div className="flex items-center justify-between text-xs">
            <div>
              <div className="font-bold text-foreground">
                {isRTL ? "وضع المحرك" : "Engine Mode"}
              </div>
              <div className="text-[10.5px] text-muted-foreground mt-0.5">
                {isRTL ? "اختر بين المحلي فقط، الهجين، أو السحابي فقط" : "Choose local-only, hybrid, or cloud-only"}
              </div>
            </div>
            <select
              value={engineMode}
              onChange={(e) => setEngineMode(e.target.value as any)}
              className="bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-bold text-foreground cursor-pointer"
            >
              <option value="hybrid">{isRTL ? "هجين (موصى به)" : "Hybrid (Recommended)"}</option>
              <option value="local">{isRTL ? "محلي فقط" : "Local Only"}</option>
              <option value="cloud">{isRTL ? "سحابي فقط" : "Cloud Only"}</option>
            </select>
          </div>

          <div className="flex items-center justify-between text-xs pt-3 border-t border-border/40">
            <div>
              <div className="font-bold text-foreground">
                {isRTL ? "قاعدة المصطلحات (GTR)" : "GTR Glossary"}
              </div>
              <div className="text-[10.5px] text-muted-foreground mt-0.5">
                {isRTL ? "استخدام قاعدة المصطلحات في الاقتراحات" : "Use glossary in suggestions"}
              </div>
            </div>
            <input
              type="checkbox"
              checked={useGtr}
              onChange={(e) => setUseGtr(e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
          </div>
        </div>

        {/* Unload button if model is loaded */}
        {loadedModel && (
          <button
            onClick={handleUnloadModel}
            className="w-full p-3 rounded-xl border border-border bg-surface hover:bg-surface-hover text-xs font-bold text-muted-foreground hover:text-foreground transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            <ServerCrash className="w-4 h-4" />
            {isRTL ? `إلغاء تحميل النموذج الحالي (${loadedModel})` : `Unload current model (${loadedModel})`}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Engine Status Banner ─────────────────────────────────────────

function EngineStatusBanner({
  adapter,
  daemonHealthy,
  adapterState,
  adapterError,
  loadedModel,
  isRTL,
  onRefresh,
  diagnostics,
}: {
  adapter: LLMAdapter | null;
  daemonHealthy: boolean;
  adapterState: string;
  adapterError: string | null;
  loadedModel: string;
  isRTL: boolean;
  onRefresh: () => void;
  diagnostics: HealthDiagnostics | null;
}) {
  if (!adapter) {
    return (
      <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="font-bold text-amber-600 dark:text-amber-400 text-sm">
            {isRTL ? "لا يوجد محرك محلي متاح" : "No local engine available"}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {isRTL
              ? "لم يتم اكتشاف Ollama أو WebGPU. التطبيق سيعمل في وضع محدود (LTE فقط)."
              : "Neither Ollama nor WebGPU detected. App will run in degraded mode (LTE only)."}
          </div>

          {/* Diagnostics — show which URLs were tried and which errors occurred.
              This turns every "Ollama not detected" field report into something
              diagnosable from a screenshot. */}
          {diagnostics && diagnostics.attempts.length > 0 && (
            <div className="mt-2 p-2 rounded-lg bg-black/20 dark:bg-black/30 border border-border/40 text-[10px] font-mono space-y-0.5" dir="ltr">
              <div className="text-muted-foreground font-bold mb-1">
                {isRTL ? "تفاصيل التشخيص:" : "Diagnostics:"}
              </div>
              {diagnostics.attempts.map((attempt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className={attempt.success ? "text-emerald-500" : "text-rose-500"}>
                    {attempt.success ? "✓" : "✗"}
                  </span>
                  <span className="text-muted-foreground truncate flex-1">{attempt.url}</span>
                  {attempt.error && (
                    <span className="text-rose-400 shrink-0">({attempt.error})</span>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 mt-2">
            {/* Recheck button — re-runs adapter detection in case Ollama
                was just started after the app launched. */}
            <button
              onClick={onRefresh}
              className="text-[10px] font-bold text-primary hover:underline cursor-pointer flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              {isRTL ? "إعادة التحقق" : "Recheck"}
            </button>
            <span className="text-muted-foreground/30">|</span>
            {/* Download Ollama button — opens ollama.com/download */}
            <a
              href="https://ollama.com/download"
              target="_blank"
              rel="noreferrer"
              className="text-[10px] font-bold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer flex items-center gap-1"
            >
              <Download className="w-3 h-3" />
              {isRTL ? "تحميل Ollama" : "Download Ollama"}
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>
        </div>
      </div>
    );
  }

  const isOllama = adapter.id === "ollama";
  const statusColor = daemonHealthy
    ? "emerald"
    : "amber";
  const statusText = daemonHealthy
    ? (isRTL ? "متصل" : "Connected")
    : (isRTL ? "غير متصل" : "Not running");

  return (
    <div className={cn(
      "p-4 rounded-xl border flex items-center gap-3",
      daemonHealthy
        ? "bg-emerald-500/10 border-emerald-500/30"
        : "bg-amber-500/10 border-amber-500/30"
    )}>
      <div className={cn(
        "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
        daemonHealthy ? "bg-emerald-500/20" : "bg-amber-500/20"
      )}>
        {daemonHealthy ? (
          <Server className="w-5 h-5 text-emerald-500" />
        ) : (
          <ServerCrash className="w-5 h-5 text-amber-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm text-foreground">{adapter.displayName}</span>
          <span className={cn(
            "text-[10px] font-bold px-2 py-0.5 rounded-full",
            daemonHealthy
              ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
              : "bg-amber-500/20 text-amber-600 dark:text-amber-400"
          )}>
            {statusText}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
          {loadedModel
            ? (isRTL ? `النموذج الحالي: ${loadedModel}` : `Active model: ${loadedModel}`)
            : daemonHealthy
              ? (isRTL ? "جاهز — اختر نموذجاً للتحميل" : "Ready — select a model to load")
              : (isOllama
                  ? (isRTL ? "Ollama غير مشغل. ثبّته من ollama.com" : "Ollama daemon not running. Install from ollama.com")
                  : (isRTL ? "WebGPU غير متاح في هذا المتصفح" : "WebGPU not available in this browser"))}
        </div>
        {adapterError && (
          <div className="text-[10px] text-rose-500 mt-1 font-mono truncate">{adapterError}</div>
        )}
      </div>
      <button
        onClick={onRefresh}
        className="p-2 rounded-lg hover:bg-surface-hover text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
        title={isRTL ? "إعادة التحقق" : "Recheck"}
      >
        <RefreshCw className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Model Card ───────────────────────────────────────────────────

interface ModelCardProps {
  model: ModelInfo;
  isLoaded: boolean;
  isPulling: boolean;
  pullProgress: number;
  isLoading: boolean;
  loadingProgress: number;
  adapterId: string;
  isRTL: boolean;
  onPull: () => void;
  onLoad: () => void;
  onRemove: () => void;
}

const ModelCard: React.FC<ModelCardProps> = ({
  model,
  isLoaded,
  isPulling,
  pullProgress,
  isLoading,
  loadingProgress,
  adapterId,
  isRTL,
  onPull,
  onLoad,
  onRemove,
}) => {
  const isCached = model.isCached;
  const isBusy = isPulling || isLoading;

  return (
    <div className={cn(
      "border rounded-xl p-4 transition-all",
      isLoaded
        ? "border-primary/40 bg-primary/5"
        : isCached
          ? "border-border bg-surface"
          : "border-border/60 bg-surface/50"
    )}>
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-foreground truncate">{model.name}</span>
            {isLoaded && (
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-primary text-white shrink-0">
                {isRTL ? "نشط" : "ACTIVE"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
            <span className="font-mono">{model.id}</span>
            <span>•</span>
            <span>{model.family}</span>
            <span>•</span>
            <span>{model.parameters}</span>
            <span>•</span>
            <span>{model.size}</span>
          </div>
        </div>
      </div>

      {/* Status / Progress */}
      {isBusy && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
            <span>
              {isPulling
                ? (isRTL ? `جاري السحب... ${pullProgress}%` : `Pulling... ${pullProgress}%`)
                : (isRTL ? `جاري التحميل... ${loadingProgress}%` : `Loading... ${loadingProgress}%`)}
            </span>
            <Loader2 className="w-3 h-3 animate-spin" />
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${isPulling ? pullProgress : loadingProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        {isLoaded ? (
          // Already loaded — show checkmark
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-primary">
            <Check className="w-3.5 h-3.5" />
            {isRTL ? "مُحمّل" : "Loaded"}
          </div>
        ) : isCached ? (
          // Cached but not loaded — Load button
          <button
            onClick={onLoad}
            disabled={isBusy}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary text-[11px] font-bold transition-all cursor-pointer disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {isRTL ? "تحميل" : "Load"}
          </button>
        ) : (
          // Not cached — Pull/Download button
          <button
            onClick={onPull}
            disabled={isBusy}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-foreground/5 hover:bg-foreground/10 border border-border text-foreground text-[11px] font-bold transition-all cursor-pointer disabled:opacity-50"
          >
            {isPulling ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            {adapterId === "ollama"
              ? (isRTL ? "سحب من Ollama" : "Pull from Ollama")
              : (isRTL ? "تحميل" : "Download")}
          </button>
        )}

        {isCached && !isLoaded && !isBusy && (
          <button
            onClick={onRemove}
            className="p-2 rounded-lg hover:bg-rose-500/10 text-muted-foreground hover:text-rose-500 cursor-pointer transition-all"
            title={isRTL ? "حذف" : "Remove"}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── No Adapter Warning ───────────────────────────────────────────

function NoAdapterWarning({ isRTL, isTauri }: { isRTL: boolean; isTauri: boolean }) {
  return (
    <div className="bg-amber-500/10 border border-amber-500/30 p-6 rounded-xl space-y-4">
      <div className="flex items-center gap-2">
        <AlertCircle className="w-5 h-5 text-amber-500" />
        <h3 className="font-bold text-sm text-amber-600 dark:text-amber-400">
          {isRTL ? "لا يوجد محرك محلي" : "No Local Engine Detected"}
        </h3>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        {isTauri
          ? (isRTL
              ? "لتشغيل النماذج المحلية، ثبّت Ollama من الموقع الرسمي. إنه مجاني وسريع التثبيت."
              : "To run local models, install Ollama from the official website. It's free and quick to set up.")
          : (isRTL
              ? "لتشغيل النماذج المحلية في المتصفح، استخدم Chrome 113+ أو Edge 113+ لدعم WebGPU."
              : "To run local models in the browser, use Chrome 113+ or Edge 113+ for WebGPU support.")}
      </p>
      {isTauri && (
        <a
          href="https://ollama.com/download"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-600 dark:text-amber-400 text-xs font-bold transition-all cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          {isRTL ? "تحميل Ollama" : "Download Ollama"}
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

export default AiModelsView;
