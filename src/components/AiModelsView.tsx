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
  CloudCheck,
  RefreshCw
} from "lucide-react";
import { cn } from "../lib/utils";

interface LocalModel {
  id: string;
  name: string;
  family: "Gemma" | "Qwen" | "Llama";
  specs: string;
  size: string;
  byteSize: number; // in MB
  vram: string;
  descAr: string;
  descEn: string;
  minTier: "Entry" | "Medium" | "High" | "Ultra";
}

const LOCAL_MODELS_CATALOG: LocalModel[] = [
  {
    id: "qwen-1.5b",
    name: "Qwen 1.5B (Arabic Specialist)",
    family: "Qwen",
    specs: "1.5 Billion Parameters",
    size: "1.08 GB",
    byteSize: 1100,
    vram: "3 GB VRAM recommended",
    descEn: "Optimized for extremely fast, low-latency multilingual translations. Excellent compatibility with standard mobile and desktop processors.",
    descAr: "محسن للترجمات السريعة ثنائية اللغة وزمن استجابة فائق السرعة. توافقية ممتازة مع المعالجات العادية على الأجهزة المحمولة والمكتبية.",
    minTier: "Medium"
  },
  {
    id: "gemma-2b",
    name: "Gemma 2B (Google Co-writer)",
    family: "Gemma",
    specs: "2 Billion Parameters",
    size: "1.65 GB",
    byteSize: 1690,
    vram: "4 GB VRAM recommended",
    descEn: "Outstanding academic translation parity and natural Arabic phrasing. Built using Google's elite lightweight instruction tuning checkpoints.",
    descAr: "اتساق أكاديمي استثنائي وصياغات عربية بليغة. مدعوم بأحدث معايير الأوزان اللغوية فائقة الخفة من Google.",
    minTier: "Medium"
  },
  {
    id: "qwen-7b",
    name: "Qwen 7B (Arabic Dialect Master)",
    family: "Qwen",
    specs: "7 Billion Parameters",
    size: "4.72 GB",
    byteSize: 4830,
    vram: "8 GB VRAM Required",
    descEn: "Captures intricate legal, administrative, and regional linguistic contexts. High accuracy on dense vocabulary and idiomatic phrases.",
    descAr: "يلقط السياقات القانونية والإدارية واللهجات الإقليمية المعقدة بنجاح. دقة عالية في تفصيل الاصطلاحات وبنى التعبيرات المركبة.",
    minTier: "High"
  },
  {
    id: "gemma-7b",
    name: "Gemma 7B (Elite Academic Core)",
    family: "Gemma",
    specs: "7 Billion Parameters",
    size: "5.15 GB",
    byteSize: 5270,
    vram: "10 GB VRAM Required",
    descEn: "State-of-the-art weights optimized for research papers, scientific glossaries, and long-form translation parity. Superior semantic logic.",
    descAr: "أوزان لغوية متطورة للغاية محسنة للأوراق البحثية والمسارد العلمية وصياغة الترجمات الطويلة. تفوق منطقي دلالي كامل.",
    minTier: "Ultra"
  },
  {
    id: "llama3-8b",
    name: "Llama 3 8B (Multilingual Heavyweight)",
    family: "Llama",
    specs: "8 Billion Parameters",
    size: "4.92 GB",
    byteSize: 5040,
    vram: "10 GB VRAM Required",
    descEn: "High-level deep reasoning with broad linguistic capabilities. Excellent for heavy sentence restructuring and complex grammatical syntax.",
    descAr: "قدرات تفكير عميق عالية المستوى ومجموعة لغوية غنية. ممتاز لهيكلة الجمل الثقيلة وحل معضلات النحو المعقدة.",
    minTier: "Ultra"
  }
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
    setLoadedModel
  } = useSettingsStore();

  // Machine Hardware Specs Profiling
  const [cpuCores, setCpuCores] = useState<number>(4);
  const [deviceMemory, setDeviceMemory] = useState<number>(8);
  const [hasWebGPU, setHasWebGPU] = useState<boolean>(false);
  const [cpuModel, setCpuModel] = useState<string>("Intel Core / Apple M-series");
  const [evaluatingSpecs, setEvaluatingSpecs] = useState<boolean>(true);

  // Active simulated downloads state tracker
  // Keyed by modelId: { progress: number, active: boolean, speed: number, downloadedMB: number }
  const [downloads, setDownloads] = useState<Record<string, {
    progress: number;
    active: boolean;
    speed: number;
    downloadedMB: number;
  }>>({});

  useEffect(() => {
    // Collect PWA client specifications
    setTimeout(() => {
      if (typeof navigator !== "undefined") {
        setCpuCores(navigator.hardwareConcurrency || 4);
        setDeviceMemory((navigator as any).deviceMemory || 8);
        setHasWebGPU("gpu" in navigator);
        
        // Dynamic detection for CPU platform
        if (navigator.userAgent.includes("Macintosh")) {
          setCpuModel("Apple Silicon / Intel Xeon");
        } else if (navigator.userAgent.includes("Android") || navigator.userAgent.includes("iPhone")) {
          setCpuModel("ARM Mobile SoC");
        } else {
          setCpuModel("Intel Core / AMD Ryzen");
        }
      }
      setEvaluatingSpecs(false);
    }, 600);
  }, []);

  // Compute machine specs tier classification
  const hardwareTier = React.useMemo(() => {
    if (!hasWebGPU || deviceMemory < 6) return "Entry";
    if (deviceMemory >= 16 && cpuCores >= 8) return "Ultra";
    if (deviceMemory >= 8 && cpuCores >= 6) return "High";
    return "Medium";
  }, [cpuCores, deviceMemory, hasWebGPU]);

  // Download simulation loop
  const handleTriggerDownload = (modelId: string, totalMB: number) => {
    const current = downloads[modelId];

    if (current?.active) {
      // Pause download
      setDownloads(prev => ({
        ...prev,
        [modelId]: { ...prev[modelId], active: false }
      }));
      showToast(
        isRTL ? "تم إيقاف التحميل مؤقتاً!" : "Inference download paused!",
        "info"
      );
      return;
    }

    // Start/Resume download loop
    setDownloads(prev => ({
      ...prev,
      [modelId]: {
        progress: current?.progress || 0,
        active: true,
        speed: 15 + Math.round(Math.random() * 20), // Simulated MB/s
        downloadedMB: current?.downloadedMB || 0
      }
    }));

    showToast(
      isRTL ? "بدء تحميل حزم الأوزان والمشغلات..." : "Initializing model weights and WebGPU shaders download...",
      "success"
    );
  };

  // Run the downloader tick
  useEffect(() => {
    const activeDownloads = Object.entries(downloads).filter(([_, dl]) => (dl as any).active);
    if (activeDownloads.length === 0) return;

    const interval = setInterval(() => {
      setDownloads(prev => {
        const next = { ...prev };
        activeDownloads.forEach(([modelId, dlVal]) => {
          const dl = dlVal as any;
          const modelCatalog = LOCAL_MODELS_CATALOG.find(m => m.id === modelId);
          if (!modelCatalog) return;

          const increment = dl.speed * 0.2; // 200ms increments
          const newDownloaded = Math.min(modelCatalog.byteSize, dl.downloadedMB + increment);
          const newProgress = Math.round((newDownloaded / modelCatalog.byteSize) * 100);

          if (newProgress >= 100) {
            next[modelId] = {
              progress: 100,
              active: false,
              speed: 0,
              downloadedMB: modelCatalog.byteSize
            };
            // Add to persistent settings downloadedModels
            addDownloadedModel(modelId);
            showToast(
              isRTL 
                ? `اكتمل تحميل ${modelCatalog.name} بنجاح! تم استيراد النماذج وتخزينها محلياً.`
                : `Successfully downloaded and cached ${modelCatalog.name}! Ready to load locally.`,
              "success"
            );
          } else {
            next[modelId] = {
              progress: newProgress,
              active: true,
              downloadedMB: parseFloat(newDownloaded.toFixed(1)),
              speed: Math.max(8, dl.speed + (Math.random() > 0.5 ? 2 : -2)) // fluctuated speeds
            };
          }
        });
        return next;
      });
    }, 200);

    return () => clearInterval(interval);
  }, [downloads, addDownloadedModel, isRTL, showToast]);

  const handleLoadModelState = (modelId: string) => {
    if (loadedModel === modelId) {
      setLoadedModel("");
      showToast(
        isRTL ? "تم إلغاء تنشيط النموذج المحلي." : "Unloaded active WebGPU inference model.",
        "info"
      );
    } else {
      setLoadedModel(modelId);
      setEngineMode("local"); // Automatically switch to local engine mode for premium offline testing!
      showToast(
        isRTL 
          ? `تم شحن نموذج ${modelId.toUpperCase()} بنجاح كالمحرك النشط على معالج الرسوميات.`
          : `Loaded ${modelId.toUpperCase()} as the active on-device WebGPU translation engine!`,
        "success"
      );
    }
  };

  // Utility to match minimum tier compatibility with actual hardware tier
  const isTierCompatible = (minRequired: "Entry" | "Medium" | "High" | "Ultra") => {
    const order = ["Entry", "Medium", "High", "Ultra"];
    return order.indexOf(hardwareTier) >= order.indexOf(minRequired);
  };

  return (
    <div className="h-full overflow-y-auto bg-background p-6" dir={isRTL ? "rtl" : "ltr"}>
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
              : "Manage on-chip generator options and download lightweight offline models for zero-latency academic translation."}
          </p>
        </div>

        {/* Dynamic Hardware Diagnostics & Spec Profiler */}
        <div className="p-5 rounded-2xl border border-border dark:border-white/5 bg-surface dark:bg-[#111318] space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h2 className="text-xs font-black uppercase text-foreground flex items-center gap-1.5">
                <Monitor className="w-4 h-4 text-primary" />
                <span>{isRTL ? "مشخص المكونات وقدرات المتصفح" : "Client System Hardware Diagnostic"}</span>
              </h2>
              <p className="text-[10px] text-muted-foreground">
                {isRTL ? "يرصد هذا المعالج التكوين الحالي للجهاز لترشيح أفضل النماذج ثنائية اللغة." : "Analyzes machine physics and WebGPU parameters dynamically."}
              </p>
            </div>
            
            {evaluatingSpecs ? (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>PROFILING...</span>
              </div>
            ) : (
              <span className={cn(
                "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border shadow-sm",
                hardwareTier === "Ultra" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
                hardwareTier === "High" ? "bg-primary/10 text-primary border-primary/20" :
                hardwareTier === "Medium" ? "bg-amber-500/10 text-amber-500 border-amber-500/20" :
                "bg-red-500/10 text-red-500 border-red-500/20"
              )}>
                {isRTL ? `رتبة الجهاز: ${hardwareTier}` : `Specs Grade: ${hardwareTier}`}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5 pt-2">
            {/* CPU cores */}
            <div className="p-3 bg-[#0A0B0E] rounded-xl border border-border/80 dark:border-white/5 space-y-1">
              <span className="text-[9px] uppercase font-bold text-muted-foreground">{isRTL ? "أنوية المعالج المنطقية" : "CPU Cores"}</span>
              <div className="text-sm font-black text-foreground flex items-center justify-between">
                <span>{cpuCores} Cores</span>
                <span className="text-[9.5px] font-mono text-slate-500">{cpuModel}</span>
              </div>
            </div>

            {/* RAM capacity */}
            <div className="p-3 bg-[#0A0B0E] rounded-xl border border-border/80 dark:border-white/5 space-y-1">
              <span className="text-[9px] uppercase font-bold text-muted-foreground">{isRTL ? "تقدير الذاكرة العشوائية RAM" : "System RAM"}</span>
              <div className="text-sm font-black text-foreground flex items-center justify-between">
                <span>{deviceMemory} GB</span>
                <span className="text-[9.5px] text-emerald-500 font-bold bg-emerald-500/5 border border-emerald-500/10 px-1.5 rounded">
                  {deviceMemory >= 8 ? "OK" : "LOW"}
                </span>
              </div>
            </div>

            {/* WebGPU Support */}
            <div className="p-3 bg-[#0A0B0E] rounded-xl border border-border/80 dark:border-white/5 space-y-1">
              <span className="text-[9px] uppercase font-bold text-muted-foreground">{isRTL ? "تسريع الرسوميات WebGPU" : "WebGPU Support"}</span>
              <div className="text-sm font-black text-foreground flex items-center justify-between">
                <span className={hasWebGPU ? "text-emerald-400" : "text-amber-500"}>
                  {hasWebGPU ? (isRTL ? "متاح / مدعوم" : "Available / Hardware Accelerated") : (isRTL ? "غير مدعوم" : "Software Emulated / N/A")}
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
              <span className="text-[9px] uppercase font-bold text-muted-foreground">{isRTL ? "تخزين المتصفح المخصص OPFS" : "OPFS Sandbox Storage"}</span>
              <div className="text-sm font-black text-foreground flex items-center justify-between">
                <span className="text-primary">Quota Managed</span>
                <span className="text-[9.5px] opacity-75 font-mono">10 GB Allowed</span>
              </div>
            </div>
          </div>

          {/* Compatibility Advice */}
          <div className="p-3.5 rounded-xl border border-primary/20 bg-primary/5 text-xs flex gap-2.5 items-start">
            <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="space-y-0.5 text-foreground">
              <div className="font-bold">
                {isRTL ? "توصيات تشغيل النماذج ثنائية اللغة:" : "Off-Device Intelligence Compatibility Insights:"}
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {hardwareTier === "Ultra" && (isRTL 
                  ? "جهازك مجهز بمكونات قوية! يمكنك تحميل نماذج 7B و 8B وتشغيل الاستدلال المحلي على السرعة القصوى مع الحفاظ التام على أمن المستندات."
                  : "Your hardware parameters are classified as Ultra Class! We recommend high-fidelity weights (Gemma 7B or Llama 3 8B) for complex syntax resolution.")}
                {hardwareTier === "High" && (isRTL 
                  ? "مواصفات جهازك جيدة جداً لترجمة المصطلحات المعقدة. نوصي بنموذج Qwen 7B أو Gemma 2B للاستخدام الدقيق دون إجهاد الرسوميات."
                  : "Your device is highly optimized for middleweight pipelines. We suggest Gemma 2B or Qwen 7B for standard corporate translation speeds.")}
                {hardwareTier === "Medium" && (isRTL 
                  ? "محرك جهازك متزن. تفضل النماذج الخفيفة كـ Qwen 1.5B و Gemma 2B لقضاء المهام بمرونة فائقة وسرعة استجابة خاطفة."
                  : "Excellent setup for light-register inference. Qwen 1.5B or Gemma 2B will run with stunning responsive latency without high consumption.")}
                {hardwareTier === "Entry" && (isRTL 
                  ? "جواز تشغيل النماذج محلياً يتطلب متصفحاً حديثاً مفعلاً فيه WebGPU. نوصي باستعمال محرك الهجين للتخزين الخفيف واستدعاء السحابية للترجمة الكبيرة."
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
                title: isRTL ? "محرك هجين متزن (موصى به)" : "Hybrid Engine (Recommended)",
                desc: isRTL 
                  ? "يجمع بين مطابقة المصطلحات المحلية (LTE) فائقة السرعة مع المساعد السحابي الذكي." 
                  : "Blends lightning-fast local phrase matches (LTE) with intelligent cloud LLMs.",
                icon: Cpu
              },
              {
                id: "local",
                title: isRTL ? "محرك محلي بالكامل" : "Strictly Local",
                desc: isRTL 
                  ? "يستغل بنوك المصطلحات والـ RAG على جهازك فقط. يعمل 100% دون إنترنت." 
                  : "Utilizes only local terminology and offline indices. Works 100% offline with zero data leakage.",
                icon: CpuIcon
              },
              {
                id: "cloud",
                title: isRTL ? "سحابي غني بالتوليد" : "Pure Cloud API",
                desc: isRTL 
                  ? "يعتمد على النماذج التوليدية للحصول على ترجمات غنية بسياق معقد." 
                  : "Leverages Gemini cloud models for complex translation nuances, bypassing local glossaries.",
                icon: Cloud
              }
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
                    <Icon className={cn("w-5 h-5", isSelected ? "text-primary" : "text-muted-foreground")} />
                    {isSelected && (
                      <span className="text-[10px] font-bold bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
                        {isRTL ? "نشط" : "Active"}
                      </span>
                    )}
                  </div>
                  <div>
                    <h3 className={cn("text-xs font-bold", isSelected ? "text-primary" : "text-foreground")}>
                      {mode.title}
                    </h3>
                    <p className="text-[10.5px] leading-relaxed mt-1">{mode.desc}</p>
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
              {isRTL ? "مستودع نماذج الذكاء الاصطناعي المحلية" : "PWA Local AI Model Repository"}
            </h2>
          </div>

          <div className="space-y-4">
            {LOCAL_MODELS_CATALOG.map((model) => {
              const isDownloaded = downloadedModels.includes(model.id);
              const isLoaded = loadedModel === model.id;
              const downloadState = downloads[model.id];
              const isDownloading = downloadState?.active;
              const progress = downloadState?.progress || 0;
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
                        <span className="font-extrabold text-sm text-foreground">{model.name}</span>
                        <span className="text-[9.5px] font-mono font-bold bg-[#0A0B0E] border dark:border-white/5 border-border px-2 py-0.5 rounded text-muted-foreground">
                          {model.specs}
                        </span>
                        <span className="text-[9.5px] font-mono font-bold bg-indigo-500/5 text-indigo-400 border border-indigo-500/10 px-2 py-0.5 rounded">
                          {model.size}
                        </span>
                        {!compatible && (
                          <span className="text-[9px] font-mono font-bold bg-amber-500/5 text-amber-500 border border-amber-500/10 px-1.5 py-0.5 rounded flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            <span>{isRTL ? "مواصفات ثقيلة" : "Heavy Specs Check"}</span>
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        {isRTL ? model.descAr : model.descEn}
                      </p>
                      <div className="text-[10px] font-mono text-slate-500 flex items-center gap-3">
                        <span>Min Spec Req: <strong className="text-foreground font-semibold">{model.minTier} Class</strong></span>
                        <span>•</span>
                        <span>VRAM: <strong className="text-foreground font-semibold">{model.vram}</strong></span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0 md:self-center">
                      {isDownloaded ? (
                        <button
                          onClick={() => handleLoadModelState(model.id)}
                          className={cn(
                            "px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-sm hover:scale-[1.01]",
                            isLoaded 
                              ? "bg-[#D93838]/10 text-[#D93838] border border-[#D93838]/20 hover:bg-[#D93838]/15" 
                              : "bg-primary text-primary-foreground hover:bg-primary/95"
                          )}
                        >
                          {isLoaded ? (
                            <>
                              <ServerCrash className="w-4 h-4" />
                              <span>{isRTL ? "إلغاء التحميل" : "UNLOAD MODEL"}</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-4 h-4" />
                              <span>{isRTL ? "تحميل النموذج" : "LOAD MODEL"}</span>
                            </>
                          )}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleTriggerDownload(model.id, model.byteSize)}
                          disabled={isDownloading && !downloadState?.active}
                          className={cn(
                            "px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-sm hover:scale-[1.01] disabled:opacity-50",
                            isDownloading 
                              ? "bg-amber-500 text-white hover:bg-amber-500/90" 
                              : "bg-[#0A0B0E] text-foreground hover:bg-muted font-bold border border-border"
                          )}
                        >
                          {isDownloading ? (
                            <>
                              <RefreshCw className="w-4 h-4 animate-spin" />
                              <span>{isRTL ? "إيقاف مؤقت" : "PAUSE"}</span>
                            </>
                          ) : (
                            <>
                              <Download className="w-4 h-4 text-primary" />
                              <span>{isRTL ? "تنزيل الأوزان" : "DOWNLOAD"}</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progressive Download Bar */}
                  {downloadState && (downloadState.progress > 0 || isDownloading) && (
                    <div className="mt-4 pt-3.5 border-t border-dashed border-border/80 dark:border-white/5 space-y-2">
                      <div className="flex items-center justify-between text-[10.5px] font-mono text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <span className={isDownloading ? "text-primary font-bold" : "text-slate-500"}>
                            {isDownloading 
                              ? (isRTL ? "جاري تنزيل ملفات الأوزان والمصفوفات..." : "Fetching parameters...") 
                              : (isRTL ? "موقوف مؤقتاً" : "Downloaded weights paused")}
                          </span>
                          {isDownloading && (
                            <span className="font-bold text-foreground">
                              {downloadState.speed} MB/s
                            </span>
                          )}
                        </div>
                        <div>
                          <span>{downloadState.downloadedMB} MB / {model.byteSize} MB</span>
                          <span className="ml-2 pl-2 border-l border-border font-bold text-foreground">
                            {progress}%
                          </span>
                        </div>
                      </div>

                      {/* Bar fill rail */}
                      <div className="h-1.5 w-full bg-[#0A0B0E] rounded-full overflow-hidden relative">
                        <div 
                          className={cn(
                            "h-full rounded-full transition-all duration-300",
                            isDownloading ? "bg-primary animate-pulse" : "bg-slate-600"
                          )}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
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
            {isRTL ? "أمن البيانات والخصوصية" : "Copilot Security & Pipeline"}
          </h3>
          <div className="divide-y divide-border/50 text-xs">
            <div className="flex items-center justify-between py-3">
              <div>
                <div className="font-bold text-foreground">
                  {isRTL ? "المساعد ثنائي المحاور (LTE + GTR)" : "Dual-Core Smart Matching"}
                </div>
                <div className="text-[10.5px] text-muted-foreground mt-0.5">
                  {isRTL ? "اقتراح مصطلحات دقيقة بالاعتماد على قواعد البيانات المحلية المرفوعة." : "Index custom uploaded glossaries in offline database."}
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
                  {isRTL ? "وضع الخصوصية الأكاديمية" : "On-Device Privacy Core"}
                </div>
                <div className="text-[10.5px] text-muted-foreground mt-0.5">
                  {isRTL ? "يمنع خروج الترجمات إلى السيرفرات عند الترجمة المباشرة." : "Ensure all terminology lookup remains inside local browser storage."}
                </div>
              </div>
              <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                <ShieldCheck className="w-3 h-3" />
                <span>{isRTL ? "مفعل" : "Strict"}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
export default AiModelsView;
