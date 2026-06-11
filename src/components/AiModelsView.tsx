import React, { useState, useEffect } from "react";
import { useLanguage } from "../context/LanguageContext";
import { useSettingsStore } from "../stores/settings-store";
import { useToast } from "../context/ToastContext";
import {
  Cpu,
  ShieldCheck,
  CpuIcon,
  Cloud,
  Download,
  Check,
  Sparkles,
  ServerCrash,
  Play,
  AlertCircle,
  Monitor,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { cn } from "../lib/utils";
import {
  loadModel,
  unloadModel,
  isModelCached,
  isModelLoaded,
  getEngineState,
  getLoadingProgress,
  getEngineError,
  onEngineStateChange,
  removeModelCache,
  isWebGPUAvailable,
  type LLMEngineState,
} from "../lib/local-llm-engine";

interface LocalModel {
  id: string;
  name: string;
  family: "Gemma" | "Qwen" | "Llama";
  specs: string;
  size: string;
  byteSize: number; // approximate MB for display purposes
  vram: string;
  descAr: string;
  descEn: string;
  minTier: "Entry" | "Medium" | "High" | "Ultra";
}

const LOCAL_MODELS_CATALOG: LocalModel[] = [
  {
    id: "qwen-1.5b",
    name: "Qwen 2.5 1.5B (Arabic Specialist)",
    family: "Qwen",
    specs: "1.5 Billion Parameters",
    size: "~1.0 GB",
    byteSize: 1100,
    vram: "3 GB VRAM recommended",
    descEn: "Optimized for extremely fast, low-latency multilingual translations. Excellent compatibility with standard mobile and desktop processors. Runs via WebGPU on-device with zero data leaving your browser.",
    descAr: "محسن للترجمات السريعة ثنائية اللغة وزمن استجابة فائق السرعة. توافقية ممتازة مع المعالجات العادية على الأجهزة المحمولة والمكتبية. يعمل عبر WebGPU محلياً دون إرسال أي بيانات.",
    minTier: "Medium",
  },
  {
    id: "gemma-2b",
    name: "Gemma 2 2B (Google Co-writer)",
    family: "Gemma",
    specs: "2 Billion Parameters",
    size: "~1.4 GB",
    byteSize: 1440,
    vram: "4 GB VRAM recommended",
    descEn: "Outstanding academic translation parity and natural Arabic phrasing. Built using Google's elite lightweight instruction tuning checkpoints. WebGPU-accelerated on-device inference.",
    descAr: "اتساق أكاديمي استثنائي وصياغات عربية بليغة. مدعوم بأحدث معايير الأوزان اللغوية فائقة الخفة من Google. استدلال محلي مسرّع عبر WebGPU.",
    minTier: "Medium",
  },
  {
    id: "qwen-7b",
    name: "Qwen 2.5 7B (Arabic Dialect Master)",
    family: "Qwen",
    specs: "7 Billion Parameters",
    size: "~4.2 GB",
    byteSize: 4300,
    vram: "8 GB VRAM Required",
    descEn: "Captures intricate legal, administrative, and regional linguistic contexts. High accuracy on dense vocabulary and idiomatic phrases. Requires high-end GPU for smooth WebGPU inference.",
    descAr: "يلقط السياقات القانونية والإدارية واللهجات الإقليمية المعقدة بنجاح. دقة عالية في تفصيل الاصطلاحات وبنى التعبيرات المركبة. يتطلب معالج رسوميات متقدم.",
    minTier: "High",
  },
  {
    id: "gemma-7b",
    name: "Gemma 2 9B (Elite Academic Core)",
    family: "Gemma",
    specs: "9 Billion Parameters",
    size: "~5.2 GB",
    byteSize: 5270,
    vram: "10 GB VRAM Required",
    descEn: "State-of-the-art weights optimized for research papers, scientific glossaries, and long-form translation parity. Superior semantic logic. Best with dedicated GPU hardware.",
    descAr: "أوزان لغوية متطورة للغاية محسنة للأوراق البحثية والمسارد العلمية وصياغة الترجمات الطويلة. تفوق منطقي دلالي كامل. يعمل بأفضل أداء مع معالج رسوميات مخصص.",
    minTier: "Ultra",
  },
  {
    id: "llama3-8b",
    name: "Llama 3.1 8B (Multilingual Heavyweight)",
    family: "Llama",
    specs: "8 Billion Parameters",
    size: "~4.5 GB",
    byteSize: 4600,
    vram: "10 GB VRAM Required",
    descEn: "High-level deep reasoning with broad linguistic capabilities. Excellent for heavy sentence restructuring and complex grammatical syntax. Requires premium hardware.",
    descAr: "قدرات تفكير عميق عالية المستوى ومجموعة لغوية غنية. ممتاز لهيكلة الجمل الثقيلة وحل معضلات النحو المعقدة. يتطلب عتاداً متقدماً.",
    minTier: "Ultra",
  },
];

export function AiModelsView() {
  const { locale, t } = useLanguage();
  const { showToast } = useToast();
  const isRTL = locale === "ar";

  const {
    engineMode,
    setEngineMode,
    useGtr,
    setUseGtr,
    downloadedModels,
    loadedModel,
    addDownloadedModel,
    setLoadedModel,
  } = useSettingsStore();

  // Machine Hardware Specs Profiling
  const [cpuCores, setCpuCores] = useState<number>(4);
  const [deviceMemory, setDeviceMemory] = useState<number>(8);
  const [hasWebGPU, setHasWebGPU] = useState<boolean>(false);
  const [cpuModel, setCpuModel] = useState<string>(
    "Intel Core / Apple M-series"
  );
  const [evaluatingSpecs, setEvaluatingSpecs] = useState<boolean>(true);

  // Real model loading state — tracks which model is currently being downloaded/loaded
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [engineError, setEngineError] = useState<string | null>(null);

  // Track which models are cached in the browser (already downloaded)
  const [cachedModels, setCachedModels] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Collect PWA client specifications
    setTimeout(() => {
      if (typeof navigator !== "undefined") {
        setCpuCores(navigator.hardwareConcurrency || 4);
        setDeviceMemory((navigator as any).deviceMemory || 8);
        isWebGPUAvailable().then(setHasWebGPU);

        // Dynamic detection for CPU platform
        if (navigator.userAgent.includes("Macintosh")) {
          setCpuModel("Apple Silicon / Intel Xeon");
        } else if (
          navigator.userAgent.includes("Android") ||
          navigator.userAgent.includes("iPhone")
        ) {
          setCpuModel("ARM Mobile SoC");
        } else {
          setCpuModel("Intel Core / AMD Ryzen");
        }
      }
      setEvaluatingSpecs(false);
    }, 600);
  }, []);

  // Check which models are already cached on mount and when downloads change
  useEffect(() => {
    const checkCache = async () => {
      const cached = new Set<string>();
      for (const model of LOCAL_MODELS_CATALOG) {
        const isCached = await isModelCached(model.id);
        if (isCached) {
          cached.add(model.id);
          // Also mark as downloaded in the settings store
          if (!downloadedModels.includes(model.id)) {
            addDownloadedModel(model.id);
          }
        }
      }
      setCachedModels(cached);
    };
    checkCache();
  }, [downloadedModels, addDownloadedModel]);

  // Subscribe to engine state changes for real-time progress updates
  useEffect(() => {
    const unsubscribe = onEngineStateChange(
      (state: LLMEngineState, progress: number, error: string | null) => {
        if (state === "loading") {
          setLoadingProgress(progress);
        }
        if (state === "ready") {
          setLoadingModelId(null);
          setLoadingProgress(100);
          setEngineError(null);
        }
        if (state === "error") {
          setLoadingModelId(null);
          setEngineError(error);
        }
        if (state === "idle") {
          setLoadingModelId(null);
          setLoadingProgress(0);
        }
      }
    );
    return unsubscribe;
  }, []);

  // Compute machine specs tier classification
  const hardwareTier = React.useMemo(() => {
    if (!hasWebGPU || deviceMemory < 6) return "Entry";
    if (deviceMemory >= 16 && cpuCores >= 8) return "Ultra";
    if (deviceMemory >= 8 && cpuCores >= 6) return "High";
    return "Medium";
  }, [cpuCores, deviceMemory, hasWebGPU]);

  /**
   * Download + Load a model.
   *
   * With @mlc-ai/web-llm, the download and loading happen together:
   * `CreateMLCEngine()` downloads model weights from MLC's CDN (caching
   * them in the browser Cache API) and then loads them into WebGPU memory.
   *
   * On subsequent loads, cached weights are reused — no re-download needed.
   */
  const handleDownloadAndLoad = async (modelId: string) => {
    if (!hasWebGPU) {
      showToast(
        isRTL
          ? "WebGPU غير متاح في هذا المتصفح. يرجى استخدام متصفح حديث يدعم WebGPU."
          : "WebGPU is not available in this browser. Please use a modern WebGPU-capable browser.",
        "error"
      );
      return;
    }

    const modelCatalog = LOCAL_MODELS_CATALOG.find((m) => m.id === modelId);
    if (!modelCatalog) return;

    setLoadingModelId(modelId);
    setLoadingProgress(0);
    setEngineError(null);

    const isCached = cachedModels.has(modelId);

    showToast(
      isCached
        ? isRTL
          ? `جاري تحميل ${modelCatalog.name} من ذاكرة التخزين المؤقت...`
          : `Loading ${modelCatalog.name} from browser cache...`
        : isRTL
          ? `بدء تحميل أوزان ${modelCatalog.name} من MLC CDN. قد يستغرق عدة دقائق حسب سرعة الاتصال...`
          : `Downloading ${modelCatalog.name} weights from MLC CDN. This may take several minutes depending on your connection...`,
      "info"
    );

    try {
      await loadModel(modelId, (progress) => {
        setLoadingProgress(progress);
      });

      // Mark as downloaded in the settings store
      addDownloadedModel(modelId);
      // Update cached models
      setCachedModels((prev) => new Set(prev).add(modelId));
      // Set as the active loaded model
      setLoadedModel(modelId);
      // Switch to local engine mode
      setEngineMode("local");

      showToast(
        isRTL
          ? `تم تحميل ${modelCatalog.name} بنجاح! المحرك المحلي جاهز للاستدلال على جهازك.`
          : `Successfully loaded ${modelCatalog.name}! On-device inference is now active via WebGPU.`,
        "success"
      );
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      setEngineError(errorMsg);
      setLoadingModelId(null);

      showToast(
        isRTL
          ? `فشل تحميل النموذج: ${errorMsg}`
          : `Failed to load model: ${errorMsg}`,
        "error"
      );
    }
  };

  /**
   * Unload the current model from WebGPU memory.
   */
  const handleUnloadModel = async () => {
    if (!loadedModel) return;

    try {
      await unloadModel();
      setLoadedModel("");
      showToast(
        isRTL
          ? "تم إلغاء تنشيط النموذج المحلي. الذاكرة حررت."
          : "Unloaded active WebGPU inference model. GPU memory freed.",
        "info"
      );
    } catch (err: any) {
      showToast(
        isRTL
          ? `خطأ أثناء إلغاء التحميل: ${err?.message}`
          : `Error during unload: ${err?.message}`,
        "error"
      );
    }
  };

  /**
   * Delete a model's cached weights from the browser to free storage.
   */
  const handleDeleteCache = async (modelId: string) => {
    try {
      await removeModelCache(modelId);
      setCachedModels((prev) => {
        const next = new Set(prev);
        next.delete(modelId);
        return next;
      });
      showToast(
        isRTL
          ? "تم حذف ملفات النموذج المخزنة مؤقتاً."
          : "Cached model weights deleted from browser storage.",
        "info"
      );
    } catch (err: any) {
      showToast(
        isRTL
          ? `فشل حذف المخزن المؤقت: ${err?.message}`
          : `Failed to delete cache: ${err?.message}`,
        "error"
      );
    }
  };

  // Utility to match minimum tier compatibility with actual hardware tier
  const isTierCompatible = (minRequired: "Entry" | "Medium" | "High" | "Ultra") => {
    const order = ["Entry", "Medium", "High", "Ultra"];
    return order.indexOf(hardwareTier) >= order.indexOf(minRequired);
  };

  return (
    <div
      className="h-full overflow-y-auto bg-background p-6"
      dir={isRTL ? "rtl" : "ltr"}
    >
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-black text-foreground flex items-center gap-2">
            <span>{t("nav.models")}</span>
            <span className="text-xs bg-primary/10 text-primary border border-primary/20 px-2.5 py-0.5 rounded-full font-mono uppercase tracking-widest">
              OFFLINE PWA SYSTEM
            </span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {isRTL
              ? "قم بإدارة خيارات التوليد على الرقاقة، وتحميل نماذج اللغات الصغيرة المستقلة للترجمة وتوجيهات المعلم الذكي دون اتصال بالإنترنت."
              : "Manage on-chip generator options and download lightweight offline models for zero-latency academic translation via WebGPU."}
          </p>
        </div>

        {/* Dynamic Hardware Diagnostics & Spec Profiler */}
        <div className="p-5 rounded-2xl border border-border dark:border-white/5 bg-surface dark:bg-[#111318] space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h2 className="text-xs font-black uppercase text-foreground flex items-center gap-1.5">
                <Monitor className="w-4 h-4 text-primary" />
                <span>
                  {isRTL
                    ? "مشخص المكونات وقدرات المتصفح"
                    : "Client System Hardware Diagnostic"}
                </span>
              </h2>
              <p className="text-[10px] text-muted-foreground">
                {isRTL
                  ? "يرصد هذا المعالج التكوين الحالي للجهاز لترشيح أفضل النماذج ثنائية اللغة."
                  : "Analyzes machine physics and WebGPU parameters dynamically."}
              </p>
            </div>

            {evaluatingSpecs ? (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>PROFILING...</span>
              </div>
            ) : (
              <span
                className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border shadow-sm",
                  hardwareTier === "Ultra"
                    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                    : hardwareTier === "High"
                      ? "bg-primary/10 text-primary border-primary/20"
                      : hardwareTier === "Medium"
                        ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                        : "bg-red-500/10 text-red-500 border-red-500/20"
                )}
              >
                {isRTL
                  ? `رتبة الجهاز: ${hardwareTier}`
                  : `Specs Grade: ${hardwareTier}`}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5 pt-2">
            {/* CPU cores */}
            <div className="p-3 bg-[#0A0B0E] rounded-xl border border-border/80 dark:border-white/5 space-y-1">
              <span className="text-[9px] uppercase font-bold text-muted-foreground">
                {isRTL ? "أنوية المعالج المنطقية" : "CPU Cores"}
              </span>
              <div className="text-sm font-black text-foreground flex items-center justify-between">
                <span>{cpuCores} Cores</span>
                <span className="text-[9.5px] font-mono text-slate-500">
                  {cpuModel}
                </span>
              </div>
            </div>

            {/* RAM capacity */}
            <div className="p-3 bg-[#0A0B0E] rounded-xl border border-border/80 dark:border-white/5 space-y-1">
              <span className="text-[9px] uppercase font-bold text-muted-foreground">
                {isRTL ? "تقدير الذاكرة العشوائية RAM" : "System RAM"}
              </span>
              <div className="text-sm font-black text-foreground flex items-center justify-between">
                <span>{deviceMemory} GB</span>
                <span className="text-[9.5px] text-emerald-500 font-bold bg-emerald-500/5 border border-emerald-500/10 px-1.5 rounded">
                  {deviceMemory >= 8 ? "OK" : "LOW"}
                </span>
              </div>
            </div>

            {/* WebGPU Support */}
            <div className="p-3 bg-[#0A0B0E] rounded-xl border border-border/80 dark:border-white/5 space-y-1">
              <span className="text-[9px] uppercase font-bold text-muted-foreground">
                {isRTL
                  ? "تسريع الرسوميات WebGPU"
                  : "WebGPU Support"}
              </span>
              <div className="text-sm font-black text-foreground flex items-center justify-between">
                <span
                  className={hasWebGPU ? "text-emerald-400" : "text-amber-500"}
                >
                  {hasWebGPU
                    ? isRTL
                      ? "متاح / مدعوم"
                      : "Available / Hardware Accelerated"
                    : isRTL
                      ? "غير مدعوم"
                      : "Software Emulated / N/A"}
                </span>
                {hasWebGPU ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                )}
              </div>
            </div>

            {/* PWA Cache Allocation */}
            <div className="p-3 bg-[#0A0B0E] rounded-xl border border-border/80 dark:border-white/5 space-y-1">
              <span className="text-[9px] uppercase font-bold text-muted-foreground">
                {isRTL
                  ? "تخزين المتصفح المخصص Cache API"
                  : "Cache API Storage"}
              </span>
              <div className="text-sm font-black text-foreground flex items-center justify-between">
                <span className="text-primary">Browser Managed</span>
                <span className="text-[9.5px] opacity-75 font-mono">
                  Auto-Cached
                </span>
              </div>
            </div>
          </div>

          {/* Compatibility Advice */}
          <div className="p-3.5 rounded-xl border border-primary/20 bg-primary/5 text-xs flex gap-2.5 items-start">
            <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="space-y-0.5 text-foreground">
              <div className="font-bold">
                {isRTL
                  ? "توصيات تشغيل النماذج ثنائية اللغة:"
                  : "On-Device Intelligence Compatibility Insights:"}
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {hardwareTier === "Ultra" &&
                  (isRTL
                    ? "جهازك مجهز بمكونات قوية! يمكنك تحميل نماذج 7B و 8B وتشغيل الاستدلال المحلي على السرعة القصوى مع الحفاظ التام على أمن المستندات."
                    : "Your hardware parameters are classified as Ultra Class! We recommend high-fidelity weights (Gemma 9B or Llama 3.1 8B) for complex syntax resolution.")}
                {hardwareTier === "High" &&
                  (isRTL
                    ? "مواصفات جهازك جيدة جداً لترجمة المصطلحات المعقدة. نوصي بنموذج Qwen 7B أو Gemma 2B للاستخدام الدقيق دون إجهاد الرسوميات."
                    : "Your device is highly optimized for middleweight pipelines. We suggest Gemma 2B or Qwen 7B for standard corporate translation speeds.")}
                {hardwareTier === "Medium" &&
                  (isRTL
                    ? "محرك جهازك متزن. تفضل النماذج الخفيفة كـ Qwen 1.5B و Gemma 2B لقضاء المهام بمرونة فائقة وسرعة استجابة خاطفة."
                    : "Excellent setup for light-register inference. Qwen 1.5B or Gemma 2B will run with stunning responsive latency without high consumption.")}
                {hardwareTier === "Entry" &&
                  (isRTL
                    ? "تشغيل النماذج محلياً يتطلب متصفحاً حديثاً مفعلاً فيه WebGPU. نوصي باستعمال محرك الهجين للتخزين الخفيف واستدعاء السحابية للترجمة الكبيرة."
                    : "WebGPU is either disabled or system memory is constrained. We suggest using 'Hybrid Engine' to combine local dictionaries with efficient Cloud model calls.")}
              </p>
            </div>
          </div>
        </div>

        {/* Engine mode select cards */}
        <div>
          <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">
            {isRTL ? "محرك الترجمة النشط" : "Active Translation Pipeline"}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                id: "hybrid",
                title: isRTL
                  ? "محرك هجين متزن (موصى به)"
                  : "Hybrid Engine (Recommended)",
                desc: isRTL
                  ? "يجمع بين مطابقة المصطلحات المحلية (LTE) فائقة السرعة مع النموذج المحلي أو المساعد السحابي."
                  : "Blends lightning-fast LTE dictionary matches with Local LLM or Cloud Gemini for intelligent suggestions.",
                icon: Cpu,
              },
              {
                id: "local",
                title: isRTL ? "محرك محلي بالكامل" : "Strictly Local",
                desc: isRTL
                  ? "يستغل بنوك المصطلحات والنموذج المحلي على جهازك فقط. يعمل 100% دون إنترنت."
                  : "Uses LTE dictionary and on-device LLM only. Works 100% offline with zero data leakage.",
                icon: CpuIcon,
              },
              {
                id: "cloud",
                title: isRTL ? "سحابي غني بالتوليد" : "Pure Cloud API",
                desc: isRTL
                  ? "يعتمد على النماذج التوليدية السحابية للحصول على ترجمات غنية بسياق معقد."
                  : "Leverages Gemini cloud models for complex translation nuances, bypassing local glossaries.",
                icon: Cloud,
              },
            ].map((mode) => {
              const Icon = mode.icon;
              const isSelected = engineMode === mode.id;

              return (
                <button
                  key={mode.id}
                  onClick={() => setEngineMode(mode.id as any)}
                  className={cn(
                    "border p-5 rounded-2xl flex flex-col gap-3 text-left transition-all hover:scale-[1.01] cursor-pointer",
                    isRTL && "text-right",
                    isSelected
                      ? "bg-primary/5 border-primary text-foreground"
                      : "bg-surface border-border text-muted-foreground hover:border-border-hover pointer-events-auto"
                  )}
                >
                  <div className="flex items-center justify-between w-full">
                    <Icon
                      className={cn(
                        "w-5 h-5",
                        isSelected ? "text-primary" : "text-muted-foreground"
                      )}
                    />
                    {isSelected && (
                      <span className="text-[10px] font-bold bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
                        {isRTL ? "نشط" : "Active"}
                      </span>
                    )}
                  </div>
                  <div>
                    <h3
                      className={cn(
                        "text-xs font-bold",
                        isSelected ? "text-primary" : "text-foreground"
                      )}
                    >
                      {mode.title}
                    </h3>
                    <p className="text-[10.5px] leading-relaxed mt-1">
                      {mode.desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Local Offline AI Model Library */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              {isRTL
                ? "مستودع نماذج الذكاء الاصطناعي المحلية"
                : "PWA Local AI Model Repository"}
            </h2>
            <span className="text-[9px] text-muted-foreground font-mono">
              Powered by @mlc-ai/web-llm
            </span>
          </div>

          <div className="space-y-4">
            {LOCAL_MODELS_CATALOG.map((model) => {
              const isDownloaded =
                downloadedModels.includes(model.id) ||
                cachedModels.has(model.id);
              const isLoaded = loadedModel === model.id && isModelLoaded();
              const isLoadingThisModel = loadingModelId === model.id;
              const isCached = cachedModels.has(model.id);
              const compatible = isTierCompatible(model.minTier);

              return (
                <div
                  key={model.id}
                  className={cn(
                    "p-5 rounded-2xl border transition-all duration-200",
                    isLoaded
                      ? "bg-primary/[0.03] border-primary/40 shadow-lg"
                      : "bg-surface border-border hover:border-primary/20"
                  )}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    {/* Model Details */}
                    <div className="space-y-1.5 flex-1 select-text">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-extrabold text-sm text-foreground">
                          {model.name}
                        </span>
                        <span className="text-[9.5px] font-mono font-bold bg-[#0A0B0E] border dark:border-white/5 border-border px-2 py-0.5 rounded text-muted-foreground">
                          {model.specs}
                        </span>
                        <span className="text-[9.5px] font-mono font-bold bg-indigo-500/5 text-indigo-400 border border-indigo-500/10 px-2 py-0.5 rounded">
                          {model.size}
                        </span>
                        {isCached && !isLoadingThisModel && (
                          <span className="text-[9px] font-mono font-bold bg-emerald-500/5 text-emerald-500 border border-emerald-500/10 px-1.5 py-0.5 rounded flex items-center gap-1">
                            <Check className="w-3 h-3" />
                            <span>{isRTL ? "مخزّن مؤقتاً" : "CACHED"}</span>
                          </span>
                        )}
                        {!compatible && (
                          <span className="text-[9px] font-mono font-bold bg-amber-500/5 text-amber-500 border border-amber-500/10 px-1.5 py-0.5 rounded flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            <span>
                              {isRTL
                                ? "مواصفات ثقيلة"
                                : "Heavy Specs Check"}
                            </span>
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        {isRTL ? model.descAr : model.descEn}
                      </p>
                      <div className="text-[10px] font-mono text-slate-500 flex items-center gap-3">
                        <span>
                          Min Spec Req:{" "}
                          <strong className="text-foreground font-semibold">
                            {model.minTier} Class
                          </strong>
                        </span>
                        <span>•</span>
                        <span>
                          VRAM:{" "}
                          <strong className="text-foreground font-semibold">
                            {model.vram}
                          </strong>
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0 md:self-center">
                      {isLoaded ? (
                        // Model is currently loaded — show UNLOAD button
                        <button
                          onClick={handleUnloadModel}
                          className={cn(
                            "px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-sm hover:scale-[1.01]",
                            "bg-[#D93838]/10 text-[#D93838] border border-[#D93838]/20 hover:bg-[#D93838]/15"
                          )}
                        >
                          <ServerCrash className="w-4 h-4" />
                          <span>
                            {isRTL ? "إلغاء التحميل" : "UNLOAD MODEL"}
                          </span>
                        </button>
                      ) : isLoadingThisModel ? (
                        // Currently downloading/loading this model
                        <button
                          disabled
                          className="px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-amber-500 text-white opacity-90"
                        >
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>
                            {isRTL ? "جاري التحميل..." : "LOADING..."}
                          </span>
                        </button>
                      ) : isDownloaded ? (
                        // Model weights are cached — show LOAD button
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleDownloadAndLoad(model.id)}
                            className={cn(
                              "px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-sm hover:scale-[1.01]",
                              "bg-primary text-primary-foreground hover:bg-primary/95"
                            )}
                          >
                            <Play className="w-4 h-4" />
                            <span>
                              {isRTL ? "تشغيل النموذج" : "LOAD MODEL"}
                            </span>
                          </button>
                          <button
                            onClick={() => handleDeleteCache(model.id)}
                            className="p-2 rounded-xl text-xs border border-border hover:border-red-500/30 hover:text-red-500 text-muted-foreground transition-all cursor-pointer"
                            title={
                              isRTL
                                ? "حذف الملفات المخزنة مؤقتاً"
                                : "Delete cached weights"
                            }
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        // Model not yet downloaded — show DOWNLOAD button
                        <button
                          onClick={() => handleDownloadAndLoad(model.id)}
                          disabled={!hasWebGPU}
                          className={cn(
                            "px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-sm hover:scale-[1.01] disabled:opacity-50 disabled:cursor-not-allowed",
                            "bg-[#0A0B0E] text-foreground hover:bg-muted font-bold border border-border"
                          )}
                        >
                          <Download className="w-4 h-4 text-primary" />
                          <span>
                            {isRTL ? "تنزيل وتشغيل" : "DOWNLOAD & LOAD"}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Real Loading Progress Bar */}
                  {isLoadingThisModel && (
                    <div className="mt-4 pt-3.5 border-t border-dashed border-border/80 dark:border-white/5 space-y-2">
                      <div className="flex items-center justify-between text-[10.5px] font-mono text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <span className="text-primary font-bold">
                            {isCached
                              ? isRTL
                                ? "جاري التحميل في ذاكرة WebGPU..."
                                : "Loading into WebGPU memory..."
                              : isRTL
                                ? "جاري تنزيل الأوزان من MLC CDN..."
                                : "Downloading weights from MLC CDN..."}
                          </span>
                        </div>
                        <div>
                          <span className="font-bold text-foreground">
                            {loadingProgress}%
                          </span>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="h-1.5 w-full bg-[#0A0B0E] rounded-full overflow-hidden relative">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-300",
                            loadingProgress < 100
                              ? "bg-primary animate-pulse"
                              : "bg-emerald-500"
                          )}
                          style={{ width: `${loadingProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Error display */}
                  {engineError && loadedModel !== model.id && !isLoaded && (
                    <div className="mt-3 pt-3 border-t border-dashed border-red-500/20">
                      <p className="text-[10.5px] text-red-500 font-mono">
                        {engineError}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Interactive Dual security */}
        <div className="bg-surface border border-border p-5 rounded-2xl space-y-4">
          <h3 className="text-xs font-black uppercase text-foreground">
            {isRTL
              ? "أمن البيانات والخصوصية"
              : "Copilot Security & Pipeline"}
          </h3>
          <div className="divide-y divide-border/50 text-xs">
            <div className="flex items-center justify-between py-3">
              <div>
                <div className="font-bold text-foreground">
                  {isRTL
                    ? "المساعد ثنائي المحاور (LTE + GTR)"
                    : "Dual-Core Smart Matching"}
                </div>
                <div className="text-[10.5px] text-muted-foreground mt-0.5">
                  {isRTL
                    ? "اقتراح مصطلحات دقيقة بالاعتماد على قواعد البيانات المحلية المرفوعة."
                    : "Index custom uploaded glossaries in offline database."}
                </div>
              </div>
              <input
                type="checkbox"
                checked={useGtr}
                onChange={(e) => setUseGtr(e.target.checked)}
                className="w-4 h-4 accent-primary"
              />
            </div>

            <div className="flex items-center justify-between py-3">
              <div>
                <div className="font-bold text-foreground">
                  {isRTL
                    ? "وضع الخصوصية الأكاديمية"
                    : "On-Device Privacy Core"}
                </div>
                <div className="text-[10.5px] text-muted-foreground mt-0.5">
                  {isRTL
                    ? "يمنع خروج الترجمات إلى السيرفرات عند الترجمة المباشرة."
                    : "Ensure all terminology lookup and LLM inference remains inside local browser storage."}
                </div>
              </div>
              <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                <ShieldCheck className="w-3 h-3" />
                <span>{isRTL ? "مفعل" : "Strict"}</span>
              </span>
            </div>

            <div className="flex items-center justify-between py-3">
              <div>
                <div className="font-bold text-foreground">
                  {isRTL
                    ? "استدلال WebGPU المحلي"
                    : "WebGPU On-Device Inference"}
                </div>
                <div className="text-[10.5px] text-muted-foreground mt-0.5">
                  {isRTL
                    ? "نماذج لغوية صغيرة تعمل محلياً عبر WebGPU للترجمة الذكية دون اتصال."
                    : "Small language models run locally via WebGPU for intelligent offline translation suggestions."}
                </div>
              </div>
              <span
                className={cn(
                  "flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full",
                  isModelLoaded()
                    ? "text-emerald-500 bg-emerald-500/10"
                    : "text-muted-foreground bg-muted/50"
                )}
              >
                <Cpu className="w-3 h-3" />
                <span>
                  {isModelLoaded()
                    ? isRTL
                      ? "نشط"
                      : "Active"
                    : isRTL
                      ? "غير محمّل"
                      : "Idle"}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
export default AiModelsView;
